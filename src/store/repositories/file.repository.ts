import { eq, and } from 'drizzle-orm';
import { files } from '../schema';
import type { DbConnection } from '../connection';

/**
 * Metadata record for an indexed source file.
 *
 * Stored and retrieved by {@link FileRepository}.
 * Exposed via {@link Gildash.getFileInfo}.
 */
export interface FileRecord {
  /** Project name this file belongs to. */
  project: string;
  /** File path relative to the project root. */
  filePath: string;
  /** Last-modified timestamp in milliseconds since epoch. */
  mtimeMs: number;
  /** File size in bytes at the time of indexing. */
  size: number;
  /** SHA-256 content hash of the file at the time of indexing. */
  contentHash: string;
  /** ISO 8601 timestamp of the last index update. */
  updatedAt: string;
  /** Number of lines in the file at the time of indexing. */
  lineCount?: number | null;
}

export class FileRepository {
  constructor(private readonly db: DbConnection) {}

  getFile(project: string, filePath: string): FileRecord | null {
    return this.db.drizzleDb
      .select()
      .from(files)
      .where(and(eq(files.project, project), eq(files.filePath, filePath)))
      .get() ?? null;
  }

  upsertFile(record: FileRecord): void {
    this.db.drizzleDb
      .insert(files)
      .values({
        project: record.project,
        filePath: record.filePath,
        mtimeMs: record.mtimeMs,
        size: record.size,
        contentHash: record.contentHash,
        updatedAt: record.updatedAt,
        lineCount: record.lineCount ?? null,
      })
      .onConflictDoUpdate({
        target: [files.project, files.filePath],
        set: {
          mtimeMs: record.mtimeMs,
          size: record.size,
          contentHash: record.contentHash,
          updatedAt: record.updatedAt,
          lineCount: record.lineCount ?? null,
        },
      })
      .run();
  }

  getAllFiles(project: string): FileRecord[] {
    return this.db.drizzleDb
      .select()
      .from(files)
      .where(eq(files.project, project))
      .all();
  }

  getFilesMap(project: string): Map<string, FileRecord> {
    const rows = this.getAllFiles(project);
    const map = new Map<string, FileRecord>();
    for (const r of rows) map.set(r.filePath, r);
    return map;
  }

  deleteFile(project: string, filePath: string): void {
    this.db.drizzleDb
      .delete(files)
      .where(and(eq(files.project, project), eq(files.filePath, filePath)))
      .run();
  }
}
