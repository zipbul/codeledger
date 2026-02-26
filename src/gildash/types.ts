import type { SymbolSearchResult } from '../search/symbol-search';
import type { SymbolKind } from '../extractor/types';
import type { ResolvedType } from '../semantic/types';

/**
 * Minimal logger interface accepted by {@link Gildash}.
 *
 * Any object with an `error` method (including `console`) satisfies this interface.
 */
export interface Logger {
  /** Log one or more error-level messages. */
  error(...args: unknown[]): void;
}

/**
 * Result of a {@link Gildash.diffSymbols} call.
 */
export interface SymbolDiff {
  /** Symbols present in `after` but not in `before`. */
  added: SymbolSearchResult[];
  /** Symbols present in `before` but not in `after`. */
  removed: SymbolSearchResult[];
  /** Symbols present in both but with a different `fingerprint`. */
  modified: Array<{ before: SymbolSearchResult; after: SymbolSearchResult }>;
}

/**
 * Public interface of a module — its exported symbols with key metadata.
 * Returned by {@link Gildash.getModuleInterface}.
 */
export interface ModuleInterface {
  filePath: string;
  exports: Array<{
    name: string;
    kind: SymbolKind;
    parameters?: string;
    returnType?: string;
    jsDoc?: string;
  }>;
}

/**
 * A node in the heritage chain tree returned by {@link Gildash.getHeritageChain}.
 */
export interface HeritageNode {
  symbolName: string;
  filePath: string;
  /** Relationship kind (`extends` or `implements`). Undefined for the root query node. */
  kind?: 'extends' | 'implements';
  children: HeritageNode[];
}

/**
 * Full symbol detail including members, documentation, and type information.
 * Returned by {@link Gildash.getFullSymbol}.
 */
export interface FullSymbol extends SymbolSearchResult {
  /** Class/interface members (methods, properties, constructors, accessors). */
  members?: Array<{
    name: string;
    kind: string;
    type?: string;
    visibility?: string;
    isStatic?: boolean;
    isReadonly?: boolean;
  }>;
  /** JSDoc comment attached to the symbol. */
  jsDoc?: string;
  /** Stringified parameter list (functions/methods). */
  parameters?: string;
  /** Stringified return type (functions/methods). */
  returnType?: string;
  /** Superclass/interface names (classes/interfaces with heritage). */
  heritage?: string[];
  /** Decorators applied to the symbol. */
  decorators?: Array<{ name: string; arguments?: string }>;
  /** Stringified type parameters (generic symbols). */
  typeParameters?: string;
  /** Resolved type from the Semantic Layer (available when `semantic: true`). */
  resolvedType?: ResolvedType;
}

/**
 * File-level statistics for an indexed file.
 * Returned by {@link Gildash.getFileStats}.
 */
export interface FileStats {
  /** Absolute file path. */
  filePath: string;
  /** Number of lines in the file at the time of last indexing. */
  lineCount: number;
  /** Number of symbols indexed in the file. */
  symbolCount: number;
  /** Number of outgoing relations (imports, calls, etc.) from the file. */
  relationCount: number;
  /** File size in bytes at the time of last indexing. */
  size: number;
  /** Number of exported symbols in the file. */
  exportedSymbolCount: number;
}

/**
 * Import-graph fan metrics for a single file.
 * Returned by {@link Gildash.getFanMetrics}.
 */
export interface FanMetrics {
  /** Absolute file path queried. */
  filePath: string;
  /** Number of files that import this file (fan-in). */
  fanIn: number;
  /** Number of files this file imports (fan-out). */
  fanOut: number;
}

/**
 * Result of following a re-export chain to the original symbol definition.
 */
export interface ResolvedSymbol {
  /** The name of the symbol at the end of the re-export chain (may differ from the queried name due to aliasing). */
  originalName: string;
  /** Absolute path of the file that originally defines the symbol. */
  originalFilePath: string;
  /** Ordered list of re-export hops between the queried file and the original definition. */
  reExportChain: Array<{ filePath: string; exportedAs: string }>;
  /** Whether a circular re-export chain was detected. */
  circular: boolean;
}

/**
 * Options for creating a {@link Gildash} instance via {@link Gildash.open}.
 */
export interface GildashOptions {
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** File extensions to index. Defaults to `['.ts', '.mts', '.cts']`. */
  extensions?: string[];
  /** Glob patterns to ignore during indexing. */
  ignorePatterns?: string[];
  /** Maximum number of parsed ASTs to keep in the LRU cache. Defaults to `500`. */
  parseCacheCapacity?: number;
  /** Logger for error output. Defaults to `console`. */
  logger?: Logger;
  /**
   * When `false`, disables the file watcher and runs in scan-only mode:
   * ownership contention is skipped, heartbeat and signal handlers are not
   * registered, and only the initial `fullIndex()` is performed.
   *
   * Set `cleanup: true` in {@link Gildash.close} to remove the database files
   * after a one-shot scan.
   *
   * @default true
   */
  watchMode?: boolean;
  /**
   * Enable the Semantic Layer (tsc-based type analysis).
   * When `true`, creates a `SemanticLayer` backed by the TypeScript compiler.
   * Requires a `tsconfig.json` in `projectRoot`.
   *
   * @default false
   */
  semantic?: boolean;
}
