import { err, isErr, type Result } from '@zipbul/result';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { ParsedFile } from './parser/types';
import { parseSource as defaultParseSource } from './parser/parse-source';
import { ParseCache } from './parser/parse-cache';
import type { ExtractedSymbol, SymbolKind, CodeRelation } from './extractor/types';
import { extractSymbols as defaultExtractSymbols } from './extractor/symbol-extractor';
import { extractRelations as defaultExtractRelations } from './extractor/relation-extractor';
import { DbConnection } from './store/connection';
import { FileRepository } from './store/repositories/file.repository';
import type { FileRecord } from './store/repositories/file.repository';
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
import type { ParserOptions } from 'oxc-parser';
import { symbolSearch as defaultSymbolSearch } from './search/symbol-search';
import type { SymbolSearchQuery, SymbolSearchResult } from './search/symbol-search';
import { relationSearch as defaultRelationSearch } from './search/relation-search';
import type { RelationSearchQuery } from './search/relation-search';
import type { SymbolStats } from './store/repositories/symbol.repository';
import { DependencyGraph } from './search/dependency-graph';
import { patternSearch as defaultPatternSearch } from './search/pattern-search';
import type { PatternMatch } from './search/pattern-search';
import { gildashError, type GildashError } from './errors';
import { SemanticLayer } from './semantic/index';
import type { ResolvedType, SemanticReference, Implementation, SemanticModuleInterface } from './semantic/types';

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
 * Result of a {@link Gildash.diffSymbols} call.
 */
export interface SymbolDiff {
  /** Symbols present in `after` but not in `before`. */
  added: SymbolSearchResult[];
  /** Symbols present in `before` but not in `after`. */
  removed: SymbolSearchResult[];
  /** Symbols present in both but with a different `fingerprint`. */
  modified: Array<{ before: SymbolSearchResult; after: SymbolSearchResult }>;
}

/**
 * Public interface of a module — its exported symbols with key metadata.
 * Returned by {@link Gildash.getModuleInterface}.
 */
export interface ModuleInterface {
  filePath: string;
  exports: Array<{
    name: string;
    kind: SymbolKind;
    parameters?: string;
    returnType?: string;
    jsDoc?: string;
  }>;
}

/**
 * A node in the heritage chain tree returned by {@link Gildash.getHeritageChain}.
 */
export interface HeritageNode {
  symbolName: string;
  filePath: string;
  /** Relationship kind (`extends` or `implements`). Undefined for the root query node. */
  kind?: 'extends' | 'implements';
  children: HeritageNode[];
}

/**
 * Full symbol detail including members, documentation, and type information.
 * Returned by {@link Gildash.getFullSymbol}.
 */
export interface FullSymbol extends SymbolSearchResult {  /** Class/interface members (methods, properties, constructors, accessors). */
  members?: Array<{
    name: string;
    kind: string;
    type?: string;
    visibility?: string;
    isStatic?: boolean;
    isReadonly?: boolean;
  }>;
  /** JSDoc comment attached to the symbol. */
  jsDoc?: string;
  /** Stringified parameter list (functions/methods). */
  parameters?: string;
  /** Stringified return type (functions/methods). */
  returnType?: string;
  /** Superclass/interface names (classes/interfaces with heritage). */
  heritage?: string[];
  /** Decorators applied to the symbol. */
  decorators?: Array<{ name: string; arguments?: string }>;
  /** Stringified type parameters (generic symbols). */
  typeParameters?: string;
  /** Resolved type from the Semantic Layer (available when `semantic: true`). */
  resolvedType?: ResolvedType;
}

/**
 * File-level statistics for an indexed file.
 * Returned by {@link Gildash.getFileStats}.
 */
export interface FileStats {
  /** Absolute file path. */
  filePath: string;
  /** Number of lines in the file at the time of last indexing. */
  lineCount: number;
  /** Number of symbols indexed in the file. */
  symbolCount: number;
  /** Number of outgoing relations (imports, calls, etc.) from the file. */
  relationCount: number;
  /** File size in bytes at the time of last indexing. */
  size: number;
  /** Number of exported symbols in the file. */
  exportedSymbolCount: number;
}

/**
 * Import-graph fan metrics for a single file.
 * Returned by {@link Gildash.getFanMetrics}.
 */
export interface FanMetrics {
  /** Absolute file path queried. */
  filePath: string;
  /** Number of files that import this file (fan-in). */
  fanIn: number;
  /** Number of files this file imports (fan-out). */
  fanOut: number;
}

/**
 * Result of following a re-export chain to the original symbol definition.
 */
export interface ResolvedSymbol {
  /** The name of the symbol at the end of the re-export chain (may differ from the queried name due to aliasing). */
  originalName: string;
  /** Absolute path of the file that originally defines the symbol. */
  originalFilePath: string;
  /** Ordered list of re-export hops between the queried file and the original definition. */
  reExportChain: Array<{ filePath: string; exportedAs: string }>;
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
  /**
   * When `false`, disables the file watcher and runs in scan-only mode:
   * ownership contention is skipped, heartbeat and signal handlers are not
   * registered, and only the initial `fullIndex()` is performed.
   *
   * Set `cleanup: true` in {@link Gildash.close} to remove the database files
   * after a one-shot scan.
   *
   * @default true
   */
  watchMode?: boolean;
  /**
   * Enable the Semantic Layer (tsc-based type analysis).
   * When `true`, creates a `SemanticLayer` backed by the TypeScript compiler.
   * Requires a `tsconfig.json` in `projectRoot`.
   *
   * @default false
   */
  semantic?: boolean;
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
  makeExternalCoordinatorFn?: (packageDir: string, project: string) => { fullIndex(): Promise<IndexResult> };
  semanticLayerFactory?: (tsconfigPath: string) => Result<SemanticLayer, GildashError>;
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
  private readonly fileRepo: Pick<FileRepository, 'getFile' | 'getAllFiles'>;
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
  private readonly patternSearchFn: (opts: { pattern: string; filePaths: string[] }) => Promise<PatternMatch[]>;
  private readonly readFileFn: (filePath: string) => Promise<string>;
  private readonly unlinkFn: (filePath: string) => Promise<void>;
  private readonly existsSyncFn: (p: string) => boolean;
  private readonly makeExternalCoordinatorFn?: (packageDir: string, project: string) => { fullIndex(): Promise<IndexResult> };
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
  /** Cached DependencyGraph — invalidated on each index run. */
  private graphCache: DependencyGraph | null = null;
  /** Project key of the cached graph (`project ?? '__cross__'`). */
  private graphCacheKey: string | null = null;
  /** Semantic Layer (tsc-backed) — `null` when `semantic` option is `false` (default). */
  private semanticLayer: Pick<SemanticLayer, 'collectTypeAt' | 'collectFileTypes' | 'findReferences' | 'findImplementations' | 'getModuleInterface' | 'getSymbolNode' | 'notifyFileChanged' | 'dispose' | 'isDisposed' | 'lineColumnToPosition'> | null = null;

  private constructor(opts: {
    projectRoot: string;
    db: Pick<DbConnection, 'open' | 'close' | 'transaction'> & WatcherOwnerStore;
    symbolRepo: SymbolRepository;
    relationRepo: RelationRepository;
    fileRepo: Pick<FileRepository, 'getFile' | 'getAllFiles'>;
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
    patternSearchFn: (opts: { pattern: string; filePaths: string[] }) => Promise<PatternMatch[]>;
    readFileFn: (filePath: string) => Promise<string>;
    unlinkFn: (filePath: string) => Promise<void>;
    existsSyncFn: (p: string) => boolean;
    makeExternalCoordinatorFn?: (packageDir: string, project: string) => { fullIndex(): Promise<IndexResult> };
    logger: Logger;
    defaultProject: string;
    role: 'owner' | 'reader';
  }) {
    this.projectRoot = opts.projectRoot;
    this.db = opts.db;
    this.symbolRepo = opts.symbolRepo;
    this.relationRepo = opts.relationRepo;
    this.fileRepo = opts.fileRepo;
    this.parseCache = opts.parseCache;
    this.coordinator = opts.coordinator;
    this.watcher = opts.watcher;
    this.releaseWatcherRoleFn = opts.releaseWatcherRoleFn;
    this.parseSourceFn = opts.parseSourceFn;
    this.extractSymbolsFn = opts.extractSymbolsFn;
    this.extractRelationsFn = opts.extractRelationsFn;
    this.symbolSearchFn = opts.symbolSearchFn;
    this.relationSearchFn = opts.relationSearchFn;
    this.patternSearchFn = opts.patternSearchFn;
    this.readFileFn = opts.readFileFn;
    this.unlinkFn = opts.unlinkFn;
    this.existsSyncFn = opts.existsSyncFn;
    this.makeExternalCoordinatorFn = opts.makeExternalCoordinatorFn;
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
      patternSearchFn = defaultPatternSearch,
      loadTsconfigPathsFn = loadTsconfigPaths,
      makeExternalCoordinatorFn,
      readFileFn = async (fp: string) => Bun.file(fp).text(),
      unlinkFn = async (fp: string) => { await Bun.file(fp).unlink(); },
      watchMode,
      semantic,
      semanticLayerFactory,
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

    const isWatchMode = watchMode ?? true;
    let role: 'owner' | 'reader';
    if (isWatchMode) {
      role = await Promise.resolve(
        acquireWatcherRoleFn(db, process.pid, {}),
      );
    } else {
      role = 'owner';
    }

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
      fileRepo: repos.fileRepo,
      parseCache: repos.parseCache,
      coordinator,
      watcher,
      releaseWatcherRoleFn: releaseWatcherRoleFn,
      parseSourceFn: parseSourceFn,
      extractSymbolsFn: extractSymbolsFn,
      extractRelationsFn: extractRelationsFn,
      symbolSearchFn: symbolSearchFn,
      relationSearchFn: relationSearchFn,
      patternSearchFn: patternSearchFn,
      readFileFn: readFileFn,
      unlinkFn: unlinkFn,
      existsSyncFn,
      makeExternalCoordinatorFn,
      logger,
      defaultProject,
      role,
    });
    clearTsconfigPathsCache(projectRoot);
    instance.tsconfigPaths = await loadTsconfigPathsFn(projectRoot);
    instance.boundaries = boundaries;

    if (semantic) {
      const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
      const semanticResult = semanticLayerFactory
        ? semanticLayerFactory(tsconfigPath)
        : SemanticLayer.create(tsconfigPath);
      if (isErr(semanticResult)) {
        db.close();
        return semanticResult;
      }
      instance.semanticLayer = semanticResult;
    }

    if (role === 'owner') {
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
      c.onIndexed(() => instance.invalidateGraphCache());

      if (isWatchMode) {
        const w = watcherFactory
          ? watcherFactory()
          : new ProjectWatcher({ projectRoot, ignorePatterns, extensions }, undefined, logger);

        instance.watcher = w;

        await w.start((event) => {
          c.handleWatcherEvent?.(event);
          if (instance.semanticLayer && event.eventType !== 'delete') {
            readFileFn(event.filePath).then(content => {
              instance.semanticLayer?.notifyFileChanged(event.filePath, content);
            }).catch(() => {});
          }
        }).then((startResult) => {
          if (isErr(startResult)) throw startResult.data;
        });

        const timer = setInterval(() => {
          updateHeartbeatFn(db, process.pid);
        }, HEARTBEAT_INTERVAL_MS);
        instance.timer = timer;
      }

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
              promotedCoordinator.onIndexed(() => instance.invalidateGraphCache());
              await promotedWatcher.start((event) => {
                promotedCoordinator?.handleWatcherEvent?.(event);
                if (instance.semanticLayer && event.eventType !== 'delete') {
                  readFileFn(event.filePath).then(content => {
                    instance.semanticLayer?.notifyFileChanged(event.filePath, content);
                  }).catch(() => {});
                }
              }).then((startResult) => {
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

    if (isWatchMode) {
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
  async close(opts?: { cleanup?: boolean }): Promise<Result<void, GildashError>> {
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

    if (this.semanticLayer) {
      try {
        this.semanticLayer.dispose();
      } catch (err) {
        closeErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
      this.semanticLayer = null;
    }

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

    if (opts?.cleanup) {
      for (const ext of ['', '-wal', '-shm']) {
        try {
          await this.unlinkFn(path.join(this.projectRoot, '.zipbul', 'gildash.db' + ext));
        } catch {}
      }
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
   * @param options - Optional oxc-parser {@link ParserOptions} (e.g. `sourceType`, `lang`).
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
  parseSource(filePath: string, sourceText: string, options?: ParserOptions): Result<ParsedFile, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    const result = this.parseSourceFn(filePath, sourceText, options);
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

  /** Invalidate the cached DependencyGraph (called after every index run). */
  private invalidateGraphCache(): void {
    this.graphCache = null;
    this.graphCacheKey = null;
  }

  /**
   * Return a cached or freshly-built {@link DependencyGraph} for the given project.
   *
   * Builds once per `project ?? '__cross__'` key; subsequent calls with the same key
   * return the cached instance. Cache is invalidated by {@link invalidateGraphCache}.
   */
  private getOrBuildGraph(project?: string): DependencyGraph {
    const key = project ?? '__cross__';
    if (this.graphCache && this.graphCacheKey === key) {
      return this.graphCache;
    }
    const g = new DependencyGraph({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
    });
    g.build();
    this.graphCache = g;
    this.graphCacheKey = key;
    return g;
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
      const result = await this.coordinator.fullIndex();
      this.invalidateGraphCache();
      return result;
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
   * Search symbols across all projects (no project filter).
   *
   * @param query - Search filters (see {@link SymbolSearchQuery}). The `project` field is ignored.
   * @returns An array of {@link SymbolSearchResult} entries, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the query fails.
   */
  searchAllSymbols(query: Omit<SymbolSearchQuery, 'project'> & { project?: string }): Result<SymbolSearchResult[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.symbolSearchFn({ symbolRepo: this.symbolRepo, project: undefined, query });
    } catch (e) {
      return err(gildashError('search', 'Gildash: searchAllSymbols failed', e));
    }
  }

  /**
   * Search relations across all projects (no project filter).
   *
   * @param query - Search filters (see {@link RelationSearchQuery}). The `project` field is ignored.
   * @returns An array of {@link CodeRelation} entries, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the query fails.
   */
  searchAllRelations(query: RelationSearchQuery): Result<CodeRelation[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.relationSearchFn({ relationRepo: this.relationRepo, project: undefined, query });
    } catch (e) {
      return err(gildashError('search', 'Gildash: searchAllRelations failed', e));
    }
  }

  /**
   * List all files indexed for a given project.
   *
   * @param project - Project name. Defaults to the primary project.
   * @returns An array of {@link FileRecord} entries, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='store'` if the repository query fails.
   */
  listIndexedFiles(project?: string): Result<FileRecord[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.fileRepo.getAllFiles(project ?? this.defaultProject);
    } catch (e) {
      return err(gildashError('store', 'Gildash: listIndexedFiles failed', e));
    }
  }

  /**
   * Get all intra-file relations for a given file (relations where both source and destination
   * are within the same file).
   *
   * @param filePath - Path of the file to query.
   * @param project - Project name. Defaults to the primary project.
   * @returns An array of {@link CodeRelation} entries, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the query fails.
   */
  getInternalRelations(filePath: string, project?: string): Result<CodeRelation[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.relationSearchFn({
        relationRepo: this.relationRepo,
        project: project ?? this.defaultProject,
        query: { srcFilePath: filePath, dstFilePath: filePath, limit: 10_000 },
      });
    } catch (e) {
      return err(gildashError('search', 'Gildash: getInternalRelations failed', e));
    }
  }

  /**
   * Compare two snapshots of symbol search results and return a structured diff.
   *
   * Symbols are keyed by `name::filePath`. A symbol is:
   * - **added** if it appears only in `after`
   * - **removed** if it appears only in `before`
   * - **modified** if it appears in both but with a different `fingerprint`
   * - **unchanged** otherwise
   *
   * @param before - Snapshot of symbols before the change.
   * @param after - Snapshot of symbols after the change.
   * @returns A {@link SymbolDiff} object.
   */
  diffSymbols(
    before: SymbolSearchResult[],
    after: SymbolSearchResult[],
  ): SymbolDiff {
    const beforeMap = new Map<string, SymbolSearchResult>(before.map(s => [`${s.name}::${s.filePath}`, s]));
    const afterMap = new Map<string, SymbolSearchResult>(after.map(s => [`${s.name}::${s.filePath}`, s]));
    const added: SymbolSearchResult[] = [];
    const removed: SymbolSearchResult[] = [];
    const modified: Array<{ before: SymbolSearchResult; after: SymbolSearchResult }> = [];
    for (const [key, afterSym] of afterMap) {
      const beforeSym = beforeMap.get(key);
      if (!beforeSym) {
        added.push(afterSym);
      } else if (beforeSym.fingerprint !== afterSym.fingerprint) {
        modified.push({ before: beforeSym, after: afterSym });
      }
    }
    for (const [key, beforeSym] of beforeMap) {
      if (!afterMap.has(key)) removed.push(beforeSym);
    }
    return { added, removed, modified };
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
      const g = this.getOrBuildGraph(project);
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
      const g = this.getOrBuildGraph(project);
      return g.hasCycle();
    } catch (e) {
      return err(gildashError('search', 'Gildash: hasCycle failed', e));
    }
  }

  /**
   * Return the full import graph for a project as an adjacency list.
   *
   * Builds a {@link DependencyGraph} and exposes its internal adjacency list.
   * Each file appears as a key; its value lists the files it directly imports.
   * Files that are imported but do not themselves import appear as keys with empty arrays.
   *
   * @param project - Project name. Defaults to the primary project.
   * @returns A `Map<filePath, importedFilePaths[]>`, or `Err<GildashError>` with
   *   `type='closed'` / `type='search'`.
   */
  async getImportGraph(project?: string): Promise<Result<Map<string, string[]>, GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const g = this.getOrBuildGraph(project);
      return g.getAdjacencyList();
    } catch (e) {
      return err(gildashError('search', 'Gildash: getImportGraph failed', e));
    }
  }

  /**
   * Return all files that `filePath` transitively imports (forward BFS).
   *
   * @param filePath - Absolute path of the starting file.
   * @param project - Project name. Defaults to the primary project.
   * @returns An array of file paths that `filePath` directly or indirectly imports,
   *   or `Err<GildashError>` with `type='closed'` / `type='search'`.
   */
  async getTransitiveDependencies(filePath: string, project?: string): Promise<Result<string[], GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const g = this.getOrBuildGraph(project);
      return g.getTransitiveDependencies(filePath);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getTransitiveDependencies failed', e));
    }
  }

  /**
   * Return all cycle paths in the import graph.
   *
   * Tarjan SCC + Johnson's circuits — 모든 elementary circuit 보장.
   * 단순한 사이클 유무(`hasCycle`)와 달리 중복 없는 정규화된 경로 전체를 반환합니다.
   * `maxCycles` 옵션으로 반환 개수를 제한할 수 있습니다.
   *
   * @param project - Project name. Defaults to the primary project.
   * @param options.maxCycles - Maximum number of cycles to return. Defaults to no limit.
   * @returns An array of cycle paths (`string[][]`), each path starting at the
   *   lexicographically smallest node (canonical rotation). Returns `[]` if no cycles exist.
   *   Returns `Err<GildashError>` with `type='closed'` (instance closed) or `type='search'` (graph error).
   */
  async getCyclePaths(project?: string, options?: { maxCycles?: number }): Promise<Result<string[][], GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const g = this.getOrBuildGraph(project);
      return g.getCyclePaths(options);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getCyclePaths failed', e));
    }
  }

  /**
   * Retrieve full details for a named symbol in a specific file,
   * including members, documentation, and type information.
   *
   * @param symbolName - Exact symbol name to look up.
   * @param filePath   - Absolute path of the file containing the symbol.
   * @param project    - Project scope override (defaults to `defaultProject`).
   * @returns A {@link FullSymbol} on success, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the symbol is not found or the query fails.
   */
  getFullSymbol(
    symbolName: string,
    filePath: string,
    project?: string,
  ): Result<FullSymbol, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const effectiveProject = project ?? this.defaultProject;
      const results = this.symbolSearchFn({
        symbolRepo: this.symbolRepo,
        project: effectiveProject,
        query: { text: symbolName, exact: true, filePath, limit: 1 },
      });
      if (results.length === 0) {
        return err(gildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`));
      }
      const sym = results[0]!;
      const d = sym.detail;
      const full: FullSymbol = {
        ...sym,
        members: Array.isArray(d.members) ? (d.members as FullSymbol['members']) : undefined,
        jsDoc: typeof d.jsDoc === 'string' ? d.jsDoc : undefined,
        parameters: typeof d.parameters === 'string' ? d.parameters : undefined,
        returnType: typeof d.returnType === 'string' ? d.returnType : undefined,
        heritage: Array.isArray(d.heritage) ? (d.heritage as string[]) : undefined,
        decorators: Array.isArray(d.decorators) ? (d.decorators as FullSymbol['decorators']) : undefined,
        typeParameters: typeof d.typeParameters === 'string' ? d.typeParameters : undefined,
      };
      if (this.semanticLayer) {
        try {
          const pos = this.semanticLayer.lineColumnToPosition(
            filePath, sym.span.start.line, sym.span.start.column,
          );
          if (pos !== null) {
            const resolvedType = this.semanticLayer.collectTypeAt(filePath, pos);
            if (resolvedType) {
              full.resolvedType = resolvedType;
            }
          }
        } catch {
          // semantic enrichment is best-effort — don't fail the whole call
        }
      }
      return full;
    } catch (e) {
      return err(gildashError('search', 'Gildash: getFullSymbol failed', e));
    }
  }

  /**
   * Retrieve statistics for an indexed file (line count, symbol count, etc.).
   *
   * @param filePath - Absolute path of the file to query.
   * @param project  - Project scope override (defaults to `defaultProject`).
   * @returns A {@link FileStats} on success, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the file is not in the index,
   *   `type='store'` if the query throws.
   */
  getFileStats(
    filePath: string,
    project?: string,
  ): Result<FileStats, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const effectiveProject = project ?? this.defaultProject;
      const fileRecord = this.fileRepo.getFile(effectiveProject, filePath);
      if (!fileRecord) {
        return err(gildashError('search', `Gildash: file '${filePath}' is not in the index`));
      }
      const symbols = this.symbolRepo.getFileSymbols(effectiveProject, filePath);
      const relations = this.relationRepo.getOutgoing(effectiveProject, filePath);
      return {
        filePath: fileRecord.filePath,
        lineCount: fileRecord.lineCount ?? 0,
        size: fileRecord.size,
        symbolCount: symbols.length,
        exportedSymbolCount: symbols.filter((s) => s.isExported).length,
        relationCount: relations.length,
      };
    } catch (e) {
      return err(gildashError('store', 'Gildash: getFileStats failed', e));
    }
  }

  /**
   * Compute import-graph fan metrics (fan-in / fan-out) for a single file.
   *
   * Builds a full {@link DependencyGraph} each call (O(relations)).
   * For repeated calls, consider caching the graph externally.
   *
   * @param filePath - Absolute path of the file to query.
   * @param project  - Project scope override (defaults to `defaultProject`).
   * @returns A {@link FanMetrics} on success, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the graph build fails.
   */
  async getFanMetrics(
    filePath: string,
    project?: string,
  ): Promise<Result<FanMetrics, GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const g = this.getOrBuildGraph(project);
      return {
        filePath,
        fanIn: g.getDependents(filePath).length,
        fanOut: g.getDependencies(filePath).length,
      };
    } catch (e) {
      return err(gildashError('search', 'Gildash: getFanMetrics failed', e));
    }
  }

  /**
   * Resolve the original definition location of a symbol by following its re-export chain.
   *
   * Traverses `re-exports` relations iteratively until no further hop is found or a
   * circular chain is detected.
   *
   * @param symbolName - The exported name to resolve.
   * @param filePath   - The file from which the symbol is exported.
   * @param project    - Project scope override (defaults to `defaultProject`).
   * @returns A {@link ResolvedSymbol} on success, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if a circular re-export chain is detected.
   */
  resolveSymbol(
    symbolName: string,
    filePath: string,
    project?: string,
  ): Result<ResolvedSymbol, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    const effectiveProject = project ?? this.defaultProject;
    const visited = new Set<string>();
    const chain: Array<{ filePath: string; exportedAs: string }> = [];

    let currentName = symbolName;
    let currentFile = filePath;

    for (;;) {
      const key = `${currentFile}::${currentName}`;
      if (visited.has(key)) {
        return err(gildashError('search', 'Gildash: resolveSymbol detected circular re-export chain'));
      }
      visited.add(key);

      const rels = this.relationSearchFn({
        relationRepo: this.relationRepo,
        project: effectiveProject,
        query: { type: 're-exports', srcFilePath: currentFile, limit: 500 },
      }) as CodeRelation[];

      let nextFile: string | undefined;
      let nextName: string | undefined;

      for (const rel of rels) {
        let specifiers: Array<{ local: string; exported: string }> | undefined;
        if (rel.metaJson) {
          try {
            const meta = JSON.parse(rel.metaJson) as Record<string, unknown>;
            if (Array.isArray(meta['specifiers'])) {
              specifiers = meta['specifiers'] as Array<{ local: string; exported: string }>;
            }
          } catch { /* ignore malformed metaJson */ }
        }
        if (!specifiers) continue;
        const match = specifiers.find((s) => s.exported === currentName);
        if (!match) continue;
        nextFile = rel.dstFilePath;
        nextName = match.local;
        break;
      }

      if (!nextFile || !nextName) {
        return { originalName: currentName, originalFilePath: currentFile, reExportChain: chain };
      }

      chain.push({ filePath: currentFile, exportedAs: currentName });
      currentFile = nextFile;
      currentName = nextName;
    }
  }

  /**
   * Search for an AST structural pattern across indexed TypeScript files.
   *
   * Uses ast-grep's `findInFiles` under the hood. Provide `opts.filePaths` to
   * limit search scope; otherwise all files tracked by the project index are searched.
   *
   * @param pattern   - ast-grep structural pattern (e.g. `'console.log($$$)'`).
   * @param opts      - Optional scope: file paths and/or project override.
   * @returns An array of {@link PatternMatch} on success, or `Err<GildashError>` with
   *   `type='closed'` if the instance is closed,
   *   `type='search'` if the underlying search fails.
   */
  async findPattern(
    pattern: string,
    opts?: { filePaths?: string[]; project?: string },
  ): Promise<Result<PatternMatch[], GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const effectiveProject = opts?.project ?? this.defaultProject;
      const filePaths: string[] = opts?.filePaths
        ? opts.filePaths
        : this.fileRepo.getAllFiles(effectiveProject).map((f) => f.filePath);

      return await this.patternSearchFn({ pattern, filePaths });
    } catch (e) {
      return err(gildashError('search', 'Gildash: findPattern failed', e));
    }
  }

  /**
   * Index the TypeScript type declarations (`.d.ts` files) of one or more
   * `node_modules` packages.
   *
   * Each package is indexed under a dedicated `@external/<packageName>` project
   * so it does not pollute the main project index. Subsequent calls re-index
   * (incremental diff) the same package.
   *
   * @param packages - Package names as they appear in `node_modules/`
   *   (e.g. `['react', 'typescript']`).
   * @param opts     - Optional overrides (unused currently, reserved for future use).
   * @returns An array of {@link IndexResult} — one per package — on success,
   *   or `Err<GildashError>` with:
   *   - `type='closed'` if the instance is closed or in reader mode,
   *   - `type='validation'` if a requested package is not found in `node_modules/`,
   *   - `type='store'` if indexing fails at runtime.
   */
  async indexExternalPackages(
    packages: string[],
    opts?: { project?: string },
  ): Promise<Result<IndexResult[], GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    if (this.role !== 'owner') {
      return err(gildashError('closed', 'Gildash: indexExternalPackages() is not available for readers'));
    }
    try {
      const results: IndexResult[] = [];
      for (const packageName of packages) {
        const packageDir = path.resolve(this.projectRoot, 'node_modules', packageName);
        if (!this.existsSyncFn(packageDir)) {
          return err(gildashError('validation', `Gildash: package not found in node_modules: ${packageName}`));
        }
        const project = `@external/${packageName}`;
        const coordinator = this.makeExternalCoordinatorFn
          ? this.makeExternalCoordinatorFn(packageDir, project)
          : new IndexCoordinator({
              projectRoot: packageDir,
              boundaries: [{ dir: '.', project }],
              extensions: ['.d.ts'],
              ignorePatterns: [],
              dbConnection: this.db,
              parseCache: this.parseCache,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              fileRepo: this.fileRepo as any,
              symbolRepo: this.symbolRepo,
              relationRepo: this.relationRepo,
              logger: this.logger,
            });
        const result = await coordinator.fullIndex();
        results.push(result);
      }
      return results;
    } catch (e) {
      return err(gildashError('store', 'Gildash: indexExternalPackages failed', e));
    }
  }

  /**
   * Parse multiple files concurrently and return a map of results.
   *
   * Files that fail to read or parse are silently excluded from the result map.
   * The operation does not fail even if every file fails — it returns an empty `Map`.
   *
   * @param filePaths - Absolute paths of files to parse.
   * @param options - Optional oxc-parser {@link ParserOptions} (e.g. `sourceType`, `lang`).
   * @returns A `Map<filePath, ParsedFile>` for every successfully-parsed file,
   *   or `Err<GildashError>` with `type='closed'` if the instance is closed.
   */
  async batchParse(filePaths: string[], options?: ParserOptions): Promise<Result<Map<string, ParsedFile>, GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    const result = new Map<string, ParsedFile>();
    await Promise.all(
      filePaths.map(async (fp) => {
        try {
          const text = await this.readFileFn(fp);
          const parsed = this.parseSourceFn(fp, text, options);
          if (!isErr(parsed)) {
            result.set(fp, parsed as ParsedFile);
          }
        } catch {
          // silently exclude failed files
        }
      }),
    );
    return result;
  }

  /**
   * Return the public interface of a module: all exported symbols with key metadata.
   *
   * @param filePath - Absolute path of the file.
   * @param project - Project name. Defaults to the primary project.
   * @returns A {@link ModuleInterface} object, or `Err<GildashError>` with
   *   `type='closed'` / `type='search'`.
   */
  getModuleInterface(filePath: string, project?: string): Result<ModuleInterface, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const symbols = this.symbolSearchFn({
        symbolRepo: this.symbolRepo,
        project: project ?? this.defaultProject,
        query: { filePath, isExported: true },
      }) as SymbolSearchResult[];
      const exports = symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        parameters: (s.detail.parameters as string | undefined) ?? undefined,
        returnType: (s.detail.returnType as string | undefined) ?? undefined,
        jsDoc: (s.detail.jsDoc as string | undefined) ?? undefined,
      }));
      return { filePath, exports };
    } catch (e) {
      return err(gildashError('search', 'Gildash: getModuleInterface failed', e));
    }
  }

  /**
   * Recursively traverse `extends`/`implements` relations to build a heritage tree.
   *
   * The root node represents `symbolName`/`filePath`. Its `children` are the symbols
   * it extends or implements, and so on transitively. A visited set prevents cycles.
   *
   * @param symbolName - Name of the starting symbol.
   * @param filePath - Absolute path of the file containing the symbol.
   * @param project - Project name. Defaults to the primary project.
   * @returns A {@link HeritageNode} tree, or `Err<GildashError>` with
   *   `type='closed'` / `type='search'`.
   */
  async getHeritageChain(
    symbolName: string,
    filePath: string,
    project?: string,
  ): Promise<Result<HeritageNode, GildashError>> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      const proj = project ?? this.defaultProject;
      const visited = new Set<string>();

      const buildNode = (symName: string, fp: string, kind?: 'extends' | 'implements'): HeritageNode => {
        const key = `${symName}::${fp}`;
        if (visited.has(key)) {
          return { symbolName: symName, filePath: fp, kind, children: [] };
        }
        visited.add(key);

        const rels = this.relationSearchFn({
          relationRepo: this.relationRepo,
          project: proj,
          query: { srcFilePath: fp, srcSymbolName: symName, limit: 1000 },
        }) as CodeRelation[];

        const heritageRels = rels.filter(
          (r): r is CodeRelation & { type: 'extends' | 'implements' } =>
            r.type === 'extends' || r.type === 'implements',
        );

        const children = heritageRels
          .filter((r) => r.dstSymbolName != null)
          .map((r) => buildNode(r.dstSymbolName!, r.dstFilePath, r.type));

        return { symbolName: symName, filePath: fp, kind, children };
      };

      return buildNode(symbolName, filePath);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getHeritageChain failed', e));
    }
  }

  /**
   * Retrieve a previously-parsed AST from the internal LRU cache.
   *
   * Returns `undefined` if the file has not been parsed or was evicted from the cache.
   * The returned object is shared with the internal cache — treat it as **read-only**.
   *
   * @param filePath - Absolute path of the file.
   * @returns The cached {@link ParsedFile}, or `undefined` if not available.
   */
  getParsedAst(filePath: string): ParsedFile | undefined {
    if (this.closed) return undefined;
    return this.parseCache.get(filePath);
  }

  /**
   * Retrieve metadata for an indexed file.
   *
   * Returns the stored {@link FileRecord} including content hash, mtime, and size.
   * Returns `null` if the file has not been indexed yet.
   *
   * @param filePath - Relative path from project root (as stored in the index).
   * @param project - Project name. Defaults to the primary project.
   * @returns The {@link FileRecord}, or `null` if not found.
   */
  getFileInfo(filePath: string, project?: string): Result<FileRecord | null, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    try {
      return this.fileRepo.getFile(project ?? this.defaultProject, filePath);
    } catch (e) {
      return err(gildashError('store', 'Gildash: getFileInfo failed', e));
    }
  }

  /**
   * List all symbols declared in a specific file.
   *
   * Convenience wrapper around {@link searchSymbols} with a `filePath` filter.
   *
   * @param filePath - File path to query.
   * @param project - Project name. Defaults to the primary project.
   * @returns An array of {@link SymbolSearchResult} entries, or `Err<GildashError>`.
   */
  getSymbolsByFile(filePath: string, project?: string): Result<SymbolSearchResult[], GildashError> {
    return this.searchSymbols({ filePath, project: project ?? undefined, limit: 10_000 });
  }

  // ─── Semantic Layer APIs ──────────────────────────────────────────────

  /**
   * Look up a symbol's position for semantic queries.
   * Returns `null` when the symbol is not indexed or position cannot be resolved.
   */
  private resolveSymbolPosition(
    symbolName: string,
    filePath: string,
    project?: string,
  ): { sym: SymbolSearchResult; position: number } | null {
    const effectiveProject = project ?? this.defaultProject;
    const results = this.symbolSearchFn({
      symbolRepo: this.symbolRepo,
      project: effectiveProject,
      query: { text: symbolName, exact: true, filePath, limit: 1 },
    });
    if (results.length === 0) return null;
    const sym = results[0]!;
    const position = this.semanticLayer!.lineColumnToPosition(
      filePath,
      sym.span.start.line,
      sym.span.start.column,
    );
    if (position === null) return null;
    return { sym, position };
  }

  /**
   * Retrieve the resolved type of a symbol using the Semantic Layer (tsc TypeChecker).
   *
   * Requires `semantic: true` at {@link Gildash.open} time.
   *
   * @param symbolName - Exact symbol name.
   * @param filePath   - Absolute path of the file containing the symbol.
   * @param project    - Project scope override (defaults to `defaultProject`).
   * @returns A {@link ResolvedType} on success, `null` when the type cannot be resolved,
   *   or `Err<GildashError>` with `type='closed'` / `type='semantic'` / `type='search'`.
   */
  getResolvedType(
    symbolName: string,
    filePath: string,
    project?: string,
  ): Result<ResolvedType | null, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    if (!this.semanticLayer) return err(gildashError('semantic', 'Gildash: semantic layer is not enabled'));
    try {
      const resolved = this.resolveSymbolPosition(symbolName, filePath, project);
      if (!resolved) {
        return err(gildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`));
      }
      return this.semanticLayer.collectTypeAt(filePath, resolved.position);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getResolvedType failed', e));
    }
  }

  /**
   * Find all semantic references to a symbol using the Semantic Layer (tsc findReferences).
   *
   * @param symbolName - Exact symbol name.
   * @param filePath   - Absolute path of the file containing the symbol.
   * @param project    - Project scope override (defaults to `defaultProject`).
   * @returns An array of {@link SemanticReference} entries, or `Err<GildashError>`.
   */
  getSemanticReferences(
    symbolName: string,
    filePath: string,
    project?: string,
  ): Result<SemanticReference[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    if (!this.semanticLayer) return err(gildashError('semantic', 'Gildash: semantic layer is not enabled'));
    try {
      const resolved = this.resolveSymbolPosition(symbolName, filePath, project);
      if (!resolved) {
        return err(gildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`));
      }
      return this.semanticLayer.findReferences(filePath, resolved.position);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getSemanticReferences failed', e));
    }
  }

  /**
   * Find implementations of an interface/abstract class using the Semantic Layer.
   *
   * Includes both explicit (`implements`) and structural (duck-typing) matches.
   *
   * @param symbolName - Exact symbol name.
   * @param filePath   - Absolute path of the file containing the symbol.
   * @param project    - Project scope override (defaults to `defaultProject`).
   * @returns An array of {@link Implementation} entries, or `Err<GildashError>`.
   */
  getImplementations(
    symbolName: string,
    filePath: string,
    project?: string,
  ): Result<Implementation[], GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    if (!this.semanticLayer) return err(gildashError('semantic', 'Gildash: semantic layer is not enabled'));
    try {
      const resolved = this.resolveSymbolPosition(symbolName, filePath, project);
      if (!resolved) {
        return err(gildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`));
      }
      return this.semanticLayer.findImplementations(filePath, resolved.position);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getImplementations failed', e));
    }
  }

  /**
   * Retrieve the semantic module interface — exported symbols with resolved types.
   *
   * @param filePath - Absolute path of the file.
   * @returns A {@link SemanticModuleInterface}, or `Err<GildashError>`.
   */
  getSemanticModuleInterface(
    filePath: string,
  ): Result<SemanticModuleInterface, GildashError> {
    if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
    if (!this.semanticLayer) return err(gildashError('semantic', 'Gildash: semantic layer is not enabled'));
    try {
      return this.semanticLayer.getModuleInterface(filePath);
    } catch (e) {
      return err(gildashError('search', 'Gildash: getSemanticModuleInterface failed', e));
    }
  }
}
