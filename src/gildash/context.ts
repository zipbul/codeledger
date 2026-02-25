import type { Result } from '@zipbul/result';
import type { ParsedFile } from '../parser/types';
import type { ParserOptions, Program } from 'oxc-parser';
import type { ExtractedSymbol, CodeRelation } from '../extractor/types';
import type { DbConnection } from '../store/connection';
import type { FileRepository, FileRecord } from '../store/repositories/file.repository';
import type { SymbolRepository } from '../store/repositories/symbol.repository';
import type { RelationRepository } from '../store/repositories/relation.repository';
import type { ProjectWatcher } from '../watcher/project-watcher';
import type { IndexCoordinator, IndexResult } from '../indexer/index-coordinator';
import type { FileChangeEvent } from '../watcher/types';
import type { WatcherOwnerStore } from '../watcher/ownership';
import type { WatcherRole } from '../watcher/types';
import type { ProjectBoundary } from '../common/project-discovery';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import type { SymbolSearchQuery, SymbolSearchResult, ISymbolRepo } from '../search/symbol-search';
import type { RelationSearchQuery, IRelationRepo } from '../search/relation-search';
import type { PatternMatch } from '../search/pattern-search';
import type { DependencyGraph } from '../search/dependency-graph';
import type { SemanticLayer } from '../semantic/index';
import type { ParseCache } from '../parser/parse-cache';
import type { GildashError } from '../errors';
import type { Logger } from './types';

// ─── Function type aliases ──────────────────────────────────────────

export type ParseSourceFn = (
  filePath: string,
  sourceText: string,
  options?: ParserOptions,
) => Result<ParsedFile, GildashError>;

export type ExtractSymbolsFn = (
  parsed: ParsedFile,
) => ExtractedSymbol[];

export type ExtractRelationsFn = (
  ast: Program,
  filePath: string,
  tsconfigPaths?: TsconfigPaths,
) => CodeRelation[];

export type SymbolSearchFn = (options: {
  symbolRepo: ISymbolRepo;
  project?: string;
  query: SymbolSearchQuery;
}) => SymbolSearchResult[];

export type RelationSearchFn = (options: {
  relationRepo: IRelationRepo;
  project?: string;
  query: RelationSearchQuery;
}) => CodeRelation[];

export type PatternSearchFn = (
  opts: { pattern: string; filePaths: string[] },
) => Promise<PatternMatch[]>;

export type AcquireWatcherRoleFn = (
  db: WatcherOwnerStore,
  pid: number,
  options?: object,
) => WatcherRole | Promise<WatcherRole>;

export type ReleaseWatcherRoleFn = (
  db: WatcherOwnerStore,
  pid: number,
) => void;

export type UpdateHeartbeatFn = (
  db: WatcherOwnerStore,
  pid: number,
) => void;

export type MakeExternalCoordinatorFn = (
  packageDir: string,
  project: string,
) => { fullIndex(): Promise<IndexResult> };

// ─── "Like" types for Pick-based constraints ────────────────────────

export type DbStore = Pick<DbConnection, 'open' | 'close' | 'transaction'> & WatcherOwnerStore;

export type FileRepoLike = Pick<FileRepository, 'upsertFile' | 'getAllFiles' | 'getFilesMap' | 'deleteFile' | 'getFile'>;

export type ParseCacheLike = Pick<ParseCache, 'set' | 'get' | 'invalidate'>;

export type CoordinatorLike = Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
  tsconfigPaths?: Promise<TsconfigPaths | null>;
  handleWatcherEvent?(event: FileChangeEvent): void;
};

export type WatcherLike = Pick<ProjectWatcher, 'start' | 'close'>;

export type SemanticLayerLike = Pick<
  SemanticLayer,
  | 'collectTypeAt'
  | 'collectFileTypes'
  | 'findReferences'
  | 'findImplementations'
  | 'getModuleInterface'
  | 'getSymbolNode'
  | 'notifyFileChanged'
  | 'notifyFileDeleted'
  | 'dispose'
  | 'isDisposed'
  | 'lineColumnToPosition'
  | 'findNamePosition'
>;

// ─── GildashContext ─────────────────────────────────────────────────

/** Internal shared state for all Gildash API modules. */
export interface GildashContext {
  // ─── Immutable config ─────────────────────────────────────────────
  readonly projectRoot: string;
  readonly extensions: string[];
  readonly ignorePatterns: string[];
  readonly logger: Logger;
  readonly defaultProject: string;
  readonly role: 'owner' | 'reader';

  // ─── Stores ───────────────────────────────────────────────────────
  readonly db: DbStore;
  readonly symbolRepo: SymbolRepository;
  readonly relationRepo: RelationRepository;
  readonly fileRepo: FileRepoLike;
  readonly parseCache: ParseCacheLike;

  // ─── DI functions (used at runtime by API methods) ────────────────
  readonly releaseWatcherRoleFn: ReleaseWatcherRoleFn;
  readonly parseSourceFn: ParseSourceFn;
  readonly extractSymbolsFn: ExtractSymbolsFn;
  readonly extractRelationsFn: ExtractRelationsFn;
  readonly symbolSearchFn: SymbolSearchFn;
  readonly relationSearchFn: RelationSearchFn;
  readonly patternSearchFn: PatternSearchFn;
  readonly readFileFn: (filePath: string) => Promise<string>;
  readonly unlinkFn: (filePath: string) => Promise<void>;
  readonly existsSyncFn: (p: string) => boolean;
  readonly makeExternalCoordinatorFn?: MakeExternalCoordinatorFn;

  // ─── Lifecycle DI (for healthcheck / promotion) ───────────────────
  readonly acquireWatcherRoleFn: AcquireWatcherRoleFn;
  readonly updateHeartbeatFn: UpdateHeartbeatFn;
  readonly watcherFactory?: () => WatcherLike;
  readonly coordinatorFactory?: () => CoordinatorLike;

  // ─── Mutable state ────────────────────────────────────────────────
  closed: boolean;
  coordinator: CoordinatorLike | null;
  watcher: WatcherLike | null;
  timer: ReturnType<typeof setInterval> | null;
  signalHandlers: Array<[string, () => void]>;
  tsconfigPaths: TsconfigPaths | null;
  boundaries: ProjectBoundary[];
  onIndexedCallbacks: Set<(result: IndexResult) => void>;
  graphCache: DependencyGraph | null;
  graphCacheKey: string | null;
  semanticLayer: SemanticLayerLike | null;
}
