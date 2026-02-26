import type { ParsedFile } from '../parser/types';
import type { ParserOptions } from 'oxc-parser';
import type { ExtractedSymbol, CodeRelation } from '../extractor/types';
import type { IndexResult } from '../indexer/index-coordinator';
import type { ProjectBoundary } from '../common/project-discovery';
import type { SymbolSearchQuery, SymbolSearchResult } from '../search/symbol-search';
import type { RelationSearchQuery } from '../search/relation-search';
import type { SymbolStats } from '../store/repositories/symbol.repository';
import type { FileRecord } from '../store/repositories/file.repository';
import type { PatternMatch } from '../search/pattern-search';
import type { ResolvedType, SemanticReference, Implementation, SemanticModuleInterface } from '../semantic/types';
import type { GildashContext } from './context';
import type {
  Logger,
  GildashOptions,
  SymbolDiff,
  ModuleInterface,
  HeritageNode,
  FullSymbol,
  FileStats,
  FanMetrics,
  ResolvedSymbol,
} from './types';
import type { GildashInternalOptions } from './lifecycle';
import { initializeContext, closeContext } from './lifecycle';
import * as parseApi from './parse-api';
import * as extractApi from './extract-api';
import * as queryApi from './query-api';
import * as graphApi from './graph-api';
import * as semanticApi from './semantic-api';
import * as miscApi from './misc-api';

// ─── Re-exports (public API) ───────────────────────────────────────

export type {
  Logger,
  GildashOptions,
  SymbolDiff,
  ModuleInterface,
  HeritageNode,
  FullSymbol,
  FileStats,
  FanMetrics,
  ResolvedSymbol,
} from './types';
export type { GildashInternalOptions } from './lifecycle';

// ─── Gildash Facade ─────────────────────────────────────────────────

/**
 * Main entry point for gildash.
 *
 * `Gildash` indexes TypeScript source code into a local SQLite database,
 * watches for file changes, and provides search / dependency-graph queries.
 *
 * Every public method either returns a value directly or throws a
 * `GildashError` on failure. Use `try/catch` with `instanceof GildashError`
 * to handle errors.
 *
 * Create an instance with the static {@link Gildash.open} factory.
 * Always call {@link Gildash.close} when done to release resources.
 */
export class Gildash {
  /** Internal state — exposed for advanced testing only. */
  readonly _ctx: GildashContext;

  /** Absolute path to the indexed project root. */
  get projectRoot(): string { return this._ctx.projectRoot; }

  /** Current watcher role: `'owner'` (can reindex) or `'reader'` (read-only). */
  get role(): 'owner' | 'reader' { return this._ctx.role; }

  /** Discovered project boundaries within the project root. */
  get projects(): ProjectBoundary[] { return [...this._ctx.boundaries]; }

  private constructor(ctx: GildashContext) {
    this._ctx = ctx;
  }

  /**
   * Create and initialise a new `Gildash` instance.
   * @throws {GildashError} if initialization fails.
   */
  static async open(options: GildashOptions & GildashInternalOptions): Promise<Gildash> {
    const ctx = await initializeContext(options);
    return new Gildash(ctx);
  }

  /** Shut down the instance and release all resources. */
  async close(opts?: { cleanup?: boolean }): Promise<void> {
    return closeContext(this._ctx, opts);
  }

  // ─── Parse ──────────────────────────────────────────────────────

  parseSource(filePath: string, sourceText: string, options?: ParserOptions): ParsedFile {
    return parseApi.parseSource(this._ctx, filePath, sourceText, options);
  }

  async batchParse(filePaths: string[], options?: ParserOptions): Promise<Map<string, ParsedFile>> {
    return parseApi.batchParse(this._ctx, filePaths, options);
  }

  getParsedAst(filePath: string): ParsedFile | undefined {
    return parseApi.getParsedAst(this._ctx, filePath);
  }

  // ─── Extract ────────────────────────────────────────────────────

  extractSymbols(parsed: ParsedFile): ExtractedSymbol[] {
    return extractApi.extractSymbols(this._ctx, parsed);
  }

  extractRelations(parsed: ParsedFile): CodeRelation[] {
    return extractApi.extractRelations(this._ctx, parsed);
  }

  // ─── Query ──────────────────────────────────────────────────────

  getStats(project?: string): SymbolStats {
    return queryApi.getStats(this._ctx, project);
  }

  searchSymbols(query: SymbolSearchQuery): SymbolSearchResult[] {
    return queryApi.searchSymbols(this._ctx, query);
  }

  searchRelations(query: RelationSearchQuery): CodeRelation[] {
    return queryApi.searchRelations(this._ctx, query);
  }

  searchAllSymbols(query: Omit<SymbolSearchQuery, 'project'> & { project?: string }): SymbolSearchResult[] {
    return queryApi.searchAllSymbols(this._ctx, query);
  }

  searchAllRelations(query: RelationSearchQuery): CodeRelation[] {
    return queryApi.searchAllRelations(this._ctx, query);
  }

  listIndexedFiles(project?: string): FileRecord[] {
    return queryApi.listIndexedFiles(this._ctx, project);
  }

  getInternalRelations(filePath: string, project?: string): CodeRelation[] {
    return queryApi.getInternalRelations(this._ctx, filePath, project);
  }

  getFullSymbol(symbolName: string, filePath: string, project?: string): FullSymbol | null {
    return queryApi.getFullSymbol(this._ctx, symbolName, filePath, project);
  }

  getFileStats(filePath: string, project?: string): FileStats {
    return queryApi.getFileStats(this._ctx, filePath, project);
  }

  getFileInfo(filePath: string, project?: string): FileRecord | null {
    return queryApi.getFileInfo(this._ctx, filePath, project);
  }

  getSymbolsByFile(filePath: string, project?: string): SymbolSearchResult[] {
    return queryApi.getSymbolsByFile(this._ctx, filePath, project);
  }

  getModuleInterface(filePath: string, project?: string): ModuleInterface {
    return queryApi.getModuleInterface(this._ctx, filePath, project);
  }

  // ─── Graph ──────────────────────────────────────────────────────

  getDependencies(filePath: string, project?: string, limit = 10_000): string[] {
    return graphApi.getDependencies(this._ctx, filePath, project, limit);
  }

  getDependents(filePath: string, project?: string, limit = 10_000): string[] {
    return graphApi.getDependents(this._ctx, filePath, project, limit);
  }

  async getAffected(changedFiles: string[], project?: string): Promise<string[]> {
    return graphApi.getAffected(this._ctx, changedFiles, project);
  }

  async hasCycle(project?: string): Promise<boolean> {
    return graphApi.hasCycle(this._ctx, project);
  }

  async getImportGraph(project?: string): Promise<Map<string, string[]>> {
    return graphApi.getImportGraph(this._ctx, project);
  }

  async getTransitiveDependencies(filePath: string, project?: string): Promise<string[]> {
    return graphApi.getTransitiveDependencies(this._ctx, filePath, project);
  }

  async getCyclePaths(project?: string, options?: { maxCycles?: number }): Promise<string[][]> {
    return graphApi.getCyclePaths(this._ctx, project, options);
  }

  async getFanMetrics(filePath: string, project?: string): Promise<FanMetrics> {
    return graphApi.getFanMetrics(this._ctx, filePath, project);
  }

  // ─── Semantic ───────────────────────────────────────────────────

  getResolvedType(symbolName: string, filePath: string, project?: string): ResolvedType | null {
    return semanticApi.getResolvedType(this._ctx, symbolName, filePath, project);
  }

  getSemanticReferences(symbolName: string, filePath: string, project?: string): SemanticReference[] {
    return semanticApi.getSemanticReferences(this._ctx, symbolName, filePath, project);
  }

  getImplementations(symbolName: string, filePath: string, project?: string): Implementation[] {
    return semanticApi.getImplementations(this._ctx, symbolName, filePath, project);
  }

  getSemanticModuleInterface(filePath: string): SemanticModuleInterface {
    return semanticApi.getSemanticModuleInterface(this._ctx, filePath);
  }

  // ─── Misc ───────────────────────────────────────────────────────

  diffSymbols(before: SymbolSearchResult[], after: SymbolSearchResult[]): SymbolDiff {
    return miscApi.diffSymbols(before, after);
  }

  onIndexed(callback: (result: IndexResult) => void): () => void {
    return miscApi.onIndexed(this._ctx, callback);
  }

  async reindex(): Promise<IndexResult> {
    return miscApi.reindex(this._ctx);
  }

  resolveSymbol(symbolName: string, filePath: string, project?: string): ResolvedSymbol {
    return miscApi.resolveSymbol(this._ctx, symbolName, filePath, project);
  }

  async findPattern(pattern: string, opts?: { filePaths?: string[]; project?: string }): Promise<PatternMatch[]> {
    return miscApi.findPattern(this._ctx, pattern, opts);
  }

  async getHeritageChain(symbolName: string, filePath: string, project?: string): Promise<HeritageNode> {
    return miscApi.getHeritageChain(this._ctx, symbolName, filePath, project);
  }
}
