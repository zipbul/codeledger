import { parseSync as defaultParseSync } from 'oxc-parser';
import type { ParsedFile } from './types';
import { ParseError } from '../errors';

/**
 * Parses TypeScript/JavaScript source text into a ParsedFile.
 * Pure function. No side effects. No caching.
 *
 * @param filePath      - Absolute path to the source file. Required for relative import resolution.
 * @param sourceText    - Raw source text to parse.
 * @param parseSyncFn   - Parser function (DI seam, defaults to oxc-parser parseSync).
 * @returns ParsedFile with AST, errors, comments, and original source text.
 * @throws ParseError if oxc-parser throws internally.
 */
export function parseSource(
  filePath: string,
  sourceText: string,
  parseSyncFn: typeof defaultParseSync = defaultParseSync,
): ParsedFile {
  try {
    const { program, errors, comments } = parseSyncFn(filePath, sourceText);
    return { filePath, program: program as any, errors, comments, sourceText };
  } catch (err) {
    throw new ParseError(`Failed to parse file: ${filePath}`, { cause: err });
  }
}
