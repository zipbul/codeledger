import { isErr } from '@zipbul/result';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { DbConnection } from '../store/connection';
import { FileRepository } from '../store/repositories/file.repository';
import { SymbolRepository } from '../store/repositories/symbol.repository';
import { RelationRepository } from '../store/repositories/relation.repository';
import { ProjectWatcher } from '../watcher/project-watcher';
import { IndexCoordinator } from '../indexer/index-coordinator';
import type { IndexResult } from '../indexer/index-coordinator';
import type { FileChangeEvent } from '../watcher/types';
import { acquireWatcherRole, releaseWatcherRole, updateHeartbeat } from '../watcher/ownership';
import type { WatcherOwnerStore } from '../watcher/ownership';
import { discoverProjects } from '../common/project-discovery';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import { loadTsconfigPaths, clearTsconfigPathsCache } from '../common/tsconfig-resolver';
import { ParseCache } from '../parser/parse-cache';
import { parseSource as defaultParseSource } from '../parser/parse-source';
import { extractSymbols as defaultExtractSymbols } from '../extractor/symbol-extractor';
import { extractRelations as defaultExtractRelations } from '../extractor/relation-extractor';
import { symbolSearch as defaultSymbolSearch } from '../search/symbol-search';
import { relationSearch as defaultRelationSearch } from '../search/relation-search';
import { patternSearch as defaultPatternSearch } from '../search/pattern-search';
import type { PatternMatch } from '../search/pattern-search';
import { SemanticLayer } from '../semantic/index';
import { GildashError, gildashError } from '../errors';
import { DATA_DIR, DB_FILE } from '../constants';
import { invalidateGraphCache } from './graph-api';
import type { IDependencyGraphRepo } from '../search/dependency-graph';
import type { GildashContext, CoordinatorLike, WatcherLike, DbStore } from './context';
import type { GildashOptions, Logger } from './types';

// ─── Constants ──────────────────────────────────────────────────────

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEALTHCHECK_INTERVAL_MS = 15_000;
export const MAX_HEALTHCHECK_RETRIES = 10;

// ─── Internal Options ───────────────────────────────────────────────

export interface GildashInternalOptions {
  existsSyncFn?: (p: string) => boolean;
  dbConnectionFactory?: () => DbStore;
  watcherFactory?: () => WatcherLike;
  coordinatorFactory?: () => CoordinatorLike;
  repositoryFactory?: () => {
    fileRepo: Pick<FileRepository, 'upsertFile' | 'getAllFiles' | 'getFilesMap' | 'deleteFile' | 'getFile'>;
    symbolRepo: SymbolRepository;
    relationRepo: RelationRepository;
    parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
  };
  acquireWatcherRoleFn?: typeof acquireWatcherRole;
  releaseWatcherRoleFn?: typeof releaseWatcherRole;
  updateHeartbeatFn?: typeof updateHeartbeat;
  discoverProjectsFn?: typeof discoverProjects;
  parseSourceFn?: typeof defaultParseSource;
  extractSymbolsFn?: typeof defaultExtractSymbols;
  extractRelationsFn?: typeof defaultExtractRelations;
  symbolSearchFn?: typeof defaultSymbolSearch;
  relationSearchFn?: typeof defaultRelationSearch;
  patternSearchFn?: (opts: { pattern: string; filePaths: string[] }) => Promise<PatternMatch[]>;
  loadTsconfigPathsFn?: typeof loadTsconfigPaths;
  readFileFn?: (filePath: string) => Promise<string>;
  unlinkFn?: (filePath: string) => Promise<void>;
  semanticLayerFactory?: (tsconfigPath: string) => SemanticLayer;
}

// ─── Helpers ────────────────────────────────────────────────────────

function createWatcherCallback(
  ctx: GildashContext,
  coordinator: CoordinatorLike,
): (event: FileChangeEvent) => void {
  return (event: FileChangeEvent) => {
    // Fire onFileChanged callbacks
    for (const cb of ctx.onFileChangedCallbacks) {
      try { cb(event); } catch (e) {
        ctx.logger.error('[Gildash] onFileChanged callback threw:', e);
      }
    }

    coordinator.handleWatcherEvent?.(event);
    if (ctx.semanticLayer) {
      if (event.eventType === 'delete') {
        ctx.semanticLayer.notifyFileDeleted(event.filePath);
      } else {
        ctx.readFileFn(event.filePath).then(content => {
          ctx.semanticLayer?.notifyFileChanged(event.filePath, content);
        }).catch((readErr) => {
          ctx.logger.error('[Gildash] failed to read file for semantic layer', event.filePath, readErr);
          ctx.semanticLayer?.notifyFileDeleted(event.filePath);
        });
      }
    }
  };
}

async function feedSemanticLayer(ctx: GildashContext): Promise<void> {
  if (!ctx.semanticLayer) return;
  const files = ctx.fileRepo.getAllFiles(ctx.defaultProject);
  await Promise.all(
    files.map(async (f) => {
      try {
        const absPath = path.resolve(ctx.projectRoot, f.filePath);
        const content = await ctx.readFileFn(absPath);
        ctx.semanticLayer?.notifyFileChanged(absPath, content);
      } catch { /* best-effort */ }
    }),
  );
}

/** Create coordinator + watcher, start watcher, heartbeat timer, run fullIndex. */
export async function setupOwnerInfrastructure(
  ctx: GildashContext,
  opts: { isWatchMode: boolean },
): Promise<void> {
  const c: CoordinatorLike = ctx.coordinatorFactory
    ? ctx.coordinatorFactory()
    : new IndexCoordinator({
        projectRoot: ctx.projectRoot,
        boundaries: ctx.boundaries,
        extensions: ctx.extensions,
        ignorePatterns: ctx.ignorePatterns,
        dbConnection: ctx.db,
        parseCache: ctx.parseCache,
        fileRepo: ctx.fileRepo,
        symbolRepo: ctx.symbolRepo,
        relationRepo: ctx.relationRepo,
        logger: ctx.logger,
      });

  ctx.coordinator = c;

  // (Re-)register any existing callbacks (important for promotion).
  for (const cb of ctx.onIndexedCallbacks) {
    c.onIndexed(cb);
  }
  c.onIndexed((result) => {
    const total = result.changedFiles.length + result.deletedFiles.length;
    if (ctx.graphCache && total > 0 && total < 100) {
      const repo = ctx.relationRepo as unknown as IDependencyGraphRepo;
      ctx.graphCache.patchFiles(result.changedFiles, result.deletedFiles, (filePath) => {
        const projects = [ctx.defaultProject, ...ctx.boundaries.map(b => b.project)];
        return projects.flatMap(p =>
          repo.getByType(p, 'imports')
            .concat(repo.getByType(p, 'type-references'))
            .concat(repo.getByType(p, 're-exports')),
        )
          .filter(r => r.srcFilePath === filePath || r.dstFilePath === filePath)
          .map(r => ({ srcFilePath: r.srcFilePath, dstFilePath: r.dstFilePath }));
      });
      ctx.graphCacheBuiltAt = Date.now();
    } else {
      invalidateGraphCache(ctx);
    }
  });

  if (opts.isWatchMode) {
    const w: WatcherLike = ctx.watcherFactory
      ? ctx.watcherFactory()
      : new ProjectWatcher(
          { projectRoot: ctx.projectRoot, ignorePatterns: ctx.ignorePatterns, extensions: ctx.extensions },
          undefined,
          ctx.logger,
        );

    await w.start(createWatcherCallback(ctx, c)).then((startResult) => {
      if (isErr(startResult)) throw startResult.data;
    });

    ctx.watcher = w;

    ctx.timer = setInterval(() => {
      ctx.updateHeartbeatFn(ctx.db, process.pid);
    }, HEARTBEAT_INTERVAL_MS);
  }

  await c.fullIndex();
  await feedSemanticLayer(ctx);
}

/** Register SIGTERM / SIGINT / beforeExit handlers. */
export function registerSignalHandlers(
  ctx: GildashContext,
  closeFn: () => Promise<void>,
): void {
  const signals: Array<NodeJS.Signals | 'beforeExit'> = ['SIGTERM', 'SIGINT', 'beforeExit'];
  for (const sig of signals) {
    const handler = () => {
      closeFn().catch(closeErr =>
        ctx.logger.error('[Gildash] close error during signal', sig, closeErr),
      );
    };
    if (sig === 'beforeExit') {
      process.on('beforeExit', handler);
    } else {
      process.on(sig, handler);
    }
    ctx.signalHandlers.push([sig, handler]);
  }
}

// ─── Main lifecycle functions ───────────────────────────────────────

/** Initialize a GildashContext (replaces the old `Gildash.open()` body). */
export async function initializeContext(
  options: GildashOptions & GildashInternalOptions,
): Promise<GildashContext> {
  const {
    projectRoot,
    extensions = ['.ts', '.mts', '.cts'],
    ignorePatterns = ['**/node_modules/**'],
    parseCacheCapacity = 500,
    logger = console,
    existsSyncFn = existsSync,
    dbConnectionFactory,
    watcherFactory,
    coordinatorFactory,
    repositoryFactory,
    acquireWatcherRoleFn: acquireWatcherRoleFnOpt = acquireWatcherRole,
    releaseWatcherRoleFn: releaseWatcherRoleFnOpt = releaseWatcherRole,
    updateHeartbeatFn: updateHeartbeatFnOpt = updateHeartbeat,
    discoverProjectsFn = discoverProjects,
    parseSourceFn = defaultParseSource,
    extractSymbolsFn = defaultExtractSymbols,
    extractRelationsFn = defaultExtractRelations,
    symbolSearchFn = defaultSymbolSearch,
    relationSearchFn = defaultRelationSearch,
    patternSearchFn = defaultPatternSearch,
    loadTsconfigPathsFn = loadTsconfigPaths,
    readFileFn = async (fp: string) => Bun.file(fp).text(),
    unlinkFn = async (fp: string) => { await Bun.file(fp).unlink(); },
    watchMode,
    semantic,
    semanticLayerFactory,
  } = options;

  if (!path.isAbsolute(projectRoot)) {
    throw new GildashError('validation', `Gildash: projectRoot must be an absolute path, got: "${projectRoot}"`);
  }
  if (!existsSyncFn(projectRoot)) {
    throw new GildashError('validation', `Gildash: projectRoot does not exist: "${projectRoot}"`);
  }

  const db = dbConnectionFactory
    ? dbConnectionFactory()
    : new DbConnection({ projectRoot });
  const openResult = db.open();
  if (isErr(openResult)) throw openResult.data;
  try {

  const boundaries = await discoverProjectsFn(projectRoot);
  const defaultProject = boundaries[0]?.project ?? path.basename(projectRoot);

  const repos = repositoryFactory
    ? repositoryFactory()
    : (() => {
        const connection = db as DbConnection;
        return {
          fileRepo: new FileRepository(connection),
          symbolRepo: new SymbolRepository(connection),
          relationRepo: new RelationRepository(connection),
          parseCache: new ParseCache(parseCacheCapacity),
        };
      })();

  const isWatchMode = watchMode ?? true;
  const instanceId = crypto.randomUUID();
  let role: 'owner' | 'reader';
  if (isWatchMode) {
    role = await Promise.resolve(
      acquireWatcherRoleFnOpt(db, process.pid, { instanceId }),
    );
  } else {
    role = 'owner';
  }

  const ctx: GildashContext = {
    projectRoot,
    extensions,
    ignorePatterns,
    logger,
    defaultProject,
    role,

    db,
    symbolRepo: repos.symbolRepo,
    relationRepo: repos.relationRepo,
    fileRepo: repos.fileRepo,
    parseCache: repos.parseCache,

    releaseWatcherRoleFn: releaseWatcherRoleFnOpt,
    parseSourceFn,
    extractSymbolsFn,
    extractRelationsFn,
    symbolSearchFn,
    relationSearchFn,
    patternSearchFn,
    readFileFn,
    unlinkFn,
    existsSyncFn,

    acquireWatcherRoleFn: acquireWatcherRoleFnOpt,
    updateHeartbeatFn: updateHeartbeatFnOpt,
    watcherFactory,
    coordinatorFactory,
    instanceId,

    closed: false,
    coordinator: null,
    watcher: null,
    timer: null,
    signalHandlers: [],
    tsconfigPaths: null,
    boundaries,
    onIndexedCallbacks: new Set(),
    onFileChangedCallbacks: new Set(),
    onErrorCallbacks: new Set(),
    onRoleChangedCallbacks: new Set(),
    graphCache: null,
    graphCacheKey: null,
    graphCacheBuiltAt: null,
    semanticLayer: null,
  };

  clearTsconfigPathsCache(projectRoot);
  ctx.tsconfigPaths = await loadTsconfigPathsFn(projectRoot);

  if (semantic) {
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    try {
      if (semanticLayerFactory) {
        ctx.semanticLayer = semanticLayerFactory(tsconfigPath);
      } else {
        const semanticResult = SemanticLayer.create(tsconfigPath);
        if (isErr(semanticResult)) {
          throw semanticResult.data;
        }
        ctx.semanticLayer = semanticResult;
      }
    } catch (e) {
      if (e instanceof GildashError) throw e;
      throw new GildashError('semantic', 'Gildash: semantic layer creation failed', { cause: e });
    }
  }

  if (role === 'owner') {
    await setupOwnerInfrastructure(ctx, { isWatchMode });
  } else {
    // Reader path — healthcheck loop with promotion
    let retryCount = 0;
    const healthcheck = async () => {
      try {
        const newRole = await Promise.resolve(
          ctx.acquireWatcherRoleFn(ctx.db, process.pid, { instanceId: ctx.instanceId }),
        );
        retryCount = 0;
        if (newRole === 'owner') {
          // Fire onRoleChanged callbacks
          for (const cb of ctx.onRoleChangedCallbacks) {
            try { cb('owner'); } catch (e) {
              ctx.logger.error('[Gildash] onRoleChanged callback threw:', e);
            }
          }
          clearInterval(ctx.timer!);
          ctx.timer = null;
          try {
            await setupOwnerInfrastructure(ctx, { isWatchMode: true });
          } catch (setupErr) {
            ctx.logger.error('[Gildash] owner promotion failed, reverting to reader', setupErr);
            if (ctx.watcher) {
              const closeResult = await ctx.watcher.close();
              if (isErr(closeResult)) ctx.logger.error('[Gildash] watcher close error during promotion rollback', closeResult.data);
              ctx.watcher = null;
            }
            if (ctx.coordinator) {
              await ctx.coordinator.shutdown().catch((e) =>
                ctx.logger.error('[Gildash] coordinator shutdown error during promotion rollback', e),
              );
              ctx.coordinator = null;
            }
            if (ctx.timer === null) {
              ctx.timer = setInterval(healthcheck, HEALTHCHECK_INTERVAL_MS);
            }
          }
        }
      } catch (healthErr) {
        retryCount++;
        // Fire onError callbacks
        const gErr = healthErr instanceof GildashError
          ? healthErr
          : new GildashError('watcher', 'Gildash: healthcheck error', { cause: healthErr });
        for (const cb of ctx.onErrorCallbacks) {
          try { cb(gErr); } catch (e) {
            ctx.logger.error('[Gildash] onError callback threw:', e);
          }
        }
        ctx.logger.error('[Gildash] healthcheck error', healthErr);
        if (retryCount >= MAX_HEALTHCHECK_RETRIES) {
          ctx.logger.error('[Gildash] healthcheck failed too many times, shutting down');
          clearInterval(ctx.timer!);
          ctx.timer = null;
          closeContext(ctx).catch((closeErr) =>
            ctx.logger.error('[Gildash] close error during healthcheck shutdown', closeErr),
          );
        }
      }
    };
    ctx.timer = setInterval(healthcheck, HEALTHCHECK_INTERVAL_MS);
  }

  if (isWatchMode) {
    registerSignalHandlers(ctx, () => closeContext(ctx));
  }

  return ctx;
  } catch (error) {
    db.close();
    if (error instanceof GildashError) throw error;
    throw new GildashError('store', 'Gildash: initialization failed', { cause: error });
  }
}

/** Shut down the context and release all resources. */
export async function closeContext(
  ctx: GildashContext,
  opts?: { cleanup?: boolean },
): Promise<void> {
  if (ctx.closed) return;
  ctx.closed = true;

  const closeErrors: unknown[] = [];

  for (const [sig, handler] of ctx.signalHandlers) {
    if (sig === 'beforeExit') {
      process.off('beforeExit', handler);
    } else {
      process.off(sig as NodeJS.Signals, handler);
    }
  }
  ctx.signalHandlers = [];

  if (ctx.semanticLayer) {
    try {
      ctx.semanticLayer.dispose();
    } catch (e) {
      closeErrors.push(e instanceof Error ? e : new Error(String(e)));
    }
    ctx.semanticLayer = null;
  }

  if (ctx.coordinator) {
    try {
      await ctx.coordinator.shutdown();
    } catch (e) {
      closeErrors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }

  if (ctx.watcher) {
    const closeResult = await ctx.watcher.close();
    if (isErr(closeResult)) closeErrors.push(closeResult.data);
  }

  if (ctx.timer !== null) {
    clearInterval(ctx.timer);
    ctx.timer = null;
  }

  try {
    ctx.releaseWatcherRoleFn(ctx.db, process.pid);
  } catch (e) {
    closeErrors.push(e instanceof Error ? e : new Error(String(e)));
  }

  try {
    ctx.db.close();
  } catch (e) {
    closeErrors.push(e instanceof Error ? e : new Error(String(e)));
  }

  if (opts?.cleanup) {
    for (const ext of ['', '-wal', '-shm']) {
      try {
        await ctx.unlinkFn(path.join(ctx.projectRoot, DATA_DIR, DB_FILE + ext));
      } catch {}
    }
  }

  if (closeErrors.length > 0) {
    throw new GildashError('close', 'Gildash: one or more errors occurred during close()', { cause: closeErrors });
  }
}
