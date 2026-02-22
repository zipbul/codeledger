import { describe, expect, it } from "bun:test";
import {
  GildashError,
  ExtractError,
  IndexError,
  ParseError,
  SearchError,
  StoreError,
  WatcherError,
} from "./errors";

describe("GildashError", () => {
  it("should set name and message when created", () => {
    const sut = new GildashError("failed");

    expect(sut.name).toBe("GildashError");
    expect(sut.message).toBe("failed");
  });

  it("should preserve cause when cause option is provided", () => {
    const cause = new Error("root");
    const sut = new GildashError("failed", { cause });

    expect(sut.cause).toBe(cause);
  });

  it("should set empty string message when empty string is provided", () => {
    const sut = new GildashError("");

    expect(sut.message).toBe("");
  });

  it("should be instance of Error when instantiated", () => {
    const sut = new GildashError("failed");

    expect(sut).toBeInstanceOf(Error);
  });
});

describe("WatcherError", () => {
  it("should have subclass name when instantiated", () => {
    const sut = new WatcherError("watcher failed");

    expect(sut).toBeInstanceOf(GildashError);
    expect(sut.name).toBe("WatcherError");
  });

  it("should preserve message when instantiated", () => {
    const sut = new WatcherError("watcher failed");

    expect(sut.message).toBe("watcher failed");
  });

  it("should preserve cause when cause option is provided", () => {
    const cause = new Error("root");
    const sut = new WatcherError("watcher failed", { cause });

    expect(sut.cause).toBe(cause);
  });
});

describe("ParseError", () => {
  it("should have subclass name when instantiated", () => {
    const sut = new ParseError("parse failed");

    expect(sut).toBeInstanceOf(GildashError);
    expect(sut.name).toBe("ParseError");
  });

  it("should preserve message when instantiated", () => {
    const sut = new ParseError("parse failed");

    expect(sut.message).toBe("parse failed");
  });

  it("should preserve cause when cause option is provided", () => {
    const cause = new Error("root");
    const sut = new ParseError("parse failed", { cause });

    expect(sut.cause).toBe(cause);
  });
});

describe("ExtractError", () => {
  it("should have subclass name when instantiated", () => {
    const sut = new ExtractError("extract failed");

    expect(sut).toBeInstanceOf(GildashError);
    expect(sut.name).toBe("ExtractError");
  });

  it("should preserve message when instantiated", () => {
    const sut = new ExtractError("extract failed");

    expect(sut.message).toBe("extract failed");
  });

  it("should preserve cause when cause option is provided", () => {
    const cause = new Error("root");
    const sut = new ExtractError("extract failed", { cause });

    expect(sut.cause).toBe(cause);
  });
});

describe("IndexError", () => {
  it("should have subclass name when instantiated", () => {
    const sut = new IndexError("index failed");

    expect(sut).toBeInstanceOf(GildashError);
    expect(sut.name).toBe("IndexError");
  });

  it("should preserve message when instantiated", () => {
    const sut = new IndexError("index failed");

    expect(sut.message).toBe("index failed");
  });

  it("should preserve cause when cause option is provided", () => {
    const cause = new Error("root");
    const sut = new IndexError("index failed", { cause });

    expect(sut.cause).toBe(cause);
  });
});

describe("StoreError", () => {
  it("should have subclass name when instantiated", () => {
    const sut = new StoreError("store failed");

    expect(sut).toBeInstanceOf(GildashError);
    expect(sut.name).toBe("StoreError");
  });

  it("should preserve message when instantiated", () => {
    const sut = new StoreError("store failed");

    expect(sut.message).toBe("store failed");
  });

  it("should preserve cause when cause option is provided", () => {
    const cause = new Error("root");
    const sut = new StoreError("store failed", { cause });

    expect(sut.cause).toBe(cause);
  });
});

describe("SearchError", () => {
  it("should have subclass name when instantiated", () => {
    const sut = new SearchError("search failed");

    expect(sut).toBeInstanceOf(GildashError);
    expect(sut.name).toBe("SearchError");
  });

  it("should preserve message when instantiated", () => {
    const sut = new SearchError("search failed");

    expect(sut.message).toBe("search failed");
  });

  it("should preserve cause when cause option is provided", () => {
    const cause = new Error("root");
    const sut = new SearchError("search failed", { cause });

    expect(sut.cause).toBe(cause);
  });
});
