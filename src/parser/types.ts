import type { Program, Comment, OxcError } from 'oxc-parser';

export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

/**
 * The result of parsing a TypeScript source file with oxc-parser.
 *
 * Returned by {@link Gildash.parseSource} and retrievable from the internal LRU
 * cache via {@link Gildash.getParsedAst}.
 *
 * @remarks
 * The `program` field is an oxc-parser `Program` node.
 * Consumers must add `oxc-parser` as a peer dependency to access the `Program` type.
 *
 * **The returned object is shared with the internal cache — treat it as read-only.**
 * Mutating the AST may cause undefined behaviour in subsequent extraction operations.
 */
export interface ParsedFile {
  /** Absolute path of the parsed file. */
  filePath: string;
  /** Root AST node produced by oxc-parser. */
  program: Program;
  /** Parse errors reported by oxc-parser (non-fatal). */
  errors: readonly OxcError[];
  /** Top-level comments found in the source. */
  comments: readonly Comment[];
  /** Raw source text that was parsed. */
  sourceText: string;
}
