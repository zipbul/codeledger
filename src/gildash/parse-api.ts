import { isErr } from '@zipbul/result';
import type { ParsedFile } from '../parser/types';
import type { ParserOptions } from 'oxc-parser';
import { GildashError } from '../errors';
import type { GildashContext } from './context';

/** Parse a TypeScript source string into an AST and cache the result. */
export function parseSource(
  ctx: GildashContext,
  filePath: string,
  sourceText: string,
  options?: ParserOptions,
): ParsedFile {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  const result = ctx.parseSourceFn(filePath, sourceText, options);
  if (isErr(result)) throw result.data;
  ctx.parseCache.set(filePath, result);
  return result;
}

/** Parse multiple files concurrently and return a map of results. */
export async function batchParse(
  ctx: GildashContext,
  filePaths: string[],
  options?: ParserOptions,
): Promise<Map<string, ParsedFile>> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  const result = new Map<string, ParsedFile>();
  await Promise.all(
    filePaths.map(async (fp) => {
      try {
        const text = await ctx.readFileFn(fp);
        const parsed = ctx.parseSourceFn(fp, text, options);
        if (!isErr(parsed)) {
          result.set(fp, parsed as ParsedFile);
        }
      } catch {
        // silently exclude failed files
      }
    }),
  );
  return result;
}

/** Retrieve a previously-parsed AST from the internal LRU cache. */
export function getParsedAst(
  ctx: GildashContext,
  filePath: string,
): ParsedFile | undefined {
  if (ctx.closed) return undefined;
  return ctx.parseCache.get(filePath);
}
