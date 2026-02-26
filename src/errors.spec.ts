import { describe, expect, it } from "bun:test";
import { GildashError, gildashError } from "./errors";

describe("GildashError", () => {
  it("should be an instance of Error", () => {
    const error = new GildashError("parse", "parse failed");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(GildashError);
  });

  it("should have name set to GildashError", () => {
    const error = new GildashError("store", "store failed");

    expect(error.name).toBe("GildashError");
  });

  it("should have a stack trace", () => {
    const error = new GildashError("search", "search failed");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("GildashError");
  });

  it("should pass cause through Error options", () => {
    const cause = new Error("root cause");
    const error = new GildashError("index", "index failed", { cause });

    expect(error.cause).toBe(cause);
  });

  it("should not have cause when options is omitted", () => {
    const error = new GildashError("closed", "closed");

    expect("cause" in error).toBe(false);
  });

  it("should store type and message", () => {
    const error = new GildashError("validation", "invalid input");

    expect(error.type).toBe("validation");
    expect(error.message).toBe("invalid input");
  });
});

describe("gildashError", () => {
  it("should return object with type and message and no cause property when cause is undefined", () => {
    const result = gildashError("parse", "parse failed");

    expect(result.type).toBe("parse");
    expect(result.message).toBe("parse failed");
    expect("cause" in result).toBe(false);
  });

  it("should include cause in result when cause is an Error instance", () => {
    const cause = new Error("root");
    const result = gildashError("watcher", "watcher failed", cause);

    expect(result.cause).toBe(cause);
  });

  it("should set cause to exact string value when cause is a string", () => {
    const result = gildashError("store", "store failed", "string cause");

    expect(result.cause).toBe("string cause");
  });

  it("should set cause to null when cause is null", () => {
    const result = gildashError("index", "index failed", null);

    expect(result.cause).toBeNull();
  });

  it("should set cause to 0 when cause is numeric zero", () => {
    const result = gildashError("search", "search failed", 0);

    expect(result.cause).toBe(0);
  });

  it("should set cause to false when cause is boolean false", () => {
    const result = gildashError("closed", "closed", false);

    expect(result.cause).toBe(false);
  });

  it("should set cause to empty string when cause is empty string", () => {
    const result = gildashError("validation", "validation failed", "");

    expect(result.cause).toBe("");
  });

  it("should reflect exact type value in returned object when any type variant is used", () => {
    const allTypes = ["watcher", "parse", "extract", "index", "store", "search", "closed", "validation", "close"] as const;

    for (const type of allTypes) {
      const result = gildashError(type, "msg");
      expect(result.type).toBe(type);
    }
  });

  it("should reflect exact message value in returned object when message is provided", () => {
    const result = gildashError("extract", "exact message content");

    expect(result.message).toBe("exact message content");
  });

  it("should handle empty string message and return object with empty message when message is empty string", () => {
    const result = gildashError("index", "");

    expect(result.message).toBe("");
    expect(result.type).toBe("index");
  });

  it("should include empty object as cause when cause is an empty object", () => {
    const cause = {};
    const result = gildashError("store", "failed", cause);

    expect(result.cause).toBe(cause);
  });

  it("should include empty array as cause when cause is an empty array", () => {
    const cause: unknown[] = [];
    const result = gildashError("search", "failed", cause);

    expect(result.cause).toBe(cause);
  });

  it("should return object with no cause property when message is empty and cause is undefined", () => {
    const result = gildashError("close", "");

    expect(result.message).toBe("");
    expect("cause" in result).toBe(false);
  });

  it("should return separate object instances with same shape when called twice with identical arguments", () => {
    const result1 = gildashError("parse", "failed", new Error("root"));
    const result2 = gildashError("parse", "failed", new Error("root"));

    expect(result1).not.toBe(result2);
    expect(result1.type).toBe(result2.type);
    expect(result1.message).toBe(result2.message);
  });

  it("should produce no cause property on both results when called twice with cause undefined", () => {
    const result1 = gildashError("watcher", "w");
    const result2 = gildashError("watcher", "w");

    expect("cause" in result1).toBe(false);
    expect("cause" in result2).toBe(false);
  });
});
