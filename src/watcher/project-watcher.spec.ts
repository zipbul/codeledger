import { afterEach, describe, expect, it, mock, spyOn, type Mock } from "bun:test";
import type { AsyncSubscription, SubscribeCallback } from "@parcel/watcher";
import { subscribe as parcelSubscribe } from "@parcel/watcher";
import { ProjectWatcher } from "./project-watcher";
import { isErr } from '@zipbul/result';

type SubscribeOptions = NonNullable<Parameters<typeof parcelSubscribe>[2]>;

function createFakeSubscription(): AsyncSubscription {
  return {
    unsubscribe: async () => {},
  };
}

describe("ProjectWatcher", () => {
  let errorSpy: Mock<typeof console.error> | undefined;

  afterEach(() => {
    errorSpy?.mockRestore();
    errorSpy = undefined;
  });

  it("should map raw update event to change when subscribed event is valid source file", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (
      path: string,
      cb: SubscribeCallback,
      opts?: SubscribeOptions,
    ): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher(
      {
        projectRoot: "/repo",
        extensions: [".ts"],
      },
      subscribe,
    );

    await watcher.start((event) => {
      events.push(event);
    });

    callback?.(null, [{ type: "update", path: "/repo/src/main.ts" }]);

    expect(events).toEqual([{ eventType: "change", filePath: "src/main.ts" }]);
  });

  it("should ignore file outside project root when callback receives outside path", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher(
      {
        projectRoot: "/repo",
        extensions: [".ts"],
      },
      subscribe,
    );

    await watcher.start((event) => {
      events.push(event);
    });

    callback?.(null, [{ type: "create", path: "/other/outside.ts" }]);

    expect(events).toEqual([]);
  });

  it("should close subscription when close is called after start", async () => {
    const unsubscribeFn = mock(async () => {});
    const subscribe = async (): Promise<AsyncSubscription> => ({
      unsubscribe: unsubscribeFn,
    });

    const watcher = new ProjectWatcher(
      {
        projectRoot: "/repo",
      },
      subscribe,
    );

    await watcher.start(() => {});
    await watcher.close();

    expect(unsubscribeFn).toHaveBeenCalledTimes(1);
  });

  it("should map create and delete events when callback receives both types", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [
      { type: "create", path: "/repo/src/new.ts" },
      { type: "delete", path: "/repo/src/old.ts" },
    ]);

    expect(events).toEqual([
      { eventType: "create", filePath: "src/new.ts" },
      { eventType: "delete", filePath: "src/old.ts" },
    ]);
  });

  it("should ignore declaration file when callback receives dts path", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [{ type: "update", path: "/repo/src/types.d.ts" }]);

    expect(events).toEqual([]);
  });

  it("should bypass extension filter when callback receives package json", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [{ type: "update", path: "/repo/apps/web/package.json" }]);

    expect(events).toEqual([{ eventType: "change", filePath: "apps/web/package.json" }]);
  });

  it("should ignore file when extension is not allowed and file is not config", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [{ type: "update", path: "/repo/assets/logo.svg" }]);

    expect(events).toEqual([]);
  });

  it("should return Err with watcher type when subscribe throws during start", async () => {
    const subscribe = async (): Promise<AsyncSubscription> => {
      throw new Error("subscription failed");
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo" }, subscribe);
    const result = await watcher.start(() => {});

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('watcher');
  });

  it("should log watcher callback error when callback receives error as first argument", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start(() => {});

    callback?.(new Error("watch callback failed"), []);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const firstArg = errorSpy.mock.calls[0]?.[0];
    expect(firstArg?.type).toBe('watcher');
  });

  it("should log watcher callback error when onChange throws", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start(() => {
      throw new Error("consumer failed");
    });

    callback?.(null, [{ type: "update", path: "/repo/src/main.ts" }]);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const firstArg = errorSpy.mock.calls[0]?.[0];
    expect(firstArg?.type).toBe('watcher');
  });

  it("should treat extension match as case-insensitive when configured extension is lowercase", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [{ type: "update", path: "/repo/src/MAIN.TS" }]);

    expect(events).toEqual([{ eventType: "change", filePath: "src/MAIN.TS" }]);
  });

  it("should not throw when close is called before start", async () => {
    const watcher = new ProjectWatcher({ projectRoot: "/repo" }, async () => {
      throw new Error("should not be called");
    });

    await expect(watcher.close()).resolves.toBeUndefined();
  });

  it("should return Err with watcher type when unsubscribe throws during close", async () => {
    const subscribe = async (): Promise<AsyncSubscription> => ({
      unsubscribe: async () => {
        throw new Error("unsubscribe failed");
      },
    });

    const watcher = new ProjectWatcher({ projectRoot: "/repo" }, subscribe);
    await watcher.start(() => {});
    const result = await watcher.close();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('watcher');
  });

  it("should pass tsconfig json as config file when callback receives tsconfig path", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [{ type: "update", path: "/repo/tsconfig.json" }]);

    expect(events).toEqual([{ eventType: "change", filePath: "tsconfig.json" }]);
  });

  it("should ignore jsconfig json when callback receives jsconfig path", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [{ type: "update", path: "/repo/jsconfig.json" }]);

    expect(events).toEqual([]);
  });

  it("should include additional ignore patterns when ignorePatterns option is provided on construction", async () => {
    let capturedOptions: SubscribeOptions | undefined;
    const subscribe = async (
      path: string,
      cb: SubscribeCallback,
      opts?: SubscribeOptions,
    ): Promise<AsyncSubscription> => {
      capturedOptions = opts;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher(
      { projectRoot: "/repo", ignorePatterns: ["**/coverage/**"] },
      subscribe,
    );
    await watcher.start(() => {});

    expect(capturedOptions?.ignore).toContain("**/coverage/**");
  });

  it("should pass mts file when default extensions are used", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo" }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [{ type: "create", path: "/repo/src/module.mts" }]);

    expect(events).toEqual([{ eventType: "create", filePath: "src/module.mts" }]);
  });

  it("should deliver batch events in order when callback receives multiple events", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(null, [
      { type: "create", path: "/repo/src/a.ts" },
      { type: "update", path: "/repo/src/b.ts" },
      { type: "delete", path: "/repo/src/c.ts" },
    ]);

    expect(events).toEqual([
      { eventType: "create", filePath: "src/a.ts" },
      { eventType: "change", filePath: "src/b.ts" },
      { eventType: "delete", filePath: "src/c.ts" },
    ]);
  });
});
