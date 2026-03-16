import { eq, and, sql } from 'drizzle-orm';
import { annotations } from '../schema';
import type { DbConnection } from '../connection';

export interface AnnotationRecord {
  id: number;
  project: string;
  filePath: string;
  tag: string;
  value: string;
  source: string;
  symbolName: string | null;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  indexedAt: string;
}

const BATCH_CHUNK_SIZE = 80;

export class AnnotationRepository {
  constructor(private readonly db: DbConnection) {}

  insertBatch(
    project: string,
    filePath: string,
    rows: ReadonlyArray<Omit<AnnotationRecord, 'id'>>,
  ): void {
    if (!rows.length) return;
    const mapped = rows.map((row) => ({
      project,
      filePath,
      tag: row.tag,
      value: row.value,
      source: row.source,
      symbolName: row.symbolName,
      startLine: row.startLine,
      startColumn: row.startColumn,
      endLine: row.endLine,
      endColumn: row.endColumn,
      indexedAt: row.indexedAt,
    }));
    for (let i = 0; i < mapped.length; i += BATCH_CHUNK_SIZE) {
      this.db.drizzleDb.insert(annotations).values(mapped.slice(i, i + BATCH_CHUNK_SIZE)).run();
    }
  }

  deleteFileAnnotations(project: string, filePath: string): void {
    this.db.drizzleDb
      .delete(annotations)
      .where(and(eq(annotations.project, project), eq(annotations.filePath, filePath)))
      .run();
  }

  search(opts: {
    project?: string;
    tag?: string;
    filePath?: string;
    symbolName?: string;
    source?: string;
    ftsQuery?: string;
    limit: number;
  }): AnnotationRecord[] {
    return this.db.drizzleDb
      .select()
      .from(annotations)
      .where(
        and(
          opts.project ? eq(annotations.project, opts.project) : undefined,
          opts.tag ? eq(annotations.tag, opts.tag) : undefined,
          opts.filePath ? eq(annotations.filePath, opts.filePath) : undefined,
          opts.symbolName ? eq(annotations.symbolName, opts.symbolName) : undefined,
          opts.source ? eq(annotations.source, opts.source) : undefined,
          opts.ftsQuery
            ? sql`${annotations.id} IN (SELECT rowid FROM annotations_fts WHERE annotations_fts MATCH ${opts.ftsQuery})`
            : undefined,
        ),
      )
      .limit(opts.limit)
      .all() as AnnotationRecord[];
  }
}
