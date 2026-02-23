import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
  foreignKey,
  check,
} from 'drizzle-orm/sqlite-core';

export const files = sqliteTable(
  'files',
  {
    project: text('project').notNull(),
    filePath: text('file_path').notNull(),
    mtimeMs: real('mtime_ms').notNull(),
    size: integer('size').notNull(),
    contentHash: text('content_hash').notNull(),
    updatedAt: text('updated_at').notNull(),
    lineCount: integer('line_count'),
  },
  (table) => [primaryKey({ columns: [table.project, table.filePath] })],
);

export const symbols = sqliteTable(
  'symbols',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    project: text('project').notNull(),
    filePath: text('file_path').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    startLine: integer('start_line').notNull(),
    startColumn: integer('start_column').notNull(),
    endLine: integer('end_line').notNull(),
    endColumn: integer('end_column').notNull(),
    isExported: integer('is_exported').notNull().default(0),
    signature: text('signature'),
    fingerprint: text('fingerprint'),
    detailJson: text('detail_json'),
    contentHash: text('content_hash').notNull(),
    indexedAt: text('indexed_at').notNull(),
  },
  (table) => [
    index('idx_symbols_project_file').on(table.project, table.filePath),
    index('idx_symbols_project_kind').on(table.project, table.kind),
    index('idx_symbols_project_name').on(table.project, table.name),
    index('idx_symbols_fingerprint').on(table.project, table.fingerprint),
    foreignKey({
      columns: [table.project, table.filePath],
      foreignColumns: [files.project, files.filePath],
    }).onDelete('cascade'),
  ],
);

export const relations = sqliteTable(
  'relations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    project: text('project').notNull(),
    type: text('type').notNull(),
    srcFilePath: text('src_file_path').notNull(),
    srcSymbolName: text('src_symbol_name'),
    dstFilePath: text('dst_file_path').notNull(),
    dstSymbolName: text('dst_symbol_name'),
    metaJson: text('meta_json'),
  },
  (table) => [
    index('idx_relations_src').on(table.project, table.srcFilePath),
    index('idx_relations_dst').on(table.project, table.dstFilePath),
    index('idx_relations_type').on(table.project, table.type),
    foreignKey({
      columns: [table.project, table.srcFilePath],
      foreignColumns: [files.project, files.filePath],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.project, table.dstFilePath],
      foreignColumns: [files.project, files.filePath],
    }).onDelete('cascade'),
  ],
);

export const watcherOwner = sqliteTable(
  'watcher_owner',
  {
    id: integer('id').primaryKey(),
    pid: integer('pid').notNull(),
    startedAt: text('started_at').notNull(),
    heartbeatAt: text('heartbeat_at').notNull(),
  },
  (table) => [check('watcher_owner_singleton', sql`${table.id} = 1`)],
);


