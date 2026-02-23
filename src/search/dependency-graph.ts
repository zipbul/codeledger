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
   * @returns An array of cycles, where each cycle is a `string[]` of file paths.
   */
  getCyclePaths(): string[][] {
    const seenCycles = new Set<string>();
    const cycles: string[][] = [];
    const globalVisited = new Set<string>();
    const inPath = new Map<string, number>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      if (globalVisited.has(node)) return;
      if (inPath.has(node)) {
        const cycleStart = inPath.get(node)!;
        const cycle = path.slice(cycleStart);
        const minNode = cycle.reduce((a, b) => (a <= b ? a : b));
        const idx = cycle.indexOf(minNode);
        const canonical = [...cycle.slice(idx), ...cycle.slice(0, idx)];
        const key = canonical.join('\0');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(canonical);
        }
        return;
      }
      inPath.set(node, path.length);
      path.push(node);
      for (const neighbor of this.adjacencyList.get(node) ?? []) {
        dfs(neighbor);
      }
      path.pop();
      inPath.delete(node);
      globalVisited.add(node);
    };

    for (const startNode of this.adjacencyList.keys()) {
      dfs(startNode);
    }

    return cycles;
  }
}
