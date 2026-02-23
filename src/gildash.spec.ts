import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { isErr } from '@zipbul/result';
import { Gildash } from './gildash';
import type { GildashError } from './errors';
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
    getAllFiles: mock(() => []),
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
  const result = await Gildash.open(opts);
  if (isErr(result)) throw result.data;
  return result;
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

    const result = await Gildash.open(opts);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('validation');
  });

  it('should return Err with validation type when projectRoot does not exist on disk', async () => {
    const opts = makeOptions({ existsSync: () => false });

    const result = await Gildash.open(opts);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('validation');
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

    const result = await (ledger as any).reindex();
    expect(isErr(result)).toBe(true);
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

    const result = await Gildash.open(opts);
    expect(isErr(result)).toBe(true);
    expect(db.close).toHaveBeenCalled();
  });

  it('should call db.close() when watcher.start() throws during open() as owner', async () => {
    const db = makeDbMock();
    const watcher = makeWatcherMock();
    watcher.start.mockRejectedValue(new Error('watcher start failed'));
    const opts = makeOptions({ role: 'owner', db, watcher });

    const result = await Gildash.open(opts);
    expect(isErr(result)).toBe(true);
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

    expect(isErr(ledger.searchSymbols({ text: 'foo' }))).toBe(true);
  });

  it('should return Err when searchRelations() is called after close()', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    await ledger.close();

    expect(isErr(ledger.searchRelations({ srcFilePath: 'a.ts' }))).toBe(true);
  });

  it('should return Err when stateless APIs are called after close()', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' } as any;
    await ledger.close();

    expect(isErr(ledger.parseSource('/project/src/a.ts', 'x'))).toBe(true);
    expect(isErr(ledger.extractSymbols(parsed))).toBe(true);
    expect(isErr(ledger.extractRelations(parsed))).toBe(true);
    expect(isErr(ledger.getStats())).toBe(true);
    expect(isErr(ledger.getDependencies('src/a.ts'))).toBe(true);
    expect(isErr(ledger.getDependents('src/a.ts'))).toBe(true);
  });

  it('should return Err when async APIs are called after close()', async () => {
    const opts = makeOptions();
    const ledger = await openOrThrow(opts);
    await ledger.close();

    expect(isErr(await ledger.reindex())).toBe(true);
    expect(isErr(await ledger.getAffected(['src/a.ts']))).toBe(true);
    expect(isErr(await ledger.hasCycle())).toBe(true);
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

    const result = await ledger.close();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('close');
  });

  it('should accumulate multiple errors in Err when both coordinator and db.close() throw', async () => {
    const coordinator = makeCoordinatorMock();
    coordinator.shutdown = mock(async () => { throw new Error('coordinator fail'); });
    const db = makeDbMock();
    db.close = mock(() => { throw new Error('db close fail'); });
    const opts = makeOptions({ role: 'owner', coordinator, db });
    const ledger = await openOrThrow(opts);

    const result = await ledger.close();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('close');
      expect(Array.isArray(result.data.cause)).toBe(true);
      expect((result.data.cause as unknown[]).length).toBeGreaterThanOrEqual(2);
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

    const ledger = await openOrThrow(opts);

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

  it('should return Err with store type when symbolRepo.getStats() throws inside getStats()', async () => {
    const symbolRepo = makeSymbolRepoMock();
    symbolRepo.getStats.mockImplementation(() => { throw new Error('db error'); });
    const opts = makeOptions({ symbolRepo });
    const ledger = await openOrThrow(opts);

    const result = (ledger as any).getStats();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect((result.data as GildashError).type).toBe('store');
      expect((result.data as GildashError).cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when symbolSearchFn throws inside searchSymbols()', async () => {
    const opts = makeOptions();
    opts.symbolSearchFn.mockImplementation(() => { throw new Error('db error'); });
    const ledger = await openOrThrow(opts);

    const result = ledger.searchSymbols({ text: 'foo' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when relationSearchFn throws inside searchRelations()', async () => {
    const opts = makeOptions();
    opts.relationSearchFn.mockImplementation(() => { throw new Error('db error'); });
    const ledger = await openOrThrow(opts);

    const result = ledger.searchRelations({ srcFilePath: 'a.ts' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when relationSearchFn throws inside getDependencies()', async () => {
    const opts = makeOptions();
    opts.relationSearchFn.mockImplementation(() => { throw new Error('db error'); });
    const ledger = await openOrThrow(opts);

    const result = ledger.getDependencies('src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when relationSearchFn throws inside getDependents()', async () => {
    const opts = makeOptions();
    opts.relationSearchFn.mockImplementation(() => { throw new Error('db error'); });
    const ledger = await openOrThrow(opts);

    const result = ledger.getDependents('src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when DependencyGraph.build throws inside getAffected()', async () => {
    const relationRepo = makeRelationRepoMock();
    relationRepo.getByType.mockImplementation(() => { throw new Error('db error'); });
    const opts = makeOptions({ relationRepo });
    const ledger = await openOrThrow(opts);

    const result = await ledger.getAffected(['src/a.ts']);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with search type when DependencyGraph.build throws inside hasCycle()', async () => {
    const relationRepo = makeRelationRepoMock();
    relationRepo.getByType.mockImplementation(() => { throw new Error('db error'); });
    const opts = makeOptions({ relationRepo });
    const ledger = await openOrThrow(opts);

    const result = await ledger.hasCycle();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBeInstanceOf(Error);
    }
    await ledger.close();
  });

  it('should return Err with index type when coordinator.fullIndex() throws inside reindex()', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'owner', coordinator });
    const ledger = await openOrThrow(opts);
    coordinator.fullIndex.mockRejectedValue(new Error('db error'));

    const result = await (ledger as any).reindex();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect((result.data as GildashError).type).toBe('index');
      expect((result.data as GildashError).cause).toBeInstanceOf(Error);
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

    expect((ledger as any).closed).toBe(true);
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

      expect(isErr(result)).toBe(false);
      expect(result).toEqual(record);
      await ledger.close();
    });

    it('should return null when getFileInfo is called for non-indexed file', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getFile.mockReturnValue(null);
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);
      const result = (ledger as any).getFileInfo('src/missing.ts');

      expect(isErr(result)).toBe(false);
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
      const result = (ledger as any).getFileInfo('src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    it('should return store error when fileRepo.getFile throws', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getFile.mockImplementation(() => { throw new Error('db failure'); });
      const opts = makeOptions({ fileRepo });

      const ledger = await openOrThrow(opts);
      const result = (ledger as any).getFileInfo('src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('store');
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
      const result = (ledger as any).getFileInfo('src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
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

      expect(isErr(result)).toBe(false);
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

      const result = (ledger as any).searchAllSymbols({});

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    it('should return Err with search type when symbolSearchFn throws inside searchAllSymbols', async () => {
      const symbolSearchFn = mock((_opts: any) => { throw new Error('search fail'); });
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).searchAllSymbols({});

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([rel]);
      await ledger.close();
    });

    it('should return Err with closed type when searchAllRelations is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = (ledger as any).searchAllRelations({});

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    it('should return Err with search type when relationSearchFn throws inside searchAllRelations', async () => {
      const relationSearchFn = mock((_opts: any) => { throw new Error('fail'); });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).searchAllRelations({});

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
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

      expect(isErr(result)).toBe(false);
      expect(result).toEqual(files);
      await ledger.close();
    });

    it('should return Err with closed type when listIndexedFiles is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = (ledger as any).listIndexedFiles();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    it('should return Err with store type when fileRepo.getAllFiles throws inside listIndexedFiles', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles = mock(() => { throw new Error('db error'); }) as any;
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).listIndexedFiles();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('store');
      await ledger.close();
    });

    it('should return empty array when no files are indexed', async () => {
      const fileRepo = makeFileRepoMock();
      fileRepo.getAllFiles = mock(() => []) as any;
      const opts = makeOptions({ fileRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).listIndexedFiles();

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([rel]);
      await ledger.close();
    });

    it('should return Err with closed type when getInternalRelations is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = (ledger as any).getInternalRelations('src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    it('should return Err with search type when relationSearchFn throws inside getInternalRelations', async () => {
      const relationSearchFn = mock((_opts: any) => { throw new Error('fail'); });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getInternalRelations('src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
      await ledger.close();
    });

    it('should return empty array when no intra-file relations exist', async () => {
      const relationSearchFn = mock((_opts: any) => []);
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getInternalRelations('src/isolated.ts');

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
      expect(result).toBeInstanceOf(Map);
      expect((result as Map<string, string[]>).get('src/a.ts')).toContain('src/b.ts');
      await ledger.close();
    });

    it('should return empty Map when no import relations exist in getImportGraph', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await ledger.getImportGraph();

      expect(isErr(result)).toBe(false);
      expect((result as Map<string, string[]>).size).toBe(0);
      await ledger.close();
    });

    it('should return Err with closed type when getImportGraph is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = await ledger.getImportGraph();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    it('should return Err with search type when relationRepo throws inside getImportGraph', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockImplementation(() => { throw new Error('db error'); });
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await ledger.getImportGraph();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
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

      expect(isErr(result)).toBe(false);
      expect(result as string[]).toContain('src/b.ts');
      expect(result as string[]).toContain('src/c.ts');
      await ledger.close();
    });

    it('should return empty array when file has no dependencies in getTransitiveDependencies', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await ledger.getTransitiveDependencies('src/isolated.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
      await ledger.close();
    });

    it('should return Err with closed type when getTransitiveDependencies is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = await ledger.getTransitiveDependencies('src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
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

      expect(isErr(result)).toBe(false);
      expect((result as string[][]).length).toBeGreaterThan(0);
      await ledger.close();
    });

    it('should return empty array when no cycles exist in getCyclePaths', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);

      const result = await ledger.getCyclePaths();

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
      await ledger.close();
    });

    it('should return Err with closed type when getCyclePaths is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = await ledger.getCyclePaths();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    it('should return Err with search type when relationRepo throws inside getCyclePaths', async () => {
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType.mockImplementation(() => { throw new Error('db error'); });
      const opts = makeOptions({ relationRepo });
      const ledger = await openOrThrow(opts);

      const result = await ledger.getCyclePaths();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
      const map = result as Map<string, any>;
      expect(map.has('/project/src/ok.ts')).toBe(true);
      expect(map.has('/project/src/fail.ts')).toBe(false);
      await ledger.close();
    });

    it('should return Err with closed type when batchParse is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = await ledger.batchParse(['/project/src/a.ts']);

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
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

      expect(isErr(result)).toBe(false);
      expect((result as Map<string, any>).size).toBe(1);
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
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

      const result = ledger.getModuleInterface('/project/src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    it('should return Err with search type when symbolSearchFn throws inside getModuleInterface', async () => {
      const symbolSearchFn = mock((_opts: any) => { throw new Error('fail'); });
      const opts = { ...makeOptions(), symbolSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = ledger.getModuleInterface('/project/src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
      const node = result as any;
      expect(node.symbolName).toBe('StandaloneClass');
      expect(node.children).toEqual([]);
      await ledger.close();
    });

    it('should return Err with closed type when getHeritageChain is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = await ledger.getHeritageChain('ClassA', '/project/src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
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

      expect(isErr(result)).toBe(false);
      const node = result as any;
      expect(node.children[0].kind).toBe('implements');
      expect(node.children[0].symbolName).toBe('IFoo');
      await ledger.close();
    });

    it('should return Err with search type when relationSearchFn throws inside getHeritageChain', async () => {
      const relationSearchFn = mock((_opts: any) => { throw new Error('db fail'); });
      const opts = { ...makeOptions(), relationSearchFn } as any;
      const ledger = await openOrThrow(opts);

      const result = await ledger.getHeritageChain('ClassA', '/project/src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
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

      expect((ledger as any).timer).toBeNull();
      await ledger.close();
    });

    // [HP] watchMode:false → signal handler 미등록
    it('should not register signal handlers when watchMode is false', async () => {
      const opts = { ...makeOptions(), watchMode: false } as any;
      const ledger = await openOrThrow(opts);

      expect((ledger as any).signalHandlers).toHaveLength(0);
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
      const result = await ledger.close({ cleanup: true });

      expect(isErr(result)).toBe(false);
    });
  });

  // ─── FR-07: getDeadExports ───

  describe('Gildash.getDeadExports', () => {
    function makeExportedSymbol(name: string, filePath: string) {
      return { name, filePath, kind: 'function', project: 'test-project', isExported: 1,
        startLine: 1, startColumn: 0, endLine: 5, endColumn: 1,
        signature: null, fingerprint: null, detailJson: null, contentHash: 'h1', indexedAt: '2024-01-01' };
    }

    function makeImportRelation(dstFilePath: string, dstSymbolName: string | null, type = 'imports') {
      return { type, srcFilePath: 'src/other.ts', srcSymbolName: null,
        dstFilePath, dstSymbolName, project: 'test-project', metaJson: null };
    }

    // [HP] all exports imported → returns []
    it('should return empty array when all exported symbols are imported by other files', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [makeExportedSymbol('Foo', 'src/a.ts')]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock((_p: string, type: string) =>
        type === 'imports' ? [makeImportRelation('src/a.ts', 'Foo')] : []
      ) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
      await ledger.close();
    });

    // [HP] 1 export not imported → returns [{symbolName, filePath}]
    it('should return one item when one exported symbol is not imported by any file', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [makeExportedSymbol('Bar', 'src/b.ts')]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock(() => []) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([{ symbolName: 'Bar', filePath: 'src/b.ts' }]);
      await ledger.close();
    });

    // [HP] multiple dead exports → all returned
    it('should return all dead exports when multiple exported symbols are not imported', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [
        makeExportedSymbol('A', 'src/utils.ts'),
        makeExportedSymbol('B', 'src/utils.ts'),
        makeExportedSymbol('C', 'src/utils.ts'),
      ]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock(() => []) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(false);
      expect(result).toHaveLength(3);
      await ledger.close();
    });

    // [HP] dstSymbolName=null in relation → symbol still considered dead
    it('should not consider a symbol imported when relation has null dstSymbolName', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [makeExportedSymbol('Baz', 'src/c.ts')]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock((_p: string, type: string) =>
        type === 'imports' ? [makeImportRelation('src/c.ts', null)] : []
      ) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([{ symbolName: 'Baz', filePath: 'src/c.ts' }]);
      await ledger.close();
    });

    // [HP] entryPoints specified → excludes exports from those files
    it('should exclude exports from entry point files when entryPoints option is specified', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [makeExportedSymbol('Entry', 'src/index.ts')]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock(() => []) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports(undefined, { entryPoints: ['src/index.ts'] });

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
      await ledger.close();
    });

    // [HP] entryPoints=[] → no exclusion, even default names not excluded
    it('should not exclude any exports when entryPoints is an empty array', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [makeExportedSymbol('Main', 'src/index.ts')]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock(() => []) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports(undefined, { entryPoints: [] });

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([{ symbolName: 'Main', filePath: 'src/index.ts' }]);
      await ledger.close();
    });

    // [HP] entryPoints not specified → default entry points applied
    it('should exclude exports from index.ts by default when entryPoints is not specified', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [makeExportedSymbol('Default', 'src/index.ts')]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock(() => []) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
      await ledger.close();
    });

    // [HP] project not specified → defaultProject used
    it('should pass defaultProject to symbolRepo when project is not specified', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => []) as any;
      const opts = makeOptions({ symbolRepo });
      const ledger = await openOrThrow(opts);

      (ledger as any).getDeadExports();

      expect(symbolRepo.searchByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'test-project' }),
      );
      await ledger.close();
    });

    // [HP] same name exported from 2 files, one imported → correct per-file distinction
    it('should treat exports with same name from different files independently based on filePath', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [
        makeExportedSymbol('Shared', 'src/a.ts'),
        makeExportedSymbol('Shared', 'src/b.ts'),
      ]) as any;
      const relationRepo = makeRelationRepoMock();
      // only src/a.ts::Shared is imported
      relationRepo.getByType = mock((_p: string, type: string) =>
        type === 'imports' ? [makeImportRelation('src/a.ts', 'Shared')] : []
      ) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([{ symbolName: 'Shared', filePath: 'src/b.ts' }]);
      await ledger.close();
    });

    // [HP] 're-exports' type relation included in imported determination
    it('should not mark a symbol as dead when it is referenced via a re-exports relation', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [makeExportedSymbol('Widget', 'src/widget.ts')]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock((_p: string, type: string) =>
        type === 're-exports' ? [makeImportRelation('src/widget.ts', 'Widget', 're-exports')] : []
      ) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
      await ledger.close();
    });

    // [NE] closed → Err('closed')
    it('should return Err with closed type when getDeadExports is called after close', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
    });

    // [NE] symbolRepo.searchByQuery throws → Err
    it('should return Err with store type when symbolRepo throws inside getDeadExports', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => { throw new Error('db error'); }) as any;
      const opts = makeOptions({ symbolRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('store');
      await ledger.close();
    });

    // [NE] relationRepo.getByType throws → Err
    it('should return Err with store type when relationRepo throws inside getDeadExports', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => []) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock(() => { throw new Error('relation db error'); }) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('store');
      await ledger.close();
    });

    // [ED] 0 import relations → all exports are dead
    it('should return all exports as dead when there are no import relations in the project', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => [
        makeExportedSymbol('X', 'src/x.ts'),
        makeExportedSymbol('Y', 'src/y.ts'),
      ]) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock(() => []) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getDeadExports();

      expect(isErr(result)).toBe(false);
      expect(result).toHaveLength(2);
      await ledger.close();
    });

    // [ED] project specified → correct project passed to queries
    it('should pass specified project to symbolRepo and relationRepo when project is given', async () => {
      const symbolRepo = makeSymbolRepoMock();
      symbolRepo.searchByQuery = mock(() => []) as any;
      const relationRepo = makeRelationRepoMock();
      relationRepo.getByType = mock(() => []) as any;
      const opts = makeOptions({ symbolRepo, relationRepo });
      const ledger = await openOrThrow(opts);

      (ledger as any).getDeadExports('custom-project');

      expect(symbolRepo.searchByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'custom-project' }),
      );
      expect(relationRepo.getByType).toHaveBeenCalledWith('custom-project', expect.any(String));
      await ledger.close();
    });
  });

  // FR-09: getFullSymbol
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
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

      expect(isErr(result)).toBe(false);
      expect(result.members).toBeUndefined();
      expect(result.jsDoc).toBeUndefined();
      expect(result.parameters).toBeUndefined();
      expect(result.returnType).toBeUndefined();
      await ledger.close();
    });

    // 7. [NE] symbol not found → Err with search type
    it('should return Err with search type when getFullSymbol cannot find the requested symbol', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockReturnValue([]);
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('NotExist', 'src/x.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
      await ledger.close();
    });

    // 8. [NE] closed instance → Err with closed type
    it('should return Err with closed type when getFullSymbol is called on a closed instance', async () => {
      const opts = makeOptions();
      const ledger = await openOrThrow(opts);
      await ledger.close();

      const result = (ledger as any).getFullSymbol('Foo', 'src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('closed');
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

      expect(isErr(result)).toBe(false);
      expect(result.members).toEqual([]);
      await ledger.close();
    });

    // 10. [CO] symbolSearchFn throws → Err('search')
    it('should return Err with search type when symbolSearchFn throws during getFullSymbol', async () => {
      const opts = makeOptions();
      opts.symbolSearchFn.mockImplementation(() => { throw new Error('db error'); });
      const ledger = await openOrThrow(opts);

      const result = (ledger as any).getFullSymbol('Foo', 'src/a.ts');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
      await ledger.close();
    });
  });
});
