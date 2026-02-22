import { parseSync as defaultParseSync } from 'oxc-parser';
import type { ParsedFile } from './types';
import { ParseError } from '../errors';

export function parseSource(
  filePath: string,
  sourceText: string,
  parseSyncFn: typeof defaultParseSync = defaultParseSync,
): ParsedFile {
  try {
    const { program, errors, comments } = parseSyncFn(filePath, sourceText);
    return { filePath, program: program as ParsedFile['program'], errors, comments, sourceText };
  } catch (err) {
    throw new ParseError(`Failed to parse file: ${filePath}`, { cause: err });
  }
}
