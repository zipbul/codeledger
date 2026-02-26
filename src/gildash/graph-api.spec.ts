import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GildashError } from '../errors';
import type { GildashContext } from './context';

// ─── DependencyGraph mock ───────────────────────────────────────────

const mockBuild = mock(() => {});
const mockGetAffectedByChange = mock((_files: string[]) => ['a.ts', 'b.ts'] as string[]);
const mockHasCycle = mock(() => false as boolean);
const mockGetAdjacencyList = mock(() => new Map([['a.ts', ['b.ts']]]));
const mockGetTransitiveDependencies = mock((_fp: string) => ['b.ts', 'c.ts'] as string[]);
const mockGetCyclePaths = mock((_opts?: any) => [] as string[][]);
const mockGraphGetDependents = mock((_fp: string) => ['x.ts'] as string[]);
const mockGraphGetDependencies = mock((_fp: string) => ['y.ts', 'z.ts'] as string[]);

class MockDependencyGraph {
  build = mockBuild;
  getAffectedByChange = mockGetAffectedByChange;
  hasCycle = mockHasCycle;
  getAdjacencyList = mockGetAdjacencyList;
  getTransitiveDependencies = mockGetTransitiveDependencies;
  getCyclePaths = mockGetCyclePaths;
  getDependents = mockGraphGetDependents;
  getDependencies = mockGraphGetDependencies;
  constructor(public opts: any) {
    lastDependencyGraphOpts = opts;
  }
}

let lastDependencyGraphOpts: any = null;

mock.module('../search/dependency-graph', () => ({
  DependencyGraph: MockDependencyGraph,
}));

// Import SUT after mock.module
const {
  invalidateGraphCache,
  getOrBuildGraph,
  getDependencies,
  getDependents,
  getAffected,
  hasCycle,
  getImportGraph,
  getTransitiveDependencies,
  getCyclePaths,
  getFanMetrics,
} = await import('./graph-api');

// ─── Fixtures ───────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<GildashContext>): GildashContext {
  return {
    closed: false,
    defaultProject: 'default',
    relationRepo: {} as any,
    relationSearchFn: mock(() => []),
    graphCache: null,
    graphCacheKey: null,
    ...overrides,
  } as unknown as GildashContext;
}

beforeEach(() => {
  mock.module('../search/dependency-graph', () => ({
    DependencyGraph: MockDependencyGraph,
  }));
  mockBuild.mockClear();
  mockGetAffectedByChange.mockClear();
  mockHasCycle.mockClear();
  mockGetAdjacencyList.mockClear();
  mockGetTransitiveDependencies.mockClear();
  mockGetCyclePaths.mockClear();
  mockGraphGetDependents.mockClear();
  mockGraphGetDependencies.mockClear();
});

// ─── invalidateGraphCache ───────────────────────────────────────────

describe('invalidateGraphCache', () => {
  it('should set graphCache and graphCacheKey to null', () => {
    const ctx = makeCtx({ graphCache: {} as any, graphCacheKey: 'some-key' });

    invalidateGraphCache(ctx);

    expect(ctx.graphCache).toBeNull();
    expect(ctx.graphCacheKey).toBeNull();
  });

  it('should cause getOrBuildGraph to rebuild on next call', () => {
    const ctx = makeCtx();

    // Build once
    getOrBuildGraph(ctx, 'proj');
    expect(mockBuild).toHaveBeenCalledTimes(1);

    // Invalidate
    invalidateGraphCache(ctx);

    // Rebuild
    getOrBuildGraph(ctx, 'proj');
    expect(mockBuild).toHaveBeenCalledTimes(2);
  });
});

// ─── getOrBuildGraph ────────────────────────────────────────────────

describe('getOrBuildGraph', () => {
  it('should build new DependencyGraph when cache is empty', () => {
    const ctx = makeCtx();

    const result = getOrBuildGraph(ctx, 'my-proj');

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect((result as any).opts).toEqual({
      relationRepo: ctx.relationRepo,
      project: 'my-proj',
    });
    expect(ctx.graphCache).toBe(result);
    expect(ctx.graphCacheKey).toBe('my-proj');
  });

  it('should return cached graph when key matches', () => {
    const ctx = makeCtx();

    const first = getOrBuildGraph(ctx, 'proj');
    const second = getOrBuildGraph(ctx, 'proj');

    expect(first).toBe(second);
    expect(mockBuild).toHaveBeenCalledTimes(1);
  });

  it('should use __cross__ as key when project is omitted', () => {
    const ctx = makeCtx();

    getOrBuildGraph(ctx);

    expect(ctx.graphCacheKey).toBe('__cross__');
    const graph = ctx.graphCache as any;
    expect(graph.opts).toEqual({
      relationRepo: ctx.relationRepo,
      project: 'default',
    });
  });

  it('should rebuild when called with different project key', () => {
    const ctx = makeCtx();

    const first = getOrBuildGraph(ctx, 'proj-a');
    const second = getOrBuildGraph(ctx, 'proj-b');

    expect(first).not.toBe(second);
    expect(mockBuild).toHaveBeenCalledTimes(2);
    expect(ctx.graphCacheKey).toBe('proj-b');
  });
});

// ─── getDependencies ────────────────────────────────────────────────

describe('getDependencies', () => {
  it('should call relationSearchFn and map results to dstFilePath', () => {
    const relations = [
      { srcFilePath: 'a.ts', dstFilePath: 'b.ts' },
      { srcFilePath: 'a.ts', dstFilePath: 'c.ts' },
    ];
    const searchFn = mock(() => relations);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = getDependencies(ctx, 'a.ts', 'proj');

    expect(result).toEqual(['b.ts', 'c.ts']);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getDependencies(ctx, 'a.ts')).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('search fail');
    const ctx = makeCtx({ relationSearchFn: mock(() => { throw error; }) as any });

    try {
      getDependencies(ctx, 'a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBe(error);
    }
  });

  it('should use default limit 10_000 and pass project ?? defaultProject', () => {
    const searchFn = mock(() => []);
    const ctx = makeCtx({ relationSearchFn: searchFn as any, defaultProject: 'dp' });

    getDependencies(ctx, 'a.ts');

    expect(searchFn).toHaveBeenCalledWith({
      relationRepo: ctx.relationRepo,
      project: 'dp',
      query: { srcFilePath: 'a.ts', type: 'imports', project: 'dp', limit: 10_000 },
    });
  });
});

// ─── getDependents ──────────────────────────────────────────────────

describe('getDependents', () => {
  it('should call relationSearchFn and map results to srcFilePath', () => {
    const relations = [
      { srcFilePath: 'x.ts', dstFilePath: 'a.ts' },
      { srcFilePath: 'y.ts', dstFilePath: 'a.ts' },
    ];
    const searchFn = mock(() => relations);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = getDependents(ctx, 'a.ts', 'proj');

    expect(result).toEqual(['x.ts', 'y.ts']);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getDependents(ctx, 'a.ts')).toThrow(GildashError);
  });
});

// ─── getAffected ────────────────────────────────────────────────────

describe('getAffected', () => {
  it('should return getAffectedByChange result via getOrBuildGraph', async () => {
    const ctx = makeCtx();
    mockGetAffectedByChange.mockReturnValue(['a.ts', 'b.ts']);

    const result = await getAffected(ctx, ['a.ts'], 'proj');

    expect(result).toEqual(['a.ts', 'b.ts']);
    expect(mockGetAffectedByChange).toHaveBeenCalledWith(['a.ts']);
  });

  it('should throw with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    await expect(getAffected(ctx, ['a.ts'])).rejects.toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', async () => {
    const error = new Error('affected fail');
    mockGetAffectedByChange.mockImplementation(() => { throw error; });
    const ctx = makeCtx();

    try {
      await getAffected(ctx, ['a.ts']);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── hasCycle ───────────────────────────────────────────────────────

describe('hasCycle', () => {
  it('should return hasCycle result via getOrBuildGraph', async () => {
    const ctx = makeCtx();
    mockHasCycle.mockReturnValue(true);

    const result = await hasCycle(ctx, 'proj');

    expect(result).toBe(true);
  });

  it('should throw with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    await expect(hasCycle(ctx)).rejects.toThrow(GildashError);
  });
});

// ─── getImportGraph ─────────────────────────────────────────────────

describe('getImportGraph', () => {
  it('should return getAdjacencyList result via getOrBuildGraph', async () => {
    const adj = new Map([['a.ts', ['b.ts']]]);
    mockGetAdjacencyList.mockReturnValue(adj);
    const ctx = makeCtx();

    const result = await getImportGraph(ctx, 'proj');

    expect(result).toBe(adj);
  });

  it('should throw with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    await expect(getImportGraph(ctx)).rejects.toThrow(GildashError);
  });
});

// ─── getTransitiveDependencies ──────────────────────────────────────

describe('getTransitiveDependencies', () => {
  it('should return transitive dependencies via getOrBuildGraph', async () => {
    mockGetTransitiveDependencies.mockReturnValue(['b.ts', 'c.ts']);
    const ctx = makeCtx();

    const result = await getTransitiveDependencies(ctx, 'a.ts', 'proj');

    expect(result).toEqual(['b.ts', 'c.ts']);
    expect(mockGetTransitiveDependencies).toHaveBeenCalledWith('a.ts');
  });

  it('should throw with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    await expect(getTransitiveDependencies(ctx, 'a.ts')).rejects.toThrow(GildashError);
  });
});

// ─── getCyclePaths ──────────────────────────────────────────────────

describe('getCyclePaths', () => {
  it('should return cycle paths via getOrBuildGraph', async () => {
    const paths = [['a.ts', 'b.ts', 'a.ts']];
    mockGetCyclePaths.mockReturnValue(paths);
    const ctx = makeCtx();

    const result = await getCyclePaths(ctx, 'proj');

    expect(result).toBe(paths);
  });

  it('should throw with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    await expect(getCyclePaths(ctx)).rejects.toThrow(GildashError);
  });

  it('should forward options to getCyclePaths', async () => {
    const ctx = makeCtx();
    const options = { maxCycles: 5 };

    await getCyclePaths(ctx, 'proj', options);

    expect(mockGetCyclePaths).toHaveBeenCalledWith(options);
  });
});

// ─── getFanMetrics ──────────────────────────────────────────────────

describe('getFanMetrics', () => {
  it('should return FanMetrics with fanIn and fanOut from graph', async () => {
    mockGraphGetDependents.mockReturnValue(['x.ts', 'y.ts']);
    mockGraphGetDependencies.mockReturnValue(['z.ts']);
    const ctx = makeCtx();

    const result = await getFanMetrics(ctx, 'a.ts', 'proj');

    expect(result.filePath).toBe('a.ts');
    expect(result.fanIn).toBe(2);
    expect(result.fanOut).toBe(1);
  });

  it('should throw with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    await expect(getFanMetrics(ctx, 'a.ts')).rejects.toThrow(GildashError);
  });

  it('should return fanIn=0 and fanOut=0 when graph has no edges', async () => {
    mockGraphGetDependents.mockReturnValue([]);
    mockGraphGetDependencies.mockReturnValue([]);
    const ctx = makeCtx();

    const result = await getFanMetrics(ctx, 'lonely.ts');

    expect(result.fanIn).toBe(0);
    expect(result.fanOut).toBe(0);
  });
});

// ─── State Transition ───────────────────────────────────────────────

describe('graph-api state transitions', () => {
  it('should throw from getDependencies after ctx transitions open to closed', () => {
    const searchFn = mock(() => []);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const first = getDependencies(ctx, 'a.ts');
    expect(first).toEqual([]);

    ctx.closed = true;

    expect(() => getDependencies(ctx, 'a.ts')).toThrow(GildashError);
  });
});

describe('getOrBuildGraph additionalProjects', () => {
  it('should pass additionalProjects from boundaries when project is not provided', () => {
    const ctx = makeCtx();
    (ctx as any).boundaries = [{ project: 'proj-b' }, { project: 'proj-c' }];

    invalidateGraphCache(ctx);
    getOrBuildGraph(ctx, undefined);

    expect(lastDependencyGraphOpts?.additionalProjects).toEqual(['proj-b', 'proj-c']);
  });

  it('should pass undefined additionalProjects when a specific project is provided', () => {
    const ctx = makeCtx();
    (ctx as any).boundaries = [{ project: 'proj-b' }];

    invalidateGraphCache(ctx);
    getOrBuildGraph(ctx, 'proj-a');

    expect(lastDependencyGraphOpts?.additionalProjects).toBeUndefined();
  });
});
