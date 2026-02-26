import { err, type Result } from '@zipbul/result';
import type { ParsedFile } from '../parser/types';
import type { ExtractedSymbol, CodeRelation } from '../extractor/types';
import type { GildashError } from '../errors';
import { gildashError } from '../errors';
import type { GildashContext } from './context';

/** Extract all symbol declarations from a previously parsed file. */
export function extractSymbols(
  ctx: GildashContext,
  parsed: ParsedFile,
): Result<ExtractedSymbol[], GildashError> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  return ctx.extractSymbolsFn(parsed);
}

/** Extract inter-file relationships from a previously parsed file. */
export function extractRelations(
  ctx: GildashContext,
  parsed: ParsedFile,
): Result<CodeRelation[], GildashError> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  return ctx.extractRelationsFn(
    parsed.program,
    parsed.filePath,
    ctx.tsconfigPaths ?? undefined,
  );
}
