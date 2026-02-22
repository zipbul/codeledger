import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { Gildash } from './gildash';
import type { ExtractedSymbol, CodeRelation } from './extractor/types';
import type { RelationRecord } from './store/repositories/relation.repository';

function makeDbMock() {
  return {
    open: mock(() => {}),
    close: mock(() => {}),
    transaction: mock((fn: (tx: any) => any) => fn(null)),
    immediateTransaction: mock((fn: () => any) => fn()),
    selectOwner: mock(() => undefined as { pid: number; heartbeat_at: string } | undefined),
    insertOwner: mock((pid: number) => {}),
    replaceOwner: mock((pid: number) => {}),
    touchOwner: mock((pid: number) => {}),
    deleteOwner: mock((pid: number) => {}),
  };
}

function makeWatcherMock() {
  return {
    start: mock(async (cb: any) => {}),
    close: mock(async () => {}),
  };
}

function makeCoordinatorMock() {
  const inst = {
    fullIndex: mock(async () => ({
      indexedFiles: 0, removedFiles: 0,
      totalSymbols: 0, totalRelations: 0,
      durationMs: 0, changedFiles: [], deletedFiles: [],
    })),
    shutdown: mock(async () => {}),
    onIndexed: mock((cb: (r: any) => void) => (() => {})),
    handleWatcherEvent: mock((_event: any) => {}),
    tsconfigPaths: null as any,
    onIndexedCb: null as ((r: any) => void) | null,
  };
  inst.onIndexed = mock((cb: (r: any) => void) => {
    inst.onIndexedCb = cb;
    return () => { inst.onIndexedCb = null; };
  });
  return inst;
}

function makeSymbolRepoMock() {
  return {
    replaceFileSymbols: mock(() => {}),
    getFileSymbols: mock(() => []),
    getByFingerprint: mock(() => []),
    deleteFileSymbols: mock(() => {}),
    searchByQuery: mock(() => []),
    getStats: mock((p: string) => ({ fileCount: 0, symbolCount: 0 })),
  };
}

function makeRelationRepoMock() {
  return {
    replaceFileRelations: mock(() => {}),
    getOutgoing: mock((): Array<Partial<RelationRecord>> => []),
    getIncoming: mock((): Array<Partial<RelationRecord>> => []),
    getByType: mock((): Array<Partial<RelationRecord>> => []),
    deleteFileRelations: mock(() => {}),
    retargetRelations: mock(() => {}),
    searchRelations: mock((): Array<Partial<RelationRecord>> => []),
  };
}

function makeFileRepoMock() {
  return {
    upsertFile: mock(() => {}),
    getAllFiles: mock(() => []),
    getFilesMap: mock(() => new Map()),
    deleteFile: mock(() => {}),
    getFile: mock(() => null),
  };
}

function makeParseCacheMock() {
  return {
    set: mock(() => {}),
    get: mock(() => undefined),
    invalidate: mock(() => {}),
  };
}

const PROJECT_ROOT = '/project';

function makeOptions(opts: {
  role?: 'owner' | 'reader';
  db?: ReturnType<typeof makeDbMock>;
  watcher?: ReturnType<typeof makeWatcherMock>;
  coordinator?: ReturnType<typeof makeCoordinatorMock>;
  symbolRepo?: ReturnType<typeof makeSymbolRepoMock>;
  relationRepo?: ReturnType<typeof makeRelationRepoMock>;
  existsSync?: (p: string) => boolean;
  projectRoot?: string;
} = {}) {
  const db = opts.db ?? makeDbMock();
  const watcher = opts.watcher ?? makeWatcherMock();
  const coordinator = opts.coordinator ?? makeCoordinatorMock();
  const symbolRepo = opts.symbolRepo ?? makeSymbolRepoMock();
  const relationRepo = opts.relationRepo ?? makeRelationRepoMock();

  return {
    projectRoot: opts.projectRoot ?? PROJECT_ROOT,
    existsSyncFn: opts.existsSync ?? ((p: string) => true),
    dbConnectionFactory: () => db,
    watcherFactory: () => watcher,
    coordinatorFactory: () => coordinator,
    repositoryFactory: () => ({
      fileRepo: makeFileRepoMock(),
      symbolRepo,
      relationRepo,
      parseCache: makeParseCacheMock(),
    }),
    acquireWatcherRoleFn: mock(async () => (opts.role ?? 'owner') as 'owner' | 'reader'),
    releaseWatcherRoleFn: mock(() => {}),
    updateHeartbeatFn: mock(() => {}),
    discoverProjectsFn: mock(async (root: string) => [{ dir: '.', project: 'test-project' }]),
    parseSourceFn: mock((fp: string, text: string) => ({
      filePath: fp, program: { body: [] }, errors: [], comments: [], sourceText: text,
    })) as any,
    extractSymbolsFn: mock(() => []) as any,
    extractRelationsFn: mock(() => []) as any,
    loadTsconfigPathsFn: mock((root: string) => null) as any,
    symbolSearchFn: mock((opts: any) => []) as any,
    relationSearchFn: mock((opts: any) => []) as any,
    db: db,
    watcher: watcher,
    coordinator: coordinator,
    symbolRepo: symbolRepo,
    relationRepo: relationRepo,
  } as any;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Gildash', () => {
  it('should return a Gildash instance when open() succeeds as owner', async () => {
    const opts = makeOptions({ role: 'owner' });

    const ledger = await Gildash.open(opts);

    expect(ledger).toBeInstanceOf(Gildash);
    await ledger.close();
  });

  it('should return a Gildash instance when open() succeeds as reader without starting watcher', async () => {
    const watcher = makeWatcherMock();
    const opts = makeOptions({ role: 'reader', watcher });

    const ledger = await Gildash.open(opts);

    expect(ledger).toBeInstanceOf(Gildash);
    expect(watcher.start).not.toHaveBeenCalled();
    await ledger.close();
  });

  it('should call coordinator.fullIndex() during open() when role is owner', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'owner', coordinator });

    const ledger = await Gildash.open(opts);

    expect(coordinator.fullIndex).toHaveBeenCalled();
    await ledger.close();
  });

  it('should start a 30-second heartbeat interval when role is owner', async () => {
    const spySetInterval = spyOn(globalThis, 'setInterval');
    const opts = makeOptions({ role: 'owner' });

    const ledger = await Gildash.open(opts);

    const intervals = (spySetInterval.mock.calls as any[]).map((c) => c[1]);
    expect(intervals).toContain(30_000);

    await ledger.close();
    spySetInterval.mockRestore();
  });

  it('should start a 60-second healthcheck interval when role is reader', async () => {
    const spySetInterval = spyOn(globalThis, 'setInterval');
    const opts = makeOptions({ role: 'reader' });

    const ledger = await Gildash.open(opts);

    const intervals = (spySetInterval.mock.calls as any[]).map((c) => c[1]);
    expect(intervals).toContain(60_000);

    await ledger.close();
    spySetInterval.mockRestore();
  });

  it('should register a SIGTERM process signal handler when open() is called', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await Gildash.open(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('SIGTERM');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  it('should register a SIGINT process signal handler when open() is called', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await Gildash.open(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('SIGINT');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  it('should register a beforeExit process signal handler when open() is called', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await Gildash.open(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('beforeExit');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  it('should delegate searchSymbols(query) when symbolSearch is injected', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    const query = { text: 'myFunc' };

    ledger.searchSymbols(query);

    expect(opts.symbolSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
    );
    await ledger.close();
  });

  it('should delegate searchRelations(query) when relationSearch is injected', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    const query = { srcFilePath: 'src/a.ts' };

    ledger.searchRelations(query);

    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
    );
    await ledger.close();
  });

  it('should call relationSearchFn with srcFilePath and return dstFilePath array when getDependencies is called', async () => {
    const opts = makeOptions();
    opts.relationSearchFn.mockReturnValue([
      { type: 'imports', srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', srcSymbolName: null, dstSymbolName: null },
      { type: 'imports', srcFilePath: 'src/a.ts', dstFilePath: 'src/c.ts', srcSymbolName: null, dstSymbolName: null },
    ]);
    const ledger = await Gildash.open(opts);

    const result = ledger.getDependencies('src/a.ts');

    expect(result).toEqual(['src/b.ts', 'src/c.ts']);
    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ srcFilePath: 'src/a.ts', type: 'imports' }) }),
    );
    await ledger.close();
  });

  it('should use the given project when getDependencies is called with a project argument', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    ledger.getDependencies('src/a.ts', 'my-project');

    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ project: 'my-project' }) }),
    );
    await ledger.close();
  });

  it('should fall back to defaultProject when getDependencies is called without a project argument', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    ledger.getDependencies('src/a.ts');

    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ project: 'test-project' }) }),
    );
    await ledger.close();
  });

  it('should call relationSearchFn with dstFilePath and return srcFilePath array when getDependents is called', async () => {
    const opts = makeOptions();
    opts.relationSearchFn.mockReturnValue([
      { type: 'imports', srcFilePath: 'src/x.ts', dstFilePath: 'src/a.ts', srcSymbolName: null, dstSymbolName: null },
    ]);
    const ledger = await Gildash.open(opts);

    const result = ledger.getDependents('src/a.ts');

    expect(result).toEqual(['src/x.ts']);
    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ dstFilePath: 'src/a.ts', type: 'imports' }) }),
    );
    await ledger.close();
  });

  it('should fall back to defaultProject when getDependents is called without a project argument', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    ledger.getDependents('src/a.ts');

    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ project: 'test-project' }) }),
    );
    await ledger.close();
  });

  it('should build DependencyGraph and return getAffectedByChange result when getAffected is called', async () => {
    const relationRepo = makeRelationRepoMock();
    relationRepo.getByType.mockReturnValue([
      { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project' },
    ]);
    const opts = makeOptions({ relationRepo });
    const ledger = await Gildash.open(opts);

    const result = await ledger.getAffected(['src/b.ts']);

    expect(result).toContain('src/a.ts');
    await ledger.close();
  });

  it('should pass defaultProject to DependencyGraph when getAffected is called without a project argument', async () => {
    const relationRepo = makeRelationRepoMock();
    const opts = makeOptions({ relationRepo });
    const ledger = await Gildash.open(opts);

    await ledger.getAffected([]);

    expect(relationRepo.getByType).toHaveBeenCalledWith('test-project', 'imports');
    await ledger.close();
  });

  it('should return true when hasCycle detects a circular dependency in the graph', async () => {
    const relationRepo = makeRelationRepoMock();
    relationRepo.getByType.mockReturnValue([
      { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project' },
      { srcFilePath: 'src/b.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project' },
    ]);
    const opts = makeOptions({ relationRepo });
    const ledger = await Gildash.open(opts);

    const result = await ledger.hasCycle();

    expect(result).toBe(true);
    await ledger.close();
  });

  it('should return false when hasCycle finds no circular dependency in the graph', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    const result = await ledger.hasCycle();

    expect(result).toBe(false);
    await ledger.close();
  });

  it('should return a ParsedFile and store it in parseCache when parseSource is called', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    const result = ledger.parseSource('/project/src/a.ts', 'const x = 1;');

    expect(result).toMatchObject({ filePath: '/project/src/a.ts' });
    expect(opts.parseSourceFn).toHaveBeenCalledWith('/project/src/a.ts', 'const x = 1;');
    await ledger.close();
  });

  it('should call injected extractSymbols and return result when indexing file', async () => {
    const fakeSymbols: ExtractedSymbol[] = [{
      kind: 'function',
      name: 'foo',
      span: { start: { line: 1, column: 0 }, end: { line: 1, column: 3 } },
      isExported: false,
      modifiers: [],
    }];
    const opts = makeOptions();
    (opts.extractSymbolsFn as any).mockReturnValue(fakeSymbols);
    const ledger = await Gildash.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    const result = ledger.extractSymbols(parsed as any);

    expect(result).toBe(fakeSymbols);
    await ledger.close();
  });

  it('should call injected extractRelations and return result when indexing file', async () => {
    const fakeRelations: CodeRelation[] = [{ type: 'imports', srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', srcSymbolName: null, dstSymbolName: null }];
    const opts = makeOptions();
    (opts.extractRelationsFn as any).mockReturnValue(fakeRelations);
    const ledger = await Gildash.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    const result = ledger.extractRelations(parsed as any);

    expect(result).toBe(fakeRelations);
    await ledger.close();
  });

  it('should pass onIndexed callback through when coordinator.onIndexed is used', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await Gildash.open(opts);
    const cb = mock((r: any) => {});

    ledger.onIndexed(cb);

    expect(coordinator.onIndexed).toHaveBeenCalledWith(cb);
    await ledger.close();
  });

  it('should return unsubscribe function when onIndexed registers callback', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await Gildash.open(opts);
    const cb = mock((r: any) => {});

    const unsubscribe = ledger.onIndexed(cb);
    unsubscribe();

    expect(coordinator.onIndexedCb).toBeNull();
    await ledger.close();
  });

  it('should call shutdown and close resources when close() is called as owner', async () => {
    const coordinator = makeCoordinatorMock();
    const watcher = makeWatcherMock();
    const db = makeDbMock();
    const opts = makeOptions({ role: 'owner', coordinator, watcher, db });

    const ledger = await Gildash.open(opts);
    await ledger.close();

    expect(coordinator.shutdown).toHaveBeenCalled();
    expect(watcher.close).toHaveBeenCalled();
    expect(opts.releaseWatcherRoleFn).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
  });

  it('should clear timers and close db when close() is called as reader', async () => {
    const db = makeDbMock();
    const opts = makeOptions({ role: 'reader', db });
    const spyClearInterval = spyOn(globalThis, 'clearInterval');

    const ledger = await Gildash.open(opts);
    await ledger.close();

    expect(spyClearInterval).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
    spyClearInterval.mockRestore();
  });

  it('should throw when projectRoot is a relative path', async () => {
    const opts: any = { projectRoot: 'relative/path' };

    await expect(Gildash.open(opts)).rejects.toThrow();
  });

  it('should throw when projectRoot does not exist on disk', async () => {
    const opts = makeOptions({ existsSync: () => false });

    await expect(Gildash.open(opts)).rejects.toThrow();
  });

  it('should not throw when close() is called a second time', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    await ledger.close();

    await expect(ledger.close()).resolves.toBeUndefined();
  });

  it('should propagate error when the DB factory or open() throws', async () => {
    const db = makeDbMock();
    db.open.mockImplementation(() => { throw new Error('DB open failed'); });
    const opts = makeOptions({ db });

    await expect(Gildash.open(opts)).rejects.toThrow('DB open failed');
  });

  it('should invoke registered onIndexed callback when coordinator fires it', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await Gildash.open(opts);
    const cb = mock((r: any) => {});
    ledger.onIndexed(cb);

    coordinator.onIndexedCb?.({
      indexedFiles: 2, changedFiles: ['a.ts'], deletedFiles: [],
      totalSymbols: 5, totalRelations: 3, durationMs: 10,
    });

    expect(cb).toHaveBeenCalledTimes(1);
    await ledger.close();
  });

  it('should support open → searchSymbols → close lifecycle when called sequentially', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    const results = ledger.searchSymbols({ text: 'handler' });

    expect(Array.isArray(results)).toBe(true);
    await expect(ledger.close()).resolves.toBeUndefined();
  });

  it('should execute close() steps in correct order when shutting down', async () => {
    const order: string[] = [];
    const coordinator = makeCoordinatorMock();
    coordinator.shutdown = mock(async () => { order.push('shutdown'); });
    const watcher = makeWatcherMock();
    watcher.close = mock(async () => { order.push('watcher.close'); });
    const db = makeDbMock();
    db.close = mock(() => { order.push('db.close'); });
    const releaseWatcherRoleFn = mock(() => { order.push('releaseRole'); });
    const opts = makeOptions({ role: 'owner', coordinator, watcher, db });
    opts.releaseWatcherRoleFn = releaseWatcherRoleFn;

    const ledger = await Gildash.open(opts);
    await ledger.close();

    expect(order.indexOf('shutdown')).toBeLessThan(order.indexOf('watcher.close'));
    expect(order.indexOf('watcher.close')).toBeLessThan(order.indexOf('releaseRole'));
    expect(order.indexOf('releaseRole')).toBeLessThan(order.indexOf('db.close'));
  });

  it('should throw an error when reindex() is called on a reader instance', async () => {
    const opts = makeOptions({ role: 'reader' });
    const ledger = await Gildash.open(opts);

    await expect((ledger as any).reindex()).rejects.toThrow();
    await ledger.close();
  });

  it('should delegate reindex() to coordinator.fullIndex() when role is owner', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'owner', coordinator });
    const ledger = await Gildash.open(opts);
    coordinator.fullIndex.mockClear();

    await (ledger as any).reindex();

    expect(coordinator.fullIndex).toHaveBeenCalledTimes(1);
    await ledger.close();
  });

  it('should pass tsconfigPaths to extractRelations when loadTsconfigPathsFn resolves', async () => {
    const tsconfigPaths = { '@/': ['src/'] };
    const opts = makeOptions({ role: 'reader' });
    (opts as any).loadTsconfigPathsFn = mock(() => tsconfigPaths);
    const ledger = await Gildash.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    ledger.extractRelations(parsed as any);

    expect(opts.extractRelationsFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      tsconfigPaths,
    );
    await ledger.close();
  });

  it('should forward onIndexed callbacks to coordinator when promoted from reader to owner', async () => {
    const acquireMock = mock(async () => 'reader' as const);
    (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'reader', coordinator });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);
    const cb = mock((r: any) => {});
    ledger.onIndexed(cb);

    jest.advanceTimersByTime(60_000);
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(coordinator.onIndexed).toHaveBeenCalledWith(cb);
    await ledger.close();
  });

  it('should return an array when projects getter is accessed', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    const projects = (ledger as any).projects;

    expect(Array.isArray(projects)).toBe(true);
    await ledger.close();
  });

  it('should delegate getStats() when symbolRepo is available', async () => {
    const symbolRepo = makeSymbolRepoMock();
    const opts = makeOptions({ symbolRepo });
    const ledger = await Gildash.open(opts);

    (ledger as any).getStats();

    expect(symbolRepo.getStats).toHaveBeenCalled();
    await ledger.close();
  });

  it('should await loadTsconfigPathsFn when passing resolved value to extractRelations', async () => {
    const tsconfigPaths = { '@/': ['src/'] };
    const opts = makeOptions({ role: 'reader' });
    (opts as any).loadTsconfigPathsFn = mock(() => Promise.resolve(tsconfigPaths));
    const ledger = await Gildash.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    ledger.extractRelations(parsed as any);

    expect(opts.extractRelationsFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      tsconfigPaths,
    );
    await ledger.close();
  });

  it('should call db.close() when discoverProjectsFn throws during open()', async () => {
    const db = makeDbMock();
    const opts = makeOptions({ db });
    opts.discoverProjectsFn = mock(async () => { throw new Error('discover failed'); }) as any;

    await expect(Gildash.open(opts)).rejects.toThrow('discover failed');
    expect(db.close).toHaveBeenCalled();
  });

  it('should call db.close() when watcher.start() throws during open() as owner', async () => {
    const db = makeDbMock();
    const watcher = makeWatcherMock();
    watcher.start.mockRejectedValue(new Error('watcher start failed'));
    const opts = makeOptions({ role: 'owner', db, watcher });

    await expect(Gildash.open(opts)).rejects.toThrow('watcher start failed');
    expect(db.close).toHaveBeenCalled();
  });

  it('should not produce unhandled rejection when watcher.start() throws during reader-to-owner promotion', async () => {
    const acquireMock = mock(async () => 'reader' as const);
    (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
    const watcher = makeWatcherMock();
    watcher.start.mockRejectedValue(new Error('transition start failed'));
    const opts = makeOptions({ role: 'reader', watcher });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    jest.advanceTimersByTime(60_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    await expect(ledger.close()).resolves.toBeUndefined();
  });

  it('should close the instance when healthcheck fails MAX_HEALTHCHECK_RETRIES consecutive times', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      throw new Error('db unavailable');
    });
    const opts = makeOptions({ role: 'reader' });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }

    expect(opts.db.close).toHaveBeenCalled();
  });

  it('should NOT close the instance when healthcheck failures are fewer than MAX_HEALTHCHECK_RETRIES', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      throw new Error('db unavailable');
    });
    const opts = makeOptions({ role: 'reader' });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    for (let i = 0; i < 9; i++) {
      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }

    expect(opts.db.close).not.toHaveBeenCalled();
    await ledger.close();
  });

  it('should restore the healthcheck timer when owner promotion fails because watcher.start() throws', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      return 'owner' as const;
    });
    const watcher = makeWatcherMock();
    let startCalls = 0;
    watcher.start = mock(async () => {
      startCalls++;
      if (startCalls === 1) throw new Error('start failed');
    });

    const opts = makeOptions({ role: 'reader', watcher });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    expect(watcher.start).toHaveBeenCalledTimes(2);
    await ledger.close();
  });

  it('should maintain owner state when fullIndex() fails after heartbeat timer is already set', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      return 'owner' as const;
    });
    const coordinator = makeCoordinatorMock();
    coordinator.fullIndex = mock(async () => { throw new Error('index failed'); });
    const opts = makeOptions({ role: 'reader', coordinator });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    expect(opts.db.close).not.toHaveBeenCalled();
    await ledger.close();
    expect(coordinator.shutdown).toHaveBeenCalled();
  });

  it('should reset retry count and restore timer when acquiring owner role succeeds after failures then setup fails', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      if (callCount <= 6) throw new Error('db unavailable');
      return 'owner' as const;
    });
    const watcher = makeWatcherMock();
    watcher.start = mock(async () => { throw new Error('watcher start failed'); });

    const opts = makeOptions({ role: 'reader', watcher });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    expect(opts.db.close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    expect(watcher.start).toHaveBeenCalledTimes(2);
    await ledger.close();
  });

  it('should throw when searchSymbols() is called after close()', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    await ledger.close();

    expect(() => ledger.searchSymbols({ text: 'foo' })).toThrow();
  });

  it('should throw when searchRelations() is called after close()', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    await ledger.close();

    expect(() => ledger.searchRelations({ srcFilePath: 'a.ts' })).toThrow();
  });

  it('should throw when stateless APIs are called after close()', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' } as any;
    await ledger.close();

    expect(() => ledger.parseSource('/project/src/a.ts', 'x')).toThrow();
    expect(() => ledger.extractSymbols(parsed)).toThrow();
    expect(() => ledger.extractRelations(parsed)).toThrow();
    expect(() => ledger.getStats()).toThrow();
    expect(() => ledger.getDependencies('src/a.ts')).toThrow();
    expect(() => ledger.getDependents('src/a.ts')).toThrow();
  });

  it('should throw when async APIs are called after close()', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    await ledger.close();

    await expect(ledger.reindex()).rejects.toThrow();
    await expect(ledger.getAffected(['src/a.ts'])).rejects.toThrow();
    await expect(ledger.hasCycle()).rejects.toThrow();
  });

  it('should use projectRoot basename as defaultProject when discoverProjects returns empty', async () => {
    const opts = makeOptions({ projectRoot: '/project/my-root' });
    opts.discoverProjectsFn = mock(async () => []) as any;
    const ledger = await Gildash.open(opts);

    ledger.searchSymbols({ text: 'foo' });

    expect(opts.symbolSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'my-root' }),
    );
    await ledger.close();
  });

  it('should pass defaultProject to symbolSearchFn when searchSymbols is called without a project in the query', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    ledger.searchSymbols({ text: 'foo' });

    expect(opts.symbolSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'test-project' }),
    );
    await ledger.close();
  });

  it('should pass defaultProject to relationSearchFn when searchRelations is called without a project in the query', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    ledger.searchRelations({ srcFilePath: 'a.ts' });

    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'test-project' }),
    );
    await ledger.close();
  });

  it('should throw AggregateError when one component throws during close()', async () => {
    const coordinator = makeCoordinatorMock();
    coordinator.shutdown = mock(async () => { throw new Error('coordinator shutdown failed'); });
    const opts = makeOptions({ role: 'owner', coordinator });
    const ledger = await Gildash.open(opts);

    await expect(ledger.close()).rejects.toThrow(AggregateError);
  });

  it('should accumulate multiple errors in AggregateError when both coordinator and db.close() throw', async () => {
    const coordinator = makeCoordinatorMock();
    coordinator.shutdown = mock(async () => { throw new Error('coordinator fail'); });
    const db = makeDbMock();
    db.close = mock(() => { throw new Error('db close fail'); });
    const opts = makeOptions({ role: 'owner', coordinator, db });
    const ledger = await Gildash.open(opts);

    let caughtError: unknown;
    try {
      await ledger.close();
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(AggregateError);
    expect((caughtError as AggregateError).errors.length).toBeGreaterThanOrEqual(2);
  });

  it('should call process.off with SIGTERM when close() is invoked', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    const spyOff = spyOn(process, 'off');

    await ledger.close();

    const offSignals = (spyOff.mock.calls as any[]).map((c) => c[0]);
    expect(offSignals).toContain('SIGTERM');
    spyOff.mockRestore();
  });

  it('should call process.off with SIGINT when close() is invoked', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    const spyOff = spyOn(process, 'off');

    await ledger.close();

    const offSignals = (spyOff.mock.calls as any[]).map((c) => c[0]);
    expect(offSignals).toContain('SIGINT');
    spyOff.mockRestore();
  });

  it('should call process.off with beforeExit when close() is invoked', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);
    const spyOff = spyOn(process, 'off');

    await ledger.close();

    const offSignals = (spyOff.mock.calls as any[]).map((c) => c[0]);
    expect(offSignals).toContain('beforeExit');
    spyOff.mockRestore();
  });

  it('should not affect internal boundaries when elements are pushed into the projects() array', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    const snapshot = ledger.projects;
    const sizeBefore = snapshot.length;
    snapshot.push({ dir: 'injected', project: 'injected' });

    expect(ledger.projects.length).toBe(sizeBefore);
    expect(ledger.projects.some((b) => b.project === 'injected')).toBe(false);
    await ledger.close();
  });

  it('should return a different array instance on each call to the projects getter', async () => {
    const opts = makeOptions();
    const ledger = await Gildash.open(opts);

    const list1 = ledger.projects;
    const list2 = ledger.projects;

    expect(list1).not.toBe(list2);
    await ledger.close();
  });

  it('should invoke updateHeartbeatFn when the owner heartbeat timer fires', async () => {
    const opts = makeOptions({ role: 'owner' });
    const ledger = await Gildash.open(opts);

    jest.advanceTimersByTime(30_000);

    expect(opts.updateHeartbeatFn).toHaveBeenCalled();
    await ledger.close();
  });

  it('should invoke updateHeartbeatFn when the promotion heartbeat timer fires', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      return 'owner' as const;
    });
    const opts = makeOptions({ role: 'reader' });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    opts.updateHeartbeatFn.mockClear();
    jest.advanceTimersByTime(30_000);

    expect(opts.updateHeartbeatFn).toHaveBeenCalled();
    await ledger.close();
  });

  it('should log error and not throw when promotedWatcher.close rejects during promotion rollback', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      return 'owner' as const;
    });
    const watcher = makeWatcherMock();
    watcher.start.mockRejectedValue(new Error('start failed'));
    watcher.close.mockRejectedValue(new Error('close also failed'));
    const opts = makeOptions({ role: 'reader', watcher });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    expect(opts.db.close).not.toHaveBeenCalled();
    await ledger.close();
  });

  it('should log error and not throw when promotedCoordinator.shutdown rejects during promotion rollback', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      return 'owner' as const;
    });
    const coordinator = makeCoordinatorMock();
    coordinator.fullIndex.mockRejectedValue(new Error('fullIndex failed'));
    coordinator.shutdown.mockRejectedValue(new Error('shutdown also failed'));
    const watcher = makeWatcherMock();
    const opts = makeOptions({ role: 'reader', watcher, coordinator });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    expect(opts.db.close).not.toHaveBeenCalled();
    await ledger.close();
  });

  it('should forward watcher event to coordinator.handleWatcherEvent when owner watcher start callback fires', async () => {
    const watcher = makeWatcherMock();
    let capturedCb: ((event: any) => void) | null = null;
    watcher.start = mock(async (cb: any) => { capturedCb = cb; });
    const coordinator = makeCoordinatorMock();
    coordinator.handleWatcherEvent = mock(() => {});
    const opts = makeOptions({ role: 'owner', watcher, coordinator });

    const ledger = await Gildash.open(opts);

    capturedCb!({ filePath: 'src/a.ts', type: 'update' });

    expect(coordinator.handleWatcherEvent).toHaveBeenCalledWith({ filePath: 'src/a.ts', type: 'update' });
    await ledger.close();
  });

  it('should forward watcher event to promotedCoordinator.handleWatcherEvent when promotion watcher start callback fires', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      return 'owner' as const;
    });
    const watcher = makeWatcherMock();
    let capturedCb: ((event: any) => void) | null = null;
    watcher.start = mock(async (cb: any) => { capturedCb = cb; });
    const coordinator = makeCoordinatorMock();
    coordinator.handleWatcherEvent = mock(() => {});
    const opts = makeOptions({ role: 'reader', watcher, coordinator });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    jest.advanceTimersByTime(60_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();

    capturedCb!({ filePath: 'src/b.ts', type: 'create' });

    expect(coordinator.handleWatcherEvent).toHaveBeenCalledWith({ filePath: 'src/b.ts', type: 'create' });
    await ledger.close();
  });

  it('should catch and log when close() rejects inside healthcheck max-retries shutdown', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      throw new Error('db unavailable');
    });
    const opts = makeOptions({ role: 'reader' });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await Gildash.open(opts);

    const coordinator = (ledger as any).coordinator;
    if (coordinator) coordinator.shutdown = mock(async () => { throw new Error('shutdown fail'); });
    (ledger as any).db.close = mock(() => { throw new Error('db close fail'); });

    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }

    for (let j = 0; j < 20; j++) await Promise.resolve();

    expect((ledger as any).closed).toBe(true);
  });

  it('should catch and log when close() rejects inside signal handler', async () => {
    const spyOn_ = spyOn(process, 'on');
    const opts = makeOptions({ role: 'owner' });

    const ledger = await Gildash.open(opts);

    const sigintCall = spyOn_.mock.calls.find((c: any) => c[0] === 'SIGINT');
    const handler = sigintCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    const coordinator = (ledger as any).coordinator;
    if (coordinator) coordinator.shutdown = mock(async () => { throw new Error('shutdown fail'); });
    (ledger as any).db.close = mock(() => { throw new Error('db close fail'); });

    handler!();

    for (let j = 0; j < 20; j++) await Promise.resolve();

    expect((ledger as any).closed).toBe(true);
    spyOn_.mockRestore();
  });
});
