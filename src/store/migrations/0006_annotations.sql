CREATE TABLE `annotations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project` text NOT NULL,
  `file_path` text NOT NULL,
  `tag` text NOT NULL,
  `value` text NOT NULL DEFAULT '',
  `source` text NOT NULL,
  `symbol_name` text,
  `start_line` integer NOT NULL,
  `start_column` integer NOT NULL,
  `end_line` integer NOT NULL,
  `end_column` integer NOT NULL,
  `indexed_at` text NOT NULL,
  FOREIGN KEY (`project`, `file_path`) REFERENCES `files`(`project`, `file_path`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_annotations_project_file` ON `annotations`(`project`, `file_path`);
--> statement-breakpoint
CREATE INDEX `idx_annotations_project_tag` ON `annotations`(`project`, `tag`);
--> statement-breakpoint
CREATE INDEX `idx_annotations_project_symbol` ON `annotations`(`project`, `symbol_name`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `annotations_fts` USING fts5(`tag`, `value`, content=`annotations`, content_rowid=`id`);
--> statement-breakpoint
CREATE TRIGGER `annotations_ai` AFTER INSERT ON `annotations` BEGIN
  INSERT INTO `annotations_fts`(`rowid`, `tag`, `value`) VALUES (new.`id`, new.`tag`, new.`value`);
END;
--> statement-breakpoint
CREATE TRIGGER `annotations_ad` AFTER DELETE ON `annotations` BEGIN
  INSERT INTO `annotations_fts`(`annotations_fts`, `rowid`, `tag`, `value`) VALUES ('delete', old.`id`, old.`tag`, old.`value`);
END;
--> statement-breakpoint
CREATE TRIGGER `annotations_au` AFTER UPDATE ON `annotations` BEGIN
  INSERT INTO `annotations_fts`(`annotations_fts`, `rowid`, `tag`, `value`) VALUES ('delete', old.`id`, old.`tag`, old.`value`);
  INSERT INTO `annotations_fts`(`rowid`, `tag`, `value`) VALUES (new.`id`, new.`tag`, new.`value`);
END;
