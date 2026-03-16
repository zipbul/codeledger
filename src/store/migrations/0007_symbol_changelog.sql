ALTER TABLE `symbols` ADD `structural_fingerprint` text;
--> statement-breakpoint
CREATE TABLE `symbol_changelog` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project` text NOT NULL,
  `change_type` text NOT NULL,
  `symbol_name` text NOT NULL,
  `symbol_kind` text NOT NULL,
  `file_path` text NOT NULL,
  `old_name` text,
  `old_file_path` text,
  `fingerprint` text,
  `changed_at` text NOT NULL,
  `is_full_index` integer NOT NULL DEFAULT 0,
  `index_run_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_changelog_project_changed_at` ON `symbol_changelog`(`project`, `changed_at`);
--> statement-breakpoint
CREATE INDEX `idx_changelog_project_name` ON `symbol_changelog`(`project`, `symbol_name`);
--> statement-breakpoint
CREATE INDEX `idx_changelog_project_run` ON `symbol_changelog`(`project`, `index_run_id`);
