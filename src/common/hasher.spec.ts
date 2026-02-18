import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { hashFile, hashString } from "./hasher";

describe("hashString", () => {
  it("should return 16-char lowercase hex when input is empty string", () => {
    const result = hashString("");

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return same hash when input is same", () => {
    const first = hashString("abc");
    const second = hashString("abc");

    expect(first).toBe(second);
  });

  it("should return different hash when input is different", () => {
    const first = hashString("abc");
    const second = hashString("abd");

    expect(first).not.toBe(second);
  });

  it("should return 16-char lowercase hex when input is long string", () => {
    const result = hashString("a".repeat(10_000));

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return 16-char lowercase hex when input contains unicode characters", () => {
    const result = hashString("안녕하세요 🎉");

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return 16-char lowercase hex when input contains special characters", () => {
    const result = hashString("!@#$%^&*()_+-=[]{}|;':\",./<>?");

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return same hash on repeated calls with same input", () => {
    const results = Array.from({ length: 5 }, () => hashString("idempotent"));

    expect(new Set(results).size).toBe(1);
  });
});

describe("hashFile", () => {
  afterEach(() => {
    spyOn(Bun, "file").mockRestore();
  });

  it("should return same hash as hashString when file content is same", async () => {
    const content = "hash target content";
    spyOn(Bun, "file").mockReturnValue({ text: async () => content } as ReturnType<typeof Bun.file>);

    const fileHash = await hashFile("/fake/file.txt");
    const stringHash = hashString(content);

    expect(fileHash).toBe(stringHash);
  });

  it("should return 16-char lowercase hex when file exists", async () => {
    spyOn(Bun, "file").mockReturnValue({ text: async () => "format check" } as ReturnType<typeof Bun.file>);

    const result = await hashFile("/fake/file.txt");

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return same hash on repeated calls for same file", async () => {
    const content = "idempotent content";
    spyOn(Bun, "file").mockReturnValue({ text: async () => content } as ReturnType<typeof Bun.file>);

    const first = await hashFile("/fake/file.txt");
    const second = await hashFile("/fake/file.txt");

    expect(first).toBe(second);
  });

  it("should throw when file text rejects", async () => {
    spyOn(Bun, "file").mockReturnValue({
      text: async () => { throw new Error("file not found"); },
    } as ReturnType<typeof Bun.file>);

    await expect(hashFile("/nonexistent/path/file.txt")).rejects.toThrow();
  });
});