import type { FileChangeEvent } from '../watcher/types';
import type { ProjectBoundary } from '../common/project-discovery';
import { resolveFileProject, discoverProjects } from '../common/project-discovery';
import { loadTsconfigPaths, clearTsconfigPathsCache } from '../common/tsconfig-resolver';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import { toAbsolutePath } from '../common/path-utils';
import { hashString } from '../common/hasher';
import { isErr } from '@zipbul/result';
import { parseSource } from '../parser/parse-source';
import type { ParsedFile } from '../parser/types';
import { detectChanges } from './file-indexer';
import { indexFileSymbols } from './symbol-indexer';
import { indexFileRelations } from './relation-indexer';
import type { DbConnection } from '../store/connection';
import type { FileRecord } from '../store/repositories/file.repository';
import type { SymbolRecord } from '../store/repositories/symbol.repository';
import type { RelationRecord } from '../store/repositories/relation.repository';
import type { Logger } from '../gildash';

export const WATCHER_DEBOUNCE_MS = 100;

/**
 * Summary returned after an indexing run completes.
 *
 * Received via {@link Gildash.reindex} and the {@link Gildash.onIndexed} callback.
 */
export interface IndexResult {
  /** Number of files that were (re-)indexed. */
  indexedFiles: number;
  /** Number of files removed from the index. */
  removedFiles: number;
  /** Total symbol count after indexing. */
  totalSymbols: number;
  /** Total relation count after indexing. */
  totalRelations: number;
  /** Wall-clock duration of the indexing run in milliseconds. */
  durationMs: number;
  /** Absolute paths of files that changed and were re-indexed. */
  changedFiles: string[];
  /** Absolute paths of files that were deleted from the index. */
  deletedFiles: string[];
  /** Absolute paths of files that failed to index. */
  failedFiles: string[];
  /**
   * Symbol-level diff compared to the previous index state.
   * On the very first full index (empty DB), all symbols appear in `added`.
   */
  changedSymbols: {
    added: Array<{ name: string; filePath: string; kind: string }>;
    modified: Array<{ name: string; filePath: string; kind: string }>;
    removed: Array<{ name: string; filePath: string; kind: string }>;
  };
}

export interface IndexCoordinatorOptions {
  projectRoot: string;
  boundaries: ProjectBoundary[];
  extensions: string[];
  ignorePatterns: string[];
  dbConnection: { transaction<T>(fn: (tx: DbConnection) => T): T };
  parseCache: {
    set(key: string, value: unknown): void;
    get(key: string): unknown;
    invalidate(key: string): void;
  };
  fileRepo: {
    getFilesMap(project: string): Map<string, FileRecord>;
    getAllFiles(project: string): FileRecord[];
    upsertFile(record: FileRecord): void;
    deleteFile(project: string, filePath: string): void;
  };
  symbolRepo: {
    replaceFileSymbols(project: string, filePath: string, contentHash: string, symbols: ReadonlyArray<Partial<SymbolRecord>>): void;
    getFileSymbols(project: string, filePath: string): SymbolRecord[];
    getByFingerprint(project: string, fingerprint: string): SymbolRecord[];
    deleteFileSymbols(project: string, filePath: string): void;
  };
  relationRepo: {
    replaceFileRelations(project: string, filePath: string, relations: ReadonlyArray<Partial<RelationRecord>>): void;
    retargetRelations(opts: { dstProject: string; oldFile: string; oldSymbol: string | null; newFile: string; newSymbol: string | null; newDstProject?: string }): void;
    deleteFileRelations(project: string, filePath: string): void;
  };
  parseSourceFn?: typeof parseSource;
  discoverProjectsFn?: typeof discoverProjects;
  logger?: Logger;
}

export class IndexCoordinator {
  private readonly opts: IndexCoordinatorOptions;
  private readonly logger: Logger;

  private readonly callbacks = new Set<(result: IndexResult) => void>();

  private indexingLock = false;

  private pendingEvents: FileChangeEvent[] = [];

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private currentIndexing: Promise<IndexResult> | null = null;

  private pendingFullIndex = false;

  private pendingFullIndexWaiters: Array<{ resolve: (r: IndexResult) => void; reject: (e: unknown) => void }> = [];

  private tsconfigPathsRaw: Promise<TsconfigPaths | null>;

  private boundariesRefresh: Promise<void> | null = null;

  constructor(opts: IndexCoordinatorOptions) {
    this.opts = opts;
    this.logger = opts.logger ?? console;
    this.tsconfigPathsRaw = loadTsconfigPaths(opts.projectRoot);
  }

  get tsconfigPaths(): Promise<TsconfigPaths | null> {
    return this.tsconfigPathsRaw;
  }

  fullIndex(): Promise<IndexResult> {
    return this.startIndex(undefined, true);
  }

  incrementalIndex(events?: FileChangeEvent[]): Promise<IndexResult> {
    return this.startIndex(events, false);
  }

  onIndexed(cb: (result: IndexResult) => void): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  handleWatcherEvent(event: FileChangeEvent): void {
    if (event.filePath.endsWith('tsconfig.json')) {
      clearTsconfigPathsCache(this.opts.projectRoot);
      this.tsconfigPathsRaw = loadTsconfigPaths(this.opts.projectRoot);
      this.fullIndex().catch((err) => {
        this.logger.error('[IndexCoordinator] fullIndex failed after tsconfig change:', err);
      });
      return;
    }

    if (event.filePath.endsWith('package.json')) {
      const discover = this.opts.discoverProjectsFn ?? discoverProjects;
      this.boundariesRefresh = discover(this.opts.projectRoot).then((b) => {
        this.opts.boundaries = b;
      });
    }

    this.pendingEvents.push(event);

    if (this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.flushPending();
      }, WATCHER_DEBOUNCE_MS);
    }
  }

  async shutdown(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.currentIndexing) {
      await this.currentIndexing;
    }
  }

  private startIndex(events: FileChangeEvent[] | undefined, useTransaction: boolean): Promise<IndexResult> {
    if (this.indexingLock) {
      if (useTransaction) {
        this.pendingFullIndex = true;
        return new Promise<IndexResult>((resolve, reject) => {
          this.pendingFullIndexWaiters.push({ resolve, reject });
        });
      }
      return this.currentIndexing!;
    }
    this.indexingLock = true;

    const work = this.doIndex(events, useTransaction)
      .then((result) => {
        this.fireCallbacks(result);
        return result;
      })
      .finally(() => {
        this.indexingLock = false;
        this.currentIndexing = null;
        if (this.pendingFullIndex) {
          this.pendingFullIndex = false;
          const waiters = this.pendingFullIndexWaiters.splice(0);
          this.startIndex(undefined, true)
            .then((result) => {
              for (const waiter of waiters) waiter.resolve(result);
            })
            .catch((error) => {
              for (const waiter of waiters) waiter.reject(error);
            });
        } else if (this.pendingEvents.length > 0) {
          const drained = this.pendingEvents.splice(0);
          this.startIndex(drained, false).catch((err) =>
            this.logger.error('[IndexCoordinator] incremental drain error', err),
          );
        }
      });

    this.currentIndexing = work;
    return work;
  }

  private async doIndex(events: FileChangeEvent[] | undefined, useTransaction: boolean): Promise<IndexResult> {
    const start = Date.now();
    const { fileRepo, symbolRepo, relationRepo, dbConnection } = this.opts;

    if (this.boundariesRefresh) {
      await this.boundariesRefresh;
      this.boundariesRefresh = null;
    }

    let changed: Array<{ filePath: string; contentHash: string; mtimeMs: number; size: number }>;
    let deleted: string[];

    if (events !== undefined) {
      changed = events
        .filter((e) => e.eventType === 'create' || e.eventType === 'change')
        .map((e) => ({
          filePath: e.filePath,
          contentHash: '',
          mtimeMs: 0,
          size: 0,
        }));
      deleted = events.filter((e) => e.eventType === 'delete').map((e) => e.filePath);
    } else {
      const existingMap = new Map<string, FileRecord>();
      for (const boundary of this.opts.boundaries) {
        for (const [key, val] of fileRepo.getFilesMap(boundary.project)) {
          existingMap.set(key, val);
        }
      }
      const result = await detectChanges({
        projectRoot: this.opts.projectRoot,
        extensions: this.opts.extensions,
        ignorePatterns: this.opts.ignorePatterns,
        fileRepo: { getFilesMap: () => existingMap },
      });
      changed = result.changed;
      deleted = result.deleted;
    }

    const tsconfigPaths = (await this.tsconfigPathsRaw) ?? undefined;

    const deletedSymbols = new Map<string, SymbolRecord[]>();
    for (const filePath of deleted) {
      const project = resolveFileProject(filePath, this.opts.boundaries);
      const syms = symbolRepo.getFileSymbols(project, filePath);
      deletedSymbols.set(filePath, syms);
    }

    // FR-08: collect before-indexing symbol snapshot for changedSymbols diff
    type SymbolSnap = { name: string; filePath: string; kind: string; fingerprint: string | null };
    const beforeSnapshot = new Map<string, SymbolSnap>();
    const afterSnapshot = new Map<string, SymbolSnap>();

    if (useTransaction) {
      // fullIndex: snapshot all currently-stored symbols before the transaction wipes them
      for (const boundary of this.opts.boundaries) {
        for (const f of fileRepo.getAllFiles(boundary.project)) {
          for (const sym of symbolRepo.getFileSymbols(boundary.project, f.filePath)) {
            beforeSnapshot.set(`${sym.filePath}::${sym.name}`, {
              name: sym.name, filePath: sym.filePath, kind: sym.kind, fingerprint: sym.fingerprint,
            });
          }
        }
      }
    } else {
      // incremental: snapshot symbols in files that are about to change
      for (const file of changed) {
        const project = resolveFileProject(file.filePath, this.opts.boundaries);
        for (const sym of symbolRepo.getFileSymbols(project, file.filePath)) {
          beforeSnapshot.set(`${sym.filePath}::${sym.name}`, {
            name: sym.name, filePath: sym.filePath, kind: sym.kind, fingerprint: sym.fingerprint,
          });
        }
      }
      // also include symbols from files being deleted
      for (const [, syms] of deletedSymbols) {
        for (const sym of syms) {
          beforeSnapshot.set(`${sym.filePath}::${sym.name}`, {
            name: sym.name, filePath: sym.filePath, kind: sym.kind, fingerprint: sym.fingerprint,
          });
        }
      }
    }

    const processDeleted = () => {
      for (const filePath of deleted) {
        const project = resolveFileProject(filePath, this.opts.boundaries);
        symbolRepo.deleteFileSymbols(project, filePath);
        relationRepo.deleteFileRelations(project, filePath);
        fileRepo.deleteFile(project, filePath);
      }
    };

    const processChanged = async (): Promise<{ symbols: number; relations: number; failedFiles: string[] }> => {
      const { projectRoot, boundaries } = this.opts;
      const { parseCache } = this.opts;
      let symbols = 0;
      let relations = 0;
      const failedFiles: string[] = [];

      // ── Pass 1: 모든 변경 파일 read + parse + upsertFile ──
      type Prepared = {
        filePath: string; text: string; contentHash: string;
        parsed: ParsedFile; project: string;
      };
      const prepared: Prepared[] = [];

      for (const file of changed) {
        try {
          const absPath = toAbsolutePath(projectRoot, file.filePath);
          const bunFile = Bun.file(absPath);
          const text = await bunFile.text();
          const contentHash = file.contentHash || hashString(text);
          const project = resolveFileProject(file.filePath, boundaries);

          fileRepo.upsertFile({
            project,
            filePath: file.filePath,
            mtimeMs: bunFile.lastModified,
            size: bunFile.size,
            contentHash,
            updatedAt: new Date().toISOString(),
            lineCount: text.split('\n').length,
          });

          const parseFn = this.opts.parseSourceFn ?? parseSource;
          const parseResult = parseFn(absPath, text);
          if (isErr(parseResult)) throw parseResult.data;
          const parsed = parseResult as ParsedFile;
          prepared.push({ filePath: file.filePath, text, contentHash, parsed, project });
        } catch (e) {
          this.logger.error(`[IndexCoordinator] Failed to prepare ${file.filePath}:`, e);
          failedFiles.push(file.filePath);
        }
      }

      // ── knownFiles 구축 (1회) — Pass 1 완료 후 모든 신규 파일 포함 ──
      const knownFiles = new Set<string>();
      for (const boundary of boundaries) {
        for (const [fp] of fileRepo.getFilesMap(boundary.project)) {
          knownFiles.add(`${boundary.project}::${fp}`);
        }
      }

      // ── Pass 2: index symbols + relations (동기 DB → 트랜잭션으로 보호) ──
      dbConnection.transaction(() => {
        for (const fd of prepared) {
          indexFileSymbols({
            parsed: fd.parsed, project: fd.project,
            filePath: fd.filePath, contentHash: fd.contentHash, symbolRepo,
          });
          relations += indexFileRelations({
            ast: fd.parsed.program, project: fd.project, filePath: fd.filePath,
            relationRepo, projectRoot, tsconfigPaths,
            knownFiles, boundaries,
          });
          parseCache.set(fd.filePath, fd.parsed);
          symbols += symbolRepo.getFileSymbols(fd.project, fd.filePath).length;
        }
      });

      return { symbols, relations, failedFiles };
    };

    let totalSymbols = 0;
    let totalRelations = 0;
    let allFailedFiles: string[] = [];

    if (useTransaction) {
      const { projectRoot, boundaries } = this.opts;
      const { parseCache } = this.opts;
      const prereadResults = await Promise.allSettled(
        changed.map(async (file) => {
          const absPath = toAbsolutePath(projectRoot, file.filePath);
          const bunFile = Bun.file(absPath);
          const text = await bunFile.text();
          const contentHash = file.contentHash || hashString(text);
          return { filePath: file.filePath, text, contentHash, mtimeMs: bunFile.lastModified, size: bunFile.size };
        }),
      );
      const preread = prereadResults
        .filter((r): r is PromiseFulfilledResult<{ filePath: string; text: string; contentHash: string; mtimeMs: number; size: number }> => r.status === 'fulfilled')
        .map((r) => r.value);
      for (const r of prereadResults) {
        if (r.status === 'rejected') {
          this.logger.error('[IndexCoordinator] Failed to pre-read file:', r.reason);
        }
      }

      const parsedCacheEntries: Array<{ filePath: string; parsed: unknown }> = [];

      dbConnection.transaction(() => {
        // Only delete changed files (cascade removes their symbols + relations).
        // Unchanged files are preserved so that FK constraints on
        // relations.dstFilePath remain satisfiable.
        for (const fd of preread) {
          const project = resolveFileProject(fd.filePath, boundaries);
          fileRepo.deleteFile(project, fd.filePath);
        }
        for (const filePath of deleted) {
          const project = resolveFileProject(filePath, boundaries);
          symbolRepo.deleteFileSymbols(project, filePath);
          relationRepo.deleteFileRelations(project, filePath);
          fileRepo.deleteFile(project, filePath);
        }

        // Pass 1: Insert all file records first so that FK constraints on
        // relations.dstFilePath are satisfiable regardless of processing order.
        for (const fd of preread) {
          const project = resolveFileProject(fd.filePath, boundaries);
          fileRepo.upsertFile({
            project,
            filePath: fd.filePath,
            mtimeMs: fd.mtimeMs,
            size: fd.size,
            contentHash: fd.contentHash,
            updatedAt: new Date().toISOString(),
            lineCount: fd.text.split('\n').length,
          });
        }

        // knownFiles Set 구축: Pass 1에서 upsert한 파일 + 기존 파일 모두 포함 (read-your-own-writes)
        const knownFiles = new Set<string>();
        for (const boundary of boundaries) {
          for (const [fp] of fileRepo.getFilesMap(boundary.project)) {
            knownFiles.add(`${boundary.project}::${fp}`);
          }
        }

        // Pass 2: Parse sources and index symbols + relations.
        const parseFn = this.opts.parseSourceFn ?? parseSource;
        for (const fd of preread) {
          const project = resolveFileProject(fd.filePath, boundaries);
          const parseResult = parseFn(toAbsolutePath(projectRoot, fd.filePath), fd.text);
          if (isErr(parseResult)) throw parseResult.data;
          const parsed = parseResult;
          parsedCacheEntries.push({ filePath: fd.filePath, parsed });
          indexFileSymbols({ parsed, project, filePath: fd.filePath, contentHash: fd.contentHash, symbolRepo });
          totalRelations += indexFileRelations({
            ast: parsed.program,
            project,
            filePath: fd.filePath,
            relationRepo,
            projectRoot,
            tsconfigPaths,
            knownFiles,
            boundaries,
          });
          totalSymbols += symbolRepo.getFileSymbols(project, fd.filePath).length;
        }
      });

      for (const entry of parsedCacheEntries) {
        parseCache.set(entry.filePath, entry.parsed);
      }
    } else {
      processDeleted();
      const counts = await processChanged();
      totalSymbols = counts.symbols;
      totalRelations = counts.relations;
      allFailedFiles = counts.failedFiles;
    }

    // FR-08: collect after-indexing symbol snapshot
    for (const file of changed) {
      const project = resolveFileProject(file.filePath, this.opts.boundaries);
      for (const sym of symbolRepo.getFileSymbols(project, file.filePath)) {
        afterSnapshot.set(`${sym.filePath}::${sym.name}`, {
          name: sym.name, filePath: sym.filePath, kind: sym.kind, fingerprint: sym.fingerprint,
        });
      }
    }

    // FR-08: compute symbol-level diff (added / modified / removed)
    const changedSymbols: IndexResult['changedSymbols'] = { added: [], modified: [], removed: [] };
    for (const [key, after] of afterSnapshot) {
      const before = beforeSnapshot.get(key);
      if (!before) {
        changedSymbols.added.push({ name: after.name, filePath: after.filePath, kind: after.kind });
      } else if (before.fingerprint !== after.fingerprint) {
        changedSymbols.modified.push({ name: after.name, filePath: after.filePath, kind: after.kind });
      }
    }
    for (const [key, before] of beforeSnapshot) {
      if (!afterSnapshot.has(key)) {
        changedSymbols.removed.push({ name: before.name, filePath: before.filePath, kind: before.kind });
      }
    }

    if (!useTransaction) {
      for (const [oldFile, syms] of deletedSymbols) {
        for (const sym of syms) {
          if (!sym.fingerprint) continue;
          const oldProject = resolveFileProject(oldFile, this.opts.boundaries);
          const matches = symbolRepo.getByFingerprint(oldProject, sym.fingerprint);
          if (matches.length === 1) {
            const newSym = matches[0]!;
            relationRepo.retargetRelations({
              dstProject: oldProject,
              oldFile,
              oldSymbol: sym.name,
              newFile: newSym.filePath,
              newSymbol: newSym.name,
            });
          }
        }
      }
    }

    return {
      indexedFiles: changed.length,
      removedFiles: deleted.length,
      totalSymbols,
      totalRelations,
      durationMs: Date.now() - start,
      changedFiles: changed.map((f) => f.filePath),
      deletedFiles: [...deleted],
      failedFiles: allFailedFiles,
      changedSymbols,
    };
  }

  private fireCallbacks(result: IndexResult): void {
    for (const cb of this.callbacks) {
      try {
        cb(result);
      } catch (err) {
        this.logger.error('[IndexCoordinator] onIndexed callback threw:', err);
      }
    }
  }

  private flushPending(): void {
    if (this.indexingLock) {
      return;
    }
    if (this.pendingEvents.length > 0) {
      const events = this.pendingEvents.splice(0);
      this.startIndex(events, false).catch((err) =>
        this.logger.error('[IndexCoordinator] flushPending startIndex error:', err),
      );
    }
  }
}
