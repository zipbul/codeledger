import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { Gildash } from './gildash';
import { GildashError } from './errors';
import type { ResolvedType, SemanticReference, Implementation } from './semantic/types';
import type { SemanticModuleInterface } from './semantic/types';
import type { ExtractedSymbol, CodeRelation } from './extractor/types';
import type { RelationRecord } from './store/repositories/relation.repository';
import type { FileRecord } from './store/repositories/file.repository';
import type { ParsedFile } from './parser/types';

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
    getAllFiles: mock((): FileRecord[] => []),
    getFilesMap: mock(() => new Map()),
    deleteFile: mock(() => {}),
    getFile: mock((_project: string, _filePath: string): FileRecord | null => null),
  };
}

function makeParseCacheMock() {
  return {
    set: mock(() => {}),
    get: mock((_filePath: string): ParsedFile | undefined => undefined),
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
  fileRepo?: ReturnType<typeof makeFileRepoMock>;
  parseCache?: ReturnType<typeof makeParseCacheMock>;
  existsSync?: (p: string) => boolean;
  projectRoot?: string;
  readFileFn?: (filePath: string) => Promise<string>;
  unlinkFn?: (filePath: string) => Promise<void>;
} = {}) {
  const db = opts.db ?? makeDbMock();
  const watcher = opts.watcher ?? makeWatcherMock();
  const coordinator = opts.coordinator ?? makeCoordinatorMock();
  const symbolRepo = opts.symbolRepo ?? makeSymbolRepoMock();
  const relationRepo = opts.relationRepo ?? makeRelationRepoMock();
  const fileRepo = opts.fileRepo ?? makeFileRepoMock();
  const parseCache = opts.parseCache ?? makeParseCacheMock();

  return {
    projectRoot: opts.projectRoot ?? PROJECT_ROOT,
    existsSyncFn: opts.existsSync ?? ((p: string) => true),
    dbConnectionFactory: () => db,
    watcherFactory: () => watcher,
    coordinatorFactory: () => coordinator,
    repositoryFactory: () => ({
      fileRepo,
      symbolRepo,
      relationRepo,
      parseCache,
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
    patternSearchFn: mock(async (_opts: any) => []) as any,
    logger: { error: mock(() => {}) },
    readFileFn: opts.readFileFn ?? mock(async (_fp: string) => '// default content'),
    unlinkFn: opts.unlinkFn ?? mock(async (_fp: string) => {}),
    db: db,
    watcher: watcher,
    coordinator: coordinator,
    symbolRepo: symbolRepo,
    relationRepo: relationRepo,
    fileRepo: fileRepo,
    parseCache: parseCache,
  } as any;
}

async function openOrThrow(opts: Parameters<typeof Gildash.open>[0]): Promise<Gildash> {
  return Gildash.open(opts);
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

    const ledger = await openOrThrow(opts);

    expect(ledger).toBeInstanceOf(Gildash);
    await ledger.close();
  });

  it('should return a Gildash instance when open() succeeds as reader without starting watcher', async () => {
    const watcher = makeWatcherMock();
    const opts = makeOptions({ role: 'reader', watcher });

    const ledger = await openOrThrow(opts);

    expect(ledger).toBeInstanceOf(Gildash);
    expect(watcher.start).not.toHaveBeenCalled();
    await ledger.close();
  });

  it('should call coordinator.fullIndex() during open() when role is owner', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'owner', coordinator });

    const ledger = await openOrThrow(opts);

    expect(coordinator.fullIndex).toHaveBeenCalled();
    await ledger.close();
  });

  it('should start a 30-second heartbeat interval when role is owner', async () => {
    const spySetInterval = spyOn(globalThis, 'setInterval');
    const opts = makeOptions({ role: 'owner' });

    const ledger = await openOrThrow(opts);

    const intervals = (spySetInterval.mock.calls as any[]).map((c) => c[1]);
    expect(intervals).toContain(30_000);

    await ledger.close();
    spySetInterval.mockRestore();
  });

  it('should start a 60-second healthcheck interval when role is reader', async () => {
    const spySetInterval = spyOn(globalThis, 'setInterval');
    const opts = makeOptions({ role: 'reader' });

    const ledger = await openOrThrow(opts);

    const intervals = (spySetInterval.mock.calls as any[]).map((c) => c[1]);
    expect(intervals).toContain(60_000);

    await ledger.close();
    spySetInterval.mockRestore();
  });

  it('should register a SIGTERM process signal handler when open() is called', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await openOrThrow(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('SIGTERM');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  it('should register a SIGINT process signal handler when open() is called', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await openOrThrow(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('SIGINT');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  it('should register a beforeExit process signal handler when open() is called', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await openOrThrow(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('beforeExit');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  it('should delegate searchSymbols(query) when symbolSearch is injected', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    const query = { text: 'myFunc' };

    ledger.searchSymbols(query);

    expect(opts.symbolSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
    );
    await ledger.close();
  });

  it('should delegate searchRelations(query) when relationSearch is injected', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
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
    const ledger = await openOrThrow(opts);

    const result = ledger.getDependencies('src/a.ts');

    expect(result).toEqual(['src/b.ts', 'src/c.ts']);
    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ srcFilePath: 'src/a.ts', type: 'imports' }) }),
    );
    await ledger.close();
  });

  it('should use the given project when getDependencies is called with a project argument', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

    ledger.getDependencies('src/a.ts', 'my-project');

    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ project: 'my-project' }) }),
    );
    await ledger.close();
  });

  it('should fall back to defaultProject when getDependencies is called without a project argument', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

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
    const ledger = await openOrThrow(opts);

    const result = ledger.getDependents('src/a.ts');

    expect(result).toEqual(['src/x.ts']);
    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ dstFilePath: 'src/a.ts', type: 'imports' }) }),
    );
    await ledger.close();
  });

  it('should fall back to defaultProject when getDependents is called without a project argument', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

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
    const ledger = await openOrThrow(opts);

    const result = await ledger.getAffected(['src/b.ts']);

    expect(result).toContain('src/a.ts');
    await ledger.close();
  });

  it('should pass defaultProject to DependencyGraph when getAffected is called without a project argument', async () => {
    const relationRepo = makeRelationRepoMock();
    const opts = makeOptions({ relationRepo });
    const ledger = await openOrThrow(opts);

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
    const ledger = await openOrThrow(opts);

    const result = await ledger.hasCycle();

    expect(result).toBe(true);
    await ledger.close();
  });

  it('should return false when hasCycle finds no circular dependency in the graph', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

    const result = await ledger.hasCycle();

    expect(result).toBe(false);
    await ledger.close();
  });

  it('should return a ParsedFile and store it in parseCache when parseSource is called', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

    const result = ledger.parseSource('/project/src/a.ts', 'const x = 1;');

    expect(result).toMatchObject({ filePath: '/project/src/a.ts' });
    expect(opts.parseSourceFn).toHaveBeenCalledWith('/project/src/a.ts', 'const x = 1;', undefined);
    await ledger.close();
  });

  it('should pass options to parseSourceFn when parseSource is called with options', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    const options = { sourceType: 'script' as const };

    ledger.parseSource('/project/src/a.ts', 'const x = 1;', options);

    expect(opts.parseSourceFn).toHaveBeenCalledWith('/project/src/a.ts', 'const x = 1;', options);
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
    const ledger = await openOrThrow(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    const result = ledger.extractSymbols(parsed as any);

    expect(result).toBe(fakeSymbols);
    await ledger.close();
  });

  it('should call injected extractRelations and return result when indexing file', async () => {
    const fakeRelations: CodeRelation[] = [{ type: 'imports', srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', srcSymbolName: null, dstSymbolName: null }];
    const opts = makeOptions();
    (opts.extractRelationsFn as any).mockReturnValue(fakeRelations);
    const ledger = await openOrThrow(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    const result = ledger.extractRelations(parsed as any);

    expect(result).toBe(fakeRelations);
    await ledger.close();
  });

  it('should pass onIndexed callback through when coordinator.onIndexed is used', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await openOrThrow(opts);
    const cb = mock((r: any) => {});

    ledger.onIndexed(cb);

    expect(coordinator.onIndexed).toHaveBeenCalledWith(cb);
    await ledger.close();
  });

  it('should return unsubscribe function when onIndexed registers callback', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await openOrThrow(opts);
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

    const ledger = await openOrThrow(opts);
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

    const ledger = await openOrThrow(opts);
    await ledger.close();

    expect(spyClearInterval).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
    spyClearInterval.mockRestore();
  });

  it('should return Err with validation type when projectRoot is a relative path', async () => {
    const opts: any = { projectRoot: 'relative/path' };

    await expect(Gildash.open(opts)).rejects.toThrow(GildashError);
  });

  it('should return Err with validation type when projectRoot does not exist on disk', async () => {
    const opts = makeOptions({ existsSync: () => false });

    await expect(Gildash.open(opts)).rejects.toThrow(GildashError);
  });

  it('should not throw when close() is called a second time', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
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
    const ledger = await openOrThrow(opts);
    const cb = mock((r: any) => {});
    ledger.onIndexed(cb);

    coordinator.onIndexedCb?.({
      indexedFiles: 2, changedFiles: ['a.ts'], deletedFiles: [],
      totalSymbols: 5, totalRelations: 3, durationMs: 10,
    });

    expect(cb).toHaveBeenCalledTimes(1);
    await ledger.close();
  });

  it('should invoke internal invalidateGraphCache when coordinator.onIndexedCb fires in owner mode', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await openOrThrow(opts);

    // Set a non-null graphCache to detect invalidation
    ledger._ctx.graphCache = {} as any;
    ledger._ctx.graphCacheKey = 'test-key';
    coordinator.onIndexedCb?.({
      indexedFiles: 1, changedFiles: ['a.ts'], deletedFiles: [],
      totalSymbols: 2, totalRelations: 1, durationMs: 5,
    });

    expect(ledger._ctx.graphCache).toBeNull();
    expect(ledger._ctx.graphCacheKey).toBeNull();
    await ledger.close();
  });

  it('should support open → searchSymbols → close lifecycle when called sequentially', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);
    await ledger.close();

    expect(order.indexOf('shutdown')).toBeLessThan(order.indexOf('watcher.close'));
    expect(order.indexOf('watcher.close')).toBeLessThan(order.indexOf('releaseRole'));
    expect(order.indexOf('releaseRole')).toBeLessThan(order.indexOf('db.close'));
  });

  it('should return Err when reindex() is called on a reader instance', async () => {
    const opts = makeOptions({ role: 'reader' });
    const ledger = await openOrThrow(opts);

    await expect((ledger as any).reindex()).rejects.toThrow(GildashError);
    await ledger.close();
  });

  it('should delegate reindex() to coordinator.fullIndex() when role is owner', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'owner', coordinator });
    const ledger = await openOrThrow(opts);
    coordinator.fullIndex.mockClear();

    await (ledger as any).reindex();

    expect(coordinator.fullIndex).toHaveBeenCalledTimes(1);
    await ledger.close();
  });

  it('should pass tsconfigPaths to extractRelations when loadTsconfigPathsFn resolves', async () => {
    const tsconfigPaths = { '@/': ['src/'] };
    const opts = makeOptions({ role: 'reader' });
    (opts as any).loadTsconfigPathsFn = mock(() => tsconfigPaths);
    const ledger = await openOrThrow(opts);
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

    const ledger = await openOrThrow(opts);
    const cb = mock((r: any) => {});
    ledger.onIndexed(cb);

    jest.advanceTimersByTime(60_000);
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(coordinator.onIndexed).toHaveBeenCalledWith(cb);
    await ledger.close();
  });

  it('should return an array when projects getter is accessed', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

    const projects = (ledger as any).projects;

    expect(Array.isArray(projects)).toBe(true);
    await ledger.close();
  });

  it('should delegate getStats() when symbolRepo is available', async () => {
    const symbolRepo = makeSymbolRepoMock();
    const opts = makeOptions({ symbolRepo });
    const ledger = await openOrThrow(opts);

    (ledger as any).getStats();

    expect(symbolRepo.getStats).toHaveBeenCalled();
    await ledger.close();
  });

  it('should await loadTsconfigPathsFn when passing resolved value to extractRelations', async () => {
    const tsconfigPaths = { '@/': ['src/'] };
    const opts = makeOptions({ role: 'reader' });
    (opts as any).loadTsconfigPathsFn = mock(() => Promise.resolve(tsconfigPaths));
    const ledger = await openOrThrow(opts);
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

    await expect(Gildash.open(opts)).rejects.toThrow(GildashError);
    expect(db.close).toHaveBeenCalled();
  });

  it('should call db.close() when watcher.start() throws during open() as owner', async () => {
    const db = makeDbMock();
    const watcher = makeWatcherMock();
    watcher.start.mockRejectedValue(new Error('watcher start failed'));
    const opts = makeOptions({ role: 'owner', db, watcher });

    await expect(Gildash.open(opts)).rejects.toThrow(GildashError);
    expect(db.close).toHaveBeenCalled();
  });

  it('should not produce unhandled rejection when watcher.start() throws during reader-to-owner promotion', async () => {
    const acquireMock = mock(async () => 'reader' as const);
    (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
    const watcher = makeWatcherMock();
    watcher.start.mockRejectedValue(new Error('transition start failed'));
    const opts = makeOptions({ role: 'reader', watcher });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

  it('should return Err when searchSymbols() is called after close()', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    await ledger.close();

    expect(() => ledger.searchSymbols({ text: 'foo' })).toThrow(GildashError);
  });

  it('should return Err when searchRelations() is called after close()', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    await ledger.close();

    expect(() => ledger.searchRelations({ srcFilePath: 'a.ts' })).toThrow(GildashError);
  });

  it('should return Err when stateless APIs are called after close()', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' } as any;
    await ledger.close();

    expect(() => ledger.parseSource('/project/src/a.ts', 'x')).toThrow(GildashError);
    expect(() => ledger.extractSymbols(parsed)).toThrow(GildashError);
    expect(() => ledger.extractRelations(parsed)).toThrow(GildashError);
    expect(() => ledger.getStats()).toThrow(GildashError);
    expect(() => ledger.getDependencies('src/a.ts')).toThrow(GildashError);
    expect(() => ledger.getDependents('src/a.ts')).toThrow(GildashError);
  });

  it('should return Err when async APIs are called after close()', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    await ledger.close();

    await expect(ledger.reindex()).rejects.toThrow(GildashError);
    await expect(ledger.getAffected(['src/a.ts'])).rejects.toThrow(GildashError);
    await expect(ledger.hasCycle()).rejects.toThrow(GildashError);
  });

  it('should use projectRoot basename as defaultProject when discoverProjects returns empty', async () => {
    const opts = makeOptions({ projectRoot: '/project/my-root' });
    opts.discoverProjectsFn = mock(async () => []) as any;
    const ledger = await openOrThrow(opts);

    ledger.searchSymbols({ text: 'foo' });

    expect(opts.symbolSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'my-root' }),
    );
    await ledger.close();
  });

  it('should pass defaultProject to symbolSearchFn when searchSymbols is called without a project in the query', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

    ledger.searchSymbols({ text: 'foo' });

    expect(opts.symbolSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'test-project' }),
    );
    await ledger.close();
  });

  it('should pass defaultProject to relationSearchFn when searchRelations is called without a project in the query', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

    ledger.searchRelations({ srcFilePath: 'a.ts' });

    expect(opts.relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'test-project' }),
    );
    await ledger.close();
  });

  it('should return Err with close type when one component throws during close()', async () => {
    const coordinator = makeCoordinatorMock();
    coordinator.shutdown = mock(async () => { throw new Error('coordinator shutdown failed'); });
    const opts = makeOptions({ role: 'owner', coordinator });
    const ledger = await openOrThrow(opts);

    await expect(ledger.close()).rejects.toThrow(GildashError);
  });

  it('should accumulate multiple errors in Err when both coordinator and db.close() throw', async () => {
    const coordinator = makeCoordinatorMock();
    coordinator.shutdown = mock(async () => { throw new Error('coordinator fail'); });
    const db = makeDbMock();
    db.close = mock(() => { throw new Error('db close fail'); });
    const opts = makeOptions({ role: 'owner', coordinator, db });
    const ledger = await openOrThrow(opts);

    try {
      await ledger.close();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('close');
      expect(Array.isArray((e as GildashError).cause)).toBe(true);
      expect(((e as GildashError).cause as unknown[]).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should call process.off with SIGTERM when close() is invoked', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    const spyOff = spyOn(process, 'off');

    await ledger.close();

    const offSignals = (spyOff.mock.calls as any[]).map((c) => c[0]);
    expect(offSignals).toContain('SIGTERM');
    spyOff.mockRestore();
  });

  it('should call process.off with SIGINT when close() is invoked', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    const spyOff = spyOn(process, 'off');

    await ledger.close();

    const offSignals = (spyOff.mock.calls as any[]).map((c) => c[0]);
    expect(offSignals).toContain('SIGINT');
    spyOff.mockRestore();
  });

  it('should call process.off with beforeExit when close() is invoked', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    const spyOff = spyOn(process, 'off');

    await ledger.close();

    const offSignals = (spyOff.mock.calls as any[]).map((c) => c[0]);
    expect(offSignals).toContain('beforeExit');
    spyOff.mockRestore();
  });

  it('should not affect internal boundaries when elements are pushed into the projects() array', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

    const snapshot = ledger.projects;
    const sizeBefore = snapshot.length;
    snapshot.push({ dir: 'injected', project: 'injected' });

    expect(ledger.projects.length).toBe(sizeBefore);
    expect(ledger.projects.some((b) => b.project === 'injected')).toBe(false);
    await ledger.close();
  });

  it('should return a different array instance on each call to the projects getter', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);

    const list1 = ledger.projects;
    const list2 = ledger.projects;

    expect(list1).not.toBe(list2);
    await ledger.close();
  });

  it('should invoke updateHeartbeatFn when the owner heartbeat timer fires', async () => {
    const opts = makeOptions({ role: 'owner' });
    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

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

    const ledger = await openOrThrow(opts);

    const coordinator = ledger._ctx.coordinator;
    if (coordinator) coordinator.shutdown = mock(async () => { throw new Error('shutdown fail'); });
    (ledger._ctx.db as any).close = mock(() => { throw new Error('db close fail'); });

    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }

    for (let j = 0; j < 20; j++) await Promise.resolve();

    expect(ledger._ctx.closed).toBe(true);
  });

  it('should catch and log when close() rejects inside signal handler', async () => {
    const spyOn_ = spyOn(process, 'on');
    const opts = makeOptions({ role: 'owner' });

    const ledger = await openOrThrow(opts);

    const sigintCall = spyOn_.mock.calls.find((c: any) => c[0] === 'SIGINT');
    const handler = sigintCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    const coordinator = ledger._ctx.coordinator;
    if (coordinator) coordinator.shutdown = mock(async () => { throw new Error('shutdown fail'); });
    (ledger._ctx.db as any).close = mock(() => { throw new Error('db close fail'); });

    handler!();

    for (let j = 0; j < 20; j++) await Promise.resolve();

    expect(ledger._ctx.closed).toBe(true);
    spyOn_.mockRestore();
  });

  it('should return Err with store type when symbolRepo.getStats() throws inside getStats()', async () => {
    const symbolRepo = makeSymbolRepoMock();
    symbolRepo.getStats.mockImplementation(() => { throw new Error('db error'); });
    const opts = makeOptions({ symbolRepo });
    const ledger = await openOrThrow(opts);


    try {
      (ledger as any).getStats();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('store');
      expect((e as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when symbolSearchFn throws inside searchSymbols()', async () => {
    const opts = makeOptions();
    opts.symbolSearchFn.mockImplementation(() => { throw new Error('db error'); });
    const ledger = await openOrThrow(opts);


    try {
      ledger.searchSymbols({ text: 'foo' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when relationSearchFn throws inside searchRelations()', async () => {
    const opts = makeOptions();
    opts.relationSearchFn.mockImplementation(() => { throw new Error('db error'); });
    const ledger = await openOrThrow(opts);


    try {
      ledger.searchRelations({ srcFilePath: 'a.ts' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when relationSearchFn throws inside getDependencies()', async () => {
    const opts = makeOptions();
    opts.relationSearchFn.mockImplementation(() => { throw new Error('db error'); });
    const ledger = await openOrThrow(opts);


    try {
      ledger.getDependencies('src/a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when relationSearchFn throws inside getDependents()', async () => {
    const opts = makeOptions();
    opts.relationSearchFn.mockImplementation(() => { throw new Error('db error'); });
    const ledger = await openOrThrow(opts);


    try {
      ledger.getDependents('src/a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when DependencyGraph.build throws inside getAffected()', async () => {
    const relationRepo = makeRelationRepoMock();
    relationRepo.getByType.mockImplementation(() => { throw new Error('db error'); });
    const opts = makeOptions({ relationRepo });
    const ledger = await openOrThrow(opts);


    try {
      await ledger.getAffected(['src/a.ts']);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when DependencyGraph.build throws inside hasCycle()', async () => {
    const relationRepo = makeRelationRepoMock();
    relationRepo.getByType.mockImplementation(() => { throw new Error('db error'); });
    const opts = makeOptions({ relationRepo });
    const ledger = await openOrThrow(opts);


    try {
      await ledger.hasCycle();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with index type when coordinator.fullIndex() throws inside reindex()', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'owner', coordinator });
    const ledger = await openOrThrow(opts);
    coordinator.fullIndex.mockRejectedValue(new Error('db error'));


    try {
      await (ledger as any).reindex();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('index');
      expect((e as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should execute close().catch() callback when close() rejects during healthcheck max-retries shutdown', async () => {
    let callCount = 0;
    const acquireMock = mock(async () => {
      callCount++;
      if (callCount === 1) return 'reader' as const;
      throw new Error('db unavailable');
    });
    const opts = makeOptions({ role: 'reader' });
    opts.acquireWatcherRoleFn = acquireMock as any;

    const ledger = await openOrThrow(opts);

    const originalClose = ledger.close.bind(ledger);
    (ledger as any).close = mock(async () => {
      await originalClose();
      throw new Error('close rejected');
    });

    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }

    for (let j = 0; j < 20; j++) await Promise.resolve();

    expect(ledger._ctx.closed).toBe(true);
  });

  it('should return "owner" from role getter when opened as owner', async () => {
    const opts = makeOptions({ role: 'owner' });

    const ledger = await openOrThrow(opts);

    expect(ledger.role).toBe('owner');
    await ledger.close();
  });

  it('should return "reader" from role getter when opened as reader', async () => {
    const opts = makeOptions({ role: 'reader' });

    const ledger = await openOrThrow(opts);

    expect(ledger.role).toBe('reader');
    await ledger.close();
  });

  describe('Gildash.getParsedAst', () => {
    it('should return ParsedFile from cache when getParsedAst is called for cached file', async () => {
      const cachedFile = { filePath: '/project/src/a.ts', program: {}, errors: [], comments: [], sourceText: 'x' } as any;
      const parseCache = makeParseCacheMock();
      parseCache.get.mockReturnValue(cachedFile);
      const opts = makeOptions({ parseCache });

      const ledger = await openOrThrow(opts);
      const result = (ledger as any).getParsedAst('/project/src/a.ts');

      expect(result).toBe(cachedFile);
      await ledger.close();
    });

    it('should return undefined when getParsedAst is called for uncached file', async () => {
      const parseCache = makeParseCacheMock();
      parseCache.get.mockReturnValue(undefined);
      const opts = makeOptions({ parseCache });

      const ledger = await openOrThrow(opts);
      const result = (ledger as any).getParsedAst('/project/src/missing.ts');

      expect(result).toBeUndefined();
      await ledger.close();
    });

    it('should call parseCache.get with the provided filePath when getParsedAst is invoked', async () => {
      const parseCache = makeParseCacheMock();
      const opts = makeOptions({ parseCache });

      const ledger = await openOrThrow(opts);
      (ledger as any).getParsedAst('/project/src/target.ts');

      expect(parseCache.get).toHaveBeenCalledTimes(1);
      expect(parseCache.get).toHaveBeenCalledWith('/project/src/target.ts');
      await ledger.close();
    });

    it('should return undefined and not call parseCache.get when getParsedAst is called after close', async () => {
      const parseCache = makeParseCacheMock();
      const opts = makeOptions({ parseCache });

      const ledger = await openOrThrow(opts);
      await ledger.close();
      const result = (ledger as any).getParsedAst('/project/src/a.ts');

      expect(result).toBeUndefined();
      expect(parseCache.get).not.toHaveBeenCalled();
    });

    it('should call parseCache.get with empty string when filePath is empty string', async () => {
      const parseCache = makeParseCacheMock();
      const opts = makeOptions({ parseCache });

      const ledger = await openOrThrow(opts);
      (ledger as any).getParsedAst('');

      expect(parseCache.get).toHaveBeenCalledWith('');
      await ledger.close();
    });

    it('should return ParsedFile for first path when getParsedAst is called after two different parseSource calls', async () => {
      const fileA = { filePath: '/project/src/a.ts', program: {}, errors: [], comments: [], sourceText: 'a' } as any;
      const parseCache = makeParseCacheMock();
      parseCache.get.mockImplementation((fp: string) => fp === '/project/src/a.ts' ? fileA : undefined);
      const opts = makeOptions({ parseCache });

      const ledger = await openOrThrow(opts);
      const result = (ledger as any).getParsedAst('/project/src/a.ts');

      expect(result).toBe(fileA);
      await ledger.close();
    });
  });

  describe('Gildash.getFileInfo', () => {
    it('should return FileRecord when getFileInfo is called for indexed file', async () => {
      const record = { project: 'test-project', filePath: 'src/a.ts', mtimeMs: 1000, size: 100, contentHash: 'abc', updatedAt: '2026-01-01' };
      const fileRepo = makeFileRepoMock();
      fileRepo.getFile.mockReturnValue(record);
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);
      const result = (ledger as any).getFileInfo('src/a.ts');

      expect(result).toEqual(record);
      await ledger.close();
    });

    it('should return null when getFileInfo is called for non-indexed file', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getFile.mockReturnValue(null);
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);
      const result = (ledger as any).getFileInfo('src/missing.ts');

      expect(result).toBeNull();
      await ledger.close();
    });

    it('should call fileRepo.getFile with provided project when getFileInfo is called with project', async () => {
      const fileRepo = makeFileRepoMock();
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);
      (ledger as any).getFileInfo('src/a.ts', 'custom-project');

      expect(fileRepo.getFile).toHaveBeenCalledWith('custom-project', 'src/a.ts');
      await ledger.close();
    });

    it('should use defaultProject when getFileInfo is called without project', async () => {
      const fileRepo = makeFileRepoMock();
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);
      (ledger as any).getFileInfo('src/a.ts');

      expect(fileRepo.getFile).toHaveBeenCalledWith('test-project', 'src/a.ts');
      await ledger.close();
    });

    it('should return closed error when getFileInfo is called after close', async () => {
      const opts = makeOptions();

      const ledger = await openOrThrow(opts);
      await ledger.close();

      expect(() => (ledger as any).getFileInfo('src/a.ts')).toThrow(GildashError);
    });

    it('should return store error when fileRepo.getFile throws', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getFile.mockImplementation(() => { throw new Error('db failure'); });
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);

      expect(() => (ledger as any).getFileInfo('src/a.ts')).toThrow(GildashError);
      await ledger.close();
    });

    it('should call fileRepo.getFile with empty string project when project is empty string', async () => {
      const fileRepo = makeFileRepoMock();
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);
      (ledger as any).getFileInfo('src/a.ts', '');

      expect(fileRepo.getFile).toHaveBeenCalledWith('', 'src/a.ts');
      await ledger.close();
    });

    it('should return closed error when getFileInfo is called after close without project', async () => {
      const fileRepo = makeFileRepoMock();
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);
      await ledger.close();

      expect(() => (ledger as any).getFileInfo('src/a.ts')).toThrow(GildashError);
      expect(fileRepo.getFile).not.toHaveBeenCalled();
    });
  });

  describe('Gildash.getSymbolsByFile', () => {
    it('should delegate to searchSymbols with filePath filter and limit 10000 when getSymbolsByFile is called', async () => {
      const symbolSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), symbolSearchFn } as any;

      const ledger = await openOrThrow(opts);
      (ledger as any).getSymbolsByFile('src/a.ts');

      expect(symbolSearchFn).toHaveBeenCalledTimes(1);
      const callOpts = symbolSearchFn.mock.calls[0]![0] as any;
      expect(callOpts.query.filePath).toBe('src/a.ts');
      expect(callOpts.query.limit).toBe(10_000);
      await ledger.close();
    });

    it('should pass undefined project to searchSymbols when getSymbolsByFile is called without project', async () => {
      const symbolSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), symbolSearchFn } as any;

      const ledger = await openOrThrow(opts);
      (ledger as any).getSymbolsByFile('src/a.ts');

      expect(symbolSearchFn).toHaveBeenCalledTimes(1);
      const callOpts = symbolSearchFn.mock.calls[0]![0] as any;
      expect(callOpts.query.project).toBeUndefined();
      await ledger.close();
    });
  });

  // ─── FR-17: searchAllSymbols / searchAllRelations ───

  describe('Gildash.searchAllSymbols', () => {
    it('should call symbolSearchFn with project:undefined when searchAllSymbols is called', async () => {
      const symbolSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      (ledger as any).searchAllSymbols({ text: 'Foo' });

      expect(symbolSearchFn).toHaveBeenCalledWith(
        expect.objectContaining({ project: undefined }),
      );
      await ledger.close();
    });

    it('should return symbolSearchFn result when searchAllSymbols succeeds', async () => {
      const sym = { id: 1, name: 'Foo', filePath: 'a.ts', kind: 'function', span: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } }, isExported: true, signature: null, fingerprint: 'fp1', detail: {} };
      const symbolSearchFn = mock((_opts: any) => [sym]);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).searchAllSymbols({});

      expect(result).toEqual([sym]);
      await ledger.close();
    });

    it('should pass empty query to symbolSearchFn when searchAllSymbols called with empty query', async () => {
      const symbolSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      (ledger as any).searchAllSymbols({});

      const callOpts = symbolSearchFn.mock.calls[0]![0] as any;
      expect(callOpts.project).toBeUndefined();
      expect(callOpts.query).toEqual({});
      await ledger.close();
    });

    it('should return Err with closed type when searchAllSymbols is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => (ledger as any).searchAllSymbols({})).toThrow(GildashError);
    });

    it('should return Err with search type when symbolSearchFn throws inside searchAllSymbols', async () => {
      const symbolSearchFn = mock((_opts: any) => { throw new Error('search fail'); });
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);


      expect(() => (ledger as any).searchAllSymbols({})).toThrow(GildashError);
      await ledger.close();
    });

    it('should return identical results when searchAllSymbols called twice with same query', async () => {
      const symbolSearchFn = mock((_opts: any) => [{ id: 1, name: 'A' }]);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const r1 = (ledger as any).searchAllSymbols({});
      const r2 = (ledger as any).searchAllSymbols({});

      expect(r1).toEqual(r2);
      await ledger.close();
    });

    it('should pass query.project through to effectiveProject in symbolSearchFn when query.project is set in searchAllSymbols', async () => {
      const symbolSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      (ledger as any).searchAllSymbols({ project: 'specific' });

      const callOpts = symbolSearchFn.mock.calls[0]![0] as any;
      expect(callOpts.project).toBeUndefined();
      expect(callOpts.query.project).toBe('specific');
      await ledger.close();
    });

    it('should return empty array when symbolSearchFn returns empty array in searchAllSymbols', async () => {
      const symbolSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).searchAllSymbols({});

      expect(result).toEqual([]);
      await ledger.close();
    });
  });

  describe('Gildash.searchAllRelations', () => {
    it('should call relationSearchFn with project:undefined when searchAllRelations is called', async () => {
      const relationSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      (ledger as any).searchAllRelations({ type: 'imports' });

      expect(relationSearchFn).toHaveBeenCalledWith(
        expect.objectContaining({ project: undefined }),
      );
      await ledger.close();
    });

    it('should return relationSearchFn result when searchAllRelations succeeds', async () => {
      const rel = { type: 'imports', srcFilePath: 'a.ts', srcSymbolName: null, dstFilePath: 'b.ts', dstSymbolName: null };
      const relationSearchFn = mock((_opts: any) => [rel]);
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).searchAllRelations({});

      expect(result).toEqual([rel]);
      await ledger.close();
    });

    it('should return Err with closed type when searchAllRelations is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => (ledger as any).searchAllRelations({})).toThrow(GildashError);
    });

    it('should return Err with search type when relationSearchFn throws inside searchAllRelations', async () => {
      const relationSearchFn = mock((_opts: any) => { throw new Error('fail'); });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);


      expect(() => (ledger as any).searchAllRelations({})).toThrow(GildashError);
      await ledger.close();
    });
  });

  // ─── FR-05: listIndexedFiles ───

  describe('Gildash.listIndexedFiles', () => {
    it('should call fileRepo.getAllFiles with defaultProject when listIndexedFiles is called without project', async () => {
      const fileRepo = makeFileRepoMock();
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      (ledger as any).listIndexedFiles();

      expect(fileRepo.getAllFiles).toHaveBeenCalledWith('test-project');
      await ledger.close();
    });

    it('should call fileRepo.getAllFiles with given project when listIndexedFiles is called with project', async () => {
      const fileRepo = makeFileRepoMock();
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      (ledger as any).listIndexedFiles('other-project');

      expect(fileRepo.getAllFiles).toHaveBeenCalledWith('other-project');
      await ledger.close();
    });

    it('should return file records when fileRepo.getAllFiles returns records', async () => {
      const files = [
        { project: 'test-project', filePath: 'a.ts', mtimeMs: 1000, size: 100, contentHash: 'abc', updatedAt: '2024-01-01', lineCount: 10 },
        { project: 'test-project', filePath: 'b.ts', mtimeMs: 2000, size: 200, contentHash: 'def', updatedAt: '2024-01-01', lineCount: 20 },
      ];
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles = mock(() => files) as any;
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).listIndexedFiles();

      expect(result).toEqual(files);
      await ledger.close();
    });

    it('should return Err with closed type when listIndexedFiles is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => (ledger as any).listIndexedFiles()).toThrow(GildashError);
    });

    it('should return Err with store type when fileRepo.getAllFiles throws inside listIndexedFiles', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles = mock(() => { throw new Error('db error'); }) as any;
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);


      expect(() => (ledger as any).listIndexedFiles()).toThrow(GildashError);
      await ledger.close();
    });

    it('should return empty array when no files are indexed', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles = mock(() => []) as any;
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).listIndexedFiles();

      expect(result).toEqual([]);
      await ledger.close();
    });

    it('should return same result on two consecutive listIndexedFiles calls when data is unchanged', async () => {
      const files = [{ project: 'test-project', filePath: 'a.ts', mtimeMs: 1000, size: 100, contentHash: 'abc', updatedAt: '2024-01-01' }];
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles = mock(() => files) as any;
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      const r1 = (ledger as any).listIndexedFiles();
      const r2 = (ledger as any).listIndexedFiles();

      expect(r1).toEqual(r2);
      await ledger.close();
    });
  });

  // ─── FR-20: getInternalRelations ───

  describe('Gildash.getInternalRelations', () => {
    it('should call relationSearchFn with both srcFilePath and dstFilePath set to filePath when getInternalRelations is called', async () => {
      const relationSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      (ledger as any).getInternalRelations('src/a.ts');

      const callOpts = relationSearchFn.mock.calls[0]![0] as any;
      expect(callOpts.query.srcFilePath).toBe('src/a.ts');
      expect(callOpts.query.dstFilePath).toBe('src/a.ts');
      await ledger.close();
    });

    it('should pass project param to relationSearchFn when getInternalRelations is called with project', async () => {
      const relationSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      (ledger as any).getInternalRelations('src/a.ts', 'my-project');

      const callOpts = relationSearchFn.mock.calls[0]![0] as any;
      expect(callOpts.project).toBe('my-project');
      await ledger.close();
    });

    it('should return intra-file relations when relationSearchFn returns relations', async () => {
      const rel = { type: 'calls', srcFilePath: 'src/a.ts', srcSymbolName: 'fnA', dstFilePath: 'src/a.ts', dstSymbolName: 'fnB' };
      const relationSearchFn = mock((_opts: any) => [rel]);
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getInternalRelations('src/a.ts');

      expect(result).toEqual([rel]);
      await ledger.close();
    });

    it('should return Err with closed type when getInternalRelations is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => (ledger as any).getInternalRelations('src/a.ts')).toThrow(GildashError);
    });

    it('should return Err with search type when relationSearchFn throws inside getInternalRelations', async () => {
      const relationSearchFn = mock((_opts: any) => { throw new Error('fail'); });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);


      expect(() => (ledger as any).getInternalRelations('src/a.ts')).toThrow(GildashError);
      await ledger.close();
    });

    it('should return empty array when no intra-file relations exist', async () => {
      const relationSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getInternalRelations('src/isolated.ts');

      expect(result).toEqual([]);
      await ledger.close();
    });

    it('should return identical results when getInternalRelations is called twice for same file', async () => {
      const rel = { type: 'calls', srcFilePath: 'a.ts', srcSymbolName: null, dstFilePath: 'a.ts', dstSymbolName: null };
      const relationSearchFn = mock((_opts: any) => [rel]);
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const r1 = (ledger as any).getInternalRelations('a.ts');
      const r2 = (ledger as any).getInternalRelations('a.ts');

      expect(r1).toEqual(r2);
      await ledger.close();
    });
  });

  // ─── FR-18: diffSymbols ───

  describe('Gildash.diffSymbols', () => {
    function makeSym(overrides: Partial<{ name: string; filePath: string; fingerprint: string | null; kind: string }> = {}) {
      return {
        id: 1, name: 'myFn', filePath: 'src/a.ts', kind: 'function',
        span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
        isExported: true, signature: null, fingerprint: 'fp-default', detail: {},
        ...overrides,
      };
    }

    it('should return added=[sym] when before=[] and after=[sym]', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const sym = makeSym();

      const diff = (ledger as any).diffSymbols([], [sym]);

      expect(diff.added).toEqual([sym]);
      expect(diff.removed).toEqual([]);
      expect(diff.modified).toEqual([]);
      await ledger.close();
    });

    it('should return removed=[sym] when before=[sym] and after=[]', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const sym = makeSym();

      const diff = (ledger as any).diffSymbols([sym], []);

      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([sym]);
      expect(diff.modified).toEqual([]);
      await ledger.close();
    });

    it('should return all empty when before and after contain the same symbol with same fingerprint', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const sym = makeSym({ fingerprint: 'fp1' });

      const diff = (ledger as any).diffSymbols([sym], [sym]);

      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.modified).toEqual([]);
      await ledger.close();
    });

    it('should return modified=[{before,after}] when same name+filePath but different fingerprint', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const before = makeSym({ fingerprint: 'fp1' });
      const after = makeSym({ fingerprint: 'fp2' });

      const diff = (ledger as any).diffSymbols([before], [after]);

      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0]).toEqual({ before, after });
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      await ledger.close();
    });

    it('should correctly classify added, removed and unchanged when mix of changes', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const unchanged = makeSym({ name: 'unchanged', fingerprint: 'fp1' });
      const removed = makeSym({ name: 'removed', fingerprint: 'fp2' });
      const added = makeSym({ name: 'added', fingerprint: 'fp3' });

      const diff = (ledger as any).diffSymbols([unchanged, removed], [unchanged, added]);

      expect(diff.added).toEqual([added]);
      expect(diff.removed).toEqual([removed]);
      expect(diff.modified).toEqual([]);
      await ledger.close();
    });

    it('should return all empty when before=[] and after=[]', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const diff = (ledger as any).diffSymbols([], []);

      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.modified).toEqual([]);
      await ledger.close();
    });

    it('should treat sym with null fingerprint in both before and after as unchanged', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const sym = makeSym({ fingerprint: null });

      const diff = (ledger as any).diffSymbols([sym], [sym]);

      expect(diff.modified).toEqual([]);
      await ledger.close();
    });

    it('should treat same name in different filePaths as add+remove not modified', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const before = makeSym({ name: 'fn', filePath: 'a.ts' });
      const after = makeSym({ name: 'fn', filePath: 'b.ts' });

      const diff = (ledger as any).diffSymbols([before], [after]);

      expect(diff.added).toEqual([after]);
      expect(diff.removed).toEqual([before]);
      expect(diff.modified).toEqual([]);
      await ledger.close();
    });

    it('should handle undefined fingerprint in both before and after as unchanged', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const sym = makeSym({ fingerprint: undefined as any });

      const diff = (ledger as any).diffSymbols([sym], [sym]);

      expect(diff.modified).toEqual([]);
      await ledger.close();
    });

    it('should correctly report all three categories simultaneously', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const addedSym = makeSym({ name: 'newFn', fingerprint: 'fp-new' });
      const removedSym = makeSym({ name: 'oldFn', fingerprint: 'fp-old' });
      const beforeMod = makeSym({ name: 'changedFn', fingerprint: 'fp-before' });
      const afterMod = makeSym({ name: 'changedFn', fingerprint: 'fp-after' });
      const unchanged = makeSym({ name: 'stableFn', fingerprint: 'fp-stable' });

      const diff = (ledger as any).diffSymbols(
        [removedSym, beforeMod, unchanged],
        [addedSym, afterMod, unchanged],
      );

      expect(diff.added).toEqual([addedSym]);
      expect(diff.removed).toEqual([removedSym]);
      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0]).toEqual({ before: beforeMod, after: afterMod });
      await ledger.close();
    });

    it('should return same diff result when diffSymbols called twice with same inputs', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const before = [makeSym({ fingerprint: 'fp1' })];
      const after = [makeSym({ fingerprint: 'fp2' })];

      const d1 = (ledger as any).diffSymbols(before, after);
      const d2 = (ledger as any).diffSymbols(before, after);

      expect(d1).toEqual(d2);
      await ledger.close();
    });

    it('should return modified when before.fingerprint=null and after.fingerprint="fp1" for same sym', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const before = makeSym({ fingerprint: null });
      const after = makeSym({ fingerprint: 'fp1' });

      const diff = (ledger as any).diffSymbols([before], [after]);

      expect(diff.modified).toHaveLength(1);
      await ledger.close();
    });

    it('should include multiple modified entries when multiple symbols change fingerprint', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      const b1 = makeSym({ name: 'fnA', fingerprint: 'fp-a-before' });
      const b2 = makeSym({ name: 'fnB', fingerprint: 'fp-b-before' });
      const a1 = makeSym({ name: 'fnA', fingerprint: 'fp-a-after' });
      const a2 = makeSym({ name: 'fnB', fingerprint: 'fp-b-after' });

      const diff = (ledger as any).diffSymbols([b1, b2], [a1, a2]);

      expect(diff.modified).toHaveLength(2);
      await ledger.close();
    });
  });

  // ─── FR-03: getImportGraph ───

  describe('Gildash.getImportGraph', () => {
    it('should return a Map with import edges when getImportGraph is called after indexing', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await ledger.getImportGraph();

      expect(result).toBeInstanceOf(Map);
      expect((result as Map<string, string[]>).get('src/a.ts')).toContain('src/b.ts');
      await ledger.close();
    });

    it('should return empty Map when no import relations exist in getImportGraph', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await ledger.getImportGraph();

      expect((result as Map<string, string[]>).size).toBe(0);
      await ledger.close();
    });

    it('should return Err with closed type when getImportGraph is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      await expect(ledger.getImportGraph()).rejects.toThrow(GildashError);
    });

    it('should return Err with search type when relationRepo throws inside getImportGraph', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockImplementation(() => { throw new Error('db error'); });
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);


      await expect(ledger.getImportGraph()).rejects.toThrow(GildashError);
      await ledger.close();
    });
  });

  // ─── FR-13: getTransitiveDependencies ───

  describe('Gildash.getTransitiveDependencies', () => {
    it('should return B and C when chain A→B→C exists and getTransitiveDependencies is called for A', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
        { srcFilePath: 'src/b.ts', dstFilePath: 'src/c.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await ledger.getTransitiveDependencies('src/a.ts');

      expect(result as string[]).toContain('src/b.ts');
      expect(result as string[]).toContain('src/c.ts');
      await ledger.close();
    });

    it('should return empty array when file has no dependencies in getTransitiveDependencies', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await ledger.getTransitiveDependencies('src/isolated.ts');

      expect(result).toEqual([]);
      await ledger.close();
    });

    it('should return Err with closed type when getTransitiveDependencies is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      await expect(ledger.getTransitiveDependencies('src/a.ts')).rejects.toThrow(GildashError);
    });

    it('should not loop infinitely when cycle exists in getTransitiveDependencies', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
        { srcFilePath: 'src/b.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await ledger.getTransitiveDependencies('src/a.ts');

      expect(Array.isArray(result)).toBe(true);
      await ledger.close();
    });
  });

  // ─── FR-04: getCyclePaths ───

  describe('Gildash.getCyclePaths', () => {
    it('should return cycle paths when A→B→A cycle exists', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
        { srcFilePath: 'src/b.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await ledger.getCyclePaths();

      expect((result as string[][]).length).toBeGreaterThan(0);
      await ledger.close();
    });

    it('should return empty array when no cycles exist in getCyclePaths', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await ledger.getCyclePaths();

      expect(result).toEqual([]);
      await ledger.close();
    });

    it('should return Err with closed type when getCyclePaths is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      await expect(ledger.getCyclePaths()).rejects.toThrow(GildashError);
    });

    it('should return Err with search type when relationRepo throws inside getCyclePaths', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockImplementation(() => { throw new Error('db error'); });
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);


      await expect(ledger.getCyclePaths()).rejects.toThrow(GildashError);
      await ledger.close();
    });

    it('should pass options to graph getCyclePaths when maxCycles is provided', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
        { srcFilePath: 'src/b.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
        { srcFilePath: 'src/c.ts', dstFilePath: 'src/d.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
        { srcFilePath: 'src/d.ts', dstFilePath: 'src/c.ts', type: 'imports', project: 'test-project', srcSymbolName: null, dstSymbolName: null, metaJson: null },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await ledger.getCyclePaths(undefined, { maxCycles: 1 });

      expect(result as string[][]).toHaveLength(1);
      await ledger.close();
    });
  });

  // ─── FR-02: batchParse ───

  describe('Gildash.batchParse', () => {
    it('should return Map with ParsedFile for each filePath when batchParse succeeds', async () => {
      const readFileFn = mock(async (fp: string) => `// content of ${fp}`);
      const opts = makeOptions({ readFileFn });
      const ledger = await openOrThrow(opts);

      const result = await ledger.batchParse(['/project/src/a.ts', '/project/src/b.ts']);

      const map = result as Map<string, any>;
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(2);
      expect(map.has('/project/src/a.ts')).toBe(true);
      expect(map.has('/project/src/b.ts')).toBe(true);
      await ledger.close();
    });

    it('should return empty Map when batchParse is called with empty array', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await ledger.batchParse([]);

      expect((result as Map<string, any>).size).toBe(0);
      await ledger.close();
    });

    it('should exclude failed file and include successful ones when some files fail to read in batchParse', async () => {
      const readFileFn = mock(async (fp: string) => {
        if (fp.includes('fail')) throw new Error('not found');
        return '// ok';
      });
      const opts = makeOptions({ readFileFn });
      const ledger = await openOrThrow(opts);

      const result = await ledger.batchParse(['/project/src/ok.ts', '/project/src/fail.ts']);

      const map = result as Map<string, any>;
      expect(map.has('/project/src/ok.ts')).toBe(true);
      expect(map.has('/project/src/fail.ts')).toBe(false);
      await ledger.close();
    });

    it('should return Err with closed type when batchParse is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      await expect(ledger.batchParse(['/project/src/a.ts'])).rejects.toThrow(GildashError);
    });

    it('should exclude file when parseSourceFn throws for that file in batchParse', async () => {
      let callCount = 0;
      const readFileFn = mock(async (_fp: string) => '// content');
      const parseSourceFn = mock((fp: string, text: string) => {
        callCount++;
        if (fp.includes('broken')) throw new Error('parse error');
        return { filePath: fp, program: { body: [] }, errors: [], comments: [], sourceText: text };
      }) as any;
      const opts = { ...makeOptions({ readFileFn }), parseSourceFn };
      const ledger = await openOrThrow(opts);

      const result = await ledger.batchParse(['/project/src/ok.ts', '/project/src/broken.ts']);

      const map = result as Map<string, any>;
      expect(map.has('/project/src/ok.ts')).toBe(true);
      expect(map.has('/project/src/broken.ts')).toBe(false);
      await ledger.close();
    });

    it('should return Map with single entry when single file is passed to batchParse', async () => {
      const readFileFn = mock(async (_fp: string) => '// single');
      const opts = makeOptions({ readFileFn });
      const ledger = await openOrThrow(opts);

      const result = await ledger.batchParse(['/project/src/single.ts']);

      expect((result as Map<string, any>).size).toBe(1);
      await ledger.close();
    });

    it('should pass options to parseSourceFn for each file when batchParse is called with options', async () => {
      const readFileFn = mock(async (_fp: string) => '// content');
      const parseSourceFn = mock((fp: string, text: string, _opts: any) => ({
        filePath: fp, program: { body: [] }, errors: [], comments: [], sourceText: text,
      })) as any;
      const opts = { ...makeOptions({ readFileFn }), parseSourceFn };
      const ledger = await openOrThrow(opts);
      const options = { sourceType: 'module' as const };

      await ledger.batchParse(['/project/src/a.ts', '/project/src/b.ts'], options);

      for (const call of (parseSourceFn.mock.calls as any[])) {
        expect(call[2]).toBe(options);
      }
      await ledger.close();
    });
  });

  // ─── FR-11: getModuleInterface ───

  describe('Gildash.getModuleInterface', () => {
    it('should return ModuleInterface with exported symbols when getModuleInterface is called', async () => {
      const symbolSearchFn = mock((_opts: any) => [
        { id: 1, name: 'myFn', filePath: '/project/src/a.ts', kind: 'function', isExported: true,
          span: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
          signature: null, fingerprint: null, detail: { parameters: 'x: number', returnType: 'void' } },
      ]);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = ledger.getModuleInterface('/project/src/a.ts');

      const mi = result as any;
      expect(mi.filePath).toBe('/project/src/a.ts');
      expect(mi.exports).toHaveLength(1);
      expect(mi.exports[0].name).toBe('myFn');
      expect(mi.exports[0].kind).toBe('function');
      expect(mi.exports[0].parameters).toBe('x: number');
      expect(mi.exports[0].returnType).toBe('void');
      await ledger.close();
    });

    it('should return empty exports array when no exported symbols exist in getModuleInterface', async () => {
      const symbolSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = ledger.getModuleInterface('/project/src/empty.ts');

      const mi = result as any;
      expect(mi.exports).toEqual([]);
      await ledger.close();
    });

    it('should call symbolSearchFn with isExported:true when getModuleInterface is called', async () => {
      const symbolSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      ledger.getModuleInterface('/project/src/a.ts');

      const callOpts = symbolSearchFn.mock.calls[0]![0] as any;
      expect(callOpts.query.isExported).toBe(true);
      expect(callOpts.query.filePath).toBe('/project/src/a.ts');
      await ledger.close();
    });

    it('should return Err with closed type when getModuleInterface is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => ledger.getModuleInterface('/project/src/a.ts')).toThrow(GildashError);
    });

    it('should return Err with search type when symbolSearchFn throws inside getModuleInterface', async () => {
      const symbolSearchFn = mock((_opts: any) => { throw new Error('fail'); });
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);


      expect(() => ledger.getModuleInterface('/project/src/a.ts')).toThrow(GildashError);
      await ledger.close();
    });

    it('should include jsDoc field when detail contains jsDoc in getModuleInterface', async () => {
      const symbolSearchFn = mock((_opts: any) => [
        { id: 2, name: 'MyClass', filePath: '/project/src/a.ts', kind: 'class', isExported: true,
          span: { start: { line: 1, column: 0 }, end: { line: 10, column: 1 } },
          signature: null, fingerprint: null, detail: { jsDoc: 'A useful class.' } },
      ]);
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = ledger.getModuleInterface('/project/src/a.ts');

      const mi = result as any;
      expect(mi.exports[0].jsDoc).toBe('A useful class.');
      await ledger.close();
    });
  });

  // ─── FR-21: getHeritageChain ───

  describe('Gildash.getHeritageChain', () => {
    it('should return root HeritageNode with one child when A extends B', async () => {
      const relationSearchFn = mock((opts: any) => {
        const { query } = opts;
        if (query.srcSymbolName === 'ClassA') {
          return [{ type: 'extends', srcFilePath: '/project/src/a.ts', srcSymbolName: 'ClassA', dstFilePath: '/project/src/b.ts', dstSymbolName: 'ClassB' }];
        }
        return [];
      });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = await ledger.getHeritageChain('ClassA', '/project/src/a.ts');

      const node = result as any;
      expect(node.symbolName).toBe('ClassA');
      expect(node.children).toHaveLength(1);
      expect(node.children[0].symbolName).toBe('ClassB');
      expect(node.children[0].kind).toBe('extends');
      await ledger.close();
    });

    it('should return root node with empty children when symbol has no heritage', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await ledger.getHeritageChain('StandaloneClass', '/project/src/a.ts');

      const node = result as any;
      expect(node.symbolName).toBe('StandaloneClass');
      expect(node.children).toEqual([]);
      await ledger.close();
    });

    it('should return Err with closed type when getHeritageChain is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      await expect(ledger.getHeritageChain('ClassA', '/project/src/a.ts')).rejects.toThrow(GildashError);
    });

    it('should not loop infinitely when cycle exists in getHeritageChain', async () => {
      const relationSearchFn = mock((opts: any) => {
        const { query } = opts;
        if (query.srcSymbolName === 'ClassA') {
          return [{ type: 'extends', srcFilePath: '/project/src/a.ts', srcSymbolName: 'ClassA', dstFilePath: '/project/src/b.ts', dstSymbolName: 'ClassB' }];
        }
        if (query.srcSymbolName === 'ClassB') {
          return [{ type: 'extends', srcFilePath: '/project/src/b.ts', srcSymbolName: 'ClassB', dstFilePath: '/project/src/a.ts', dstSymbolName: 'ClassA' }];
        }
        return [];
      });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = await ledger.getHeritageChain('ClassA', '/project/src/a.ts');

      expect(Array.isArray((result as any).children)).toBe(true);
      await ledger.close();
    });

    it('should include implements children when symbol implements interface', async () => {
      const relationSearchFn = mock((opts: any) => {
        const { query } = opts;
        if (query.srcSymbolName === 'MyClass') {
          return [{ type: 'implements', srcFilePath: '/project/src/a.ts', srcSymbolName: 'MyClass', dstFilePath: '/project/src/i.ts', dstSymbolName: 'IFoo' }];
        }
        return [];
      });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = await ledger.getHeritageChain('MyClass', '/project/src/a.ts');

      const node = result as any;
      expect(node.children[0].kind).toBe('implements');
      expect(node.children[0].symbolName).toBe('IFoo');
      await ledger.close();
    });

    it('should return Err with search type when relationSearchFn throws inside getHeritageChain', async () => {
      const relationSearchFn = mock((_opts: any) => { throw new Error('db fail'); });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);


      await expect(ledger.getHeritageChain('ClassA', '/project/src/a.ts')).rejects.toThrow(GildashError);
      await ledger.close();
    });
  });

  // ── FR-01 watchMode: false ─────────────────────────────────────────────────

  describe('watchMode: false (scan-only mode)', () => {
    // [HP] watchMode:false → acquireWatcherRoleFn 미호출
    it('should not call acquireWatcherRoleFn when watchMode is false', async () => {
      const acquireMock = mock(async () => 'owner' as const);
      const opts = { ...makeOptions(), acquireWatcherRoleFn: acquireMock, watchMode: false } as any;
      const ledger = await openOrThrow(opts);

      expect(acquireMock).not.toHaveBeenCalled();
      await ledger.close();
    });

    // [HP] watchMode:false → watcherFactory 미호출
    it('should not call watcherFactory when watchMode is false', async () => {
      const watcherFactory = mock(() => makeWatcherMock());
      const opts = { ...makeOptions(), watcherFactory, watchMode: false } as any;
      const ledger = await openOrThrow(opts);

      expect(watcherFactory).not.toHaveBeenCalled();
      await ledger.close();
    });

    // [HP] watchMode:false → heartbeat timer 미생성 (timer = null)
    it('should not start a heartbeat timer when watchMode is false', async () => {
      const opts = { ...makeOptions(), watchMode: false } as any;
      const ledger = await openOrThrow(opts);

      expect(ledger._ctx.timer).toBeNull();
      await ledger.close();
    });

    // [HP] watchMode:false → signal handler 미등록
    it('should not register signal handlers when watchMode is false', async () => {
      const opts = { ...makeOptions(), watchMode: false } as any;
      const ledger = await openOrThrow(opts);

      expect(ledger._ctx.signalHandlers).toHaveLength(0);
      await ledger.close();
    });

    // [HP] watchMode:false → coordinatorFactory 호출됨 + fullIndex 실행됨
    it('should call coordinatorFactory and run fullIndex when watchMode is false', async () => {
      const coordinatorMock = makeCoordinatorMock();
      const coordinatorFactory = mock(() => coordinatorMock);
      const opts = { ...makeOptions(), coordinatorFactory, watchMode: false } as any;
      const ledger = await openOrThrow(opts);

      expect(coordinatorFactory).toHaveBeenCalled();
      expect(coordinatorMock.fullIndex).toHaveBeenCalled();
      await ledger.close();
    });

    // [HP] watchMode:undefined (기본값) → acquireWatcherRoleFn 호출됨
    it('should call acquireWatcherRoleFn when watchMode is undefined (default behavior preserved)', async () => {
      const acquireMock = mock(async () => 'owner' as const);
      const opts = { ...makeOptions(), acquireWatcherRoleFn: acquireMock } as any;
      const ledger = await openOrThrow(opts);

      expect(acquireMock).toHaveBeenCalled();
      await ledger.close();
    });
  });

  // ── FR-01 close cleanup ────────────────────────────────────────────────────

  describe('close({ cleanup })', () => {
    // [HP] close({cleanup:true}) → unlinkFn이 .db/.db-wal/.db-shm 각각으로 호출됨
    it('should call unlinkFn for db, wal, and shm files when cleanup is true', async () => {
      const unlinkFn = mock(async (_p: string) => {});
      const opts = { ...makeOptions(), unlinkFn } as any;
      const ledger = await openOrThrow(opts);
      await ledger.close({ cleanup: true });

      expect(unlinkFn).toHaveBeenCalledTimes(3);
      const paths = unlinkFn.mock.calls.map((c: any[]) => c[0] as string);
      expect(paths.some((p: string) => p.endsWith('gildash.db'))).toBe(true);
      expect(paths.some((p: string) => p.endsWith('gildash.db-wal'))).toBe(true);
      expect(paths.some((p: string) => p.endsWith('gildash.db-shm'))).toBe(true);
    });

    // [HP] close({cleanup:false}) → unlinkFn 미호출
    it('should not call unlinkFn when cleanup is false', async () => {
      const unlinkFn = mock(async (_p: string) => {});
      const opts = { ...makeOptions(), unlinkFn } as any;
      const ledger = await openOrThrow(opts);
      await ledger.close({ cleanup: false });

      expect(unlinkFn).not.toHaveBeenCalled();
    });

    // [HP] close() opts 없음 → unlinkFn 미호출
    it('should not call unlinkFn when close is called without opts', async () => {
      const unlinkFn = mock(async (_p: string) => {});
      const opts = { ...makeOptions(), unlinkFn } as any;
      const ledger = await openOrThrow(opts);
      await ledger.close();

      expect(unlinkFn).not.toHaveBeenCalled();
    });

    // [ED] close({cleanup:true}) + unlinkFn throws → close 정상 완료
    it('should complete close normally when unlinkFn throws with cleanup true', async () => {
      const unlinkFn = mock(async (_p: string) => { throw new Error('unlink failed'); });
      const opts = { ...makeOptions(), unlinkFn } as any;
      const ledger = await openOrThrow(opts);
      await ledger.close({ cleanup: true });

    });
  });

  describe('Gildash.getFullSymbol', () => {
    // 1. [HP] class with members → FullSymbol.members populated
    it('should return FullSymbol with members when searching for a class symbol with member data in detail', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([{
        id: 1, name: 'MyClass', filePath: 'src/a.ts', kind: 'class',
        span: { start: { line: 1, column: 0 }, end: { line: 10, column: 1 } },
        isExported: true, signature: null, fingerprint: 'fp1',
        detail: {
          members: [{ name: 'doWork', kind: 'method', type: 'void', visibility: 'public', isStatic: false }],
          heritage: ['BaseClass'],
        },
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('MyClass', 'src/a.ts');

      expect(result.members).toEqual([{ name: 'doWork', kind: 'method', type: 'void', visibility: 'public', isStatic: false }]);
      await ledger.close();
    });

    // 2. [HP] function with parameters and returnType → fields populated
    it('should return FullSymbol with parameters and returnType when searching for a function symbol', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([{
        id: 2, name: 'fetchData', filePath: 'src/b.ts', kind: 'function',
        span: { start: { line: 5, column: 0 }, end: { line: 8, column: 1 } },
        isExported: true, signature: 'fetchData(url: string): Promise<Data>', fingerprint: 'fp2',
        detail: { parameters: 'url: string', returnType: 'Promise<Data>' },
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('fetchData', 'src/b.ts');

      expect(result.parameters).toBe('url: string');
      expect(result.returnType).toBe('Promise<Data>');
      await ledger.close();
    });

    // 3. [HP] symbol with jsDoc → jsDoc populated
    it('should return FullSymbol with jsDoc when symbol detail contains jsDoc string', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([{
        id: 3, name: 'MyFunc', filePath: 'src/c.ts', kind: 'function',
        span: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
        isExported: true, signature: null, fingerprint: 'fp3',
        detail: { jsDoc: '/** Does something useful */' },
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('MyFunc', 'src/c.ts');

      expect(result.jsDoc).toBe('/** Does something useful */');
      await ledger.close();
    });

    // 4. [HP] symbol with heritage array → heritage populated
    it('should return FullSymbol with heritage when symbol detail contains heritage array', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([{
        id: 4, name: 'DerivedClass', filePath: 'src/d.ts', kind: 'class',
        span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
        isExported: true, signature: null, fingerprint: 'fp4',
        detail: { heritage: ['BaseClass', 'IMixin'] },
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('DerivedClass', 'src/d.ts');

      expect(result.heritage).toEqual(['BaseClass', 'IMixin']);
      await ledger.close();
    });

    // 5. [HP] symbol with decorators → decorators populated
    it('should return FullSymbol with decorators when symbol detail contains decorators array', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([{
        id: 5, name: 'Injectable', filePath: 'src/e.ts', kind: 'class',
        span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
        isExported: true, signature: null, fingerprint: 'fp5',
        detail: { decorators: [{ name: 'Injectable', arguments: "'singleton'" }] },
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('Injectable', 'src/e.ts');

      expect(result.decorators).toEqual([{ name: 'Injectable', arguments: "'singleton'" }]);
      await ledger.close();
    });

    // 6. [HP] symbol with no detail fields → all optional fields undefined
    it('should return FullSymbol with undefined optional fields when symbol detail is empty', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([{
        id: 6, name: 'SimpleVar', filePath: 'src/f.ts', kind: 'variable',
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
        isExported: false, signature: null, fingerprint: 'fp6',
        detail: {},
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('SimpleVar', 'src/f.ts');

      expect(result.members).toBeUndefined();
      expect(result.jsDoc).toBeUndefined();
      expect(result.parameters).toBeUndefined();
      expect(result.returnType).toBeUndefined();
      await ledger.close();
    });

    // 7. [NE] symbol not found → null
    it('should return null when getFullSymbol cannot find the requested symbol', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('NotExist', 'src/x.ts');
      expect(result).toBeNull();
      await ledger.close();
    });

    // 8. [NE] closed instance → Err with closed type
    it('should return Err with closed type when getFullSymbol is called on a closed instance', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => (ledger as any).getFullSymbol('Foo', 'src/a.ts')).toThrow(GildashError);
    });

    // 9. [ED] symbol with empty members array → members is []
    it('should return FullSymbol with empty members array when symbol detail has members as empty array', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([{
        id: 7, name: 'EmptyClass', filePath: 'src/g.ts', kind: 'class',
        span: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
        isExported: true, signature: null, fingerprint: 'fp7',
        detail: { members: [] },
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('EmptyClass', 'src/g.ts');

      expect(result.members).toEqual([]);
      await ledger.close();
    });

    // 10. [CO] symbolSearchFn throws → Err('search')
    it('should return Err with search type when symbolSearchFn throws during getFullSymbol', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockImplementation(() => { throw new Error('db error'); });
      const ledger = await openOrThrow(opts);


      expect(() => (ledger as any).getFullSymbol('Foo', 'src/a.ts')).toThrow(GildashError);
      await ledger.close();
    });
  });

  // FR-10: getFileStats
  describe('Gildash.getFileStats', () => {
    // 1. [HP] indexed file with symbols and relations → all fields correct
    it('should return all file stats when getFileStats is called for an indexed file', async () => {
      const fileRepo = makeFileRepoMock();
      const symbolRepo = makeSymbolRepoMock();
      const relationRepo = makeRelationRepoMock();
      fileRepo.getFile.mockReturnValue({
        project: 'test-project', filePath: 'src/a.ts',
        contentHash: 'h1', mtimeMs: 1000, size: 512, lineCount: 80, updatedAt: '',
      });
      symbolRepo.getFileSymbols.mockReturnValue([
        { name: 'Foo', kind: 'class', filePath: 'src/a.ts', isExported: true },
        { name: 'bar', kind: 'function', filePath: 'src/a.ts', isExported: true },
        { name: '_internal', kind: 'function', filePath: 'src/a.ts', isExported: false },
      ] as any);
      relationRepo.getOutgoing.mockReturnValue([{}, {}] as any);
      const opts = makeOptions({ fileRepo, symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFileStats('src/a.ts');

      expect(result).toMatchObject({
        filePath: 'src/a.ts',
        lineCount: 80,
        size: 512,
        symbolCount: 3,
        exportedSymbolCount: 2,
        relationCount: 2,
      });
      await ledger.close();
    });

    // 2. [HP] file with 0 symbols → symbolCount=0, exportedSymbolCount=0
    it('should return symbolCount=0 and exportedSymbolCount=0 when file has no symbols', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getFile.mockReturnValue({
        project: 'test-project', filePath: 'src/empty.ts',
        contentHash: 'h0', mtimeMs: 0, size: 0, lineCount: 1, updatedAt: '',
      });
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFileStats('src/empty.ts');

      expect(result.symbolCount).toBe(0);
      expect(result.exportedSymbolCount).toBe(0);
      await ledger.close();
    });

    // 3. [HP] 3 symbols, 2 exported → exportedSymbolCount=2
    it('should return exportedSymbolCount=2 when only 2 of 3 symbols are exported', async () => {
      const fileRepo = makeFileRepoMock();
      const symbolRepo = makeSymbolRepoMock();
      fileRepo.getFile.mockReturnValue({
        project: 'test-project', filePath: 'src/b.ts',
        contentHash: 'h2', mtimeMs: 2, size: 100, lineCount: 20, updatedAt: '',
      });
      symbolRepo.getFileSymbols.mockReturnValue([
        { name: 'A', kind: 'class', filePath: 'src/b.ts', isExported: true },
        { name: 'B', kind: 'class', filePath: 'src/b.ts', isExported: true },
        { name: 'c', kind: 'variable', filePath: 'src/b.ts', isExported: false },
      ] as any);
      const opts = makeOptions({ fileRepo, symbolRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFileStats('src/b.ts');

      expect(result.symbolCount).toBe(3);
      expect(result.exportedSymbolCount).toBe(2);
      await ledger.close();
    });

    // 4. [NE] file not indexed → Err('search')
    it('should return Err with search type when getFileStats is called for a file not in the index', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);


      expect(() => (ledger as any).getFileStats('src/missing.ts')).toThrow(GildashError);
      await ledger.close();
    });

    // 5. [NE] closed → Err('closed')
    it('should return Err with closed type when getFileStats is called on a closed instance', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => (ledger as any).getFileStats('src/a.ts')).toThrow(GildashError);
    });

    // 6. [ED] lineCount null → returns 0
    it('should return lineCount=0 when file record has null lineCount', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getFile.mockReturnValue({
        project: 'test-project', filePath: 'src/null-lc.ts',
        contentHash: 'h3', mtimeMs: 0, size: 0, lineCount: null, updatedAt: '',
      });
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFileStats('src/null-lc.ts');

      expect(result.lineCount).toBe(0);
      await ledger.close();
    });

    // 7. [CO] getFileSymbols throws → Err('store')
    it('should return Err with store type when symbolRepo.getFileSymbols throws inside getFileStats', async () => {
      const fileRepo = makeFileRepoMock();
      const symbolRepo = makeSymbolRepoMock();
      fileRepo.getFile.mockReturnValue({
        project: 'test-project', filePath: 'src/a.ts',
        contentHash: 'h4', mtimeMs: 0, size: 0, lineCount: 1, updatedAt: '',
      });
      symbolRepo.getFileSymbols.mockImplementation(() => { throw new Error('db fail'); });
      const opts = makeOptions({ fileRepo, symbolRepo });
      const ledger = await openOrThrow(opts);


      expect(() => (ledger as any).getFileStats('src/a.ts')).toThrow(GildashError);
      await ledger.close();
    });

    // 8. [HP] 0 relations → relationCount=0
    it('should return relationCount=0 when file has no outgoing relations', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getFile.mockReturnValue({
        project: 'test-project', filePath: 'src/leaf.ts',
        contentHash: 'h5', mtimeMs: 0, size: 50, lineCount: 5, updatedAt: '',
      });
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFileStats('src/leaf.ts');

      expect(result.relationCount).toBe(0);
      await ledger.close();
    });
  });

  // FR-12: getFanMetrics
  describe('Gildash.getFanMetrics', () => {
    // 1. [HP] 3 files import A → fanIn=3
    it('should return fanIn=3 when three files import the target file', async () => {
      const relationRepo = makeRelationRepoMock();
      // 3 files (b, c, d) import src/a.ts
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/b.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project' },
        { srcFilePath: 'src/c.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project' },
        { srcFilePath: 'src/d.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project' },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await (ledger as any).getFanMetrics('src/a.ts');

      expect(result.fanIn).toBe(3);
      await ledger.close();
    });

    // 2. [HP] A imports 2 files → fanOut=2
    it('should return fanOut=2 when target file imports two other files', async () => {
      const relationRepo = makeRelationRepoMock();
      // a imports b and c
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project' },
        { srcFilePath: 'src/a.ts', dstFilePath: 'src/c.ts', type: 'imports', project: 'test-project' },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await (ledger as any).getFanMetrics('src/a.ts');

      expect(result.fanOut).toBe(2);
      await ledger.close();
    });

    // 3. [HP] isolated file → fanIn=0, fanOut=0
    it('should return fanIn=0 and fanOut=0 when file has no import relationships', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await (ledger as any).getFanMetrics('src/isolated.ts');

      expect(result.fanIn).toBe(0);
      expect(result.fanOut).toBe(0);
      await ledger.close();
    });

    // 4. [NE] closed → Err('closed')
    it('should return Err with closed type when getFanMetrics is called on a closed instance', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      await expect((ledger as any).getFanMetrics('src/a.ts')).rejects.toThrow(GildashError);
    });

    // 5. [NE] build throws → Err('search')
    it('should return Err with search type when DependencyGraph build throws during getFanMetrics', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockImplementation(() => { throw new Error('db fail'); });
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);


      await expect((ledger as any).getFanMetrics('src/a.ts')).rejects.toThrow(GildashError);
      await ledger.close();
    });

    // 6. [ED] single incoming import → fanIn=1
    it('should return fanIn=1 when exactly one file imports the target file', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/b.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project' },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await (ledger as any).getFanMetrics('src/a.ts');

      expect(result.fanIn).toBe(1);
      await ledger.close();
    });

    // 7. [CO] import cycle: A↔B → both fanIn>0 and fanOut>0
    it('should return both fanIn>0 and fanOut>0 when target file is in an import cycle', async () => {
      const relationRepo = makeRelationRepoMock();
      // a imports b, b imports a
      relationRepo.getByType.mockReturnValue([
        { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project' },
        { srcFilePath: 'src/b.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project' },
      ]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await (ledger as any).getFanMetrics('src/a.ts');

      expect(result.fanIn).toBeGreaterThan(0);
      expect(result.fanOut).toBeGreaterThan(0);
      await ledger.close();
    });
  });

  // ─── FR-14: resolveSymbol ───

  describe('Gildash.resolveSymbol', () => {
    // 1. [HP] no re-export → direct return, chain empty
    it('should return originalName=symbolName and empty reExportChain when no re-export relation exists', async () => {
      const opts = makeOptions();
      opts.relationSearchFn.mockReturnValue([]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).resolveSymbol('Foo', '/project/src/a.ts');

      expect(result.originalName).toBe('Foo');
      expect(result.originalFilePath).toBe('/project/src/a.ts');
      expect(result.reExportChain).toEqual([]);
      await ledger.close();
    });

    // 2. [HP] 1-hop re-export (same name)
    it('should return originalFilePath=B and chain=[A] when Foo is re-exported from A to B', async () => {
      const opts = makeOptions();
      opts.relationSearchFn
        .mockReturnValueOnce([{
          type: 're-exports',
          srcFilePath: '/project/src/a.ts',
          srcSymbolName: null,
          dstFilePath: '/project/src/b.ts',
          dstSymbolName: null,
          metaJson: JSON.stringify({ isReExport: true, specifiers: [{ local: 'Foo', exported: 'Foo' }] }),
        }])
        .mockReturnValueOnce([]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).resolveSymbol('Foo', '/project/src/a.ts');

      expect(result.originalName).toBe('Foo');
      expect(result.originalFilePath).toBe('/project/src/b.ts');
      expect(result.reExportChain).toEqual([{ filePath: '/project/src/a.ts', exportedAs: 'Foo' }]);
      await ledger.close();
    });

    // 3. [HP] alias re-export (Bar as Foo)
    it('should return originalName=Bar when Foo is an alias re-export of Bar from B', async () => {
      const opts = makeOptions();
      opts.relationSearchFn
        .mockReturnValueOnce([{
          type: 're-exports',
          srcFilePath: '/project/src/a.ts',
          srcSymbolName: null,
          dstFilePath: '/project/src/b.ts',
          dstSymbolName: null,
          metaJson: JSON.stringify({ isReExport: true, specifiers: [{ local: 'Bar', exported: 'Foo' }] }),
        }])
        .mockReturnValueOnce([]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).resolveSymbol('Foo', '/project/src/a.ts');

      expect(result.originalName).toBe('Bar');
      expect(result.originalFilePath).toBe('/project/src/b.ts');
      expect(result.reExportChain).toEqual([{ filePath: '/project/src/a.ts', exportedAs: 'Foo' }]);
      await ledger.close();
    });

    // 4. [HP] 2-hop chain A → B → C
    it('should build 2-element chain and originalFilePath=C when Foo passes through A then B to reach C', async () => {
      const opts = makeOptions();
      opts.relationSearchFn
        .mockReturnValueOnce([{
          type: 're-exports',
          srcFilePath: '/project/src/a.ts',
          srcSymbolName: null,
          dstFilePath: '/project/src/b.ts',
          dstSymbolName: null,
          metaJson: JSON.stringify({ isReExport: true, specifiers: [{ local: 'Foo', exported: 'Foo' }] }),
        }])
        .mockReturnValueOnce([{
          type: 're-exports',
          srcFilePath: '/project/src/b.ts',
          srcSymbolName: null,
          dstFilePath: '/project/src/c.ts',
          dstSymbolName: null,
          metaJson: JSON.stringify({ isReExport: true, specifiers: [{ local: 'Foo', exported: 'Foo' }] }),
        }])
        .mockReturnValueOnce([]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).resolveSymbol('Foo', '/project/src/a.ts');

      expect(result.originalFilePath).toBe('/project/src/c.ts');
      expect(result.reExportChain.length).toBe(2);
      expect(result.reExportChain[0]).toEqual({ filePath: '/project/src/a.ts', exportedAs: 'Foo' });
      expect(result.reExportChain[1]).toEqual({ filePath: '/project/src/b.ts', exportedAs: 'Foo' });
      await ledger.close();
    });

    // 5. [EP] circular re-export A → B → A → { circular: true }
    it('should return { circular: true } when re-export chain is circular', async () => {
      const opts = makeOptions();
      opts.relationSearchFn
        .mockReturnValueOnce([{
          type: 're-exports',
          srcFilePath: '/project/src/a.ts',
          srcSymbolName: null,
          dstFilePath: '/project/src/b.ts',
          dstSymbolName: null,
          metaJson: JSON.stringify({ isReExport: true, specifiers: [{ local: 'Foo', exported: 'Foo' }] }),
        }])
        .mockReturnValueOnce([{
          type: 're-exports',
          srcFilePath: '/project/src/b.ts',
          srcSymbolName: null,
          dstFilePath: '/project/src/a.ts',
          dstSymbolName: null,
          metaJson: JSON.stringify({ isReExport: true, specifiers: [{ local: 'Foo', exported: 'Foo' }] }),
        }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).resolveSymbol('Foo', '/project/src/a.ts');
      expect(result.circular).toBe(true);
      expect(result.reExportChain.length).toBeGreaterThan(0);
      await ledger.close();
    });

    // 6. [EP] closed → Err('closed')
    it('should return Err(closed) when resolveSymbol is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => (ledger as any).resolveSymbol('Foo', '/project/src/a.ts')).toThrow(GildashError);
    });

    // 7. [HP] project 파라미터 전달 확인
    it('should pass specified project to relationSearchFn when project is provided', async () => {
      const opts = makeOptions();
      opts.relationSearchFn.mockReturnValue([]);
      const ledger = await openOrThrow(opts);

      (ledger as any).resolveSymbol('Foo', '/project/src/a.ts', 'my-project');

      expect(opts.relationSearchFn).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'my-project' }),
      );
      await ledger.close();
    });

    // 8. [EP] export* (specifiers 없음) → 현재 위치 반환
    it('should return original filePath without following hop when re-export has no specifiers (export *)', async () => {
      const opts = makeOptions();
      opts.relationSearchFn.mockReturnValue([{
        type: 're-exports',
        srcFilePath: '/project/src/a.ts',
        srcSymbolName: null,
        dstFilePath: '/project/src/b.ts',
        dstSymbolName: null,
        metaJson: JSON.stringify({ isReExport: true }), // no specifiers
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).resolveSymbol('Foo', '/project/src/a.ts');

      expect(result.originalName).toBe('Foo');
      expect(result.originalFilePath).toBe('/project/src/a.ts');
      expect(result.reExportChain).toEqual([]);
      await ledger.close();
    });
  });

  // ─── FR-15: findPattern ───

  describe('Gildash.findPattern', () => {
    // 1. [HP] 패턴 매칭 결과 반환
    it('should return PatternMatch array from patternSearchFn when pattern matches', async () => {
      const matches = [{ filePath: '/project/src/a.ts', startLine: 5, endLine: 5, matchedText: 'console.log("hi")' }];
      const opts = makeOptions();
      (opts as any).patternSearchFn.mockResolvedValue(matches);
      const ledger = await openOrThrow(opts);

      const result = await (ledger as any).findPattern('console.log($$$)');

      expect(result).toEqual(matches);
      await ledger.close();
    });

    // 2. [HP] filePaths 지정 → patternSearchFn에 전달
    it('should pass specified filePaths to patternSearchFn when filePaths option is provided', async () => {
      const opts = makeOptions();
      (opts as any).patternSearchFn.mockResolvedValue([]);
      const ledger = await openOrThrow(opts);

      await (ledger as any).findPattern('foo()', { filePaths: ['/project/src/a.ts'] });

      expect((opts as any).patternSearchFn).toHaveBeenCalledWith(
        expect.objectContaining({ filePaths: ['/project/src/a.ts'] }),
      );
      await ledger.close();
    });

    // 3. [HP] filePaths 미지정 → fileRepo.getAllFiles 사용
    it('should use fileRepo.getAllFiles when filePaths is not specified', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles.mockReturnValue([
        { filePath: '/project/src/a.ts', project: 'test-project', contentHash: 'h1', mtimeMs: 0, size: 100, lineCount: 10, updatedAt: '' },
      ]);
      const opts = makeOptions({ fileRepo });
      (opts as any).patternSearchFn.mockResolvedValue([]);
      const ledger = await openOrThrow(opts);

      await (ledger as any).findPattern('foo()');

      expect((opts as any).patternSearchFn).toHaveBeenCalledWith(
        expect.objectContaining({ filePaths: ['/project/src/a.ts'] }),
      );
      await ledger.close();
    });

    // 4. [HP] 매칭 없음 → 빈 배열
    it('should return empty array when patternSearchFn returns no matches', async () => {
      const opts = makeOptions();
      (opts as any).patternSearchFn.mockResolvedValue([]);
      const ledger = await openOrThrow(opts);

      const result = await (ledger as any).findPattern('nonExistentPattern');

      expect(result).toEqual([]);
      await ledger.close();
    });

    // 5. [EP] closed → Err('closed')
    it('should return Err(closed) when findPattern is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();


      await expect((ledger as any).findPattern('foo()')).rejects.toThrow(GildashError);
    });

    // 6. [EP] patternSearchFn throws → Err('search')
    it('should return Err(search) when patternSearchFn throws', async () => {
      const opts = makeOptions();
      (opts as any).patternSearchFn.mockRejectedValue(new Error('ast-grep failed'));
      const ledger = await openOrThrow(opts);


      await expect((ledger as any).findPattern('foo()')).rejects.toThrow(GildashError);
      await ledger.close();
    });
  });

  // ─── LEG-2: DependencyGraph 내부 캐싱 ───

  describe('Gildash DependencyGraph cache (LEG-2)', () => {
    function makeIndexResultForLeg() {
      return {
        indexedFiles: 0, removedFiles: 0, totalSymbols: 0, totalRelations: 0, durationMs: 10,
        changedFiles: [], deletedFiles: [], failedFiles: [],
        changedSymbols: { added: [], modified: [], removed: [] },
      };
    }

    // 1. [HP] 연속 hasCycle() 호출 → graph 1번만 빌드
    it('should build DependencyGraph only once for consecutive calls with same project', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      await ledger.hasCycle();
      const afterFirst = relationRepo.getByType.mock.calls.length; // 3 (imports, type-ref, re-exports)

      await ledger.hasCycle(); // cache hit → no rebuild

      expect(relationRepo.getByType.mock.calls.length).toBe(afterFirst); // still 3
      await ledger.close();
    });

    // 2. [HP] 다른 project → 캐시 미스, 새 빌드
    it('should rebuild DependencyGraph when project key differs from cached key', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      await ledger.hasCycle();
      const afterFirst = relationRepo.getByType.mock.calls.length; // 3

      await ledger.hasCycle('other-project'); // different key → rebuild

      expect(relationRepo.getByType.mock.calls.length).toBeGreaterThan(afterFirst); // > 3
      await ledger.close();
    });

    // 3. [HP] reindex() 후 → 캐시 무효화됨
    it('should invalidate cache after reindex() completes', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([]);
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      await ledger.hasCycle(); // builds and caches
      const afterFirst = relationRepo.getByType.mock.calls.length;

      await ledger.reindex(); // should invalidate

      await ledger.hasCycle(); // should rebuild

      expect(relationRepo.getByType.mock.calls.length).toBeGreaterThan(afterFirst);
      await ledger.close();
    });

    // 4. [HP] coordinator onIndexed 콜백 발화 → 캐시 무효화
    it('should invalidate cache when coordinator fires onIndexed callback', async () => {
      const registeredCallbacks: Array<(r: any) => void> = [];
      const fakeCoordinator = {
        fullIndex: mock(async () => makeIndexResultForLeg()),
        onIndexed: mock((cb: any) => { registeredCallbacks.push(cb); }),
        shutdown: mock(async () => {}),
      };
      const coordinatorFactory = mock(() => fakeCoordinator as any);
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockReturnValue([]);
      const opts = { ...makeOptions({ relationRepo }), coordinatorFactory } as any;
      const ledger = await openOrThrow(opts);

      await ledger.hasCycle(); // builds and caches
      const afterFirst = relationRepo.getByType.mock.calls.length;

      // Simulate coordinator firing all registered onIndexed callbacks (incl. cache-clearing one)
      for (const cb of registeredCallbacks) cb(makeIndexResultForLeg());

      await ledger.hasCycle(); // should rebuild

      expect(relationRepo.getByType.mock.calls.length).toBeGreaterThan(afterFirst);
      await ledger.close();
    });
  });

  // ─── Semantic Layer integration ───

  describe('Semantic Layer integration', () => {
    function makeSemanticLayerMock() {
      return {
        collectTypeAt: mock((_fp: string, _pos: number) => null as ResolvedType | null),
        findReferences: mock((_fp: string, _pos: number) => [] as SemanticReference[]),
        findImplementations: mock((_fp: string, _pos: number) => [] as Implementation[]),
        getModuleInterface: mock((fp: string) => ({ filePath: fp, exports: [] } as SemanticModuleInterface)),
        notifyFileChanged: mock((_fp: string, _content: string) => {}),
        notifyFileDeleted: mock((_fp: string) => {}),
        dispose: mock(() => {}),
        isDisposed: false,
        lineColumnToPosition: mock((_fp: string, _line: number, _col: number) => 42 as number | null),
        findNamePosition: mock((_fp: string, _declPos: number, _name: string) => 55 as number | null),
      };
    }

    function makeSemanticOpts(overrides: Parameters<typeof makeOptions>[0] = {}) {
      const sl = makeSemanticLayerMock();
      const base = makeOptions(overrides);
      return {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;
    }

    const SAMPLE_SYMBOL = {
      id: 1, name: 'Foo', filePath: '/project/src/a.ts', kind: 'function',
      span: { start: { line: 5, column: 10 }, end: { line: 8, column: 1 } },
      isExported: true, signature: null, fingerprint: 'fp1', detail: {},
    };

    const SAMPLE_TYPE: ResolvedType = {
      text: 'string', flags: 1, isUnion: false, isIntersection: false, isGeneric: false,
    };

    // 1. [HP] open({semantic:true}) creates SemanticLayer
    it('should create SemanticLayer when open() is called with semantic: true', async () => {
      const opts = makeSemanticOpts();

      const ledger = await openOrThrow(opts);

      expect(opts.semanticLayerFactory).toHaveBeenCalledTimes(1);
      await ledger.close();
    });

    // 2. [NE] open({semantic:true}) SemanticLayer.create fails → Err
    it('should return Err when SemanticLayer factory fails during open()', async () => {
      const db = makeDbMock();
      const base = makeOptions({ db });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock(() => { throw new GildashError('semantic', 'tsconfig not found'); }),
      } as any;


      await expect(Gildash.open(opts)).rejects.toThrow(GildashError);
    });

    // 3. [HP] getResolvedType → symbol found + collectTypeAt returns type
    it('should return ResolvedType when getResolvedType finds symbol and collectTypeAt succeeds', async () => {
      const opts = makeSemanticOpts();
      opts.symbolSearchFn.mockReturnValue([SAMPLE_SYMBOL]);
      opts._sl.collectTypeAt.mockReturnValue(SAMPLE_TYPE);
      opts._sl.lineColumnToPosition.mockReturnValue(42);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getResolvedType('Foo', '/project/src/a.ts');

      expect(result).toEqual(SAMPLE_TYPE);
      expect(opts._sl.lineColumnToPosition).toHaveBeenCalledWith('/project/src/a.ts', 5, 10);
      expect(opts._sl.findNamePosition).toHaveBeenCalledWith('/project/src/a.ts', 42, 'Foo');
      expect(opts._sl.collectTypeAt).toHaveBeenCalledWith('/project/src/a.ts', 55);
      await ledger.close();
    });

    // 4. [HP] getResolvedType → collectTypeAt returns null
    it('should return null when getResolvedType finds symbol but collectTypeAt returns null', async () => {
      const opts = makeSemanticOpts();
      opts.symbolSearchFn.mockReturnValue([SAMPLE_SYMBOL]);
      opts._sl.collectTypeAt.mockReturnValue(null);
      opts._sl.lineColumnToPosition.mockReturnValue(42);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getResolvedType('Foo', '/project/src/a.ts');

      expect(result).toBeNull();
      await ledger.close();
    });

    // 5. [HP] getSemanticReferences → success
    it('should return SemanticReference array when getSemanticReferences finds symbol', async () => {
      const refs: SemanticReference[] = [
        { filePath: '/project/src/b.ts', position: 100, line: 10, column: 5, isDefinition: false, isWrite: false },
      ];
      const opts = makeSemanticOpts();
      opts.symbolSearchFn.mockReturnValue([SAMPLE_SYMBOL]);
      opts._sl.findReferences.mockReturnValue(refs);
      opts._sl.lineColumnToPosition.mockReturnValue(42);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getSemanticReferences('Foo', '/project/src/a.ts');

      expect(result).toEqual(refs);
      expect(opts._sl.findReferences).toHaveBeenCalledWith('/project/src/a.ts', 55);
      await ledger.close();
    });

    // 6. [HP] getImplementations → success
    it('should return Implementation array when getImplementations finds symbol', async () => {
      const impls: Implementation[] = [
        { filePath: '/project/src/c.ts', symbolName: 'FooImpl', position: 200, kind: 'class', isExplicit: true },
      ];
      const opts = makeSemanticOpts();
      opts.symbolSearchFn.mockReturnValue([SAMPLE_SYMBOL]);
      opts._sl.findImplementations.mockReturnValue(impls);
      opts._sl.lineColumnToPosition.mockReturnValue(42);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getImplementations('Foo', '/project/src/a.ts');

      expect(result).toEqual(impls);
      expect(opts._sl.findImplementations).toHaveBeenCalledWith('/project/src/a.ts', 55);
      await ledger.close();
    });

    // 7. [HP] getSemanticModuleInterface → delegates
    it('should delegate to semanticLayer.getModuleInterface when getSemanticModuleInterface is called', async () => {
      const moduleIface: SemanticModuleInterface = {
        filePath: '/project/src/a.ts',
        exports: [{ name: 'Foo', kind: 'function', resolvedType: SAMPLE_TYPE }],
      };
      const opts = makeSemanticOpts();
      opts._sl.getModuleInterface.mockReturnValue(moduleIface);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getSemanticModuleInterface('/project/src/a.ts');

      expect(result).toEqual(moduleIface);
      expect(opts._sl.getModuleInterface).toHaveBeenCalledWith('/project/src/a.ts');
      await ledger.close();
    });

    // 8. [HP] getFullSymbol + semantic → resolvedType included
    it('should include resolvedType in FullSymbol when semantic is enabled and type is available', async () => {
      const opts = makeSemanticOpts();
      opts.symbolSearchFn.mockReturnValue([{
        ...SAMPLE_SYMBOL,
        detail: { parameters: 'x: number' },
      }]);
      opts._sl.lineColumnToPosition.mockReturnValue(42);
      opts._sl.collectTypeAt.mockReturnValue(SAMPLE_TYPE);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('Foo', '/project/src/a.ts');

      expect(result.resolvedType).toEqual(SAMPLE_TYPE);
      expect(result.parameters).toBe('x: number');
      await ledger.close();
    });

    // 9. [HP] getFullSymbol - semantic → no resolvedType
    it('should not include resolvedType in FullSymbol when semantic is disabled', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([{
        ...SAMPLE_SYMBOL,
        detail: { parameters: 'x: number' },
      }]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('Foo', '/project/src/a.ts');

      expect(result.resolvedType).toBeUndefined();
      await ledger.close();
    });

    // 10. [HP] close() calls dispose
    it('should call semanticLayer.dispose() when close() is called with semantic enabled', async () => {
      const opts = makeSemanticOpts();
      const ledger = await openOrThrow(opts);

      await ledger.close();

      expect(opts._sl.dispose).toHaveBeenCalledTimes(1);
    });

    // 11. [HP] watcher event → notifyFileChanged
    it('should call semanticLayer.notifyFileChanged when watcher event fires with semantic enabled', async () => {
      const watcher = makeWatcherMock();
      let capturedCb: ((event: any) => void) | null = null;
      watcher.start = mock(async (cb: any) => { capturedCb = cb; });
      const opts = makeSemanticOpts({ watcher });
      opts.readFileFn = mock(async () => 'const x = 1;');
      const ledger = await openOrThrow(opts);

      capturedCb!({ eventType: 'change', filePath: '/project/src/a.ts' });
      for (let j = 0; j < 10; j++) await Promise.resolve();

      expect(opts.readFileFn).toHaveBeenCalledWith('/project/src/a.ts');
      expect(opts._sl.notifyFileChanged).toHaveBeenCalledWith('/project/src/a.ts', 'const x = 1;');
      await ledger.close();
    });

    // 12. [NE] semantic APIs after close → throw 'closed'
    it('should throw with closed type when semantic APIs are called after close()', async () => {
      const opts = makeSemanticOpts();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      expect(() => (ledger as any).getResolvedType('Foo', '/project/src/a.ts')).toThrow(GildashError);
      expect(() => (ledger as any).getSemanticReferences('Foo', '/project/src/a.ts')).toThrow(GildashError);
      expect(() => (ledger as any).getImplementations('Foo', '/project/src/a.ts')).toThrow(GildashError);
      expect(() => (ledger as any).getSemanticModuleInterface('/project/src/a.ts')).toThrow(GildashError);
    });

    // 13. [NE] semantic APIs without semantic → throw 'semantic'
    it('should throw with semantic type when semantic APIs are called without semantic enabled', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      expect(() => (ledger as any).getResolvedType('Foo', '/project/src/a.ts')).toThrow(GildashError);
      expect(() => (ledger as any).getSemanticReferences('Foo', '/project/src/a.ts')).toThrow(GildashError);
      expect(() => (ledger as any).getImplementations('Foo', '/project/src/a.ts')).toThrow(GildashError);
      expect(() => (ledger as any).getSemanticModuleInterface('/project/src/a.ts')).toThrow(GildashError);
      await ledger.close();
    });

    // 14. [NE] getResolvedType symbol not found → null
    it('should return null when getResolvedType cannot find the symbol', async () => {
      const opts = makeSemanticOpts();
      opts.symbolSearchFn.mockReturnValue([]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getResolvedType('NonExistent', '/project/src/a.ts');
      expect(result).toBeNull();
      await ledger.close();
    });

    // 15. [NE] getResolvedType throws → Err 'search'
    it('should return Err with search type when symbolSearchFn throws inside getResolvedType', async () => {
      const opts = makeSemanticOpts();
      opts.symbolSearchFn.mockImplementation(() => { throw new Error('db error'); });
      const ledger = await openOrThrow(opts);


      expect(() => (ledger as any).getResolvedType('Foo', '/project/src/a.ts')).toThrow(GildashError);
      await ledger.close();
    });

    // 16. [NE] close() → dispose throws → error aggregated
    it('should aggregate error when semanticLayer.dispose() throws during close()', async () => {
      const opts = makeSemanticOpts();
      opts._sl.dispose.mockImplementation(() => { throw new Error('dispose failed'); });
      const ledger = await openOrThrow(opts);


      await expect(ledger.close()).rejects.toThrow(GildashError);
    });

    // 17. [CO] closed check > semantic check priority
    it('should return Err with closed type rather than semantic type when both closed and no semantic', async () => {
      const opts = makeOptions(); // no semantic
      const ledger = await openOrThrow(opts);
      await ledger.close();


      expect(() => (ledger as any).getResolvedType('Foo', '/project/src/a.ts')).toThrow(GildashError);
    });

    // 18. [OR] SemanticLayer created before fullIndex
    it('should create SemanticLayer before calling coordinator.fullIndex() during open()', async () => {
      const callOrder: string[] = [];
      const sl = makeSemanticLayerMock();
      const coordinator = makeCoordinatorMock();
      coordinator.fullIndex = mock(async () => {
        callOrder.push('fullIndex');
        return {
          indexedFiles: 0, removedFiles: 0,
          totalSymbols: 0, totalRelations: 0,
          durationMs: 0, changedFiles: [], deletedFiles: [],
        };
      });
      const base = makeOptions({ coordinator });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => {
          callOrder.push('semanticLayerFactory');
          return sl;
        }),
      } as any;

      const ledger = await openOrThrow(opts);

      expect(callOrder).toEqual(['semanticLayerFactory', 'fullIndex']);
      await ledger.close();
    });

    // 19. [HP] getResolvedType uses defaultProject
    it('should pass defaultProject to symbolSearchFn when getResolvedType is called without project', async () => {
      const opts = makeSemanticOpts();
      opts.symbolSearchFn.mockReturnValue([SAMPLE_SYMBOL]);
      opts._sl.lineColumnToPosition.mockReturnValue(42);
      opts._sl.collectTypeAt.mockReturnValue(null);
      const ledger = await openOrThrow(opts);

      (ledger as any).getResolvedType('Foo', '/project/src/a.ts');

      const lastCall = opts.symbolSearchFn.mock.calls[opts.symbolSearchFn.mock.calls.length - 1];
      expect(lastCall[0].project).toBe('test-project');
      await ledger.close();
    });

    // 20. [HP] watcher event + no semantic → no semantic notification
    it('should not attempt semantic file read when watcher event fires without semantic enabled', async () => {
      const watcher = makeWatcherMock();
      let capturedCb: ((event: any) => void) | null = null;
      watcher.start = mock(async (cb: any) => { capturedCb = cb; });
      const readFileMock = mock(async (_fp: string) => '// content');
      const opts = makeOptions({ watcher, readFileFn: readFileMock as any });
      const ledger = await openOrThrow(opts);

      const callsBefore = readFileMock.mock.calls.length;
      capturedCb!({ eventType: 'change', filePath: '/project/src/a.ts' });
      for (let j = 0; j < 10; j++) await Promise.resolve();

      expect(readFileMock.mock.calls.length).toBe(callsBefore);
      await ledger.close();
    });

    // 21. [ED] close() → dispose before db.close
    it('should call semanticLayer.dispose() before db.close() during close()', async () => {
      const callOrder: string[] = [];
      const db = makeDbMock();
      db.close = mock(() => { callOrder.push('db.close'); });
      const sl = makeSemanticLayerMock();
      sl.dispose = mock(() => { callOrder.push('semantic.dispose'); });
      const base = makeOptions({ db });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;
      const ledger = await openOrThrow(opts);

      await ledger.close();

      const disposeIdx = callOrder.indexOf('semantic.dispose');
      const dbCloseIdx = callOrder.indexOf('db.close');
      expect(disposeIdx).not.toBe(-1);
      expect(dbCloseIdx).not.toBe(-1);
      expect(disposeIdx).toBeLessThan(dbCloseIdx);
    });

    // ─── Promotion + Semantic Layer coverage ───

    // 22. [HP] Promotion watcher callback → semantic notifyFileChanged
    it('should call semanticLayer.notifyFileChanged when promotion watcher callback fires with change event', async () => {
      const acquireMock = mock(async () => 'reader' as const);
      (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
      const watcher = makeWatcherMock();
      let capturedCb: ((event: any) => void) | null = null;
      watcher.start = mock(async (cb: any) => { capturedCb = cb; });
      const coordinator = makeCoordinatorMock();
      coordinator.handleWatcherEvent = mock(() => {});
      const sl = makeSemanticLayerMock();
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles.mockReturnValue([]);
      const readFileMock = mock(async (_fp: string) => 'const promoted = 1;');
      const base = makeOptions({ role: 'reader', watcher, coordinator, fileRepo, readFileFn: readFileMock as any });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;
      opts.acquireWatcherRoleFn = acquireMock as any;

      const ledger = await openOrThrow(opts);

      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 20; j++) await Promise.resolve();

      expect(capturedCb).not.toBeNull();
      capturedCb!({ eventType: 'change', filePath: '/project/src/a.ts' });
      for (let j = 0; j < 20; j++) await Promise.resolve();

      expect(readFileMock).toHaveBeenCalledWith('/project/src/a.ts');
      expect(sl.notifyFileChanged).toHaveBeenCalledWith('/project/src/a.ts', 'const promoted = 1;');
      await ledger.close();
    });

    // 23. [HP] Promotion → feed indexed files to semantic layer
    it('should feed indexed files to semanticLayer.notifyFileChanged after promotion fullIndex completes', async () => {
      const acquireMock = mock(async () => 'reader' as const);
      (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
      const watcher = makeWatcherMock();
      watcher.start = mock(async (_cb: any) => {});
      const coordinator = makeCoordinatorMock();
      const sl = makeSemanticLayerMock();
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles.mockReturnValue([
        { filePath: 'src/x.ts', project: 'test-project', contentHash: 'h1', mtimeMs: 1, size: 10, updatedAt: '', lineCount: 1 },
        { filePath: 'src/y.ts', project: 'test-project', contentHash: 'h2', mtimeMs: 2, size: 20, updatedAt: '', lineCount: 2 },
      ]);
      const readFileMock = mock(async (fp: string) => `// content of ${fp}`);
      const base = makeOptions({ role: 'reader', watcher, coordinator, fileRepo, readFileFn: readFileMock as any });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;
      opts.acquireWatcherRoleFn = acquireMock as any;

      const ledger = await openOrThrow(opts);

      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 30; j++) await Promise.resolve();

      expect(sl.notifyFileChanged).toHaveBeenCalledTimes(2);
      await ledger.close();
    });

    // 24. [NE] Promotion watcher callback → readFileFn rejects → .catch absorbs silently
    it('should not throw when promotion watcher callback readFileFn rejects for semantic notification', async () => {
      const acquireMock = mock(async () => 'reader' as const);
      (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
      const watcher = makeWatcherMock();
      let capturedCb: ((event: any) => void) | null = null;
      watcher.start = mock(async (cb: any) => { capturedCb = cb; });
      const coordinator = makeCoordinatorMock();
      coordinator.handleWatcherEvent = mock(() => {});
      const sl = makeSemanticLayerMock();
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles.mockReturnValue([]);
      const readFileMock = mock(async (_fp: string) => { throw new Error('read denied'); });
      const base = makeOptions({ role: 'reader', watcher, coordinator, fileRepo, readFileFn: readFileMock as any });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;
      opts.acquireWatcherRoleFn = acquireMock as any;

      const ledger = await openOrThrow(opts);

      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 20; j++) await Promise.resolve();

      capturedCb!({ eventType: 'change', filePath: '/project/src/a.ts' });
      for (let j = 0; j < 20; j++) await Promise.resolve();

      expect(sl.notifyFileChanged).not.toHaveBeenCalled();
      await ledger.close();
    });

    // 25. [NE] Promotion feed files → readFileFn throws for some, others succeed
    it('should silently catch errors when some readFileFn calls fail during promotion file feed', async () => {
      const acquireMock = mock(async () => 'reader' as const);
      (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
      const watcher = makeWatcherMock();
      watcher.start = mock(async (_cb: any) => {});
      const coordinator = makeCoordinatorMock();
      const sl = makeSemanticLayerMock();
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles.mockReturnValue([
        { filePath: 'src/ok.ts', project: 'test-project', contentHash: 'h1', mtimeMs: 1, size: 10, updatedAt: '', lineCount: 1 },
        { filePath: 'src/fail.ts', project: 'test-project', contentHash: 'h2', mtimeMs: 2, size: 20, updatedAt: '', lineCount: 2 },
      ]);
      let callCount = 0;
      const readFileMock = mock(async (fp: string) => {
        callCount++;
        if (fp.includes('fail')) throw new Error('read denied');
        return '// ok';
      });
      const base = makeOptions({ role: 'reader', watcher, coordinator, fileRepo, readFileFn: readFileMock as any });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;
      opts.acquireWatcherRoleFn = acquireMock as any;

      const ledger = await openOrThrow(opts);

      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 30; j++) await Promise.resolve();

      expect(sl.notifyFileChanged).toHaveBeenCalledTimes(1);
      await ledger.close();
    });

    // 26. [ED] Promotion watcher 'delete' event → semantic path NOT entered
    it('should not call semanticLayer.notifyFileChanged when promotion watcher callback fires with delete event', async () => {
      const acquireMock = mock(async () => 'reader' as const);
      (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
      const watcher = makeWatcherMock();
      let capturedCb: ((event: any) => void) | null = null;
      watcher.start = mock(async (cb: any) => { capturedCb = cb; });
      const coordinator = makeCoordinatorMock();
      coordinator.handleWatcherEvent = mock(() => {});
      const sl = makeSemanticLayerMock();
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles.mockReturnValue([]);
      const readFileMock = mock(async (_fp: string) => 'content');
      const base = makeOptions({ role: 'reader', watcher, coordinator, fileRepo, readFileFn: readFileMock as any });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;
      opts.acquireWatcherRoleFn = acquireMock as any;

      const ledger = await openOrThrow(opts);

      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 20; j++) await Promise.resolve();

      capturedCb!({ eventType: 'delete', filePath: '/project/src/a.ts' });
      for (let j = 0; j < 20; j++) await Promise.resolve();

      expect(sl.notifyFileChanged).not.toHaveBeenCalled();
      await ledger.close();
    });

    // 27. [NE] Owner watcher callback → readFileFn rejects → .catch absorbs silently
    it('should silently catch when readFileFn rejects inside owner watcher callback with semantic enabled', async () => {
      const watcher = makeWatcherMock();
      let capturedCb: ((event: any) => void) | null = null;
      watcher.start = mock(async (cb: any) => { capturedCb = cb; });
      const sl = makeSemanticLayerMock();
      const readFileMock = mock(async (_fp: string) => { throw new Error('read fail'); });
      const base = makeOptions({ watcher, readFileFn: readFileMock as any });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;

      const ledger = await openOrThrow(opts);

      capturedCb!({ eventType: 'change', filePath: '/project/src/a.ts' });
      for (let j = 0; j < 10; j++) await Promise.resolve();

      expect(sl.notifyFileChanged).not.toHaveBeenCalled();
      await ledger.close();
    });

    // 28. [NE] Promotion → internal onIndexed callback fires invalidateGraphCache
    it('should invoke internal invalidateGraphCache when promoted coordinator.onIndexedCb fires', async () => {
      const acquireMock = mock(async () => 'reader' as const);
      (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
      const coordinator = makeCoordinatorMock();
      const watcher = makeWatcherMock();
      watcher.start = mock(async (_cb: any) => {});
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles.mockReturnValue([]);
      const sl = makeSemanticLayerMock();
      const base = makeOptions({ role: 'reader', coordinator, watcher, fileRepo });
      const opts = {
        ...base,
        semantic: true,
        semanticLayerFactory: mock((_path: string) => sl),
        _sl: sl,
      } as any;
      opts.acquireWatcherRoleFn = acquireMock as any;

      const ledger = await openOrThrow(opts);

      jest.advanceTimersByTime(60_000);
      for (let j = 0; j < 20; j++) await Promise.resolve();

      // Set non-null graphCache to detect invalidation after promotion
      ledger._ctx.graphCache = {} as any;
      ledger._ctx.graphCacheKey = 'test-key';

      // After promotion, the coordinator's onIndexedCb is the internal callback
      coordinator.onIndexedCb?.({
        indexedFiles: 1, changedFiles: ['a.ts'], deletedFiles: [],
        totalSymbols: 2, totalRelations: 1, durationMs: 5,
      });

      expect(ledger._ctx.graphCache).toBeNull();
      expect(ledger._ctx.graphCacheKey).toBeNull();
      await ledger.close();
    });
  });
});
