import { describe, expect, it } from "bun:test";
import { toAbsolutePath, toRelativePath } from "./path-utils";

describe("toRelativePath", () => {
  it("should return forward-slash normalized relative path when inside root", () => {
    const result = toRelativePath("/repo", "/repo/src\\main.ts");

    expect(result).toBe("src/main.ts");
  });

  it("should return traversal path when target is outside root", () => {
    const result = toRelativePath("/repo/apps/web", "/repo/shared/types.ts");

    expect(result).toBe("../../shared/types.ts");
  });

  it("should normalize mixed separators while preserving traversal segments", () => {
    const result = toRelativePath("C:/repo", "C:/repo/apps\\web/..\\shared\\a.ts");

    expect(result).toBe("apps/web/../shared/a.ts");
  });

  it("should return empty string when root and target are the same path", () => {
    const result = toRelativePath("/repo", "/repo");

    expect(result).toBe("");
  });

  it("should return same result on repeated calls with same input", () => {
    const first = toRelativePath("/repo", "/repo/src/main.ts");
    const second = toRelativePath("/repo", "/repo/src/main.ts");

    expect(first).toBe(second);
  });
});

describe("toAbsolutePath", () => {
  it("should resolve absolute path when relative path is provided", () => {
    const result = toAbsolutePath("/repo", "src/main.ts");

    expect(result).toBe("/repo/src/main.ts");
  });

  it("should resolve traversal segments when relative path contains dot-dot", () => {
    const result = toAbsolutePath("/repo/apps/web", "../shared/a.ts");

    expect(result).toBe("/repo/apps/shared/a.ts");
  });

  it("should keep absolute input path as absolute result", () => {
    const result = toAbsolutePath("/repo", "/external/file.ts");

    expect(result).toBe("/external/file.ts");
  });

});