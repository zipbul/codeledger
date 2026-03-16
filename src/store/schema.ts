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
    resolvedType: text('resolved_type'),
    structuralFingerprint: text('structural_fingerprint'),
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
    dstProject: text('dst_project').notNull(),
    dstFilePath: text('dst_file_path').notNull(),
    dstSymbolName: text('dst_symbol_name'),
    metaJson: text('meta_json'),
  },
  (table) => [
    index('idx_relations_src').on(table.project, table.srcFilePath),
    index('idx_relations_dst').on(table.dstProject, table.dstFilePath),
    index('idx_relations_type').on(table.project, table.type),
    index('idx_relations_project_type_src').on(table.project, table.type, table.srcFilePath),
    foreignKey({
      columns: [table.project, table.srcFilePath],
      foreignColumns: [files.project, files.filePath],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.dstProject, table.dstFilePath],
      foreignColumns: [files.project, files.filePath],
    }).onDelete('cascade'),
  ],
);

export const annotations = sqliteTable(
  'annotations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    project: text('project').notNull(),
    filePath: text('file_path').notNull(),
    tag: text('tag').notNull(),
    value: text('value').notNull().default(''),
    source: text('source').notNull(),
    symbolName: text('symbol_name'),
    startLine: integer('start_line').notNull(),
    startColumn: integer('start_column').notNull(),
    endLine: integer('end_line').notNull(),
    endColumn: integer('end_column').notNull(),
    indexedAt: text('indexed_at').notNull(),
  },
  (table) => [
    index('idx_annotations_project_file').on(table.project, table.filePath),
    index('idx_annotations_project_tag').on(table.project, table.tag),
    index('idx_annotations_project_symbol').on(table.project, table.symbolName),
    foreignKey({
      columns: [table.project, table.filePath],
      foreignColumns: [files.project, files.filePath],
    }).onDelete('cascade'),
  ],
);

export const symbolChangelog = sqliteTable(
  'symbol_changelog',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    project: text('project').notNull(),
    changeType: text('change_type').notNull(),
    symbolName: text('symbol_name').notNull(),
    symbolKind: text('symbol_kind').notNull(),
    filePath: text('file_path').notNull(),
    oldName: text('old_name'),
    oldFilePath: text('old_file_path'),
    fingerprint: text('fingerprint'),
    changedAt: text('changed_at').notNull(),
    isFullIndex: integer('is_full_index').notNull().default(0),
    indexRunId: text('index_run_id').notNull(),
  },
  (table) => [
    index('idx_changelog_project_changed_at').on(table.project, table.changedAt),
    index('idx_changelog_project_name').on(table.project, table.symbolName),
    index('idx_changelog_project_run').on(table.project, table.indexRunId),
  ],
);

export const watcherOwner = sqliteTable(
  'watcher_owner',
  {
    id: integer('id').primaryKey(),
    pid: integer('pid').notNull(),
    startedAt: text('started_at').notNull(),
    heartbeatAt: text('heartbeat_at').notNull(),
    instanceId: text('instance_id'),
  },
  (table) => [check('watcher_owner_singleton', sql`${table.id} = 1`)],
);


