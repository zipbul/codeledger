/**
 * TscProgram — tsc Program/TypeChecker/LanguageService lifecycle manager.
 *
 * Wraps `ts.createLanguageService()` with a custom `LanguageServiceHost`
 * that tracks file versions in-memory for incremental updates.
 *
 * All I/O is injected via the `TscProgramOptions` DI parameters so that
 * unit tests can run without touching the filesystem.
 */

import ts from "typescript";
import path from "node:path";
import { err, type Result } from "@zipbul/result";
import { gildashError, type GildashError } from "../errors";

// ── DI contracts ─────────────────────────────────────────────────────────────

/**
 * Reads a file at `path` and returns its content, or `undefined` if missing.
 */
export type ReadConfigFileFn = (path: string) => string | undefined;

/**
 * Resolves content for files NOT tracked by the user project
 * (e.g. TypeScript lib declarations on disk).
 * Returns file content or `undefined` if not found.
 */
export type ResolveNonTrackedFileFn = (path: string) => string | undefined;

export interface TscProgramOptions {
  /** Reads tsconfig.json content. Injected for testability. */
  readConfigFile?: ReadConfigFileFn;
  /** Resolves non-tracked files (ts libs, node_modules). Injected for testability. */
  resolveNonTrackedFile?: ResolveNonTrackedFileFn;
}

// ── Default I/O (Bun fs) ────────────────────────────────────────────────────

function defaultReadConfigFile(filePath: string): string | undefined {
  try {
    // Synchronous read — ts.readConfigFile expects sync callback
    const fs = require("node:fs");
    return fs.readFileSync(filePath, "utf-8") as string;
  } catch {
    return undefined;
  }
}

function defaultResolveNonTrackedFile(filePath: string): string | undefined {
  try {
    const fs = require("node:fs");
    return fs.readFileSync(filePath, "utf-8") as string;
  } catch {
    return undefined;
  }
}

// ── TscProgram ──────────────────────────────────────────────────────────────

export class TscProgram {
  #languageService: ts.LanguageService;
  #host: TscLanguageServiceHost;
  #isDisposed = false;

  // ── Testing hook ────────────────────────────────────────────────────────

  /** @internal — exposed for unit test verification only. */
  readonly __testing__: { host: ts.LanguageServiceHost };

  private constructor(languageService: ts.LanguageService, host: TscLanguageServiceHost) {
    this.#languageService = languageService;
    this.#host = host;
    this.__testing__ = { host };
  }

  /**
   * Create a TscProgram from a tsconfig.json path.
   *
   * Parses the config, creates a LanguageServiceHost, and initializes the LanguageService.
   * Returns `Err<GildashError>` on config read/parse failure.
   */
  static create(
    tsconfigPath: string,
    options: TscProgramOptions = {},
  ): Result<TscProgram, GildashError> {
    const readConfigFn = options.readConfigFile ?? defaultReadConfigFile;
    const resolveNonTracked = options.resolveNonTrackedFile ?? defaultResolveNonTrackedFile;

    const projectDir = path.dirname(tsconfigPath);

    // 1. Read tsconfig.json content
    const configContent = readConfigFn(tsconfigPath);
    if (configContent === undefined) {
      return err(gildashError("semantic", `tsconfig not found: ${tsconfigPath}`));
    }

    // 2. Parse JSON via ts.parseJsonText (handles JSONC comments)
    const jsonSourceFile = ts.parseJsonText(tsconfigPath, configContent);

    // parseDiagnostics exists at runtime on every SourceFile but is not in the public typings.
    const parseDiags = (jsonSourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics;
    if (parseDiags && parseDiags.length > 0) {
      const msg = parseDiags
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        .join("; ");
      return err(gildashError("semantic", `tsconfig parse error: ${msg}`));
    }

    // 3. Parse config content into compilerOptions + fileNames
    const parsed = ts.parseJsonSourceFileConfigFileContent(
      jsonSourceFile,
      {
        useCaseSensitiveFileNames: true,
        readDirectory: () => [],
        fileExists: (p) => readConfigFn(p) !== undefined || resolveNonTracked(p) !== undefined,
        readFile: (p) => readConfigFn(p) ?? resolveNonTracked(p),
      },
      projectDir,
    );

    if (parsed.errors.length > 0) {
      // TS18003 "No inputs were found in config file" is expected — files are added
      // dynamically via notifyFileChanged, so the initial program has no source files.
      const fatalErrors = parsed.errors.filter(
        (d) => d.category === ts.DiagnosticCategory.Error && d.code !== 18003,
      );
      if (fatalErrors.length > 0) {
        const msg = fatalErrors
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
          .join("; ");
        return err(gildashError("semantic", `tsconfig compile error: ${msg}`));
      }
    }

    // 4. Create the host + LanguageService
    const host = new TscLanguageServiceHost(
      parsed.fileNames,
      parsed.options,
      projectDir,
      resolveNonTracked,
    );

    const languageService = ts.createLanguageService(host);

    return new TscProgram(languageService, host);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  getProgram(): ts.Program {
    this.#assertNotDisposed();
    const program = this.#languageService.getProgram();
    if (!program) {
      throw new Error("TscProgram: LanguageService returned null Program");
    }
    return program;
  }

  getChecker(): ts.TypeChecker {
    this.#assertNotDisposed();
    return this.getProgram().getTypeChecker();
  }

  getLanguageService(): ts.LanguageService {
    this.#assertNotDisposed();
    return this.#languageService;
  }

  /**
   * Notify that a file's content has changed (or a new file was added).
   * Bumps the internal version so the LanguageService will re-evaluate on next query.
   *
   * No-op if already disposed.
   */
  notifyFileChanged(filePath: string, content: string): void {
    if (this.#isDisposed) return;
    this.#host.updateFile(filePath, content);
  }

  /**
   * Remove a tracked file from the LanguageService host.
   * After removal the file will no longer appear in `getScriptFileNames()`
   * and `getScriptSnapshot()` will return `undefined` for it.
   *
   * No-op if already disposed or the file was never tracked.
   */
  removeFile(filePath: string): void {
    if (this.#isDisposed) return;
    this.#host.removeFile(filePath);
  }

  /**
   * Dispose the LanguageService and release references.
   * Idempotent — safe to call multiple times.
   */
  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    this.#languageService.dispose();
  }

  #assertNotDisposed(): void {
    if (this.#isDisposed) {
      throw new Error("TscProgram is disposed");
    }
  }
}

// ── LanguageServiceHost ─────────────────────────────────────────────────────

class TscLanguageServiceHost implements ts.LanguageServiceHost {
  #rootFileNames: string[];
  #compilerOptions: ts.CompilerOptions;
  #projectDir: string;
  #resolveNonTracked: ResolveNonTrackedFileFn;

  /** tracked file path → { version: number, content: string } */
  #files = new Map<string, { version: number; content: string }>();

  constructor(
    rootFileNames: string[],
    compilerOptions: ts.CompilerOptions,
    projectDir: string,
    resolveNonTracked: ResolveNonTrackedFileFn,
  ) {
    this.#rootFileNames = [...rootFileNames];
    this.#compilerOptions = compilerOptions;
    this.#projectDir = projectDir;
    this.#resolveNonTracked = resolveNonTracked;
  }

  // ── File tracking ───────────────────────────────────────────────────────

  updateFile(filePath: string, content: string): void {
    const existing = this.#files.get(filePath);
    if (existing) {
      existing.version += 1;
      existing.content = content;
    } else {
      this.#files.set(filePath, { version: 1, content });
    }
  }

  removeFile(filePath: string): void {
    this.#files.delete(filePath);
    this.#rootFileNames = this.#rootFileNames.filter((f) => f !== filePath);
  }

  // ── ts.LanguageServiceHost implementation ───────────────────────────────

  getScriptFileNames(): string[] {
    const tracked = [...this.#files.keys()];
    const rootsNotTracked = this.#rootFileNames.filter((f) => !this.#files.has(f));
    return [...rootsNotTracked, ...tracked];
  }

  getScriptVersion(fileName: string): string {
    const entry = this.#files.get(fileName);
    return entry ? String(entry.version) : "0";
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    // 1. Tracked files
    const entry = this.#files.get(fileName);
    if (entry) {
      return ts.ScriptSnapshot.fromString(entry.content);
    }

    // 2. Non-tracked files (ts libs, etc.)
    const content = this.#resolveNonTracked(fileName);
    if (content !== undefined) {
      return ts.ScriptSnapshot.fromString(content);
    }

    return undefined;
  }

  getCurrentDirectory(): string {
    return this.#projectDir;
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.#compilerOptions;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  fileExists(filePath: string): boolean {
    if (this.#files.has(filePath)) return true;
    return this.#resolveNonTracked(filePath) !== undefined;
  }

  readFile(filePath: string): string | undefined {
    const entry = this.#files.get(filePath);
    if (entry) return entry.content;
    return this.#resolveNonTracked(filePath);
  }
}
