import type { SymbolKind } from '../extractor/types';
import type { SymbolRecord } from '../store/repositories/symbol.repository';
import { toFtsPrefixQuery } from '../store/repositories/fts-utils';

/**
 * Filters for {@link symbolSearch}.
 *
 * All fields are optional. Omitted fields impose no constraint.
 */
export interface SymbolSearchQuery {
  /** Full-text search on symbol names (prefix matching). */
  text?: string;
  /** Exact symbol name match. When `true`, `text` is treated as an exact name (not FTS prefix). */
  exact?: boolean;
  /** Restrict to a specific {@link SymbolKind}. */
  kind?: SymbolKind;
  /** Restrict to symbols declared in this file path. */
  filePath?: string;
  /** `true` for exported symbols only, `false` for non-exported only. */
  isExported?: boolean;
  /** Limit results to this project. Defaults to the primary project. */
  project?: string;
  /** Maximum number of results. Defaults to `100`. */
  limit?: number;
}

/**
 * A single result returned by {@link symbolSearch}.
 */
export interface SymbolSearchResult {
  /** Database row id. */
  id: number;
  /** Absolute file path containing the symbol. */
  filePath: string;
  /** Kind of the symbol (function, class, variable, etc.). */
  kind: SymbolKind;
  /** Symbol name. */
  name: string;
  /** Source location span (start/end line and column). */
  span: { start: { line: number; column: number }; end: { line: number; column: number } };
  /** Whether the symbol is exported from its module. */
  isExported: boolean;
  /** Human-readable signature text, if available. */
  signature: string | null;
  /** Content-hash fingerprint for change detection. */
  fingerprint: string | null;
  /** Arbitrary detail fields stored as JSON. */
  detail: Record<string, unknown>;
}

export interface ISymbolRepo {
  searchByQuery(opts: {
    ftsQuery?: string;
    exactName?: string;
    kind?: string;
    filePath?: string;
    isExported?: boolean;
    project?: string;
    limit: number;
  }): (SymbolRecord & { id: number })[];
}

/**
 * Search the symbol index using the given query filters.
 *
 * @param options - Symbol repository, default project, and search query.
 * @returns An array of {@link SymbolSearchResult} entries matching the query.
 */
export function symbolSearch(options: {
  symbolRepo: ISymbolRepo;
  project?: string;
  query: SymbolSearchQuery;
}): SymbolSearchResult[] {
  const { symbolRepo, project, query } = options;
  const effectiveProject = query.project ?? project;
  const limit = query.limit ?? 100;

  const opts: Parameters<ISymbolRepo['searchByQuery']>[0] = {
    kind: query.kind,
    filePath: query.filePath,
    isExported: query.isExported,
    project: effectiveProject,
    limit,
  };

  if (query.text) {
    if (query.exact) {
      opts.exactName = query.text;
    } else {
      const ftsQuery = toFtsPrefixQuery(query.text);
      if (ftsQuery) opts.ftsQuery = ftsQuery;
    }
  }

  const records = symbolRepo.searchByQuery(opts);

  return records.map(r => ({
    id: r.id,
    filePath: r.filePath,
    kind: r.kind as SymbolKind,
    name: r.name,
    span: {
      start: { line: r.startLine, column: r.startColumn },
      end: { line: r.endLine, column: r.endColumn },
    },
    isExported: r.isExported === 1,
    signature: r.signature,
    fingerprint: r.fingerprint,
    detail: r.detailJson ? (() => {
      try { return JSON.parse(r.detailJson!) as Record<string, unknown>; }
      catch { return {}; }
    })() : {},
  }));
}
