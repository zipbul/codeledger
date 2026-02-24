/**
 * TscProgram unit spec — PRUNE-30 scenarios
 *
 * SUT: TscProgram (src/semantic/tsc-program.ts)
 * Test-First: tsc-program.ts does not exist yet → all tests RED until implementation.
 *
 * DI contract assumed by this spec:
 *   TscProgram.create(tsconfigPath, options?)
 *     options.readConfigFile?(path) → string | undefined  — tsconfig JSON reader
 *     options.resolveNonTrackedFile?(path) → string | undefined  — ts-lib / untracked file reader
 *
 *   instance.notifyFileChanged(filePath, content)  — updates tracked file + bumps version
 *   instance.isDisposed                            — boolean getter
 *   instance.dispose()                             — idempotent
 *   instance.getProgram()                          — throws if disposed
 *   instance.getChecker()                          — throws if disposed
 *   instance.getLanguageService()                  — throws if disposed
 *   instance.__testing__: { host: ts.LanguageServiceHost }
 */

import { describe, expect, it, spyOn } from "bun:test";
import { isErr } from "@zipbul/result";
import type { GildashError } from "../errors";
import { TscProgram } from "./tsc-program";

// ── 공통 픽스처 ──────────────────────────────────────────────────────────────

const TSCONFIG_PATH = "/project/tsconfig.json";

function makeReadConfigFile(json: string): (path: string) => string | undefined {
  return (path) => (path === TSCONFIG_PATH ? json : undefined);
}

const VALID_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    strict: true,
    noEmit: true,
  },
});

const EMPTY_TSCONFIG = "{}";

const FAKE_LIB_CONTENT = "// fake ts lib\nexport {};\n";

function makeResolveNonTracked(files: Record<string, string> = {}): (path: string) => string | undefined {
  return (path) => {
    if (path in files) return files[path];
    if (path.includes("lib.") && path.endsWith(".d.ts")) return FAKE_LIB_CONTENT;
    return undefined;
  };
}

/** Helper: create TscProgram or throw on setup error. */
function createOrThrow(opts?: { readConfigFile?: (p: string) => string | undefined; resolveNonTrackedFile?: (p: string) => string | undefined }): TscProgram {
  const result = TscProgram.create(TSCONFIG_PATH, {
    readConfigFile: opts?.readConfigFile ?? makeReadConfigFile(VALID_TSCONFIG),
    resolveNonTrackedFile: opts?.resolveNonTrackedFile ?? makeResolveNonTracked(),
  });
  if (isErr<GildashError>(result)) throw new Error(`setup failed: ${result.data.message}`);
  return result;
}

// ── TscProgram ───────────────────────────────────────────────────────────────

describe("TscProgram", () => {
  // 1. [HP] valid tsconfig 경로 → TscProgram 생성 성공
  it("should return TscProgram when tsconfig is valid", () => {
    // Arrange & Act
    const result = TscProgram.create(TSCONFIG_PATH, {
      readConfigFile: makeReadConfigFile(VALID_TSCONFIG),
      resolveNonTrackedFile: makeResolveNonTracked(),
    });

    // Assert
    expect(isErr(result)).toBe(false);
  });

  // 2. [HP] tsconfig compilerOptions → getCompilationSettings에 반영
  it("should reflect parsed compilerOptions when tsconfig specifies target and module", () => {
    // Arrange
    const prog = createOrThrow();

    // Act
    const settings = prog.__testing__.host.getCompilationSettings();

    // Assert
    expect(settings.strict).toBe(true);
    expect(settings.noEmit).toBe(true);
  });

  // 3. [HP] 생성 직후 getProgram() → non-null Program
  it("should return non-null program when called after successful create", () => {
    // Arrange
    const prog = createOrThrow();

    // Act
    const program = prog.getProgram();

    // Assert
    expect(program).not.toBeNull();
    expect(program).not.toBeUndefined();
  });

  // 4. [HP] 생성 직후 getChecker() → non-null TypeChecker
  it("should return non-null type checker when called after successful create", () => {
    // Arrange
    const prog = createOrThrow();

    // Act
    const checker = prog.getChecker();

    // Assert
    expect(checker).not.toBeNull();
    expect(checker).not.toBeUndefined();
  });

  // 5. [HP] 생성 직후 getLanguageService() → non-null LanguageService
  it("should return non-null language service when called after successful create", () => {
    // Arrange
    const prog = createOrThrow();

    // Act
    const ls = prog.getLanguageService();

    // Assert
    expect(ls).not.toBeNull();
    expect(ls).not.toBeUndefined();
  });

  // 6. [HP] 새 파일 notifyFileChanged → getScriptVersion "1"
  it("should return version 1 when file is notified for the first time", () => {
    // Arrange
    const prog = createOrThrow();
    const filePath = "/project/src/a.ts";

    // Act
    prog.notifyFileChanged(filePath, "const x = 1;");
    const version = prog.__testing__.host.getScriptVersion(filePath);

    // Assert
    expect(version).toBe("1");
  });

  // 7. [HP] 기존 tracked 파일 notifyFileChanged → version 증가
  it("should increment version when same file is notified multiple times", () => {
    // Arrange
    const prog = createOrThrow();
    const filePath = "/project/src/b.ts";

    // Act
    prog.notifyFileChanged(filePath, "const a = 1;");
    prog.notifyFileChanged(filePath, "const a = 2;");
    prog.notifyFileChanged(filePath, "const a = 3;");
    const version = prog.__testing__.host.getScriptVersion(filePath);

    // Assert
    expect(version).toBe("3");
  });

  // 8. [HP] notifyFileChanged 후 getScriptFileNames → 파일 포함
  it("should include newly tracked file when getScriptFileNames is called after notify", () => {
    // Arrange
    const prog = createOrThrow();
    const filePath = "/project/src/c.ts";

    // Act
    prog.notifyFileChanged(filePath, "export const c = true;");
    const fileNames = prog.__testing__.host.getScriptFileNames();

    // Assert
    expect(fileNames).toContain(filePath);
  });

  // 9. [HP] getScriptSnapshot tracked 파일 → 파일 내용 snapshot
  it("should return snapshot with provided content when file is tracked", () => {
    // Arrange
    const prog = createOrThrow();
    const filePath = "/project/src/d.ts";
    const content = "export const value = 42;";

    // Act
    prog.notifyFileChanged(filePath, content);
    const snapshot = prog.__testing__.host.getScriptSnapshot(filePath);

    // Assert
    expect(snapshot).not.toBeUndefined();
    expect(snapshot!.getLength()).toBe(content.length);
    expect(snapshot!.getText(0, content.length)).toBe(content);
  });

  // 10. [HP] getScriptSnapshot ts lib 파일 → resolveNonTrackedFile로 반환
  it("should return snapshot from resolver when file is a ts lib file", () => {
    // Arrange
    const libPath = "/node_modules/typescript/lib/lib.d.ts";
    const libContent = "// lib content";
    const prog = createOrThrow({
      resolveNonTrackedFile: (p) => (p === libPath ? libContent : undefined),
    });

    // Act
    const snapshot = prog.__testing__.host.getScriptSnapshot(libPath);

    // Assert
    expect(snapshot).not.toBeUndefined();
    expect(snapshot!.getText(0, libContent.length)).toBe(libContent);
  });

  // 11. [HP] fileExists tracked 파일 → true
  it("should return true for fileExists when file has been notified", () => {
    // Arrange
    const prog = createOrThrow();
    const filePath = "/project/src/e.ts";
    prog.notifyFileChanged(filePath, "");

    // Act
    const exists = prog.__testing__.host.fileExists!(filePath);

    // Assert
    expect(exists).toBe(true);
  });

  // 12. [HP] fileExists 비tracked 파일 → resolveNonTrackedFile에 위임
  it("should return true for fileExists when resolver provides content for path", () => {
    // Arrange
    const libPath = "/node_modules/typescript/lib/lib.es2022.d.ts";
    const prog = createOrThrow({
      resolveNonTrackedFile: (p) => (p === libPath ? "// lib" : undefined),
    });

    // Act
    const exists = prog.__testing__.host.fileExists!(libPath);

    // Assert
    expect(exists).toBe(true);
  });

  // 13. [HP] readFile tracked 파일 → 내용 문자열
  it("should return file content string when readFile is called for tracked file", () => {
    // Arrange
    const prog = createOrThrow();
    const filePath = "/project/src/f.ts";
    const content = "const z = 'hello';";
    prog.notifyFileChanged(filePath, content);

    // Act
    const read = prog.__testing__.host.readFile!(filePath);

    // Assert
    expect(read).toBe(content);
  });

  // 14. [HP] getCurrentDirectory → tsconfig 파일 디렉토리
  it("should return parent directory of tsconfig when getCurrentDirectory is called", () => {
    // Arrange
    const prog = createOrThrow();

    // Act
    const dir = prog.__testing__.host.getCurrentDirectory();

    // Assert
    expect(dir).toBe("/project");
  });

  // 15. [HP] dispose() → languageService.dispose() 호출 + isDisposed=true
  it("should call language service dispose and set isDisposed true when dispose is called", () => {
    // Arrange
    const prog = createOrThrow();
    const ls = prog.getLanguageService();
    const disposeSpy = spyOn(ls, "dispose");

    // Act
    prog.dispose();

    // Assert
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(prog.isDisposed).toBe(true);

    // Cleanup
    disposeSpy.mockRestore();
  });

  // 16. [NE] 존재하지 않는 tsconfig 경로 → GildashError
  it("should return GildashError when tsconfig file does not exist", () => {
    // Arrange
    const readConfigFile = (_path: string): string | undefined => undefined;

    // Act
    const result = TscProgram.create(TSCONFIG_PATH, { readConfigFile });

    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<GildashError>(result)) {
      expect(result.data.type).toBe("semantic");
    }
  });

  // 17. [NE] JSON 문법 오류 tsconfig → GildashError
  it("should return GildashError when tsconfig contains malformed JSON", () => {
    // Arrange
    const readConfigFile = makeReadConfigFile("{ malformed json!!!");

    // Act
    const result = TscProgram.create(TSCONFIG_PATH, { readConfigFile });

    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<GildashError>(result)) {
      expect(result.data.type).toBe("semantic");
    }
  });

  // 18. [NE] tsconfig parse error (invalid compilerOptions) → GildashError
  it("should return GildashError when tsconfig has invalid compilerOptions values", () => {
    // Arrange
    const readConfigFile = makeReadConfigFile(
      JSON.stringify({ compilerOptions: { target: "NOT_VALID_TARGET_9999" } }),
    );

    // Act
    const result = TscProgram.create(TSCONFIG_PATH, { readConfigFile });

    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<GildashError>(result)) {
      expect(result.data.type).toBe("semantic");
    }
  });

  // 19. [NE] dispose 후 getProgram() → throw
  it("should throw when getProgram is called after dispose", () => {
    // Arrange
    const prog = createOrThrow();
    prog.dispose();

    // Act & Assert
    expect(() => prog.getProgram()).toThrow();
  });

  // 20. [NE] dispose 후 getChecker() → throw
  it("should throw when getChecker is called after dispose", () => {
    // Arrange
    const prog = createOrThrow();
    prog.dispose();

    // Act & Assert
    expect(() => prog.getChecker()).toThrow();
  });

  // 21. [NE] dispose 후 getLanguageService() → throw
  it("should throw when getLanguageService is called after dispose", () => {
    // Arrange
    const prog = createOrThrow();
    prog.dispose();

    // Act & Assert
    expect(() => prog.getLanguageService()).toThrow();
  });

  // 22. [NE] getScriptSnapshot untracked + 존재하지 않는 파일 → undefined
  it("should return undefined when getScriptSnapshot is called for untracked unknown file", () => {
    // Arrange
    const prog = createOrThrow({ resolveNonTrackedFile: () => undefined });

    // Act
    const snapshot = prog.__testing__.host.getScriptSnapshot("/no/such/file.ts");

    // Assert
    expect(snapshot).toBeUndefined();
  });

  // 23. [NE] fileExists 존재하지 않는 파일 → false
  it("should return false for fileExists when file is not tracked and resolver returns undefined", () => {
    // Arrange
    const prog = createOrThrow({ resolveNonTrackedFile: () => undefined });

    // Act
    const exists = prog.__testing__.host.fileExists!("/ghost/file.ts");

    // Assert
    expect(exists).toBe(false);
  });

  // 24. [NE] readFile 존재하지 않는 파일 → undefined (throw 없음)
  it("should return undefined without throwing when readFile is called for unknown file", () => {
    // Arrange
    const prog = createOrThrow({ resolveNonTrackedFile: () => undefined });

    // Act
    const content = prog.__testing__.host.readFile!("/missing.ts");

    // Assert
    expect(content).toBeUndefined();
  });

  // 25. [ED] tsconfig = {} 최소 유효 → create 성공
  it("should create successfully when tsconfig is minimally valid empty object", () => {
    // Arrange & Act
    const result = TscProgram.create(TSCONFIG_PATH, {
      readConfigFile: makeReadConfigFile(EMPTY_TSCONFIG),
    });

    // Assert
    expect(isErr(result)).toBe(false);
  });

  // 26. [ED] 파일 내용 빈 문자열 → getScriptSnapshot 반환, length=0
  it("should return snapshot with length 0 when file content is empty string", () => {
    // Arrange
    const prog = createOrThrow();
    const filePath = "/project/src/empty.ts";

    // Act
    prog.notifyFileChanged(filePath, "");
    const snapshot = prog.__testing__.host.getScriptSnapshot(filePath);

    // Assert
    expect(snapshot).not.toBeUndefined();
    expect(snapshot!.getLength()).toBe(0);
  });

  // 27. [ED] notifyFileChanged 후 getProgram() → Program이 파일 반영
  it("should include notified file in program source files when getProgram is called after notify", () => {
    // Arrange
    const prog = createOrThrow();
    const filePath = "/project/src/new.ts";

    // Act
    prog.notifyFileChanged(filePath, "export const newVal = 1;");
    const program = prog.getProgram();
    const sourceFile = program.getSourceFile(filePath);

    // Assert
    expect(sourceFile).not.toBeUndefined();
  });

  // 28. [ST] create → use → dispose 정상 순서 + 이후 API throw
  it("should throw on all getters when disposed after normal use", () => {
    // Arrange
    const prog = createOrThrow();

    // Act — normal use
    prog.getProgram();
    prog.getChecker();
    prog.getLanguageService();
    prog.notifyFileChanged("/project/src/x.ts", "const x = 1;");
    prog.dispose();

    // Assert — all post-dispose calls throw
    expect(() => prog.getProgram()).toThrow();
    expect(() => prog.getChecker()).toThrow();
    expect(() => prog.getLanguageService()).toThrow();
  });

  // 29. [ST] dispose() 두 번 → no error (멱등)
  it("should not throw when dispose is called a second time", () => {
    // Arrange
    const prog = createOrThrow();
    prog.dispose();

    // Act & Assert
    expect(() => prog.dispose()).not.toThrow();
    expect(prog.isDisposed).toBe(true);
  });

  // 30. [CO] dispose 직후 notifyFileChanged → noop (상태 일관성)
  it("should not throw and maintain disposed state when notifyFileChanged is called after dispose", () => {
    // Arrange
    const prog = createOrThrow();
    prog.dispose();

    // Act
    expect(() => prog.notifyFileChanged("/project/src/late.ts", "const late = 1;")).not.toThrow();

    // Assert
    expect(prog.isDisposed).toBe(true);
  });
});
