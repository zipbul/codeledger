import { eq, and, sql, count } from 'drizzle-orm';
import { symbols } from '../schema';
import type { DbConnection } from '../connection';
import { toFtsPrefixQuery } from './fts-utils';

export interface SymbolRecord {
  project: string;
  filePath: string;
  kind: string;
  name: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  isExported: number;
  signature: string | null;
  fingerprint: string | null;
  detailJson: string | null;
  contentHash: string;
  indexedAt: string;
  resolvedType?: string | null;
}

export interface SearchOptions {
  kind?: string;
  limit?: number;
}

/**
 * Aggregate symbol statistics for a project.
 *
 * Returned by {@link Gildash.getStats}.
 */
export interface SymbolStats {
  /** Total number of indexed symbols. */
  symbolCount: number;
  /** Total number of indexed source files. */
  fileCount: number;
}

export class SymbolRepository {
  constructor(private readonly db: DbConnection) {}

  replaceFileSymbols(
    project: string,
    filePath: string,
    contentHash: string,
    syms: ReadonlyArray<Partial<SymbolRecord>>,
  ): void {
    this.db.drizzleDb
      .delete(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.filePath, filePath)))
      .run();

    if (!syms.length) return;

    const now = new Date().toISOString();
    for (const sym of syms) {
      this.db.drizzleDb.insert(symbols).values({
        project,
        filePath,
        kind: sym.kind ?? 'unknown',
        name: sym.name ?? '',
        startLine: sym.startLine ?? 0,
        startColumn: sym.startColumn ?? 0,
        endLine: sym.endLine ?? 0,
        endColumn: sym.endColumn ?? 0,
        isExported: sym.isExported ?? 0,
        signature: sym.signature ?? null,
        fingerprint: sym.fingerprint ?? null,
        detailJson: sym.detailJson ?? null,
        contentHash,
        indexedAt: sym.indexedAt ?? now,
        resolvedType: sym.resolvedType ?? null,
      }).run();
    }
  }

  getFileSymbols(project: string, filePath: string): SymbolRecord[] {
    return this.db.drizzleDb
      .select()
      .from(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.filePath, filePath)))
      .all();
  }

  searchByName(project: string, query: string, opts: SearchOptions = {}): SymbolRecord[] {
    const limit = opts.limit ?? 50;
    const ftsQuery = toFtsPrefixQuery(query);

    if (!ftsQuery) return [];

    let builder = this.db.drizzleDb
      .select()
      .from(symbols)
      .where(
        and(
          sql`${symbols.id} IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ${ftsQuery})`,
          eq(symbols.project, project),
          opts.kind ? eq(symbols.kind, opts.kind) : undefined,
        ),
      )
      .orderBy(symbols.name)
      .limit(limit);

    return builder.all();
  }

  searchByKind(project: string, kind: string): SymbolRecord[] {
    return this.db.drizzleDb
      .select()
      .from(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.kind, kind)))
      .orderBy(symbols.name)
      .all();
  }

  getStats(project: string): SymbolStats {
    const row = this.db.drizzleDb
      .select({
        symbolCount: count(),
        fileCount: sql<number>`COUNT(DISTINCT ${symbols.filePath})`,
      })
      .from(symbols)
      .where(eq(symbols.project, project))
      .get();
    return {
      symbolCount: row?.symbolCount ?? 0,
      fileCount: row?.fileCount ?? 0,
    };
  }

  getByFingerprint(project: string, fingerprint: string): SymbolRecord[] {
    return this.db.drizzleDb
      .select()
      .from(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.fingerprint, fingerprint)))
      .all();
  }

  deleteFileSymbols(project: string, filePath: string): void {
    this.db.drizzleDb
      .delete(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.filePath, filePath)))
      .run();
  }

  searchByQuery(opts: {
    ftsQuery?: string;
    exactName?: string;
    kind?: string;
    filePath?: string;
    isExported?: boolean;
    project?: string;
    limit: number;
    decorator?: string;
    regex?: string;
    resolvedType?: string;
  }): (SymbolRecord & { id: number })[] {
    const results = this.db.drizzleDb
      .select()
      .from(symbols)
      .where(
        and(
          opts.ftsQuery
            ? sql`${symbols.id} IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ${opts.ftsQuery})`
            : undefined,
          opts.exactName ? eq(symbols.name, opts.exactName) : undefined,
          opts.project !== undefined ? eq(symbols.project, opts.project) : undefined,
          opts.kind ? eq(symbols.kind, opts.kind) : undefined,
          opts.filePath !== undefined ? eq(symbols.filePath, opts.filePath) : undefined,
          opts.isExported !== undefined
            ? eq(symbols.isExported, opts.isExported ? 1 : 0)
            : undefined,
          opts.decorator
            ? sql`${symbols.id} IN (SELECT s.id FROM symbols s, json_each(s.detail_json, '$.decorators') je WHERE json_extract(je.value, '$.name') = ${opts.decorator})`
            : undefined,
          opts.resolvedType !== undefined ? eq(symbols.resolvedType, opts.resolvedType) : undefined,
          // NOTE: regex is applied as a JS-layer post-filter below; no SQL condition here.
        ),
      )
      .orderBy(symbols.name)
      // Fetch a larger pool when regex filtering is needed, since JS filtering reduces the result set.
      .limit(opts.regex ? Math.max(opts.limit * 50, 5000) : opts.limit)
      .all() as (SymbolRecord & { id: number })[];

    if (!opts.regex) return results;

    // JS-layer regex post-filter (SQL REGEXP UDF not available in all Bun versions)
    try {
      const pattern = new RegExp(opts.regex);
      return results.filter(r => pattern.test(r.name)).slice(0, opts.limit) as (SymbolRecord & { id: number })[];
    } catch {
      return [];
    }
  }
}
