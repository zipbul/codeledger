import { err, isErr, type Result } from '@zipbul/result';
import { Database } from 'bun:sqlite';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { gildashError, type GildashError } from '../errors';
import { DATA_DIR, DB_FILE } from '../constants';
import * as schema from './schema';


export interface DbConnectionOptions {
  projectRoot: string;
}

export class DbConnection {
  private client: Database | null = null;
  private drizzle: BunSQLiteDatabase<typeof schema> | null = null;
  private readonly dbPath: string;
  private txDepth = 0;

  constructor(opts: DbConnectionOptions) {
    this.dbPath = join(opts.projectRoot, DATA_DIR, DB_FILE);
  }

  get drizzleDb(): BunSQLiteDatabase<typeof schema> {
    if (!this.drizzle) throw new Error('Database is not open. Call open() first.');
    return this.drizzle;
  }

  open(): Result<void, GildashError> {
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true });
      this.client = new Database(this.dbPath);

      this.client.run('PRAGMA journal_mode = WAL');
      this.client.run('PRAGMA foreign_keys = OFF'); // disabled during migration; re-enabled below
      this.client.run('PRAGMA busy_timeout = 5000');

      this.drizzle = drizzle(this.client, { schema });

      migrate(this.drizzle, {
        migrationsFolder: join(import.meta.dirname, 'migrations'),
      });

      // Verify FK integrity after migration, then re-enable enforcement.
      const violations = this.client.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        throw new Error(
          `FK integrity violation after migration: ${JSON.stringify(violations.slice(0, 5))}`,
        );
      }
      this.client.run('PRAGMA foreign_keys = ON');

      // bun:sqlite Database.function() is not available in all Bun versions.
      // Regex filtering falls back to JS-layer post-processing when this is absent.
      const clientAny = this.client as unknown as Record<string, unknown>;
      if (typeof clientAny['function'] === 'function') {
        (clientAny['function'] as Function).call(
          this.client,
          'regexp',
          (pattern: string, value: string): number => {
            try {
              return new RegExp(pattern).test(value) ? 1 : 0;
            } catch {
              return 0;
            }
          },
        );
      }
    } catch (e) {
      if (this.isCorruptionError(e) && existsSync(this.dbPath)) {
        this.closeClient();
        unlinkSync(this.dbPath);
        for (const ext of ['-wal', '-shm']) {
          const p = this.dbPath + ext;
          if (existsSync(p)) unlinkSync(p);
        }
        const retryResult = this.open();
        if (isErr(retryResult)) {
          return err(gildashError('store', `Failed to recover database at ${this.dbPath}`, retryResult.data));
        }
        return retryResult;
      }
      return err(gildashError('store', `Failed to open database at ${this.dbPath}`, e));
    }
  }

  close(): void {
    this.closeClient();
    this.drizzle = null;
  }

  transaction<T>(fn: (tx: DbConnection) => T): T {
    const db = this.requireClient();

    if (this.txDepth === 0) {
      this.txDepth++;
      try {
        return db.transaction(() => fn(this))();
      } finally {
        this.txDepth--;
      }
    }

    const sp = `sp_${this.txDepth++}`;
    db.run(`SAVEPOINT "${sp}"`);
    try {
      const result = fn(this);
      db.run(`RELEASE SAVEPOINT "${sp}"`);
      return result;
    } catch (err) {
      db.run(`ROLLBACK TO SAVEPOINT "${sp}"`);
      db.run(`RELEASE SAVEPOINT "${sp}"`);
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  immediateTransaction<T>(fn: () => T): T {
    const db = this.requireClient();
    this.txDepth++;
    db.run('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.run('COMMIT');
      return result;
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  query(sql: string): unknown {
    const row = this.requireClient().prepare(sql).get() as Record<string, unknown> | null;
    if (!row) return null;
    return Object.values(row)[0];
  }

  getTableNames(): string[] {
    const rows = this.requireClient()
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  selectOwner(): { pid: number; heartbeat_at: string; instance_id: string | null } | undefined {
    const row = this.requireClient()
      .prepare('SELECT pid, heartbeat_at, instance_id FROM watcher_owner WHERE id = 1')
      .get() as { pid: number; heartbeat_at: string; instance_id: string | null } | null;
    return row ?? undefined;
  }

  insertOwner(pid: number, instanceId?: string): void {
    const now = new Date().toISOString();
    this.requireClient()
      .prepare('INSERT INTO watcher_owner (id, pid, started_at, heartbeat_at, instance_id) VALUES (1, ?, ?, ?, ?)')
      .run(pid, now, now, instanceId ?? null);
  }

  replaceOwner(pid: number, instanceId?: string): void {
    const now = new Date().toISOString();
    this.requireClient()
      .prepare('INSERT OR REPLACE INTO watcher_owner (id, pid, started_at, heartbeat_at, instance_id) VALUES (1, ?, ?, ?, ?)')
      .run(pid, now, now, instanceId ?? null);
  }

  touchOwner(pid: number): void {
    const now = new Date().toISOString();
    this.requireClient()
      .prepare('UPDATE watcher_owner SET heartbeat_at = ? WHERE id = 1 AND pid = ?')
      .run(now, pid);
  }

  deleteOwner(pid: number): void {
    this.requireClient()
      .prepare('DELETE FROM watcher_owner WHERE id = 1 AND pid = ?')
      .run(pid);
  }

  private requireClient(): Database {
    if (!this.client) throw new Error('Database is not open. Call open() first.');
    return this.client;
  }

  private closeClient(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  private isCorruptionError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return (
      msg.includes('malformed') ||
      msg.includes('corrupt') ||
      msg.includes('not a database') ||
      msg.includes('disk i/o error') ||
      msg.includes('sqlite_corrupt')
    );
  }
}
