import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { err, isErr } from '@zipbul/result';
import { gildashError } from '../errors';
import type { GildashContext, CoordinatorLike, WatcherLike } from './context';
import { ProjectWatcher } from '../watcher/project-watcher';

// ─── Module Mocks ───────────────────────────────────────────────────

const mockClearTsconfigPathsCache = mock(() => {});
mock.module('../common/tsconfig-resolver', () => ({
  loadTsconfigPaths: mock(async () => null),
  clearTsconfigPathsCache: mockClearTsconfigPathsCache,
}));

const mockCoordinatorFullIndex = mock(async () => ({ indexed: 0 }));
const mockCoordinatorShutdown = mock(async () => {});
const mockCoordinatorOnIndexed = mock((_cb: any) => () => {});
mock.module('../indexer/index-coordinator', () => ({
  IndexCoordinator: class {
    fullIndex = mockCoordinatorFullIndex;
    shutdown = mockCoordinatorShutdown;
    onIndexed = mockCoordinatorOnIndexed;
    handleWatcherEvent = mock(() => {});
    constructor(..._args: any[]) {}
  },
}));

const {
  initializeContext,
  closeContext,
  setupOwnerInfrastructure,
  registerSignalHandlers,
  HEARTBEAT_INTERVAL_MS,
  HEALTHCHECK_INTERVAL_MS,
  MAX_HEALTHCHECK_RETRIES,
} = await import('./lifecycle');

beforeEach(() => {
  mock.module('../common/tsconfig-resolver', () => ({
    loadTsconfigPaths: mock(async () => null),
    clearTsconfigPathsCache: mockClearTsconfigPathsCache,
  }));
  mock.module('../indexer/index-coordinator', () => ({
    IndexCoordinator: class {
      fullIndex = mockCoordinatorFullIndex;
      shutdown = mockCoordinatorShutdown;
      onIndexed = mockCoordinatorOnIndexed;
      handleWatcherEvent = mock(() => {});
      constructor(..._args: any[]) {}
    },
  }));
});

// ─── Helpers ────────────────────────────────────────────────────────

function makeCoordinator(): CoordinatorLike & Record<string, any> {
  return {
    fullIndex: mock(async () => ({ indexed: 5 })) as any,
    shutdown: mock(async () => {}),
    onIndexed: mock((_cb: any) => () => {}),
    handleWatcherEvent: mock(() => {}),
  };
}

function makeWatcher(): WatcherLike {
  return {
    start: mock(async (_cb: any) => undefined as any),
    close: mock(async () => undefined as any),
  };
}

function makeDb() {
  return {
    open: mock(() => undefined as any),
    close: mock(() => {}),
    transaction: mock((fn: any) => fn),
  };
}

function makeRepos() {
  return {
    fileRepo: {
      getAllFiles: mock(() => []),
      getFilesMap: mock(() => new Map()),
      getFile: mock(() => null),
      upsertFile: mock(() => {}),
      deleteFile: mock(() => {}),
    },
    symbolRepo: { getStats: mock(() => ({})), getFileSymbols: mock(() => []) } as any,
    relationRepo: { getOutgoing: mock(() => []) } as any,
    parseCache: { set: mock(() => {}), get: mock(() => undefined), invalidate: mock(() => {}) },
  };
}

function makeInitOptions(overrides?: Record<string, any>): any {
  const coordinator = makeCoordinator();
  const watcher = makeWatcher();
  const db = makeDb();
  const repos = makeRepos();

  return {
    projectRoot: '/test/project',
    existsSyncFn: mock(() => true),
    dbConnectionFactory: mock(() => db),
    repositoryFactory: mock(() => repos),
    acquireWatcherRoleFn: mock(() => 'owner' as const),
    releaseWatcherRoleFn: mock(() => {}),
    updateHeartbeatFn: mock(() => {}),
    discoverProjectsFn: mock(async () => [{ project: 'test-proj', path: '/test/project' }]),
    coordinatorFactory: mock(() => coordinator),
    watcherFactory: mock(() => watcher),
    parseSourceFn: mock(() => ({})),
    extractSymbolsFn: mock(() => []),
    extractRelationsFn: mock(() => []),
    symbolSearchFn: mock(() => []),
    relationSearchFn: mock(() => []),
    patternSearchFn: mock(async () => []),
    loadTsconfigPathsFn: mock(async () => null),
    readFileFn: mock(async () => ''),
    unlinkFn: mock(async () => {}),
    watchMode: true,
    logger: { error: mock(() => {}) },
    ...overrides,
    _coordinator: coordinator,
    _watcher: watcher,
    _db: db,
    _repos: repos,
  };
}

function makeCtx(overrides?: Partial<GildashContext>): GildashContext {
  return {
    projectRoot: '/test/project',
    extensions: ['.ts'],
    ignorePatterns: [],
    logger: { error: mock(() => {}) } as any,
    defaultProject: 'default',
    role: 'owner' as const,
    db: makeDb() as any,
    symbolRepo: {} as any,
    relationRepo: {} as any,
    fileRepo: { getAllFiles: mock(() => []) } as any,
    parseCache: {} as any,
    releaseWatcherRoleFn: mock(() => {}),
    parseSourceFn: mock(() => ({})) as any,
    extractSymbolsFn: mock(() => []) as any,
    extractRelationsFn: mock(() => []) as any,
    symbolSearchFn: mock(() => []) as any,
    relationSearchFn: mock(() => []) as any,
    patternSearchFn: mock(async () => []) as any,
    readFileFn: mock(async () => '') as any,
    unlinkFn: mock(async () => {}) as any,
    existsSyncFn: mock(() => true) as any,
    acquireWatcherRoleFn: mock(() => 'owner') as any,
    updateHeartbeatFn: mock(() => {}) as any,
    closed: false,
    coordinator: null,
    watcher: null,
    timer: null,
    signalHandlers: [],
    tsconfigPaths: null,
    boundaries: [],
    onIndexedCallbacks: new Set(),
    graphCache: null,
    graphCacheKey: null,
    semanticLayer: null,
    ...overrides,
  } as unknown as GildashContext;
}

// ─── Spies ──────────────────────────────────────────────────────────

let processOnSpy: ReturnType<typeof spyOn>;
let processOffSpy: ReturnType<typeof spyOn>;
let capturedIntervalCallbacks: Function[];

beforeEach(() => {
  mockClearTsconfigPathsCache.mockClear();
  mockCoordinatorFullIndex.mockClear();
  mockCoordinatorShutdown.mockClear();
  mockCoordinatorOnIndexed.mockClear();
  capturedIntervalCallbacks = [];
  processOnSpy = spyOn(process, 'on').mockReturnValue(process as any);
  processOffSpy = spyOn(process, 'off').mockReturnValue(process as any);
  spyOn(globalThis, 'setInterval').mockImplementation(((cb: any, _ms: any) => {
    capturedIntervalCallbacks.push(cb);
    return capturedIntervalCallbacks.length;
  }) as any);
  spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
});

afterEach(() => {
  processOnSpy?.mockRestore();
  processOffSpy?.mockRestore();
  (globalThis.setInterval as any)?.mockRestore?.();
  (globalThis.clearInterval as any)?.mockRestore?.();
});

// ═══════════════════════════════════════════════════════════════════
// initializeContext
// ═══════════════════════════════════════════════════════════════════

describe('initializeContext', () => {
  it('should create context with all DI overrides as owner', async () => {
    const opts = makeInitOptions();

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;
    expect(ctx.projectRoot).toBe('/test/project');
    expect(ctx.role).toBe('owner');
    expect(ctx.closed).toBe(false);
    expect(ctx.coordinator).not.toBeNull();
  });

  it('should use default project from first boundary', async () => {
    const opts = makeInitOptions({
      discoverProjectsFn: mock(async () => [{ project: 'my-proj', path: '/test/project' }]),
    });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(false);
    expect((result as GildashContext).defaultProject).toBe('my-proj');
  });

  it('should use basename when boundaries is empty', async () => {
    const opts = makeInitOptions({
      discoverProjectsFn: mock(async () => []),
    });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(false);
    expect((result as GildashContext).defaultProject).toBe('project');
  });

  it('should create semanticLayer when semantic is true', async () => {
    const semanticLayer = { dispose: mock(() => {}), notifyFileChanged: mock(() => {}) };
    const opts = makeInitOptions({
      semantic: true,
      semanticLayerFactory: mock(() => semanticLayer),
    });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(false);
    expect((result as GildashContext).semanticLayer).toBe(semanticLayer as any);
  });

  it('should create reader with healthcheck timer when role is reader', async () => {
    const opts = makeInitOptions({
      acquireWatcherRoleFn: mock(() => 'reader'),
    });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;
    expect(ctx.role).toBe('reader');
    expect(ctx.coordinator).toBeNull();
    expect(ctx.timer).not.toBeNull();
  });

  it('should return err when projectRoot is not absolute', async () => {
    const opts = makeInitOptions({ projectRoot: 'relative/path' });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('validation');
  });

  it('should return err when projectRoot does not exist', async () => {
    const opts = makeInitOptions({ existsSyncFn: mock(() => false) });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('validation');
  });

  it('should return err when db.open fails', async () => {
    const db = makeDb();
    db.open = mock(() => err(gildashError('store', 'db open failed')));
    const opts = makeInitOptions({ dbConnectionFactory: mock(() => db) });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('store');
  });

  it('should return err when semantic layer creation fails and close db', async () => {
    const db = makeDb();
    const opts = makeInitOptions({
      dbConnectionFactory: mock(() => db),
      semantic: true,
      semanticLayerFactory: mock(() => err(gildashError('semantic', 'tsc failed'))),
    });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('semantic');
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('should return err on outer catch and close db', async () => {
    const db = makeDb();
    const opts = makeInitOptions({
      dbConnectionFactory: mock(() => db),
      discoverProjectsFn: mock(async () => { throw new Error('discover crash'); }),
    });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('store');
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('should register signal handlers when watchMode is true', async () => {
    const opts = makeInitOptions({ watchMode: true });

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;
    expect(ctx.signalHandlers.length).toBeGreaterThan(0);
    expect(processOnSpy).toHaveBeenCalled();
  });

  it('should default watchMode to true when undefined', async () => {
    const opts = makeInitOptions();
    delete (opts as any).watchMode;

    const result = await initializeContext(opts);

    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;
    expect(ctx.signalHandlers.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// closeContext
// ═══════════════════════════════════════════════════════════════════

describe('closeContext', () => {
  it('should clean up all resources in order', async () => {
    const coordinator = makeCoordinator();
    const watcher = makeWatcher();
    const db = makeDb();
    const ctx = makeCtx({
      coordinator,
      watcher: watcher as any,
      timer: 99 as any,
      db: db as any,
      signalHandlers: [['SIGTERM', () => {}]],
    });

    const result = await closeContext(ctx);

    expect(ctx.closed).toBe(true);
    expect(coordinator.shutdown).toHaveBeenCalledTimes(1);
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('should return early when already closed', async () => {
    const db = makeDb();
    const ctx = makeCtx({ closed: true, db: db as any });

    const result = await closeContext(ctx);

    expect(result).toBeUndefined();
    expect(db.close).not.toHaveBeenCalled();
  });

  it('should delete db files when cleanup is true', async () => {
    const unlinkFn = mock(async () => {});
    const ctx = makeCtx({ unlinkFn });

    await closeContext(ctx, { cleanup: true });

    expect(unlinkFn).toHaveBeenCalledTimes(3);
  });

  it('should skip dispose when no semanticLayer', async () => {
    const ctx = makeCtx({ semanticLayer: null });

    const result = await closeContext(ctx);

    expect(ctx.closed).toBe(true);
    // no error → successful close
  });

  it('should skip shutdown when no coordinator', async () => {
    const ctx = makeCtx({ coordinator: null });

    const result = await closeContext(ctx);

    expect(ctx.closed).toBe(true);
  });

  it('should skip close when no watcher', async () => {
    const ctx = makeCtx({ watcher: null });

    const result = await closeContext(ctx);

    expect(ctx.closed).toBe(true);
  });

  it('should skip clearInterval when no timer', async () => {
    const ctx = makeCtx({ timer: null });

    await closeContext(ctx);

    expect(globalThis.clearInterval).not.toHaveBeenCalled();
  });

  it('should capture semanticLayer dispose error', async () => {
    const ctx = makeCtx({
      semanticLayer: {
        dispose: mock(() => { throw new Error('dispose fail'); }),
      } as any,
    });

    const result = await closeContext(ctx);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('close');
  });

  it('should capture coordinator shutdown error', async () => {
    const coord = makeCoordinator();
    coord.shutdown = mock(async () => { throw new Error('shutdown fail'); });
    const ctx = makeCtx({ coordinator: coord });

    const result = await closeContext(ctx);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('close');
  });

  it('should capture watcher close error', async () => {
    const watcher = makeWatcher();
    watcher.close = mock(async () => err(gildashError('watcher', 'close error')));
    const ctx = makeCtx({ watcher: watcher as any });

    const result = await closeContext(ctx);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('close');
  });

  it('should capture multiple close errors', async () => {
    const coord = makeCoordinator();
    coord.shutdown = mock(async () => { throw new Error('coord fail'); });
    const ctx = makeCtx({
      coordinator: coord,
      semanticLayer: {
        dispose: mock(() => { throw new Error('semantic fail'); }),
      } as any,
    });

    const result = await closeContext(ctx);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('close');
      expect(Array.isArray(result.data.cause)).toBe(true);
      expect((result.data.cause as unknown[]).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should remove signal handlers via process.off', async () => {
    const handler1 = () => {};
    const handler2 = () => {};
    const ctx = makeCtx({
      signalHandlers: [['SIGTERM', handler1], ['beforeExit', handler2]],
    });

    await closeContext(ctx);

    expect(processOffSpy).toHaveBeenCalledWith('SIGTERM', handler1);
    expect(processOffSpy).toHaveBeenCalledWith('beforeExit', handler2);
    expect(ctx.signalHandlers).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// setupOwnerInfrastructure
// ═══════════════════════════════════════════════════════════════════

describe('setupOwnerInfrastructure', () => {
  it('should create coordinator and run fullIndex', async () => {
    const coordinator = makeCoordinator();
    const ctx = makeCtx({ coordinatorFactory: mock(() => coordinator) as any });

    await setupOwnerInfrastructure(ctx, { isWatchMode: false });

    expect(ctx.coordinator).toBe(coordinator);
    expect(coordinator.fullIndex).toHaveBeenCalledTimes(1);
  });

  it('should create watcher and start when watchMode is true', async () => {
    const coordinator = makeCoordinator();
    const watcher = makeWatcher();
    const ctx = makeCtx({
      coordinatorFactory: mock(() => coordinator) as any,
      watcherFactory: mock(() => watcher) as any,
    });

    await setupOwnerInfrastructure(ctx, { isWatchMode: true });

    expect(ctx.watcher).toBe(watcher);
    expect(watcher.start).toHaveBeenCalledTimes(1);
    expect(ctx.timer).not.toBeNull();
  });

  it('should skip watcher when watchMode is false', async () => {
    const coordinator = makeCoordinator();
    const ctx = makeCtx({ coordinatorFactory: mock(() => coordinator) as any });

    await setupOwnerInfrastructure(ctx, { isWatchMode: false });

    expect(ctx.watcher).toBeNull();
    expect(ctx.timer).toBeNull();
  });

  it('should re-register existing onIndexedCallbacks', async () => {
    const coordinator = makeCoordinator();
    const cb1 = mock(() => {});
    const cb2 = mock(() => {});
    const ctx = makeCtx({
      coordinatorFactory: mock(() => coordinator) as any,
      onIndexedCallbacks: new Set([cb1, cb2]),
    });

    await setupOwnerInfrastructure(ctx, { isWatchMode: false });

    // +2 for existing callbacks, +1 for graphCache invalidation callback
    expect(coordinator.onIndexed).toHaveBeenCalledTimes(3);
    expect(coordinator.onIndexed).toHaveBeenCalledWith(cb1);
    expect(coordinator.onIndexed).toHaveBeenCalledWith(cb2);
  });

  it('should throw when watcher start fails', async () => {
    const coordinator = makeCoordinator();
    const watcher = makeWatcher();
    watcher.start = mock(async () => err(gildashError('watcher', 'start failed')));
    const ctx = makeCtx({
      coordinatorFactory: mock(() => coordinator) as any,
      watcherFactory: mock(() => watcher) as any,
    });

    expect(setupOwnerInfrastructure(ctx, { isWatchMode: true })).rejects.toThrow();
  });

  it('should set timer for heartbeat in watchMode', async () => {
    const coordinator = makeCoordinator();
    const watcher = makeWatcher();
    const ctx = makeCtx({
      coordinatorFactory: mock(() => coordinator) as any,
      watcherFactory: mock(() => watcher) as any,
    });

    await setupOwnerInfrastructure(ctx, { isWatchMode: true });

    expect(globalThis.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      HEARTBEAT_INTERVAL_MS,
    );
  });

  it('should create ProjectWatcher when no watcherFactory is provided', async () => {
    const startSpy = spyOn(ProjectWatcher.prototype, 'start').mockResolvedValue(undefined as any);
    const coordinator = makeCoordinator();
    const ctx = makeCtx({
      coordinatorFactory: mock(() => coordinator) as any,
      watcherFactory: undefined,
    });

    await setupOwnerInfrastructure(ctx, { isWatchMode: true });

    expect(ctx.watcher).not.toBeNull();
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(coordinator.fullIndex).toHaveBeenCalledTimes(1);
    startSpy.mockRestore();
  });

  // PRUNE-HP [HP] createWatcherCallback: delete event → calls semanticLayer.notifyFileDeleted
  it('should call semanticLayer.notifyFileDeleted on delete event', async () => {
    // Arrange
    const coordinator = makeCoordinator();
    const watcher = makeWatcher();
    const notifyFileDeleted = mock(() => {});
    const semanticLayer = {
      notifyFileChanged: mock(() => {}),
      notifyFileDeleted,
      dispose: mock(() => {}),
    };
    const ctx = makeCtx({
      coordinatorFactory: mock(() => coordinator) as any,
      watcherFactory: mock(() => watcher) as any,
      semanticLayer: semanticLayer as any,
    });

    await setupOwnerInfrastructure(ctx, { isWatchMode: true });

    // Act — capture watcher callback and invoke with delete event
    const startCall = (watcher.start as ReturnType<typeof mock>).mock.calls[0];
    const watcherCallback = startCall![0] as (event: any) => void;
    watcherCallback({ filePath: '/project/src/removed.ts', eventType: 'delete' });

    // Assert
    expect(notifyFileDeleted).toHaveBeenCalledWith('/project/src/removed.ts');
  });
});

// ═══════════════════════════════════════════════════════════════════
// registerSignalHandlers
// ═══════════════════════════════════════════════════════════════════

describe('registerSignalHandlers', () => {
  it('should register handlers for SIGTERM SIGINT and beforeExit', () => {
    const ctx = makeCtx();
    const closeFn = mock(async () => undefined as any);

    registerSignalHandlers(ctx, closeFn);

    expect(processOnSpy).toHaveBeenCalledTimes(3);
    expect(ctx.signalHandlers).toHaveLength(3);
  });

  it('should call closeFn when handler fires', () => {
    const ctx = makeCtx();
    const closeFn = mock(async () => undefined as any);

    registerSignalHandlers(ctx, closeFn);

    // Invoke the first registered handler
    const [, handler] = ctx.signalHandlers[0]!;
    handler();

    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('should push handlers to ctx.signalHandlers', () => {
    const ctx = makeCtx();
    const closeFn = mock(async () => undefined as any);

    registerSignalHandlers(ctx, closeFn);

    const signals = ctx.signalHandlers.map(([sig]: any) => sig);
    expect(signals).toContain('SIGTERM');
    expect(signals).toContain('SIGINT');
    expect(signals).toContain('beforeExit');
  });

  it('should use process.on beforeExit for beforeExit signal', () => {
    const ctx = makeCtx();
    const closeFn = mock(async () => undefined as any);

    registerSignalHandlers(ctx, closeFn);

    expect(processOnSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function));
  });

  it('should log error when closeFn rejects', async () => {
    const rejectError = new Error('close reject');
    const closeFn = mock(async () => { throw rejectError; });
    const ctx = makeCtx();

    registerSignalHandlers(ctx, closeFn);

    const [, handler] = ctx.signalHandlers[0]!;
    handler();

    // Wait for the catch to fire
    await new Promise(r => setTimeout(r, 10));

    expect(closeFn).toHaveBeenCalledTimes(1);
    expect((ctx.logger.error as any).mock.calls.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// State Transitions
// ═══════════════════════════════════════════════════════════════════

describe('lifecycle state transitions', () => {
  it('should promote reader to owner via healthcheck', async () => {
    let callCount = 0;
    const opts = makeInitOptions({
      acquireWatcherRoleFn: mock(() => {
        callCount++;
        return callCount === 1 ? 'reader' : 'owner';
      }),
    });

    const result = await initializeContext(opts);
    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;
    expect(ctx.coordinator).toBeNull();

    // Get healthcheck callback (reader timer creates exactly one setInterval)
    const healthcheck = capturedIntervalCallbacks[capturedIntervalCallbacks.length - 1]!;
    await healthcheck();

    expect(ctx.coordinator).not.toBeNull();
  });

  it('should rollback promotion when setupOwnerInfrastructure fails', async () => {
    let callCount = 0;
    const coordinator = makeCoordinator();
    coordinator.fullIndex = mock(async () => { throw new Error('setup fail'); });
    const opts = makeInitOptions({
      acquireWatcherRoleFn: mock(() => {
        callCount++;
        return callCount === 1 ? 'reader' : 'owner';
      }),
      coordinatorFactory: mock(() => coordinator),
    });

    const result = await initializeContext(opts);
    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;

    const healthcheck = capturedIntervalCallbacks[capturedIntervalCallbacks.length - 1]!;
    await healthcheck();

    // Rollback: coordinator should be null
    expect(ctx.coordinator).toBeNull();
  });

  it('should shutdown after max healthcheck retries', async () => {
    const acquireFn = mock(() => { throw new Error('health fail'); });
    let internalCallCount = 0;
    const opts = makeInitOptions({
      acquireWatcherRoleFn: mock(() => {
        internalCallCount++;
        if (internalCallCount === 1) return 'reader';
        throw new Error('health fail');
      }),
    });

    const result = await initializeContext(opts);
    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;

    const healthcheck = capturedIntervalCallbacks[capturedIntervalCallbacks.length - 1]!;

    // Invoke MAX_HEALTHCHECK_RETRIES times
    for (let i = 0; i < MAX_HEALTHCHECK_RETRIES; i++) {
      await healthcheck();
    }

    // After max retries, closeContext should have been called
    expect(ctx.closed).toBe(true);
  });

  it('should return early on double close', async () => {
    const db = makeDb();
    const ctx = makeCtx({ db: db as any });

    await closeContext(ctx);
    expect(ctx.closed).toBe(true);
    expect(db.close).toHaveBeenCalledTimes(1);

    // Second close
    await closeContext(ctx);
    expect(db.close).toHaveBeenCalledTimes(1); // not called again
  });

  it('should invalidate graphCache via onIndexed callback in setupOwnerInfrastructure', async () => {
    const coordinator = makeCoordinator();
    let graphCacheInvalidator: Function | null = null;
    coordinator.onIndexed = mock((cb: any) => {
      graphCacheInvalidator = cb;
      return () => {};
    });
    const ctx = makeCtx({
      coordinatorFactory: mock(() => coordinator) as any,
      graphCache: { fake: true } as any,
      graphCacheKey: 'old-key',
    });

    await setupOwnerInfrastructure(ctx, { isWatchMode: false });

    // The last onIndexed call is the graphCache invalidator
    expect(graphCacheInvalidator).not.toBeNull();
    graphCacheInvalidator!();
    expect(ctx.graphCache).toBeNull();
    expect(ctx.graphCacheKey).toBeNull();
  });

  it('should handle watcher close error during promotion rollback', async () => {
    let callCount = 0;
    const watcher = makeWatcher();
    watcher.close = mock(async () => err(gildashError('watcher', 'close err')));
    const coordinator = makeCoordinator();
    coordinator.fullIndex = mock(async () => { throw new Error('promotion fail'); });
    const opts = makeInitOptions({
      acquireWatcherRoleFn: mock(() => {
        callCount++;
        return callCount === 1 ? 'reader' : 'owner';
      }),
      coordinatorFactory: mock(() => coordinator),
      watcherFactory: mock(() => watcher),
    });

    const result = await initializeContext(opts);
    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;

    const healthcheck = capturedIntervalCallbacks[capturedIntervalCallbacks.length - 1]!;
    await healthcheck();

    // Rollback happened, logger.error should have been called for watcher close
    expect((ctx.logger.error as any).mock.calls.length).toBeGreaterThan(0);
    expect(ctx.watcher).toBeNull();
  });

  it('should log error when closeContext rejects during healthcheck shutdown', async () => {
    let internalCallCount = 0;
    const opts = makeInitOptions({
      acquireWatcherRoleFn: mock(() => {
        internalCallCount++;
        if (internalCallCount === 1) return 'reader';
        throw new Error('health fail');
      }),
    });
    // Force db.close to throw (causing closeContext to return err, but catch handles rejection)
    opts._db.close = mock(() => { throw new Error('db close fail during shutdown'); });

    const result = await initializeContext(opts);
    expect(isErr(result)).toBe(false);
    const ctx = result as GildashContext;

    const healthcheck = capturedIntervalCallbacks[capturedIntervalCallbacks.length - 1]!;

    for (let i = 0; i < MAX_HEALTHCHECK_RETRIES; i++) {
      await healthcheck();
    }

    // closeContext was called and its catch was exercised
    expect(ctx.closed).toBe(true);
  });
});
