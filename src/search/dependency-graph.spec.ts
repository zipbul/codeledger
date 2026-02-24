import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RelationRecord } from '../store/repositories/relation.repository';
import { DependencyGraph } from './dependency-graph';
import type { IDependencyGraphRepo } from './dependency-graph';

function makeImport(srcFilePath: string, dstFilePath: string): RelationRecord {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath,
    srcSymbolName: null,
    dstFilePath,
    dstSymbolName: null,
    metaJson: null,
  };
}

let mockGetByType: ReturnType<typeof mock>;
let mockRepo: IDependencyGraphRepo;
let graph: DependencyGraph;

beforeEach(() => {
  mockGetByType = mock((project: string, type: string) => [] as RelationRecord[]);
  mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
  graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
});

describe('DependencyGraph', () => {

  it('should populate adjacencyList when build() loads imports relations', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.getDependencies('src/a.ts')).toContain('src/b.ts');
  });

  it('should populate reverseAdjacencyList when build() completes', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.getDependents('src/b.ts')).toContain('src/a.ts');
  });

  it('should result in empty graph after build() when DB has no imports relations', async () => {
    await graph.build();
    expect(graph.getDependencies('src/a.ts')).toEqual([]);
    expect(graph.getDependents('src/a.ts')).toEqual([]);
  });

  it('should call getByType for imports, type-references and re-exports when build() is called', async () => {
    await graph.build();
    expect(mockGetByType).toHaveBeenCalledTimes(3);
    const calledTypes = mockGetByType.mock.calls.map(([, t]) => t);
    expect(calledTypes).toContain('imports');
    expect(calledTypes).toContain('type-references');
    expect(calledTypes).toContain('re-exports');
  });

  // [HP] re-exports type included in graph
  it('should include re-exports relation in getDependencies when build() loads re-exports type', async () => {
    mockGetByType = mock((project: string, type: string) => {
      if (type === 're-exports') {
        return [{ project: 'test-project', type: 're-exports', srcFilePath: 'src/barrel.ts', dstFilePath: 'src/impl.ts', srcSymbolName: null, dstSymbolName: null, metaJson: null }];
      }
      return [];
    });
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.getDependencies('src/barrel.ts')).toContain('src/impl.ts');
  });

  it('should include type-references relation in getDependencies when build() loads it', async () => {
    mockGetByType = mock((project: string, type: string) => {
      if (type === 'type-references') {
        return [{ project: 'test-project', type: 'type-references', srcFilePath: 'src/a.ts', dstFilePath: 'src/types.ts', srcSymbolName: null, dstSymbolName: null, metaJson: null }];
      }
      return [];
    });
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.getDependencies('src/a.ts')).toContain('src/types.ts');
  });

  it('should include imports relation in getDependencies when build() loads type-references as well', async () => {
    mockGetByType = mock((project: string, type: string) => {
      if (type === 'imports') {
        return [makeImport('src/a.ts', 'src/b.ts')];
      }
      return [];
    });
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.getDependencies('src/a.ts')).toContain('src/b.ts');
  });

  it('should replace old graph data when build() is called a second time', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    mockGetByType = mock(() => [makeImport('src/c.ts', 'src/d.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.getDependencies('src/a.ts')).toEqual([]);
    expect(graph.getDependencies('src/c.ts')).toContain('src/d.ts');
  });

  it('should return direct dependencies when graph was built', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/a.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getDependencies('src/a.ts');
    expect(deps).toContain('src/b.ts');
    expect(deps).toContain('src/c.ts');
    expect(deps).toHaveLength(2);
  });

  it('should return [] from getDependencies when filePath is not in the graph', () => {
    const deps = graph.getDependencies('src/unknown.ts');
    expect(deps).toEqual([]);
  });

  it('should return [] from getDependencies when file has no outgoing imports', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getDependencies('src/b.ts');
    expect(deps).toEqual([]);
  });

  it('should return direct importers when graph was built', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/x.ts'),
      makeImport('src/b.ts', 'src/x.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getDependents('src/x.ts');
    expect(deps).toContain('src/a.ts');
    expect(deps).toContain('src/b.ts');
    expect(deps).toHaveLength(2);
  });

  it('should return [] from getDependents when filePath is not imported by anyone', () => {
    const deps = graph.getDependents('src/unknown.ts');
    expect(deps).toEqual([]);
  });

  it('should return [] from getDependents when file has no incoming imports', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getDependents('src/a.ts');
    expect(deps).toEqual([]);
  });

  it('should return all transitively dependent files when BFS traverses built graph', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getTransitiveDependents('src/c.ts');
    expect(deps).toContain('src/b.ts');
    expect(deps).toContain('src/a.ts');
    expect(deps).toHaveLength(2);
  });

  it('should not include the input filePath itself when getTransitiveDependents returns result', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getTransitiveDependents('src/b.ts');
    expect(deps).not.toContain('src/b.ts');
    expect(deps).toContain('src/a.ts');
  });

  it('should return [] from getTransitiveDependents when filePath has no dependents', async () => {
    const deps = graph.getTransitiveDependents('src/unknown.ts');
    expect(deps).toEqual([]);
  });

  it('should deduplicate results when getTransitiveDependents handles diamond dependency', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/a.ts', 'src/d.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/d.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getTransitiveDependents('src/c.ts');
    const count = deps.filter(f => f === 'src/a.ts').length;
    expect(count).toBe(1);
    expect(deps).toContain('src/b.ts');
    expect(deps).toContain('src/d.ts');
    expect(deps).toContain('src/a.ts');
  });

  it('should not loop infinitely when cycle exists during getTransitiveDependents', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getTransitiveDependents('src/b.ts');
    expect(Array.isArray(deps)).toBe(true);
  });

  it('should traverse long chain correctly when getTransitiveDependents is called', async () => {
    mockGetByType = mock(() => [
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/d.ts'),
      makeImport('src/d.ts', 'src/e.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getTransitiveDependents('src/e.ts');
    expect(deps).toContain('src/d.ts');
    expect(deps).toContain('src/c.ts');
    expect(deps).toContain('src/b.ts');
    expect(deps).toHaveLength(3);
  });

  it('should return an Array (not Set) when getTransitiveDependents is called', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getTransitiveDependents('src/b.ts');
    expect(Array.isArray(deps)).toBe(true);
  });

  it('should return false from hasCycle() when there are no cycles', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.hasCycle()).toBe(false);
  });

  it('should return true from hasCycle() when a simple cycle exists', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.hasCycle()).toBe(true);
  });

  it('should return true from hasCycle() when a self-loop exists', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/a.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.hasCycle()).toBe(true);
  });

  it('should return false from hasCycle() when graph is empty', async () => {
    await graph.build();
    expect(graph.hasCycle()).toBe(false);
  });

  it('should return true from hasCycle() when cycle exists in a subgraph (other part acyclic)', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/c.ts', 'src/d.ts'),
      makeImport('src/d.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.hasCycle()).toBe(true);
  });

  it('should return true from hasCycle() when long cycle exists', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.hasCycle()).toBe(true);
  });

  it('should return transitive dependents when a single file is changed', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const affected = graph.getAffectedByChange(['src/c.ts']);
    expect(affected).toContain('src/b.ts');
    expect(affected).toContain('src/a.ts');
  });

  it('should return deduplicated union when multiple files are changed', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/x.ts'),
      makeImport('src/b.ts', 'src/x.ts'),
      makeImport('src/c.ts', 'src/y.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const affected = graph.getAffectedByChange(['src/x.ts', 'src/y.ts']);
    expect(affected).toContain('src/a.ts');
    expect(affected).toContain('src/b.ts');
    expect(affected).toContain('src/c.ts');
  });

  it('should return [] from getAffectedByChange when changed files have no dependents', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const affected = graph.getAffectedByChange(['src/a.ts']);
    expect(affected).toEqual([]);
  });

  it('should return [] from getAffectedByChange when changedFiles is empty array', async () => {
    await graph.build();
    const affected = graph.getAffectedByChange([]);
    expect(affected).toEqual([]);
  });

  it('should return [] from getAffectedByChange when changed file is unknown', async () => {
    await graph.build();
    const affected = graph.getAffectedByChange(['src/unknown.ts']);
    expect(affected).toEqual([]);
  });

  it('should deduplicate overlapping dependents when multiple changed files share importers', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/x.ts'),
      makeImport('src/a.ts', 'src/y.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const affected = graph.getAffectedByChange(['src/x.ts', 'src/y.ts']);
    const countA = affected.filter(f => f === 'src/a.ts').length;
    expect(countA).toBe(1);
  });

  it('should return [] from getDependencies when build() was not called', () => {
    const deps = graph.getDependencies('src/a.ts');
    expect(deps).toEqual([]);
  });

  it('should reflect loaded data when getDependencies is called after build()', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.getDependencies('src/a.ts')).toEqual(['src/b.ts']);
  });

  it('should reflect new data when rebuild runs with different relations', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    mockGetByType = mock(() => [makeImport('src/c.ts', 'src/d.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    expect(graph.getDependencies('src/a.ts')).toEqual([]);
    expect(graph.getDependencies('src/c.ts')).toEqual(['src/d.ts']);
  });

  it('should build a single-edge graph correctly when one relation exists', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const deps = graph.getDependencies('src/a.ts');
    const revDeps = graph.getDependents('src/b.ts');
    expect(deps).toEqual(['src/b.ts']);
    expect(revDeps).toEqual(['src/a.ts']);
  });

  // ─── FR-03: getAdjacencyList ───

  it('should return a Map with edge entries when getAdjacencyList is called after build', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const map = graph.getAdjacencyList();

    expect(map).toBeInstanceOf(Map);
    expect(map.get('src/a.ts')).toContain('src/b.ts');
  });

  it('should include destination-only node as key with empty array when getAdjacencyList is called', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const map = graph.getAdjacencyList();

    expect(map.has('src/b.ts')).toBe(true);
    expect(map.get('src/b.ts')).toEqual([]);
  });

  it('should return empty Map when getAdjacencyList is called on empty graph', async () => {
    await graph.build();

    const map = graph.getAdjacencyList();

    expect(map.size).toBe(0);
  });

  it('should return all edges from node when node has multiple outgoing edges', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/a.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const map = graph.getAdjacencyList();

    expect(map.get('src/a.ts')).toContain('src/b.ts');
    expect(map.get('src/a.ts')).toContain('src/c.ts');
    expect(map.get('src/a.ts')).toHaveLength(2);
  });

  // ─── FR-13: getTransitiveDependencies ───

  it('should return all transitive dependencies when chain A→B→C exists', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const deps = graph.getTransitiveDependencies('src/a.ts');

    expect(deps).toContain('src/b.ts');
    expect(deps).toContain('src/c.ts');
    expect(deps).toHaveLength(2);
  });

  it('should return empty array when file has no dependencies in getTransitiveDependencies', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const deps = graph.getTransitiveDependencies('src/b.ts');

    expect(deps).toEqual([]);
  });

  it('should not loop infinitely when cycle exists in getTransitiveDependencies', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const deps = graph.getTransitiveDependencies('src/a.ts');

    expect(Array.isArray(deps)).toBe(true);
  });

  it('should return empty array when unknown file is passed to getTransitiveDependencies', async () => {
    await graph.build();

    const deps = graph.getTransitiveDependencies('src/unknown.ts');

    expect(deps).toEqual([]);
  });

  // ─── FR-04: getCyclePaths ───

  it('should return empty array when there are no cycles in getCyclePaths', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toEqual([]);
  });

  it('should return the 2-node cycle when A→B→A exists', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('src/a.ts');
    expect(paths[0]).toContain('src/b.ts');
    expect(paths[0]).toHaveLength(2);
  });

  it('should return the 3-node cycle when A→B→C→A exists', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(3);
    expect(paths[0]).toContain('src/a.ts');
    expect(paths[0]).toContain('src/b.ts');
    expect(paths[0]).toContain('src/c.ts');
  });

  it('should return two cycles when two independent cycles exist', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
      makeImport('src/c.ts', 'src/d.ts'),
      makeImport('src/d.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toHaveLength(2);
  });

  it('should return a single-node cycle when a self-loop exists', async () => {
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/a.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toHaveLength(1);
    expect(paths[0]).toEqual(['src/a.ts']);
  });

  it('should return empty array from getCyclePaths when graph is empty', async () => {
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toEqual([]);
  });

  // ─── F-3: Tarjan SCC + Johnson's circuits ───

  it('should find both elementary circuits when two cycles share a common node', async () => {
    // A→B→A and B→C→B share node B → single SCC {A,B,C} → 2 circuits
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/b.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toHaveLength(2);
    const flat = paths.map(p => p.join('->'));
    expect(flat.some(s => s.includes('src/a.ts') && s.includes('src/b.ts'))).toBe(true);
    expect(flat.some(s => s.includes('src/b.ts') && s.includes('src/c.ts'))).toBe(true);
  });

  it('should return canonical form with lexicographically smallest node first when cycle nodes are unordered', async () => {
    // Z→A→M→Z cycle → canonical rotation starts with A
    mockGetByType = mock(() => [
      makeImport('src/z.ts', 'src/a.ts'),
      makeImport('src/a.ts', 'src/m.ts'),
      makeImport('src/m.ts', 'src/z.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toHaveLength(1);
    expect(paths[0]![0]).toBe('src/a.ts');
  });

  it('should find all elementary circuits in overlapping cycles within single SCC', async () => {
    // A→B→C→A and A→B→A (shortcut) → same SCC, 2 distinct elementary circuits
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/a.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths.length).toBeGreaterThanOrEqual(2);
    // Should have [A,B] and [A,B,C]
    const lengths = paths.map(p => p.length).sort();
    expect(lengths).toContain(2);
    expect(lengths).toContain(3);
  });

  it('should limit result count when maxCycles option is provided', async () => {
    // 3 independent cycles, maxCycles=1 → only 1 returned
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
      makeImport('src/c.ts', 'src/d.ts'),
      makeImport('src/d.ts', 'src/c.ts'),
      makeImport('src/e.ts', 'src/f.ts'),
      makeImport('src/f.ts', 'src/e.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths({ maxCycles: 1 });

    expect(paths).toHaveLength(1);
  });

  it('should return all cycles when maxCycles is not specified', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
      makeImport('src/c.ts', 'src/d.ts'),
      makeImport('src/d.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toHaveLength(2);
  });

  it('should return empty array when maxCycles is 0', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths({ maxCycles: 0 });

    expect(paths).toEqual([]);
  });

  it('should return each self-loop as separate cycle when multiple nodes have self-loops', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/a.ts'),
      makeImport('src/b.ts', 'src/b.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    expect(paths).toHaveLength(2);
    const flat = paths.flat();
    expect(flat).toContain('src/a.ts');
    expect(flat).toContain('src/b.ts');
  });

  it('should count self-loops toward maxCycles limit when both self-loops and multi-node cycles exist', async () => {
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/a.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/b.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths({ maxCycles: 1 });

    expect(paths).toHaveLength(1);
  });

  it('should return same cycles regardless of relation insertion order', async () => {
    // Order 1: A→B first, then B→A
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const paths1 = graph.getCyclePaths();

    // Order 2: B→A first, then A→B
    mockGetByType = mock(() => [
      makeImport('src/b.ts', 'src/a.ts'),
      makeImport('src/a.ts', 'src/b.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    const paths2 = graph.getCyclePaths();

    expect(paths1).toEqual(paths2);
  });

  it('should find all elementary circuits in complete K3 graph', async () => {
    // A↔B, B↔C, A↔C — complete graph of 3 nodes
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/b.ts'),
      makeImport('src/a.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();

    const paths = graph.getCyclePaths();

    // K3 has: [A,B], [B,C], [A,C], [A,B,C], [A,C,B] = 5 elementary circuits
    expect(paths.length).toBeGreaterThanOrEqual(5);
  });
});
