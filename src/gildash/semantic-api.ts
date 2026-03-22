import path from 'node:path';
import type { SymbolSearchResult } from '../search/symbol-search';
import { GildashError } from '../errors';
import type { ResolvedType, SemanticReference, Implementation, SemanticModuleInterface, SemanticDiagnostic } from '../semantic/types';
import type { SymbolNode } from '../semantic/symbol-graph';
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
  // DB stores relative paths — normalize absolute paths before searching
  const searchPath = path.isAbsolute(filePath)
    ? path.relative(ctx.projectRoot, filePath)
    : filePath;
  const results = ctx.symbolSearchFn({
    symbolRepo: ctx.symbolRepo,
    project: effectiveProject,
    query: { text: symbolName, exact: true, filePath: searchPath, limit: 1 },
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

/** Check whether a source symbol's type is assignable to a target symbol's type. */
export function isTypeAssignableTo(
  ctx: GildashContext,
  sourceSymbol: string,
  sourceFilePath: string,
  targetSymbol: string,
  targetFilePath: string,
  project?: string,
): boolean | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const src = resolveSymbolPosition(ctx, sourceSymbol, sourceFilePath, project);
    if (!src) throw new GildashError('search', `Gildash: source symbol '${sourceSymbol}' not found in '${sourceFilePath}'`);
    const tgt = resolveSymbolPosition(ctx, targetSymbol, targetFilePath, project);
    if (!tgt) throw new GildashError('search', `Gildash: target symbol '${targetSymbol}' not found in '${targetFilePath}'`);
    return ctx.semanticLayer.isTypeAssignableTo(src.absPath, src.position, tgt.absPath, tgt.position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: isTypeAssignableTo failed', { cause: e });
  }
}

/** Retrieve resolved types for all declarations in a file. */
export function getFileTypes(
  ctx: GildashContext,
  filePath: string,
): Map<number, ResolvedType> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.collectFileTypes(absPath);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: getFileTypes failed', { cause: e });
  }
}

/** Retrieve the resolved type at a specific position (line:column) without DB lookup. */
export function getResolvedTypeAt(
  ctx: GildashContext,
  filePath: string,
  line: number,
  column: number,
): ResolvedType | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    const position = ctx.semanticLayer.lineColumnToPosition(absPath, line, column);
    if (position === null) return null;
    return ctx.semanticLayer.collectTypeAt(absPath, position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: getResolvedTypeAt failed', { cause: e });
  }
}

/** Check type assignability at specific positions without DB lookup. */
export function isTypeAssignableToAt(
  ctx: GildashContext,
  opts: {
    source: { filePath: string; line: number; column: number };
    target: { filePath: string; line: number; column: number };
  },
): boolean | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const srcAbs = path.isAbsolute(opts.source.filePath) ? opts.source.filePath : path.resolve(ctx.projectRoot, opts.source.filePath);
    const tgtAbs = path.isAbsolute(opts.target.filePath) ? opts.target.filePath : path.resolve(ctx.projectRoot, opts.target.filePath);
    const srcPos = ctx.semanticLayer.lineColumnToPosition(srcAbs, opts.source.line, opts.source.column);
    if (srcPos === null) return null;
    const tgtPos = ctx.semanticLayer.lineColumnToPosition(tgtAbs, opts.target.line, opts.target.column);
    if (tgtPos === null) return null;
    return ctx.semanticLayer.isTypeAssignableTo(srcAbs, srcPos, tgtAbs, tgtPos);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: isTypeAssignableToAt failed', { cause: e });
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

// ─── Position-based semantic API ──────────────────────────────────────

/** Retrieve the resolved type at a byte offset without line/column conversion. */
export function getResolvedTypeAtPosition(
  ctx: GildashContext,
  filePath: string,
  position: number,
): ResolvedType | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.collectTypeAt(absPath, position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: getResolvedTypeAtPosition failed', { cause: e });
  }
}

/** Find all semantic references at a byte offset. */
export function getSemanticReferencesAtPosition(
  ctx: GildashContext,
  filePath: string,
  position: number,
): SemanticReference[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.findReferences(absPath, position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: getSemanticReferencesAtPosition failed', { cause: e });
  }
}

/** Find implementations at a byte offset. */
export function getImplementationsAtPosition(
  ctx: GildashContext,
  filePath: string,
  position: number,
): Implementation[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.findImplementations(absPath, position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: getImplementationsAtPosition failed', { cause: e });
  }
}

/** Check type assignability at byte offsets. */
export function isTypeAssignableToAtPosition(
  ctx: GildashContext,
  srcFilePath: string,
  srcPosition: number,
  dstFilePath: string,
  dstPosition: number,
): boolean | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const srcAbs = path.isAbsolute(srcFilePath) ? srcFilePath : path.resolve(ctx.projectRoot, srcFilePath);
    const dstAbs = path.isAbsolute(dstFilePath) ? dstFilePath : path.resolve(ctx.projectRoot, dstFilePath);
    return ctx.semanticLayer.isTypeAssignableTo(srcAbs, srcPosition, dstAbs, dstPosition);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: isTypeAssignableToAtPosition failed', { cause: e });
  }
}

/** Check whether the type at a position is assignable to a type expression string. */
export function isTypeAssignableToType(
  ctx: GildashContext,
  filePath: string,
  position: number,
  targetTypeExpression: string,
): boolean | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.isTypeAssignableToType(absPath, position, targetTypeExpression);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: isTypeAssignableToType failed', { cause: e });
  }
}

// ─── Internal utility exposure ────────────────────────────────────────

/** Convert 1-based line + 0-based column to a byte offset using tsc SourceFile. */
export function lineColumnToPosition(
  ctx: GildashContext,
  filePath: string,
  line: number,
  column: number,
): number | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.lineColumnToPosition(absPath, line, column);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: lineColumnToPosition failed', { cause: e });
  }
}

/** Find the byte offset of a symbol name starting from its declaration position. */
export function findNamePosition(
  ctx: GildashContext,
  filePath: string,
  declarationPos: number,
  name: string,
): number | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.findNamePosition(absPath, declarationPos, name);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: findNamePosition failed', { cause: e });
  }
}

/** Retrieve the tsc symbol graph node at a byte offset. */
export function getSymbolNode(
  ctx: GildashContext,
  filePath: string,
  position: number,
): SymbolNode | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.getSymbolNode(absPath, position);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: getSymbolNode failed', { cause: e });
  }
}

// ─── Diagnostics ──────────────────────────────────────────────────────

/** Return tsc semantic diagnostics for an indexed file. */
export function getSemanticDiagnostics(
  ctx: GildashContext,
  filePath: string,
): SemanticDiagnostic[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.getDiagnostics(absPath);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('semantic', 'Gildash: getSemanticDiagnostics failed', { cause: e });
  }
}
