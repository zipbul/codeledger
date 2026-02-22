export type FileChangeEventType = "create" | "change" | "delete";

export interface FileChangeEvent {
  eventType: FileChangeEventType;
  filePath: string;
}

export interface WatcherOptions {
  projectRoot: string;
  ignorePatterns?: string[];
  extensions?: string[];
}

/**
 * The role acquired by a {@link Gildash} instance.
 *
 * - `'owner'` — the instance owns the file watcher and can trigger re-indexing.
 * - `'reader'` — the instance shares the database but cannot trigger re-indexing.
 */
export type WatcherRole = "owner" | "reader";
