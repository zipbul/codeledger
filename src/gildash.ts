import { err, isErr, type Result } from '@zipbul/result';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { ParsedFile } from './parser/types';
import { parseSource as defaultParseSource } from './parser/parse-source';
import { ParseCache } from './parser/parse-cache';
import type { ExtractedSymbol } from './extractor/types';
import { extractSymbols as defaultExtractSymbols } from './extractor/symbol-extractor';
import { extractRelations as defaultExtractRelations } from './extractor/relation-extractor';
import type { CodeRelation } from './extractor/types';
import { DbConnection } from './store/connection';
import { FileRepository } from './store/repositories/file.repository';
import { SymbolRepository } from './store/repositories/symbol.repository';
import { RelationRepository } from './store/repositories/relation.repository';
import { ProjectWatcher } from './watcher/project-watcher';
import { IndexCoordinator } from './indexer/index-coordinator';
import type { IndexResult } from './indexer/index-coordinator';
import type { IndexCoordinatorOptions } from './indexer/index-coordinator';
import type { FileChangeEvent } from './watcher/types';
import { acquireWatcherRole, releaseWatcherRole, updateHeartbeat } from './watcher/ownership';
import type { WatcherOwnerStore } from './watcher/ownership';
import { discoverProjects } from './common/project-discovery';
import type { ProjectBoundary } from './common/project-discovery';
import { loadTsconfigPaths, clearTsconfigPathsCache } from './common/tsconfig-resolver';
import type { TsconfigPaths } from './common/tsconfig-resolver';
import { symbolSearch as defaultSymbolSearch } from './search/symbol-search';
import type { SymbolSearchQuery, SymbolSearchResult } from './search/symbol-search';
import { relationSearch as defaultRelationSearch } from './search/relation-search';
import type { RelationSearchQuery } from './search/relation-search';
import type { SymbolStats } from './store/repositories/symbol.repository';
import { DependencyGraph } from './search/dependency-graph';
import { gildashError, type GildashError } from './errors';

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEALTHCHECK_INTERVAL_MS = 60_000;
const MAX_HEALTHCHECK_RETRIES = 10;

/**
 * Minimal logger interface accepted by {@link Gildash}.
 *
 * Any object with an `error` method (including `console`) satisfies this interface.
 */
export interface Logger {
  /** Log one or more error-level messages. */
  error(...args: unknown[]): void;
}

/**
 * Options for creating a {@link Gildash} instance via {@link Gildash.open}.
 *
 * @example
 * ```ts
 * import { isErr } from '@zipbul/result';
 *
 * const result = await Gildash.open({
 *   projectRoot: '/absolute/path/to/project',
 *   extensions: ['.ts', '.tsx'],
 *   ignorePatterns: ['vendor'],
 * });
 * if (isErr(result)) {
 *   console.error(result.data.message);
 *   process.exit(1);
 * }
 * const ledger = result;
 * ```
 */
export interface GildashOptions {
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** File extensions to index. Defaults to `['.ts', '.mts', '.cts']`. */
  extensions?: string[];
  /** Glob patterns to ignore during indexing. */
  ignorePatterns?: string[];
  /** Maximum number of parsed ASTs to keep in the LRU cache. Defaults to `500`. */
  parseCacheCapacity?: number;
  /** Logger for error output. Defaults to `console`. */
  logger?: Logger;
}

interface GildashInternalOptions {
  existsSyncFn?: (p: string) => boolean;
  dbConnectionFactory?: () => Pick<DbConnection, 'open' | 'close' | 'transaction'> & WatcherOwnerStore;
  watcherFactory?: () => Pick<ProjectWatcher, 'start' | 'close'>;
  coordinatorFactory?: () => Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
    tsconfigPaths?: Promise<TsconfigPaths | null>;
    handleWatcherEvent?(event: FileChangeEvent): void;
  };
  repositoryFactory?: () => {
    fileRepo: Pick<FileRepository, 'upsertFile' | 'getAllFiles' | 'getFilesMap' | 'deleteFile'>;
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
  loadTsconfigPathsFn?: typeof loadTsconfigPaths;
}

/**
 * Main entry point for gildash.
 *
 * `Gildash` indexes TypeScript source code into a local SQLite database,
 * watches for file changes, and provides search / dependency-graph queries.
 *
 * Every public method returns a `Result<T, GildashError>` — either the
 * success value `T` directly, or an `Err<GildashError>` that can be checked
 * with `isErr()` from `@zipbul/result`.
 *
 * Create an instance with the static {@link Gildash.open} factory.
 * Always call {@link Gildash.close} when done to release resources.
 *
 * @example
 * ```ts
 * import { Gildash } from '@zipbul/gildash';
 * import { isErr } from '@zipbul/result';
 *
 * const result = await Gildash.open({ projectRoot: '/my/project' });
 * if (isErr(result)) {
 *   console.error(result.data.message);
 *   process.exit(1);
 * }
 * const ledger = result;
 *
 * const symbols = ledger.searchSymbols({ text: 'handle', kind: 'function' });
 * if (!isErr(symbols)) {
 *   symbols.forEach(s => console.log(s.name));
 * }
 *
 * await ledger.close();
 * ```
 */
export class Gildash {
  /** Absolute path to the indexed project root. */
  readonly projectRoot: string;

  private readonly db: Pick<DbConnection, 'open' | 'close' | 'transaction'> & WatcherOwnerStore;
  private readonly symbolRepo: SymbolRepository;
  private readonly relationRepo: RelationRepository;
  private readonly parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
  private coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
    tsconfigPaths?: Promise<TsconfigPaths | null>;
    handleWatcherEvent?(event: FileChangeEvent): void;
  }) | null;
  private watcher: Pick<ProjectWatcher, 'start' | 'close'> | null;
  private readonly releaseWatcherRoleFn: typeof releaseWatcherRole;
  private readonly parseSourceFn: typeof defaultParseSource;
  private readonly extractSymbolsFn: typeof defaultExtractSymbols;
  private readonly extractRelationsFn: typeof defaultExtractRelations;
  private readonly symbolSearchFn: typeof defaultSymbolSearch;
  private readonly relationSearchFn: typeof defaultRelationSearch;
  private readonly logger: Logger;
  private readonly defaultProject: string;
  /** Current watcher role: `'owner'` (can reindex) or `'reader'` (read-only). */
  readonly role: 'owner' | 'reader';
  private timer: ReturnType<typeof setInterval> | null = null;
  private signalHandlers: Array<[string, () => void]> = [];
  private closed = false;
  private tsconfigPaths: TsconfigPaths | null = null;
  private boundaries: ProjectBoundary[] = [];
  private readonly onIndexedCallbacks = new Set<(result: IndexResult) => void>();

  private constructor(opts: {
    projectRoot: string;
    db: Pick<DbConnection, 'open' | 'close' | 'transaction'> & WatcherOwnerStore;
    symbolRepo: SymbolRepository;
    relationRepo: RelationRepository;
    parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
    coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
      tsconfigPaths?: Promise<TsconfigPaths | null>;
      handleWatcherEvent?(event: FileChangeEvent): void;
    }) | null;
    watcher: Pick<ProjectWatcher, 'start' | 'close'> | null;
    releaseWatcherRoleFn: typeof releaseWatcherRole;
    parseSourceFn: typeof defaultParseSource;
    extractSymbolsFn: typeof defaultExtractSymbols;
    extractRelationsFn: typeof defaultExtractRelations;
    symbolSearchFn: typeof defaultSymbolSearch;
    relationSearchFn: typeof defaultRelationSearch;
    logger: Logger;
    defaultProject: string;
    role: 'owner' | 'reader';
  }) {
    this.projectRoot = opts.projectRoot;
    this.db = opts.db;
    this.symbolRepo = opts.symbolRepo;
    this.relationRepo = opts.relationRepo;
    this.parseCache = opts.parseCache;
    this.coordinator = opts.coordinator;
    this.watcher = opts.watcher;
    this.releaseWatcherRoleFn = opts.releaseWatcherRoleFn;
    this.parseSourceFn = opts.parseSourceFn;
    this.extractSymbolsFn = opts.extractSymbolsFn;
    this.extractRelationsFn = opts.extractRelationsFn;
    this.symbolSearchFn = opts.symbolSearchFn;
    this.relationSearchFn = opts.relationSearchFn;
    this.logger = opts.logger;
    this.defaultProject = opts.defaultProject;
    this.role = opts.role;
  }

  /**
   * Create and initialise a new `Gildash` instance.
   *
   * Opens (or creates) a SQLite database alongside the project root,
   * discovers sub-projects, acquires a watcher role, performs initial indexing,
   * and begins watching for file changes.
   *
   * @param options - Configuration for the instance.
   * @returns A fully-initialised `Gildash` ready for queries, or an `Err<GildashError>` on failure.
   *
   * @example
   * ```ts
   * const result = await Gildash.open({
   *   projectRoot: '/home/user/my-app',
   *   extensions: ['.ts', '.tsx'],
   * });
   * if (isErr(result)) { console.error(result.data.message); process.exit(1); }
   * const ledger = result;
   * ```
   */
  static async open(options: GildashOptions & GildashInternalOptions): Promise<Result<Gildash, GildashError>> {
    const {
      projectRoot,
      extensions = ['.ts', '.mts', '.cts'],
      ignorePatterns = [],
      parseCacheCapacity = 500,
      logger = console,
      existsSyncFn = existsSync,
      dbConnectionFactory,
      watcherFactory,
      coordinatorFactory,
      repositoryFactory,
      acquireWatcherRoleFn = acquireWatcherRole,
      releaseWatcherRoleFn = releaseWatcherRole,
      updateHeartbeatFn = updateHeartbeat,
      discoverProjectsFn = discoverProjects,
      parseSourceFn = defaultParseSource,
      extractSymbolsFn = defaultExtractSymbols,
      extractRelationsFn = defaultExtractRelations,
      symbolSearchFn = defaultSymbolSearch,
      relationSearchFn = defaultRelationSearch,
      loadTsconfigPathsFn = loadTsconfigPaths,
    } = options;

    if (!path.isAbsolute(projectRoot)) {
      return err(gildashError('validation', `Gildash: projectRoot must be an absolute path, got: "${projectRoot}"`))
    }
    if (!existsSyncFn(projectRoot)) {
      return err(gildashError('validation', `Gildash: projectRoot does not exist: "${projectRoot}"`))
    }

    const db = dbConnectionFactory
      ? dbConnectionFactory()
      : new DbConnection({ projectRoot });
    const openResult = db.open();
    if (isErr(openResult)) return openResult;
    try {

    const boundaries: ProjectBoundary[] = await discoverProjectsFn(projectRoot);
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

    const role = await Promise.resolve(
      acquireWatcherRoleFn(db, process.pid, {}),
    );

    let coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
      tsconfigPaths?: Promise<TsconfigPaths | null>;
      handleWatcherEvent?(event: FileChangeEvent): void;
    }) | null = null;
    let watcher: Pick<ProjectWatcher, 'start' | 'close'> | null = null;

    const instance = new Gildash({
      projectRoot,
      db,
      symbolRepo: repos.symbolRepo,
      relationRepo: repos.relationRepo,
      parseCache: repos.parseCache,
      coordinator,
      watcher,
      releaseWatcherRoleFn: releaseWatcherRoleFn,
      parseSourceFn: parseSourceFn,
      extractSymbolsFn: extractSymbolsFn,
      extractRelationsFn: extractRelationsFn,
      symbolSearchFn: symbolSearchFn,
      relationSearchFn: relationSearchFn,
      logger,
      defaultProject,
      role,
    });
    clearTsconfigPathsCache(projectRoot);
    instance.tsconfigPaths = await loadTsconfigPathsFn(projectRoot);
    instance.boundaries = boundaries;
    if (role === 'owner') {
      const w = watcherFactory
        ? watcherFactory()
        : new ProjectWatcher({ projectRoot, ignorePatterns, extensions }, undefined, logger);

      const c = coordinatorFactory
        ? coordinatorFactory()
        : new IndexCoordinator({
            projectRoot,
            boundaries,
            extensions,
            ignorePatterns,
            dbConnection: db,
            parseCache: repos.parseCache,
            fileRepo: repos.fileRepo,
            symbolRepo: repos.symbolRepo,
            relationRepo: repos.relationRepo,
            logger,
          });

      instance.coordinator = c;
      instance.watcher = w;

      await w.start((event) => c.handleWatcherEvent?.(event)).then((startResult) => {
        if (isErr(startResult)) throw startResult.data;
      });

      const timer = setInterval(() => {
        updateHeartbeatFn(db, process.pid);
      }, HEARTBEAT_INTERVAL_MS);
      instance.timer = timer;

      await c.fullIndex();
    } else {
      let retryCount = 0;
      const healthcheck = async () => {
        try {
          const newRole = await Promise.resolve(
            acquireWatcherRoleFn(db, process.pid, {}),
          );
          retryCount = 0;
          if (newRole === 'owner') {
            clearInterval(instance.timer!);
            instance.timer = null;
            let promotedWatcher: Pick<ProjectWatcher, 'start' | 'close'> | null = null;
            let promotedCoordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
              tsconfigPaths?: Promise<TsconfigPaths | null>;
              handleWatcherEvent?(event: FileChangeEvent): void;
            }) | null = null;
            try {
              promotedWatcher = watcherFactory
                ? watcherFactory()
                : new ProjectWatcher({ projectRoot, ignorePatterns, extensions }, undefined, logger);
              promotedCoordinator = coordinatorFactory
                ? coordinatorFactory()
                : new IndexCoordinator({
                    projectRoot,
                    boundaries,
                    extensions,
                    ignorePatterns,
                    dbConnection: db,
                    parseCache: repos.parseCache,
                    fileRepo: repos.fileRepo,
                    symbolRepo: repos.symbolRepo,
                    relationRepo: repos.relationRepo,
                    logger,
                  });
              for (const cb of instance.onIndexedCallbacks) {
                promotedCoordinator.onIndexed(cb);
              }
              await promotedWatcher.start((event) => promotedCoordinator?.handleWatcherEvent?.(event)).then((startResult) => {
                if (isErr(startResult)) throw startResult.data;
              });
              const hbTimer = setInterval(() => {
                updateHeartbeatFn(db, process.pid);
              }, HEARTBEAT_INTERVAL_MS);
              instance.timer = hbTimer;
              instance.coordinator = promotedCoordinator;
              instance.watcher = promotedWatcher;
              await promotedCoordinator.fullIndex();
            } catch (setupErr) {
              logger.error('[Gildash] owner promotion failed, reverting to reader', setupErr);
              if (promotedWatcher) {
                const closeResult = await promotedWatcher.close();
                if (isErr(closeResult)) logger.error('[Gildash] watcher close error during promotion rollback', closeResult.data);
                instance.watcher = null;
              }
              if (promotedCoordinator) {
                await promotedCoordinator.shutdown().catch((e) =>
                  logger.error('[Gildash] coordinator shutdown error during promotion rollback', e),
                );
                instance.coordinator = null;
              }
              if (instance.timer === null) {
                instance.timer = setInterval(healthcheck, HEALTHCHECK_INTERVAL_MS);
              }
            }
          }
        } catch (err) {
          retryCount++;
          logger.error('[Gildash] healthcheck error', err);
          if (retryCount >= MAX_HEALTHCHECK_RETRIES) {
            logger.error('[Gildash] healthcheck failed too many times, shutting down');
            clearInterval(instance.timer!);
            instance.timer = null;
            instance.close().catch((closeErr) =>
              logger.error('[Gildash] close error during healthcheck shutdown', closeErr),
            );
          }
        }
      };
      const timer = setInterval(healthcheck, HEALTHCHECK_INTERVAL_MS);
      instance.timer = timer;
    }

    const signals: Array<NodeJS.Signals | 'beforeExit'> = ['SIGTERM', 'SIGINT', 'beforeExit'];
    for (const sig of signals) {
      const handler = () => { instance.close().catch(err => logger.error('[Gildash] close error during signal', sig, err)); };
      if (sig === 'beforeExit') {
        process.on('beforeExit', handler);
      } else {
        process.on(sig, handler);
      }
      instance.signalHandlers.push([sig, handler]);
    }

    return instance;
    } catch (error) {
      db.close();
      return err(gildashError('store', 'Gildash: initialization failed', error));
    }
  }

  /**
   * Shut down the instance and release all resources.
   *
   * Stops the file watcher, shuts down the index coordinator,
   * releases the watcher ownership role, and closes the database.
   * Calling `close()` more than once is safe (subsequent calls are no-ops).
   *
   * @returns `void` on success, or `Err<GildashError>` with `type='close'` if one or more
   *   sub-systems failed during shutdown.  The `cause` field contains an array of
   *   individual errors from each failed sub-system.
   *
   * @example
   * ```ts
   * const closeResult = await ledger.close();
   * if (isErr(closeResult)) {
   *   console.error('Close failed:', closeResult.data.message);
   *   // closeResult.data.cause is unknown[] of per-subsystem errors
   * }
   * ```
   */
  async close(): Promise<Result<void, GildashError>> {
    if (this.closed) return;
    this.closed = true;

    const closeErrors: unknown[] = [];

    for (const [sig, handler] of this.signalHandlers) {
      if (sig === 'beforeExit') {
        process.off('beforeExit', handler);
      } else {
        process.off(sig as NodeJS.Signals, handler);
      }
    }
    this.signalHandlers = [];

    if (this.coordinator) {
      try {
        await this.coordinator.shutdown();
      } catch (err) {
        closeErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    if (this.watcher) {
      const closeResult = await this.watcher.close();
      if (isErr(closeResult)) closeErrors.push(closeResult.data);
    }

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    try {
      this.releaseWatcherRoleFn(this.db, process.pid);
    } catch (err) {
      closeErrors.push(err instanceof Error ? err : new Error(String(err)));
    }

    try {
      this.db.close();
    } catch (err) {
      closeErrors.push(err instanceof Error ? err : new Error(String(err)));
    }

    if (closeErrors.length > 0) {
      return err(gildashError('close', 'Gildash: one or more errors occurred during close()', closeErrors));
    }
  }

  /**
   * Register a callback that fires after each indexing run completes.
   *
   * @param callback - Receives the {@link IndexResult} for the completed run.
   * @returns An unsubscribe function. Call it to remove the listener.
   *
   * @example
   * ```ts
   * const off = ledger.onIndexed(result => {
   *   console.log(`Indexed ${result.filesProcessed} files`);
   * });
   * // later…
   * off();
   * ```
   */
  onIndexed(callback: (result: IndexResult) => void): () => void {
    this.onIndexedCallbacks.add(callback);
    if (!this.coordinator) {
      return () => { this.onIndexedCallbacks.delete(callback); };
    }
    const unsubscribe = this.coordinator.onIndexed(callback);
    return () => {
      this.onIndexedCallbacks.delete(callback);
      unsubscribe();
    };
  }

  /**
   * Parse a TypeScript source string into an AST and cache the result.
   *
   * On success the result is automatically stored in the internal LRU parse cache
   * so that subsequent calls to extraction methods can reuse it.
   *
   * @param filePath - File path used as the cache key and for diagnostics.
   * @param sourceText - Raw TypeScript source code.
   * @returns A {@link ParsedFile}, or `Err<GildashError>` with `type='closed'` if the instance
   *   is closed, or `type='parse'` if the parser fails.
   *
   * @example
   * ```ts
   * const parsed = ledger.parseSource('/project/src/app.ts', sourceCode);
   * if (isErr(parsed)) {
   *   console.error(parsed.data.message); // e.g. "Failed to parse file: ..."
   *   return;
   * }
   * // parsed is now a ParsedFile
   * const symbols = ledger.extractSymbols(parsed);
   * ```
   */
  parseSource(filePath: string, sourceText: string): Result<ParsedFile, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    const result = this.parseSourceFn(filePath, sourceText);
    if (isErr(result)) return result;
    this.parseCache.set(filePath, result);
    return result;
  }

  /**
   * Extract all symbol declarations from a previously parsed file.
   *
   * Returns function, class, variable, type-alias, interface, and enum declarations
   * found in the AST.
   *
   * @param parsed - A {@link ParsedFile} obtained from {@link parseSource}.
   * @returns An array of {@link ExtractedSymbol} entries, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed.
   *
   * @example
   * ```ts
   * const symbols = ledger.extractSymbols(parsed);
   * if (isErr(symbols)) return;
   * for (const sym of symbols) {
   *   console.log(`${sym.kind}: ${sym.name}`);
   * }
   * ```
   */
  extractSymbols(parsed: ParsedFile): Result<ExtractedSymbol[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    return this.extractSymbolsFn(parsed);
  }

  /**
   * Extract inter-file relationships (imports, calls, extends, implements)
   * from a previously parsed file.
   *
   * If tsconfig path aliases were discovered during {@link Gildash.open},
   * they are automatically applied when resolving import targets.
   *
   * @param parsed - A {@link ParsedFile} obtained from {@link parseSource}.
   * @returns An array of {@link CodeRelation} entries, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed.
   *
   * @example
   * ```ts
   * const relations = ledger.extractRelations(parsed);
   * if (isErr(relations)) return;
   * const imports = relations.filter(r => r.type === 'imports');
   * ```
   */
  extractRelations(parsed: ParsedFile): Result<CodeRelation[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    return this.extractRelationsFn(
      parsed.program,
      parsed.filePath,
      this.tsconfigPaths ?? undefined,
    );
  }

  /**
   * Trigger a full re-index of all tracked files.
   *
   * Only available to the instance that holds the *owner* role.
   * Reader instances receive `Err<GildashError>` with `type='closed'`.
   *
   * @returns An {@link IndexResult} summary on success, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed / reader,
   *   `type='index'` if the indexing pipeline fails.
   *
   * @example
   * ```ts
   * const result = await ledger.reindex();
   * if (isErr(result)) {
   *   console.error(result.data.message);
   *   return;
   * }
   * console.log(`Indexed ${result.indexedFiles} files in ${result.durationMs}ms`);
   * ```
   */
  async reindex(): Promise<Result<IndexResult, GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    if (!this.coordinator) {
      return err(gildashError('closed', 'Gildash: reindex() is not available for readers'));
    }
    try {
      return await this.coordinator.fullIndex();
    } catch (e) {
      return err(gildashError('index', 'Gildash: reindex failed', e));
    }
  }

  /**
   * Discovered project boundaries within the project root.
   *
   * Each entry contains a project name and its root directory.
   */
  get projects(): ProjectBoundary[] {
    return [...this.boundaries];
  }

  /**
   * Return aggregate symbol statistics for the given project.
   *
   * @param project - Project name. Defaults to the auto-discovered primary project.
   * @returns A {@link SymbolStats} object with counts grouped by symbol kind,
   *   or `Err<GildashError>` with `type='closed'` if the instance is closed,
   *   `type='store'` if the database query fails.
   *
   * @example
   * ```ts
   * const stats = ledger.getStats();
   * if (isErr(stats)) return;
   * console.log(`Files: ${stats.fileCount}, Symbols: ${stats.symbolCount}`);
   * ```
   */
  getStats(project?: string): Result<SymbolStats, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.symbolRepo.getStats(project ?? this.defaultProject);
    } catch (e) {
      return err(gildashError('store', 'Gildash: getStats failed', e));
    }
  }

  /**
   * Search indexed symbols by name, kind, file path, or export status.
   *
   * @param query - Search filters (see {@link SymbolSearchQuery}). All fields are optional;
   *   omitted fields match everything.
   * @returns An array of {@link SymbolSearchResult} entries, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the query fails.
   *
   * @example
   * ```ts
   * const fns = ledger.searchSymbols({ kind: 'function', isExported: true });
   * if (isErr(fns)) return;
   * fns.forEach(fn => console.log(fn.name, fn.filePath));
   * ```
   */
  searchSymbols(query: SymbolSearchQuery): Result<SymbolSearchResult[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.symbolSearchFn({ symbolRepo: this.symbolRepo, project: this.defaultProject, query });
    } catch (e) {
      return err(gildashError('search', 'Gildash: searchSymbols failed', e));
    }
  }

  /**
   * Search indexed code relationships (imports, calls, extends, implements).
   *
   * @param query - Search filters (see {@link RelationSearchQuery}). All fields are optional.
   * @returns An array of {@link CodeRelation} entries, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the query fails.
   *
   * @example
   * ```ts
   * const rels = ledger.searchRelations({ srcFilePath: 'src/app.ts', type: 'imports' });
   * if (isErr(rels)) return;
   * rels.forEach(r => console.log(`${r.srcFilePath} -> ${r.dstFilePath}`));
   * ```
   */
  searchRelations(query: RelationSearchQuery): Result<CodeRelation[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.relationSearchFn({ relationRepo: this.relationRepo, project: this.defaultProject, query });
    } catch (e) {
      return err(gildashError('search', 'Gildash: searchRelations failed', e));
    }
  }

  /**
   * List the files that a given file directly imports.
   *
   * @param filePath - Absolute path of the source file.
   * @param project - Project name. Defaults to the primary project.
   * @param limit - Maximum results. Defaults to `10_000`.
   * @returns An array of absolute paths that `filePath` imports,
   *   or `Err<GildashError>` with `type='closed'` / `type='search'`.
   *
   * @example
   * ```ts
   * const deps = ledger.getDependencies('/project/src/app.ts');
   * if (isErr(deps)) return;
   * console.log('Imports:', deps.join(', '));
   * ```
   */
  getDependencies(filePath: string, project?: string, limit = 10_000): Result<string[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.relationSearchFn({
        relationRepo: this.relationRepo,
        project: project ?? this.defaultProject,
        query: { srcFilePath: filePath, type: 'imports', project: project ?? this.defaultProject, limit },
      }).map(r => r.dstFilePath);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getDependencies failed', e));
    }
  }

  /**
   * List the files that directly import a given file.
   *
   * @param filePath - Absolute path of the target file.
   * @param project - Project name. Defaults to the primary project.
   * @param limit - Maximum results. Defaults to `10_000`.
   * @returns An array of absolute paths of files that import `filePath`,
   *   or `Err<GildashError>` with `type='closed'` / `type='search'`.
   *
   * @example
   * ```ts
   * const dependents = ledger.getDependents('/project/src/utils.ts');
   * if (isErr(dependents)) return;
   * console.log('Imported by:', dependents.join(', '));
   * ```
   */
  getDependents(filePath: string, project?: string, limit = 10_000): Result<string[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.relationSearchFn({
        relationRepo: this.relationRepo,
        project: project ?? this.defaultProject,
        query: { dstFilePath: filePath, type: 'imports', project: project ?? this.defaultProject, limit },
      }).map(r => r.srcFilePath);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getDependents failed', e));
    }
  }

  /**
   * Compute the full set of files transitively affected by changes.
   *
   * Internally builds a full {@link DependencyGraph} and walks all reverse
   * edges from each changed file to find every transitive dependent.
   *
   * @param changedFiles - Absolute paths of files that changed.
   * @param project - Project name. Defaults to the primary project.
   * @returns De-duplicated absolute paths of all transitively-dependent files
   *   (excluding the changed files themselves), or `Err<GildashError>` with
   *   `type='closed'` / `type='search'`.
   *
   * @example
   * ```ts
   * const affected = await ledger.getAffected(['/project/src/utils.ts']);
   * if (isErr(affected)) return;
   * console.log('Affected files:', affected.length);
   * ```
   */
  async getAffected(changedFiles: string[], project?: string): Promise<Result<string[], GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const g = new DependencyGraph({
        relationRepo: this.relationRepo,
        project: project ?? this.defaultProject,
      });
      await g.build();
      return g.getAffectedByChange(changedFiles);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getAffected failed', e));
    }
  }

  /**
   * Check whether the import graph contains a circular dependency.
   *
   * Internally builds a full {@link DependencyGraph} and runs iterative DFS
   * cycle detection.
   *
   * @param project - Project name. Defaults to the primary project.
   * @returns `true` if at least one cycle exists, `false` otherwise,
   *   or `Err<GildashError>` with `type='closed'` / `type='search'`.
   *
   * @example
   * ```ts
   * const cycleResult = await ledger.hasCycle();
   * if (isErr(cycleResult)) return;
   * if (cycleResult) {
   *   console.warn('Circular dependency detected!');
   * }
   * ```
   */
  async hasCycle(project?: string): Promise<Result<boolean, GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const g = new DependencyGraph({
        relationRepo: this.relationRepo,
        project: project ?? this.defaultProject,
      });
      await g.build();
      return g.hasCycle();
    } catch (e) {
      return err(gildashError('search', 'Gildash: hasCycle failed', e));
    }
  }
}
