import { err, type Result } from '@zipbul/result';
import { parseSync as defaultParseSync } from 'oxc-parser';
import type { ParsedFile } from './types';
import { gildashError, type GildashError } from '../errors';

export function parseSource(
  filePath: string,
  sourceText: string,
  parseSyncFn: typeof defaultParseSync = defaultParseSync,
): Result<ParsedFile, GildashError> {
  try {
    const { program, errors, comments } = parseSyncFn(filePath, sourceText);
    return { filePath, program: program as ParsedFile['program'], errors, comments, sourceText };
  } catch (e) {
    return err(gildashError('parse', `Failed to parse file: ${filePath}`, e));
  }
}
