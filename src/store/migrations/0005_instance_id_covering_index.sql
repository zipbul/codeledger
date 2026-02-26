ALTER TABLE `watcher_owner` ADD COLUMN `instance_id` text;--> statement-breakpoint
CREATE INDEX `idx_relations_project_type_src` ON `relations` (`project`,`type`,`src_file_path`);