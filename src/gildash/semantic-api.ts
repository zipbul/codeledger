import path from 'node:path';
import type { SymbolSearchResult } from '../search/symbol-search';
import { GildashError } from '../errors';
import type { ResolvedType, SemanticReference, Implementation, SemanticModuleInterface } from '../semantic/types';
import type { GildashContext } from './context';

/**
 * Look up a symbol's position for semantic queries.
 * Returns `null` when the symbol is not indexed or position cannot be resolved.
 */
export function resolveSymbolPosition(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): { sym: SymbolSearchResult; position: number; absPath: string } | null {
  const effectiveProject = project ?? ctx.defaultProject;
  const results = ctx.symbolSearchFn({
    symbolRepo: ctx.symbolRepo,
    project: effectiveProject,
    query: { text: symbolName, exact: true, filePath, limit: 1 },
  });
  if (results.length === 0) return null;
  const sym = results[0]!;
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
  const declPos = ctx.semanticLayer!.lineColumnToPosition(
    absPath,
    sym.span.start.line,
    sym.span.start.column,
  );
  if (declPos === null) return null;
  const position = ctx.semanticLayer!.findNamePosition(absPath, declPos, sym.name) ?? declPos;
  return { sym, position, absPath };
}

/** Retrieve the resolved type of a symbol using the Semantic Layer. */
export function getResolvedType(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): ResolvedType | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const resolved = resolveSymbolPosition(ctx, symbolName, filePath, project);
    if (!resolved) {
      return null;
    }
    return ctx.semanticLayer.collectTypeAt(resolved.absPath, resolved.position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getResolvedType failed', { cause: e });
  }
}

/** Find all semantic references to a symbol. */
export function getSemanticReferences(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): SemanticReference[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const resolved = resolveSymbolPosition(ctx, symbolName, filePath, project);
    if (!resolved) {
      throw new GildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`);
    }
    return ctx.semanticLayer.findReferences(resolved.absPath, resolved.position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getSemanticReferences failed', { cause: e });
  }
}

/** Find implementations of an interface/abstract class. */
export function getImplementations(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): Implementation[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const resolved = resolveSymbolPosition(ctx, symbolName, filePath, project);
    if (!resolved) {
      throw new GildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`);
    }
    return ctx.semanticLayer.findImplementations(resolved.absPath, resolved.position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getImplementations failed', { cause: e });
  }
}

/** Retrieve the semantic module interface — exported symbols with resolved types. */
export function getSemanticModuleInterface(
  ctx: GildashContext,
  filePath: string,
): SemanticModuleInterface {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    return ctx.semanticLayer.getModuleInterface(filePath);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getSemanticModuleInterface failed', { cause: e });
  }
}
