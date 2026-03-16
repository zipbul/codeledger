import { eq, and, sql, gt, gte } from 'drizzle-orm';
import { symbolChangelog } from '../schema';
import type { DbConnection } from '../connection';

export interface ChangelogRecord {
  id: number;
  project: string;
  changeType: string;
  symbolName: string;
  symbolKind: string;
  filePath: string;
  oldName: string | null;
  oldFilePath: string | null;
  fingerprint: string | null;
  changedAt: string;
  isFullIndex: number;
  indexRunId: string;
}

const BATCH_CHUNK_SIZE = 80;

export class ChangelogRepository {
  constructor(private readonly db: DbConnection) {}

  insertBatch(
    rows: ReadonlyArray<Omit<ChangelogRecord, 'id'>>,
  ): void {
    if (!rows.length) return;
    const mapped = rows.map((row) => ({
      project: row.project,
      changeType: row.changeType,
      symbolName: row.symbolName,
      symbolKind: row.symbolKind,
      filePath: row.filePath,
      oldName: row.oldName,
      oldFilePath: row.oldFilePath,
      fingerprint: row.fingerprint,
      changedAt: row.changedAt,
      isFullIndex: row.isFullIndex,
      indexRunId: row.indexRunId,
    }));
    for (let i = 0; i < mapped.length; i += BATCH_CHUNK_SIZE) {
      this.db.drizzleDb.insert(symbolChangelog).values(mapped.slice(i, i + BATCH_CHUNK_SIZE)).run();
    }
  }

  getSince(opts: {
    project: string;
    since: string;
    symbolName?: string;
    changeTypes?: string[];
    filePath?: string;
    includeFullIndex?: boolean;
    indexRunId?: string;
    afterId?: number;
    limit: number;
  }): ChangelogRecord[] {
    return this.db.drizzleDb
      .select()
      .from(symbolChangelog)
      .where(
        and(
          eq(symbolChangelog.project, opts.project),
          gte(symbolChangelog.changedAt, opts.since),
          opts.symbolName ? eq(symbolChangelog.symbolName, opts.symbolName) : undefined,
          opts.changeTypes?.length
            ? sql`${symbolChangelog.changeType} IN (${sql.join(opts.changeTypes.map(t => sql`${t}`), sql`, `)})`
            : undefined,
          opts.filePath ? eq(symbolChangelog.filePath, opts.filePath) : undefined,
          opts.includeFullIndex ? undefined : eq(symbolChangelog.isFullIndex, 0),
          opts.indexRunId ? eq(symbolChangelog.indexRunId, opts.indexRunId) : undefined,
          opts.afterId ? gt(symbolChangelog.id, opts.afterId) : undefined,
        ),
      )
      .orderBy(symbolChangelog.id)
      .limit(opts.limit)
      .all() as ChangelogRecord[];
  }

  pruneOlderThan(project: string, before: string): number {
    // drizzle-orm bun-sqlite types .run() as void (SQLiteBunSession generic: runResult=void),
    // but at runtime bun:sqlite Statement.run() returns { changes: number }.
    const result: unknown = this.db.drizzleDb
      .delete(symbolChangelog)
      .where(
        and(
          eq(symbolChangelog.project, project),
          sql`${symbolChangelog.changedAt} < ${before}`,
        ),
      )
      .run();
    return (result as { changes: number }).changes;
  }
}
