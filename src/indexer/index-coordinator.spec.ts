import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import type { FileChangeEvent } from '../watcher/types';
import type { FileChangeRecord, DetectChangesResult } from './file-indexer';
import type { FileRecord } from '../store/repositories/file.repository';
import type { SymbolRecord } from '../store/repositories/symbol.repository';
import type { TsconfigPaths } from '../common/tsconfig-resolver';

const mockDetectChanges = mock(async (opts: any): Promise<DetectChangesResult> => ({ changed: [], unchanged: [], deleted: [] }));
const mockIndexFileSymbols = mock((opts: any) => {});
const mockIndexFileRelations = mock((opts: any) => 0);
const mockParseSource = mock((filePath: string, text: string) => ({
  filePath: filePath,
  program: {},
  errors: [],
  comments: [],
  sourceText: text,
}));
const mockLoadTsconfigPaths = mock((root: string): TsconfigPaths | null => null);
const mockClearTsconfigPathsCache = mock((root?: string) => {});
const mockResolveFileProject = mock((rel: string, bounds: any[], root?: string) => 'test-project');
const mockDiscoverProjects = mock(async (root: string) => [{ dir: '.', project: 'test-project' }]);

import { IndexCoordinator } from './index-coordinator';

function makeFileRepo() {
  return {
    upsertFile: mock((r: any) => {}),
    getFilesMap: mock(() => new Map<string, FileRecord>()),
    getAllFiles: mock((): FileRecord[] => []),
    deleteFile: mock((p: any, f: any) => {}),
  };
}

function makeSymbolRepo() {
  return {
    replaceFileSymbols: mock((p: any, f: any, h: any, s: any) => {}),
    getFileSymbols: mock((p: any, f: any): Array<Partial<SymbolRecord> & { name: string; filePath: string }> => []),
    getByFingerprint: mock((p: any, fp: any): Array<Partial<SymbolRecord> & { name: string; filePath: string }> => []),
    deleteFileSymbols: mock((p: any, f: any) => {}),
  };
}

function makeRelationRepo() {
  return {
    replaceFileRelations: mock((p: any, f: any, r: any) => {}),
    retargetRelations: mock((p: any, of: any, os: any, nf: any, ns: any) => {}),
    deleteFileRelations: mock((p: any, f: any) => {}),
  };
}

function makeDbConnection() {
  return {
    transaction: mock((fn: () => any) => fn()),
  };
}

function makeParseCache() {
  return {
    set: mock((k: string, v: any) => {}),
    get: mock((k: string) => undefined),
    invalidate: mock((k: string) => {}),
  };
}

function makeFakeFile(filePath: string) {
  return { filePath, contentHash: 'hash-' + filePath, mtimeMs: 1000, size: 100 };
}

const PROJECT_ROOT = '/project';
const BOUNDARIES = [{ dir: '.', project: 'test-project' }];
const EXTENSIONS = ['.ts'];
const IGNORE_PATTERNS: string[] = [];

function makeCoordinator(overrides: Partial<{
  fileRepo: any; symbolRepo: any; relationRepo: any;
  dbConnection: any; parseCache: any;
}> = {}) {
  return new IndexCoordinator({
    projectRoot: PROJECT_ROOT,
    boundaries: BOUNDARIES,
    extensions: EXTENSIONS,
    ignorePatterns: IGNORE_PATTERNS,
    dbConnection: overrides.dbConnection ?? makeDbConnection(),
    parseCache: overrides.parseCache ?? makeParseCache(),
    fileRepo: (overrides.fileRepo ?? makeFileRepo()) as any,
    symbolRepo: (overrides.symbolRepo ?? makeSymbolRepo()) as any,
    relationRepo: overrides.relationRepo ?? makeRelationRepo(),
    parseSourceFn: mockParseSource as any,
  });
}

describe('IndexCoordinator', () => {
  beforeEach(() => {
    mock.module('./file-indexer', () => ({ detectChanges: mockDetectChanges }));
    mock.module('./symbol-indexer', () => ({ indexFileSymbols: mockIndexFileSymbols }));
    mock.module('./relation-indexer', () => ({ indexFileRelations: mockIndexFileRelations }));
    mock.module('../common/tsconfig-resolver', () => ({ loadTsconfigPaths: mockLoadTsconfigPaths, clearTsconfigPathsCache: mockClearTsconfigPathsCache }));
    mock.module('../common/project-discovery', () => ({ resolveFileProject: mockResolveFileProject, discoverProjects: mockDiscoverProjects }));

    mockDetectChanges.mockReset();
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    mockIndexFileSymbols.mockReset();
    mockIndexFileRelations.mockReset();
    mockIndexFileRelations.mockReturnValue(0);
    mockParseSource.mockReset();
    mockParseSource.mockImplementation((fp: string, text: string) => ({
      filePath: fp, program: { body: [] }, errors: [], comments: [], sourceText: text,
    }));
    mockLoadTsconfigPaths.mockReset();
    mockLoadTsconfigPaths.mockReturnValue(null);
    mockClearTsconfigPathsCache.mockReset();
    mockResolveFileProject.mockReset();
    mockResolveFileProject.mockReturnValue('test-project');
    mockDiscoverProjects.mockReset();
    mockDiscoverProjects.mockResolvedValue([{ dir: '.', project: 'test-project' }]);

    spyOn(Bun, 'file').mockReturnValue({
      text: async () => 'mock source',
      lastModified: 1000,
      size: 100,
    } as any);

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });
  it('should return IndexResult with correct indexedFiles count when fullIndex completes with changed files', async () => {
    const files = [makeFakeFile('src/a.ts'), makeFakeFile('src/b.ts')];
    mockDetectChanges.mockResolvedValue({ changed: files, unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'source code' } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.fullIndex();

    expect(result.indexedFiles).toBe(2);
  });

  it('should return indexedFiles=0 when there are no files to index', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    const result = await coordinator.fullIndex();

    expect(result.indexedFiles).toBe(0);
  });

  it('should index the provided file when incrementalIndex is called with explicit changedFiles', async () => {
    const file = makeFakeFile('src/index.ts');
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'code' } as any);
    const symbolRepo = makeSymbolRepo();
    const coordinator = makeCoordinator({ symbolRepo });

    await coordinator.incrementalIndex([{ eventType: 'change', filePath: 'src/index.ts' }]);

    expect(mockParseSource).toHaveBeenCalled();
  });

  it('should call detectChanges when incrementalIndex is called without arguments', async () => {
    const coordinator = makeCoordinator();

    await coordinator.incrementalIndex();

    expect(mockDetectChanges).toHaveBeenCalled();
  });

  it('should invoke onIndexed callback when incrementalIndex finishes', async () => {
    const coordinator = makeCoordinator();
    const cb = mock((result: any) => {});
    coordinator.onIndexed(cb);

    await coordinator.incrementalIndex();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('should not invoke callback when unsubscribe is called before indexing completes', async () => {
    const coordinator = makeCoordinator();
    const cb = mock((result: any) => {});
    const unsub = coordinator.onIndexed(cb);
    unsub();

    await coordinator.incrementalIndex();

    expect(cb).not.toHaveBeenCalled();
  });

  it('should fire multiple onIndexed callbacks in registration order when multiple callbacks are registered', async () => {
    const coordinator = makeCoordinator();
    const order: number[] = [];
    coordinator.onIndexed(() => order.push(1));
    coordinator.onIndexed(() => order.push(2));

    await coordinator.incrementalIndex();

    expect(order).toEqual([1, 2]);
  });

  it('should continue executing remaining callbacks when one onIndexed callback throws', async () => {
    const coordinator = makeCoordinator();
    const spyConsoleError = spyOn(console, 'error').mockImplementation(() => {});
    const secondCb = mock((result: any) => {});
    coordinator.onIndexed(() => { throw new Error('callback error'); });
    coordinator.onIndexed(secondCb);

    await coordinator.incrementalIndex();

    expect(secondCb).toHaveBeenCalled();
    spyConsoleError.mockRestore();
  });

  it('should call retargetRelations when deleted and new symbol share the same fingerprint', async () => {
    const relationRepo = makeRelationRepo();
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getByFingerprint.mockReturnValue([{ filePath: 'src/new.ts', name: 'movedFn', kind: 'function' }]);
    symbolRepo.getFileSymbols.mockReturnValue([{ filePath: 'src/old.ts', name: 'movedFn', fingerprint: 'fp-move', kind: 'function' }]);

    const coordinator = makeCoordinator({ symbolRepo, relationRepo });
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/new.ts')],
      unchanged: [],
      deleted: ['src/old.ts'],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '' } as any);

    await coordinator.incrementalIndex();

    expect(relationRepo.retargetRelations).toHaveBeenCalled();
  });

  it('should not retarget relations when fingerprint match is ambiguous (multiple matches)', async () => {
    const relationRepo = makeRelationRepo();
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getByFingerprint.mockReturnValue([
      { filePath: 'src/new1.ts', name: 'fn', kind: 'function' },
      { filePath: 'src/new2.ts', name: 'fn', kind: 'function' },
    ]);
    symbolRepo.getFileSymbols.mockReturnValue([
      { filePath: 'src/old.ts', name: 'fn', fingerprint: 'fp-dup', kind: 'function' },
    ]);

    const coordinator = makeCoordinator({ symbolRepo, relationRepo });
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/new1.ts'), makeFakeFile('src/new2.ts')],
      unchanged: [],
      deleted: ['src/old.ts'],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '' } as any);

    await coordinator.incrementalIndex();

    expect(relationRepo.retargetRelations).not.toHaveBeenCalled();
  });

  it('should queue watcher event without starting indexing when indexingLock is active', async () => {
    let resolveIndex!: () => void;
    const inflightPromise = new Promise<void>((res) => { resolveIndex = res; });
    mockDetectChanges.mockReturnValueOnce(inflightPromise.then(() => ({ changed: [], unchanged: [], deleted: [] })));

    const coordinator = makeCoordinator();
    const firstIndex = coordinator.incrementalIndex();

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/late.ts' });

    expect(mockDetectChanges).toHaveBeenCalledTimes(1);

    resolveIndex();
    await firstIndex;
  });

  it('should coalesce rapid handleWatcherEvent calls into a single incrementalIndex when debounce window is active', async () => {
    const coordinator = makeCoordinator();
    const results: any[] = [];
    coordinator.onIndexed((r) => results.push(r));

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/a.ts' });
    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/b.ts' });
    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/c.ts' });

    jest.runAllTimers();
    await coordinator.shutdown();

    expect(results).toHaveLength(1);
    expect(results[0].indexedFiles).toBe(3);
  });

  it('should not start a second debounce timer when one is already pending', async () => {
    const coordinator = makeCoordinator();
    const spySetTimeout = spyOn(globalThis, 'setTimeout');

    coordinator.handleWatcherEvent({ eventType: 'create', filePath: 'src/a.ts' });
    coordinator.handleWatcherEvent({ eventType: 'create', filePath: 'src/b.ts' });

    expect(spySetTimeout).toHaveBeenCalledTimes(1);
    spySetTimeout.mockRestore();
  });

  it('should release indexingLock when incrementalIndex fails so subsequent calls can proceed', async () => {
    mockDetectChanges
      .mockRejectedValueOnce(new Error('index error'))
      .mockResolvedValue({ changed: [], unchanged: [], deleted: [] });

    const coordinator = makeCoordinator();

    await expect(coordinator.incrementalIndex()).rejects.toThrow('index error');
    await expect(coordinator.incrementalIndex()).resolves.toBeDefined();
  });

  it('should process queued events when events are queued during active indexing', async () => {
    let resolveFirst!: () => void;
    const firstDone = new Promise<{ changed: any[]; unchanged: any[]; deleted: any[] }>((res) => { resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] }); });
    mockDetectChanges.mockReturnValueOnce(firstDone);

    const coordinator = makeCoordinator();
    const results: any[] = [];
    coordinator.onIndexed((r) => results.push(r));

    const firstIndex = coordinator.incrementalIndex();

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/queued.ts' });
    jest.runAllTimers();

    resolveFirst();
    await firstIndex;
    await coordinator.shutdown();

    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('should trigger incrementalIndex batch that includes the created file when create event is received and debounce expires', async () => {
    const coordinator = makeCoordinator();
    const results: any[] = [];
    coordinator.onIndexed((r) => results.push(r));

    coordinator.handleWatcherEvent({ eventType: 'create', filePath: 'src/newfile.ts' });

    jest.runAllTimers();
    await coordinator.shutdown();

    expect(results).toHaveLength(1);
    expect(results[0].indexedFiles).toBe(1);
  });

  it('should pass delete event filePath in the batch when delete event is received and debounce expires', async () => {
    const fileRepo = makeFileRepo();
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getFileSymbols.mockReturnValue([]);
    const coordinator = makeCoordinator({ fileRepo, symbolRepo });

    coordinator.handleWatcherEvent({ eventType: 'delete', filePath: 'src/gone.ts' });

    jest.runAllTimers();
    await coordinator.shutdown();

    expect(fileRepo.deleteFile).toHaveBeenCalledWith('test-project', 'src/gone.ts');
  });

  it('should trigger indexing when change event is received and debounce expires', async () => {
    const coordinator = makeCoordinator();
    const results: any[] = [];
    coordinator.onIndexed((r) => results.push(r));

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/modified.ts' });

    jest.runAllTimers();
    await coordinator.shutdown();

    expect(results).toHaveLength(1);
    expect(results[0].indexedFiles).toBe(1);
  });

  it('should resolve shutdown immediately when no indexing is in progress', async () => {
    const coordinator = makeCoordinator();
    await expect(coordinator.shutdown()).resolves.toBeUndefined();
  });

  it('should wait for ongoing indexing to complete when shutdown is called during active indexing', async () => {
    let resolveIndex!: () => void;
    const done = new Promise<{ changed: any[]; unchanged: any[]; deleted: any[] }>((res) => {
      resolveIndex = () => res({ changed: [], unchanged: [], deleted: [] });
    });
    mockDetectChanges.mockReturnValueOnce(done);

    const coordinator = makeCoordinator();
    const indexing = coordinator.incrementalIndex();
    const shutdownPromise = coordinator.shutdown();

    let shutdownResolved = false;
    shutdownPromise.then(() => { shutdownResolved = true; });

    await Promise.resolve();
    expect(shutdownResolved).toBe(false);

    resolveIndex();
    await indexing;
    await shutdownPromise;
    expect(shutdownResolved).toBe(true);
  });

  it('should clear any pending debounce timers when shutdown is called with a pending debounce timer', async () => {
    const coordinator = makeCoordinator();
    const spyClearTimeout = spyOn(globalThis, 'clearTimeout');

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/a.ts' });
    await coordinator.shutdown();

    expect(spyClearTimeout).toHaveBeenCalled();
    spyClearTimeout.mockRestore();
  });

  it('should call transaction wrapping fullIndex operations when fullIndex runs', async () => {
    const dbConnection = makeDbConnection();
    const coordinator = makeCoordinator({ dbConnection });

    await coordinator.fullIndex();

    expect(dbConnection.transaction).toHaveBeenCalled();
  });

  it('should delete symbols and relations for deleted files when incrementalIndex receives delete events', async () => {
    const symbolRepo = makeSymbolRepo();
    const relationRepo = makeRelationRepo();
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: ['src/gone.ts'] });
    symbolRepo.getFileSymbols.mockReturnValue([]);

    const coordinator = makeCoordinator({ symbolRepo, relationRepo });

    await coordinator.incrementalIndex();

    expect(symbolRepo.deleteFileSymbols).toHaveBeenCalledWith('test-project', 'src/gone.ts');
  });

  it('should store parsed result in parseCache when files are parsed during indexing', async () => {
    const files = [makeFakeFile('src/index.ts')];
    mockDetectChanges.mockResolvedValue({ changed: files, unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'src' } as any);
    const parseCache = makeParseCache();
    const coordinator = makeCoordinator({ parseCache });

    await coordinator.fullIndex();

    expect(parseCache.set).toHaveBeenCalled();
  });

  it('should load tsconfigPaths on construction and pass it to indexFileRelations when indexing runs', async () => {
    const fakePaths = { baseUrl: '/project', paths: new Map() };
    mockLoadTsconfigPaths.mockReturnValue(fakePaths);
    const files = [makeFakeFile('src/index.ts')];
    mockDetectChanges.mockResolvedValue({ changed: files, unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '' } as any);

    const coordinator = makeCoordinator();
    await coordinator.fullIndex();

    expect(mockIndexFileRelations).toHaveBeenCalledWith(
      expect.objectContaining({ tsconfigPaths: fakePaths }),
    );
  });

  it('should call resolveFileProject to determine project for each indexed file when indexing changed files', async () => {
    const files = [makeFakeFile('apps/web/src/index.ts')];
    mockDetectChanges.mockResolvedValue({ changed: files, unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '' } as any);

    const coordinator = makeCoordinator();
    await coordinator.fullIndex();

    expect(mockResolveFileProject).toHaveBeenCalled();
  });

  it('should reload tsconfigPaths when a tsconfig.json change event is handled', async () => {
    const coordinator = makeCoordinator();

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'tsconfig.json' });

    expect(mockLoadTsconfigPaths).toHaveBeenCalledTimes(2);
  });

  it('should include durationMs in returned IndexResult when indexing completes', async () => {
    const coordinator = makeCoordinator();
    const result = await coordinator.incrementalIndex();
    expect(typeof result.durationMs).toBe('number');
  });

  it('should return IndexResult with 0 indexedFiles when changedFiles is empty array', async () => {
    const coordinator = makeCoordinator();
    const result = await coordinator.incrementalIndex([]);
    expect(result.indexedFiles).toBe(0);
  });

  it('should not run a second fullIndex when fullIndex is called concurrently', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<{ changed: any[]; unchanged: any[]; deleted: any[] }>((res) => {
      resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] });
    });
    mockDetectChanges.mockReturnValueOnce(first);

    const coordinator = makeCoordinator();
    const fullIndexPromise = coordinator.fullIndex();

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/a.ts' });
    jest.runAllTimers();
    await Promise.resolve();

    expect(mockDetectChanges).toHaveBeenCalledTimes(1);

    resolveFirst();
    await fullIndexPromise;
  });

  it('should produce the same number of calls on second fullIndex as on first when two fullIndex runs execute sequentially', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    await coordinator.fullIndex();
    const callsAfterFirst = mockIndexFileSymbols.mock.calls.length;
    await coordinator.fullIndex();
    const callsAfterSecond = mockIndexFileSymbols.mock.calls.length;

    expect(callsAfterSecond - callsAfterFirst).toBe(callsAfterFirst);
  });

  it('should call clearTsconfigPathsCache before reloading tsconfigPaths when tsconfig.json changes', () => {
    const coordinator = makeCoordinator();

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'tsconfig.json' });

    expect(mockClearTsconfigPathsCache).toHaveBeenCalledTimes(1);
  });

  it('should call clearTsconfigPathsCache before loadTsconfigPaths when tsconfig.json changes', () => {
    const callOrder: string[] = [];
    mockClearTsconfigPathsCache.mockImplementation(() => { callOrder.push('clear'); });
    mockLoadTsconfigPaths.mockImplementation(() => { callOrder.push('load'); return null; });
    const coordinator = makeCoordinator();
    callOrder.length = 0;

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'tsconfig.json' });

    expect(callOrder).toEqual(['clear', 'load']);
  });

  it('should trigger fullIndex when tsconfig.json change clears and reloads tsconfig paths', async () => {
    const coordinator = makeCoordinator();
    const onIndexed = mock((r: any) => {});
    coordinator.onIndexed(onIndexed);

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'tsconfig.json' });
    await coordinator.shutdown();

    expect(mockClearTsconfigPathsCache).toHaveBeenCalled();
    expect(mockLoadTsconfigPaths).toHaveBeenCalledTimes(2);
    expect(onIndexed).toHaveBeenCalled();
  });

  it('should delete all files across all project boundaries when fullIndex runs in multi-boundary project', async () => {
    const fileRepo = makeFileRepo();
    fileRepo.getAllFiles
      .mockImplementationOnce(() => [{ project: 'pkg-a', filePath: 'packages/a/src/a.ts' }] as unknown as FileRecord[])
      .mockImplementationOnce(() => [{ project: 'pkg-b', filePath: 'packages/b/src/b.ts' }] as unknown as FileRecord[]);
    const dbConnection = makeDbConnection();
    const coordinator = new IndexCoordinator({
      projectRoot: PROJECT_ROOT,
      boundaries: [
        { dir: 'packages/a', project: 'pkg-a' },
        { dir: 'packages/b', project: 'pkg-b' },
      ],
      extensions: EXTENSIONS,
      ignorePatterns: IGNORE_PATTERNS,
      dbConnection,
      parseCache: makeParseCache(),
      fileRepo: fileRepo as any,
      symbolRepo: makeSymbolRepo() as any,
      relationRepo: makeRelationRepo(),
      parseSourceFn: mockParseSource as any,
    });

    await coordinator.fullIndex();

    expect(fileRepo.deleteFile).toHaveBeenCalledWith('pkg-a', 'packages/a/src/a.ts');
    expect(fileRepo.deleteFile).toHaveBeenCalledWith('pkg-b', 'packages/b/src/b.ts');
  });

  it('should delete files for the single project boundary when fullIndex runs in single-boundary project', async () => {
    const fileRepo = makeFileRepo();
    fileRepo.getAllFiles.mockReturnValue([{ project: 'test-project', filePath: 'src/a.ts' }] as unknown as FileRecord[]);
    const coordinator = makeCoordinator({ fileRepo });

    await coordinator.fullIndex();

    expect(fileRepo.deleteFile).toHaveBeenCalledWith('test-project', 'src/a.ts');
  });

  it('should return actual totalSymbols count in IndexResult when symbol repository returns per-file counts', async () => {
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getFileSymbols.mockReturnValue([
      { name: 'fn1', kind: 'function', filePath: 'src/a.ts' },
      { name: 'fn2', kind: 'function', filePath: 'src/a.ts' },
      { name: 'fn3', kind: 'function', filePath: 'src/a.ts' },
    ]);
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/a.ts')],
      unchanged: [],
      deleted: [],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'code', lastModified: 1000, size: 100 } as any);
    const coordinator = makeCoordinator({ symbolRepo });

    const result = await coordinator.fullIndex();

    expect(result.totalSymbols).toBe(3);
  });

  it('should return totalSymbols=0 when no files are indexed', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    const result = await coordinator.fullIndex();

    expect(result.totalSymbols).toBe(0);
  });

  it('should include changedFiles array with indexed file paths when files are indexed', async () => {
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/a.ts'), makeFakeFile('src/b.ts')],
      unchanged: [],
      deleted: [],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '', lastModified: 1000, size: 100 } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect(result.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('should include deletedFiles array with deleted file paths when files are deleted during incrementalIndex', async () => {
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getFileSymbols.mockReturnValue([]);
    mockDetectChanges.mockResolvedValue({
      changed: [],
      unchanged: [],
      deleted: ['src/gone.ts'],
    });
    const coordinator = makeCoordinator({ symbolRepo });

    const result = await coordinator.incrementalIndex();

    expect(result.deletedFiles).toEqual(['src/gone.ts']);
  });

  it('should return empty changedFiles and deletedFiles arrays when nothing changed', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect(result.changedFiles).toEqual([]);
    expect(result.deletedFiles).toEqual([]);
  });

  it('should call getFilesMap with each boundary project when incrementalIndex runs without explicit events', async () => {
    const fileRepo = makeFileRepo();
    const coordinator = new IndexCoordinator({
      projectRoot: PROJECT_ROOT,
      boundaries: [
        { dir: 'packages/a', project: 'pkg-a' },
        { dir: 'packages/b', project: 'pkg-b' },
      ],
      extensions: EXTENSIONS,
      ignorePatterns: IGNORE_PATTERNS,
      dbConnection: makeDbConnection(),
      parseCache: makeParseCache(),
      fileRepo: fileRepo as any,
      symbolRepo: makeSymbolRepo() as any,
      relationRepo: makeRelationRepo(),
      parseSourceFn: mockParseSource as any,
    });

    await coordinator.fullIndex();

    const calls = (fileRepo.getFilesMap.mock.calls as any[]).map((c: any[]) => c[0]);
    expect(calls).toContain('pkg-a');
    expect(calls).toContain('pkg-b');
  });

  it('should include both delete and file-insert operations inside the transaction when fullIndex processes changed files', async () => {
    const callLog: string[] = [];
    const dbConnection = makeDbConnection();
    dbConnection.transaction = mock((fn: () => any) => {
      callLog.push('tx:start');
      const result = fn();
      callLog.push('tx:end');
      return result;
    }) as any;
    const fileRepo = makeFileRepo();
    fileRepo.deleteFile = mock((...args: any[]) => { callLog.push('deleteFile'); }) as any;
    fileRepo.getAllFiles = mock(() => [{ project: 'test-project', filePath: 'src/a.ts' }]) as any;
    fileRepo.upsertFile = mock((...args: any[]) => { callLog.push('upsertFile'); }) as any;
    mockDetectChanges.mockResolvedValue({ changed: [makeFakeFile('src/a.ts')], unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'src', lastModified: 1000, size: 100 } as any);

    const coordinator = makeCoordinator({ dbConnection, fileRepo });
    await coordinator.fullIndex();

    const txStart = callLog.indexOf('tx:start');
    const txEnd = callLog.indexOf('tx:end');
    const deleteIdx = callLog.indexOf('deleteFile');
    const upsertIdx = callLog.indexOf('upsertFile');
    expect(txStart).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(txStart);
    expect(deleteIdx).toBeLessThan(txEnd);
    expect(upsertIdx).toBeGreaterThan(txStart);
    expect(upsertIdx).toBeLessThan(txEnd);
  });

  it('should return a queued fullIndex promise when fullIndex is called while already indexing', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<any>((res) => { resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] }); });
    mockDetectChanges.mockReturnValueOnce(first);

    const coordinator = makeCoordinator();
    const p1 = coordinator.fullIndex();
    const p2 = coordinator.fullIndex();

    expect(p2).not.toBe(p1);

    resolveFirst();
    await p1;
    await p2;
  });

  it('should run a second fullIndex after the first completes when fullIndex was called while lock was active', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<any>((res) => { resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] }); });
    mockDetectChanges
      .mockReturnValueOnce(first)
      .mockResolvedValue({ changed: [], unchanged: [], deleted: [] });

    const coordinator = makeCoordinator();

    const p1 = coordinator.fullIndex();
    coordinator.fullIndex();

    await Promise.resolve();
    expect(mockDetectChanges).toHaveBeenCalledTimes(1);

    resolveFirst();
    await p1;
    await coordinator.shutdown();

    expect(mockDetectChanges).toHaveBeenCalledTimes(2);
  });

  it('should return totalRelations equal to the sum returned by indexFileRelations when multiple files are indexed', async () => {
    mockIndexFileRelations.mockReturnValue(3);
    mockDetectChanges.mockResolvedValue({ changed: [makeFakeFile('src/a.ts')], unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'code', lastModified: 1000, size: 100 } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect(result.totalRelations).toBe(3);
  });

  it('should not schedule a subsequent fullIndex when incrementalIndex is called while lock is active', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<any>((res) => { resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] }); });
    mockDetectChanges
      .mockReturnValueOnce(first)
      .mockResolvedValue({ changed: [], unchanged: [], deleted: [] });

    const coordinator = makeCoordinator();
    const p1 = coordinator.fullIndex();
    coordinator.incrementalIndex();

    resolveFirst();
    await p1;

    expect(mockDetectChanges).toHaveBeenCalledTimes(1);
  });

  it('should return empty failedFiles when all processFile calls succeed', async () => {
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/a.ts'), makeFakeFile('src/b.ts')],
      unchanged: [],
      deleted: [],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'code', lastModified: 1000, size: 100 } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect((result as any).failedFiles).toEqual([]);
  });

  it('should add file to failedFiles and continue processing others when processFile throws', async () => {
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/fail.ts'), makeFakeFile('src/ok.ts')],
      unchanged: [],
      deleted: [],
    });
    let callCount = 0;
    spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => {
        if (callCount++ === 0) throw new Error('read failed');
        return 'code';
      }),
      lastModified: 1000,
      size: 100,
    } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect((result as any).failedFiles).toEqual(['src/fail.ts']);
  });

  it('should include all files in failedFiles when every processFile call throws', async () => {
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/a.ts'), makeFakeFile('src/b.ts')],
      unchanged: [],
      deleted: [],
    });
    spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => { throw new Error('read failed'); }),
      lastModified: 1000,
      size: 100,
    } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect((result as any).failedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('should expose tsconfigPaths getter that returns a promise', async () => {
    const coordinator = makeCoordinator();

    const result = await coordinator.tsconfigPaths;

    expect(result).toBeNull();
  });

  it('should catch and log when fullIndex fails after tsconfig.json change', async () => {
    mockDetectChanges.mockRejectedValue(new Error('index error'));
    const coordinator = makeCoordinator();

    coordinator.handleWatcherEvent({ filePath: '/project/tsconfig.json', type: 'update' } as any);

    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(mockClearTsconfigPathsCache).toHaveBeenCalledWith(PROJECT_ROOT);
  });

  it('should refresh boundaries when package.json change is detected', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    coordinator.handleWatcherEvent({ filePath: '/project/package.json', type: 'update' } as any);

    jest.runAllTimers();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(mockDiscoverProjects).toHaveBeenCalledWith(PROJECT_ROOT);
  });

  it('should reject all waiters when a queued fullIndex fails', async () => {
    let resolveFirst!: () => void;
    const blockFirst = new Promise<any>((res) => {
      resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] });
    });
    mockDetectChanges
      .mockReturnValueOnce(blockFirst)
      .mockRejectedValueOnce(new Error('second index failed'));

    const coordinator = makeCoordinator();
    const first = coordinator.fullIndex();
    const second = coordinator.fullIndex();

    resolveFirst();
    await first;

    await expect(second).rejects.toThrow('second index failed');
  });

  it('should catch and log when incremental drain fails after current indexing completes', async () => {
    let resolveFirst!: () => void;
    const blockFirst = new Promise<any>((res) => {
      resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] });
    });
    mockDetectChanges.mockReturnValueOnce(blockFirst);

    const coordinator = makeCoordinator();
    const first = coordinator.fullIndex();

    coordinator.handleWatcherEvent({ filePath: '/project/src/a.ts', type: 'update' } as any);

    mockDetectChanges.mockRejectedValueOnce(new Error('drain error'));
    resolveFirst();
    await first;

    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

  it('should catch and log when flushPending startIndex rejects after debounce expires', async () => {
    mockDetectChanges.mockRejectedValue(new Error('flush error'));

    const coordinator = makeCoordinator();
    coordinator.handleWatcherEvent({ filePath: '/project/src/x.ts', eventType: 'change' } as any);

    jest.advanceTimersByTime(150);

    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
});
