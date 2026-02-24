import { err, type Result } from '@zipbul/result';
import type {
  AsyncSubscription,
  SubscribeCallback,
} from "@parcel/watcher";
import { subscribe as parcelSubscribe } from "@parcel/watcher";

type FileEvent = Parameters<SubscribeCallback>[1][number];
type SubscribeOptions = NonNullable<Parameters<typeof parcelSubscribe>[2]>;
import path from "node:path";
import { gildashError, type GildashError } from "../errors";
import type { FileChangeEvent, FileChangeEventType, WatcherOptions } from "./types";
import type { Logger } from "../gildash";
import { DATA_DIR } from "../constants";

type SubscribeFn = (
  directoryPath: string,
  callback: SubscribeCallback,
  options?: SubscribeOptions,
) => Promise<AsyncSubscription>;

const WATCHER_IGNORE_GLOBS: readonly string[] = [
  "**/.git/**",
  `**/${DATA_DIR}/**`,
  "**/dist/**",
  "**/node_modules/**",
];

const CONFIG_FILE_NAMES = new Set(["package.json", "tsconfig.json"]);

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function mapEventType(type: FileEvent["type"]): FileChangeEventType {
  if (type === "update") {
    return "change";
  }

  if (type === "create") {
    return "create";
  }

  return "delete";
}

export class ProjectWatcher {
  #subscription: AsyncSubscription | undefined;
  #rootPath: string;
  #ignoreGlobs: string[];
  #extensions: Set<string>;
  #subscribe: SubscribeFn;
  #logger: Logger;

  constructor(options: WatcherOptions, subscribeFn: SubscribeFn = parcelSubscribe, logger: Logger = console) {
    this.#rootPath = options.projectRoot;
    this.#ignoreGlobs = [...WATCHER_IGNORE_GLOBS, ...(options.ignorePatterns ?? [])];
    this.#extensions = new Set(
      (options.extensions ?? [".ts", ".mts", ".cts"]).map((ext) =>
        ext.toLowerCase(),
      ),
    );
    this.#subscribe = subscribeFn;
    this.#logger = logger;
  }

  async start(onChange: (event: FileChangeEvent) => void): Promise<Result<void, GildashError>> {
    try {
      this.#subscription = await this.#subscribe(
        this.#rootPath,
        (error, events) => {
          if (error) {
            this.#logger.error(gildashError('watcher', 'Callback error', error));
            return;
          }

          try {
            for (const rawEvent of events) {
              const relativePath = normalizePath(path.relative(this.#rootPath, rawEvent.path));

              if (relativePath.startsWith("..")) {
                continue;
              }

              const baseName = path.basename(relativePath);
              const extension = path.extname(relativePath).toLowerCase();
              const isConfigFile = CONFIG_FILE_NAMES.has(baseName);

              if (!isConfigFile && !this.#extensions.has(extension)) {
                continue;
              }

              if (relativePath.endsWith(".d.ts")) {
                continue;
              }

              onChange({
                eventType: mapEventType(rawEvent.type),
                filePath: relativePath,
              });
            }
          } catch (callbackError) {
            this.#logger.error(gildashError('watcher', 'Callback error', callbackError));
          }
        },
        {
          ignore: this.#ignoreGlobs,
        },
      );
    } catch (error) {
      return err(gildashError('watcher', 'Failed to subscribe watcher', error));
    }
  }

  async close(): Promise<Result<void, GildashError>> {
    if (!this.#subscription) {
      return;
    }

    try {
      await this.#subscription.unsubscribe();
      this.#subscription = undefined;
    } catch (error) {
      return err(gildashError('watcher', 'Failed to close watcher', error));
    }
  }
}
