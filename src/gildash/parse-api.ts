import { isErr } from '@zipbul/result';
import type { ParsedFile } from '../parser/types';
import type { ParserOptions } from 'oxc-parser';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import type { BatchParseResult } from './types';

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

/** Parse multiple files concurrently and return results with failure details. */
export async function batchParse(
  ctx: GildashContext,
  filePaths: string[],
  options?: ParserOptions,
): Promise<BatchParseResult> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  const parsed = new Map<string, ParsedFile>();
  const failures: Array<{ filePath: string; error: Error }> = [];
  await Promise.all(
    filePaths.map(async (fp) => {
      try {
        const text = await ctx.readFileFn(fp);
        const result = ctx.parseSourceFn(fp, text, options);
        if (!isErr(result)) {
          parsed.set(fp, result as ParsedFile);
        } else {
          failures.push({ filePath: fp, error: result.data });
        }
      } catch (e) {
        failures.push({
          filePath: fp,
          error: e instanceof Error ? e : new Error(String(e)),
        });
      }
    }),
  );
  return { parsed, failures };
}

/** Retrieve a previously-parsed AST from the internal LRU cache. */
export function getParsedAst(
  ctx: GildashContext,
  filePath: string,
): ParsedFile | undefined {
  if (ctx.closed) return undefined;
  return ctx.parseCache.get(filePath);
}
