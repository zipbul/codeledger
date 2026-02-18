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

export type WatcherRole = "owner" | "reader";