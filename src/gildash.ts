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
 * const ledger = await Gildash.open({
 *   projectRoot: '/absolute/path/to/project',
 *   extensions: ['.ts', '.tsx'],
 *   ignorePatterns: ['vendor'],
 * });
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
 * Create an instance with the static {@link Gildash.open} factory.
 * Always call {@link Gildash.close} when done to release resources.
 *
 * @example
 * ```ts
 * import { Gildash } from '@zipbul/gildash';
 *
 * const ledger = await Gildash.open({ projectRoot: '/my/project' });
 * const symbols = ledger.searchSymbols({ text: 'handle', kind: 'function' });
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
  private readonly role: 'owner' | 'reader';
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
   * @returns A fully-initialised `Gildash` ready for queries.
   * @throws {Error} If `projectRoot` is not absolute or does not exist.
   *
   * @example
   * ```ts
   * const ledger = await Gildash.open({
   *   projectRoot: '/home/user/my-app',
   *   extensions: ['.ts', '.tsx'],
   * });
   * ```
   */
  static async open(options: GildashOptions & GildashInternalOptions): Promise<Gildash> {
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
      throw new Error(`Gildash: projectRoot must be an absolute path, got: "${projectRoot}"`);
    }
    if (!existsSyncFn(projectRoot)) {
      throw new Error(`Gildash: projectRoot does not exist: "${projectRoot}"`);
    }

    const db = dbConnectionFactory
      ? dbConnectionFactory()
      : new DbConnection({ projectRoot });
    db.open();
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

      await w.start((event) => c.handleWatcherEvent?.(event));

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
              await promotedWatcher.start((event) => promotedCoordinator?.handleWatcherEvent?.(event));
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
                await promotedWatcher.close().catch((e) =>
                  logger.error('[Gildash] watcher close error during promotion rollback', e),
                );
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
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /**
   * Shut down the instance and release all resources.
   *
   * Stops the file watcher, shuts down the index coordinator,
   * releases the watcher ownership role, and closes the database.
   * Calling `close()` more than once is safe (subsequent calls are no-ops).
   *
   * @throws {AggregateError} If one or more sub-systems fail during shutdown.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const closeErrors: Error[] = [];

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
      try {
        await this.watcher.close();
      } catch (err) {
        closeErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
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
      throw new AggregateError(closeErrors, 'Gildash: one or more errors occurred during close()');
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
   * @param filePath - File path used as the cache key and for diagnostics.
   * @param sourceText - Raw TypeScript source code.
   * @returns The parsed file representation.
   * @throws {Error} If the instance is closed.
   */
  parseSource(filePath: string, sourceText: string): ParsedFile {
    if (this.closed) throw new Error('Gildash: instance is closed');
    const parsed = this.parseSourceFn(filePath, sourceText);
    this.parseCache.set(filePath, parsed);
    return parsed;
  }

  /**
   * Extract all symbol declarations from a previously parsed file.
   *
   * @param parsed - A {@link ParsedFile} obtained from {@link parseSource}.
   * @returns An array of {@link ExtractedSymbol} entries.
   * @throws {Error} If the instance is closed.
   */
  extractSymbols(parsed: ParsedFile): ExtractedSymbol[] {
    if (this.closed) throw new Error('Gildash: instance is closed');
    return this.extractSymbolsFn(parsed);
  }

  /**
   * Extract inter-file relationships (imports, calls, extends, implements)
   * from a previously parsed file.
   *
   * @param parsed - A {@link ParsedFile} obtained from {@link parseSource}.
   * @returns An array of {@link CodeRelation} entries.
   * @throws {Error} If the instance is closed.
   */
  extractRelations(parsed: ParsedFile): CodeRelation[] {
    if (this.closed) throw new Error('Gildash: instance is closed');
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
   *
   * @returns The indexing result summary.
   * @throws {Error} If the instance is closed or is a reader.
   */
  async reindex(): Promise<IndexResult> {
    if (this.closed) throw new Error('Gildash: instance is closed');
    if (!this.coordinator) {
      throw new Error('Gildash: reindex() is not available for readers');
    }
    return this.coordinator.fullIndex();
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
   * @returns Counts grouped by symbol kind.
   * @throws {Error} If the instance is closed.
   */
  getStats(project?: string): SymbolStats {
    if (this.closed) throw new Error('Gildash: instance is closed');
    return this.symbolRepo.getStats(project ?? this.defaultProject);
  }

  /**
   * Search indexed symbols by name, kind, file path, or export status.
   *
   * @param query - Search filters. All fields are optional; omitted fields match everything.
   * @returns Matching {@link SymbolSearchResult} entries.
   * @throws {Error} If the instance is closed.
   *
   * @example
   * ```ts
   * const fns = ledger.searchSymbols({ kind: 'function', isExported: true });
   * ```
   */
  searchSymbols(query: SymbolSearchQuery): SymbolSearchResult[] {
    if (this.closed) throw new Error('Gildash: instance is closed');
    return this.symbolSearchFn({ symbolRepo: this.symbolRepo, project: this.defaultProject, query });
  }

  /**
   * Search indexed code relationships (imports, calls, extends, implements).
   *
   * @param query - Search filters. All fields are optional.
   * @returns Matching {@link CodeRelation} entries.
   * @throws {Error} If the instance is closed.
   */
  searchRelations(query: RelationSearchQuery): CodeRelation[] {
    if (this.closed) throw new Error('Gildash: instance is closed');
    return this.relationSearchFn({ relationRepo: this.relationRepo, project: this.defaultProject, query });
  }

  /**
   * List the files that a given file directly imports.
   *
   * @param filePath - Absolute path of the source file.
   * @param project - Project name. Defaults to the primary project.
   * @param limit - Maximum results. Defaults to `10_000`.
   * @returns Absolute paths of imported files.
   * @throws {Error} If the instance is closed.
   */
  getDependencies(filePath: string, project?: string, limit = 10_000): string[] {
    if (this.closed) throw new Error('Gildash: instance is closed');
    return this.relationSearchFn({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
      query: { srcFilePath: filePath, type: 'imports', project: project ?? this.defaultProject, limit },
    }).map(r => r.dstFilePath);
  }

  /**
   * List the files that directly import a given file.
   *
   * @param filePath - Absolute path of the target file.
   * @param project - Project name. Defaults to the primary project.
   * @param limit - Maximum results. Defaults to `10_000`.
   * @returns Absolute paths of files that import the target.
   * @throws {Error} If the instance is closed.
   */
  getDependents(filePath: string, project?: string, limit = 10_000): string[] {
    if (this.closed) throw new Error('Gildash: instance is closed');
    return this.relationSearchFn({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
      query: { dstFilePath: filePath, type: 'imports', project: project ?? this.defaultProject, limit },
    }).map(r => r.srcFilePath);
  }

  /**
   * Compute the full set of files transitively affected by changes.
   *
   * Builds a dependency graph and walks all reverse edges from each changed file.
   *
   * @param changedFiles - Absolute paths of files that changed.
   * @param project - Project name. Defaults to the primary project.
   * @returns Paths of all transitively-dependent files (excludes the changed files themselves).
   * @throws {Error} If the instance is closed.
   */
  async getAffected(changedFiles: string[], project?: string): Promise<string[]> {
    if (this.closed) throw new Error('Gildash: instance is closed');
    const g = new DependencyGraph({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
    });
    await g.build();
    return g.getAffectedByChange(changedFiles);
  }

  /**
   * Check whether the import graph contains a circular dependency.
   *
   * @param project - Project name. Defaults to the primary project.
   * @returns `true` if at least one cycle exists.
   * @throws {Error} If the instance is closed.
   */
  async hasCycle(project?: string): Promise<boolean> {
    if (this.closed) throw new Error('Gildash: instance is closed');
    const g = new DependencyGraph({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
    });
    await g.build();
    return g.hasCycle();
  }
}
