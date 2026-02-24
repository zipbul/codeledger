import type { RelationRecord } from '../store/repositories/relation.repository';

export interface IDependencyGraphRepo {
  getByType(project: string, type: string): RelationRecord[];
}

/**
 * Directed import graph for dependency analysis.
 *
 * Build the graph once with {@link DependencyGraph.build}, then query
 * dependencies, dependents, cycles, and change-impact.
 *
 * @example
 * ```ts
 * const graph = new DependencyGraph({ relationRepo, project: 'my-app' });
 * graph.build();
 * graph.getDependencies('/src/a.ts');  // files that a.ts imports
 * graph.getDependents('/src/a.ts');    // files that import a.ts
 * graph.hasCycle();                     // true if a circular import exists
 * ```
 */
export class DependencyGraph {
  private adjacencyList = new Map<string, Set<string>>();
  private reverseAdjacencyList = new Map<string, Set<string>>();

  constructor(
    private readonly options: {
      relationRepo: IDependencyGraphRepo;
      project: string;
    },
  ) {}

  /**
   * Populate the graph by reading all `imports` relations from the store.
   *
   * Must be called before any query method.
   */
  build(): void {
    this.adjacencyList = new Map();
    this.reverseAdjacencyList = new Map();

    const relations = [
      ...this.options.relationRepo.getByType(this.options.project, 'imports'),
      ...this.options.relationRepo.getByType(this.options.project, 'type-references'),
      ...this.options.relationRepo.getByType(this.options.project, 're-exports'),
    ];

    for (const rel of relations) {
      const { srcFilePath, dstFilePath } = rel;

      if (!this.adjacencyList.has(srcFilePath)) {
        this.adjacencyList.set(srcFilePath, new Set());
      }
      this.adjacencyList.get(srcFilePath)!.add(dstFilePath);

      // ensure destination node also appears as a key (with no outgoing edges)
      if (!this.adjacencyList.has(dstFilePath)) {
        this.adjacencyList.set(dstFilePath, new Set());
      }

      if (!this.reverseAdjacencyList.has(dstFilePath)) {
        this.reverseAdjacencyList.set(dstFilePath, new Set());
      }
      this.reverseAdjacencyList.get(dstFilePath)!.add(srcFilePath);
    }
  }

  /**
   * Return the files that `filePath` directly imports.
   *
   * @param filePath - Absolute file path.
   */
  getDependencies(filePath: string): string[] {
    return Array.from(this.adjacencyList.get(filePath) ?? []);
  }

  /**
   * Return the files that directly import `filePath`.
   *
   * @param filePath - Absolute file path.
   */
  getDependents(filePath: string): string[] {
    return Array.from(this.reverseAdjacencyList.get(filePath) ?? []);
  }

  /**
   * Return all files that transitively depend on `filePath`
   * (breadth-first reverse walk).
   *
   * @param filePath - Absolute file path.
   */
  getTransitiveDependents(filePath: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [filePath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dependent of this.reverseAdjacencyList.get(current) ?? []) {
        if (!visited.has(dependent)) {
          visited.add(dependent);
          queue.push(dependent);
        }
      }
    }

    return Array.from(visited);
  }

  /**
   * Detect whether the import graph contains at least one cycle.
   *
   * Uses iterative DFS with a path-tracking set.
   *
   * @returns `true` if a circular dependency exists.
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const inPath = new Set<string>();

    for (const startNode of this.adjacencyList.keys()) {
      if (visited.has(startNode)) continue;

      const stack: Array<{ node: string; entered: boolean }> = [{ node: startNode, entered: false }];

      while (stack.length > 0) {
        const current = stack.pop()!;

        if (current.entered) {
          inPath.delete(current.node);
          continue;
        }

        if (inPath.has(current.node)) {
          return true;
        }

        if (visited.has(current.node)) {
          continue;
        }

        visited.add(current.node);
        inPath.add(current.node);
        stack.push({ node: current.node, entered: true });

        for (const neighbor of this.adjacencyList.get(current.node) ?? []) {
          if (inPath.has(neighbor)) {
            return true;
          }
          if (!visited.has(neighbor)) {
            stack.push({ node: neighbor, entered: false });
          }
        }
      }
    }

    return false;
  }

  /**
   * Compute all files transitively affected by a set of changed files.
   *
   * Combines {@link getTransitiveDependents} for every changed file
   * and de-duplicates the result.
   *
   * @param changedFiles - Absolute paths of files that changed.
   * @returns Paths of all transitively-dependent files.
   */
  getAffectedByChange(changedFiles: string[]): string[] {
    const allAffected = new Set<string>();

    for (const file of changedFiles) {
      for (const dep of this.getTransitiveDependents(file)) {
        allAffected.add(dep);
      }
    }

    return Array.from(allAffected);
  }

  /**
   * Return the full import graph as an adjacency list.
   *
   * Each key is a file path (both source and destination files are included as keys).
   * The associated value lists the files it directly imports.
   *
   * @returns A new `Map<filePath, importedFilePaths[]>`.
   */
  getAdjacencyList(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [node, edges] of this.adjacencyList) {
      result.set(node, Array.from(edges));
    }
    return result;
  }

  /**
   * Return all files that `filePath` transitively imports
   * (breadth-first forward walk).
   *
   * @param filePath - Absolute file path.
   * @returns Paths of all transitively-imported files. Does not include `filePath` itself
   *   unless a cycle exists.
   */
  getTransitiveDependencies(filePath: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [filePath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of this.adjacencyList.get(current) ?? []) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }

    return Array.from(visited);
  }

  /**
   * Return the distinct cycle paths in the import graph.
   *
   * Each cycle is represented as a list of file paths in canonical form
   * (rotated so the lexicographically smallest node comes first).
   * Duplicate cycles are deduplicated.
   *
   * Tarjan SCC + Johnson's circuits. Finds all elementary circuits.
   *
   * @param options.maxCycles - Maximum number of cycles to return. Defaults to `Infinity`.
   * @returns An array of cycles, where each cycle is a `string[]` of file paths
   *   in canonical form (lexicographic rotation, smallest node first).
   */
  getCyclePaths(options?: { maxCycles?: number }): string[][] {
    const maxCycles = options?.maxCycles ?? Infinity;

    if (maxCycles <= 0) return [];

    // Build a Map<string, string[]> snapshot of the adjacencyList
    const adjacency = new Map<string, ReadonlyArray<string>>();
    for (const [node, edges] of this.adjacencyList) {
      adjacency.set(node, Array.from(edges));
    }

    return detectCycles(adjacency, maxCycles);
  }
}

// ─── Tarjan SCC + Johnson's circuits (module-level helpers) ───

const compareStrings = (a: string, b: string): number => a.localeCompare(b);

/**
 * Normalize a cycle to canonical form:
 * strip trailing duplicate, rotate so the lexicographically smallest node is first.
 */
function normalizeCycle(cycle: ReadonlyArray<string>): string[] {
  const unique =
    cycle.length > 1 && cycle[0] === cycle[cycle.length - 1]
      ? cycle.slice(0, -1)
      : [...cycle];

  if (unique.length === 0) return [];

  let best = unique;
  for (let i = 1; i < unique.length; i++) {
    const rotated = unique.slice(i).concat(unique.slice(0, i));
    if (rotated.join('::') < best.join('::')) {
      best = rotated;
    }
  }

  return [...best];
}

/**
 * Record a cycle into the result set, deduplicating by canonical key.
 * Returns true if the cycle was new (added), false if duplicate.
 */
function recordCyclePath(
  cycleKeys: Set<string>,
  cycles: string[][],
  path: ReadonlyArray<string>,
): boolean {
  const normalized = normalizeCycle(path);
  if (normalized.length === 0) return false;

  const key = normalized.join('->');
  if (cycleKeys.has(key)) return false;

  cycleKeys.add(key);
  cycles.push(normalized);
  return true;
}

interface SccResult {
  readonly components: ReadonlyArray<ReadonlyArray<string>>;
}

/**
 * Tarjan's SCC algorithm. Returns all strongly connected components.
 */
function tarjanScc(graph: Map<string, ReadonlyArray<string>>): SccResult {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const components: string[][] = [];

  const strongConnect = (node: string): void => {
    indices.set(node, index);
    lowlinks.set(node, index);
    index += 1;

    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowlinks.set(node, Math.min(lowlinks.get(node) ?? 0, lowlinks.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node) ?? 0, indices.get(next) ?? 0));
      }
    }

    if (lowlinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      let current = '';
      do {
        current = stack.pop() ?? '';
        onStack.delete(current);
        component.push(current);
      } while (current !== node && stack.length > 0);
      components.push(component);
    }
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  return { components };
}

/**
 * Johnson's elementary circuit algorithm.
 * Finds all elementary circuits within a single SCC sub-graph.
 */
function johnsonCircuits(
  scc: ReadonlyArray<string>,
  adjacency: Map<string, ReadonlyArray<string>>,
  maxCircuits: number,
): string[][] {
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();
  const nodes = [...scc].sort(compareStrings);

  const unblock = (node: string, blocked: Set<string>, blockMap: Map<string, Set<string>>): void => {
    blocked.delete(node);
    const blockedBy = blockMap.get(node);
    if (!blockedBy) return;
    for (const entry of blockedBy) {
      if (blocked.has(entry)) {
        unblock(entry, blocked, blockMap);
      }
    }
    blockedBy.clear();
  };

  for (let i = 0; i < nodes.length && cycles.length < maxCircuits; i++) {
    const start = nodes[i] ?? '';
    const allowed = new Set(nodes.slice(i));
    const blocked = new Set<string>();
    const blockMap = new Map<string, Set<string>>();
    const stack: string[] = [];

    const neighbors = (v: string): ReadonlyArray<string> =>
      (adjacency.get(v) ?? []).filter(e => allowed.has(e));

    const circuit = (node: string): boolean => {
      if (cycles.length >= maxCircuits) return true;

      let found = false;
      stack.push(node);
      blocked.add(node);

      for (const next of neighbors(node)) {
        if (cycles.length >= maxCircuits) break;

        if (next === start) {
          recordCyclePath(cycleKeys, cycles, stack.concat(start));
          found = true;
        } else if (!blocked.has(next)) {
          if (circuit(next)) {
            found = true;
          }
        }
      }

      if (found) {
        unblock(node, blocked, blockMap);
      } else {
        for (const next of neighbors(node)) {
          const set = blockMap.get(next) ?? new Set<string>();
          set.add(node);
          blockMap.set(next, set);
        }
      }

      stack.pop();
      return found;
    };

    circuit(start);
  }

  return cycles;
}

/**
 * Detect all elementary cycles using Tarjan SCC preprocessing + Johnson's circuits.
 */
function detectCycles(
  adjacency: Map<string, ReadonlyArray<string>>,
  maxCycles: number,
): string[][] {
  const { components } = tarjanScc(adjacency);
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();

  for (const component of components) {
    if (cycles.length >= maxCycles) break;

    if (component.length === 0) continue;

    if (component.length === 1) {
      const node = component[0] ?? '';
      const neighbors = adjacency.get(node) ?? [];
      if (neighbors.includes(node)) {
        recordCyclePath(cycleKeys, cycles, [node, node]);
      }
      continue;
    }

    const remaining = maxCycles - cycles.length;
    const circuits = johnsonCircuits(component, adjacency, remaining);

    for (const c of circuits) {
      if (cycles.length >= maxCycles) break;
      recordCyclePath(cycleKeys, cycles, c);
    }
  }

  return cycles;
}
