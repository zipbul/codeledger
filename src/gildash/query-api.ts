import path from 'node:path';
import type { SymbolSearchQuery, SymbolSearchResult } from '../search/symbol-search';
import type { RelationSearchQuery } from '../search/relation-search';
import type { CodeRelation } from '../extractor/types';
import type { FileRecord } from '../store/repositories/file.repository';
import type { SymbolStats } from '../store/repositories/symbol.repository';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import type { FullSymbol, FileStats, ModuleInterface } from './types';

/** Return aggregate symbol statistics for the given project. */
export function getStats(
  ctx: GildashContext,
  project?: string,
): SymbolStats {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.symbolRepo.getStats(project ?? ctx.defaultProject);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('store', 'Gildash: getStats failed', { cause: e });
  }
}

/** Search indexed symbols by name, kind, file path, or export status. */
export function searchSymbols(
  ctx: GildashContext,
  query: SymbolSearchQuery,
): SymbolSearchResult[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.symbolSearchFn({ symbolRepo: ctx.symbolRepo, project: ctx.defaultProject, query });
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: searchSymbols failed', { cause: e });
  }
}

/** Search indexed code relationships (imports, calls, extends, implements). */
export function searchRelations(
  ctx: GildashContext,
  query: RelationSearchQuery,
): CodeRelation[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.relationSearchFn({ relationRepo: ctx.relationRepo, project: ctx.defaultProject, query });
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: searchRelations failed', { cause: e });
  }
}

/** Search symbols across all projects (no project filter). */
export function searchAllSymbols(
  ctx: GildashContext,
  query: Omit<SymbolSearchQuery, 'project'> & { project?: string },
): SymbolSearchResult[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.symbolSearchFn({ symbolRepo: ctx.symbolRepo, project: undefined, query });
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: searchAllSymbols failed', { cause: e });
  }
}

/** Search relations across all projects (no project filter). */
export function searchAllRelations(
  ctx: GildashContext,
  query: RelationSearchQuery,
): CodeRelation[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.relationSearchFn({ relationRepo: ctx.relationRepo, project: undefined, query });
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: searchAllRelations failed', { cause: e });
  }
}

/** List all files indexed for a given project. */
export function listIndexedFiles(
  ctx: GildashContext,
  project?: string,
): FileRecord[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.fileRepo.getAllFiles(project ?? ctx.defaultProject);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('store', 'Gildash: listIndexedFiles failed', { cause: e });
  }
}

/** Get all intra-file relations for a given file. */
export function getInternalRelations(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): CodeRelation[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.relationSearchFn({
      relationRepo: ctx.relationRepo,
      project: project ?? ctx.defaultProject,
      query: { srcFilePath: filePath, dstFilePath: filePath, limit: 10_000 },
    });
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getInternalRelations failed', { cause: e });
  }
}

/** Retrieve full details for a named symbol in a specific file. */
export function getFullSymbol(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): FullSymbol | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const effectiveProject = project ?? ctx.defaultProject;
    const results = ctx.symbolSearchFn({
      symbolRepo: ctx.symbolRepo,
      project: effectiveProject,
      query: { text: symbolName, exact: true, filePath, limit: 1 },
    });
    if (results.length === 0) {
      return null;
    }
    const sym = results[0]!;
    const d = sym.detail;
    const full: FullSymbol = {
      ...sym,
      members: Array.isArray(d.members) ? (d.members as FullSymbol['members']) : undefined,
      jsDoc: typeof d.jsDoc === 'string' ? d.jsDoc : undefined,
      parameters: typeof d.parameters === 'string' ? d.parameters : undefined,
      returnType: typeof d.returnType === 'string' ? d.returnType : undefined,
      heritage: Array.isArray(d.heritage) ? (d.heritage as string[]) : undefined,
      decorators: Array.isArray(d.decorators) ? (d.decorators as FullSymbol['decorators']) : undefined,
      typeParameters: typeof d.typeParameters === 'string' ? d.typeParameters : undefined,
    };
    if (ctx.semanticLayer) {
      try {
        const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
        const declPos = ctx.semanticLayer.lineColumnToPosition(
          absPath, sym.span.start.line, sym.span.start.column,
        );
        if (declPos !== null) {
          const pos = ctx.semanticLayer.findNamePosition(absPath, declPos, sym.name) ?? declPos;
          const resolvedType = ctx.semanticLayer.collectTypeAt(absPath, pos);
          if (resolvedType) {
            full.resolvedType = resolvedType;
          }
        }
      } catch {
        // semantic enrichment is best-effort — don't fail the whole call
      }
    }
    return full;
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getFullSymbol failed', { cause: e });
  }
}

/** Retrieve statistics for an indexed file. */
export function getFileStats(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): FileStats {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const effectiveProject = project ?? ctx.defaultProject;
    const fileRecord = ctx.fileRepo.getFile(effectiveProject, filePath);
    if (!fileRecord) {
      throw new GildashError('search', `Gildash: file '${filePath}' is not in the index`);
    }
    const symbols = ctx.symbolRepo.getFileSymbols(effectiveProject, filePath);
    const relations = ctx.relationRepo.getOutgoing(effectiveProject, filePath);
    return {
      filePath: fileRecord.filePath,
      lineCount: fileRecord.lineCount ?? 0,
      size: fileRecord.size,
      symbolCount: symbols.length,
      exportedSymbolCount: symbols.filter((s) => s.isExported).length,
      relationCount: relations.length,
    };
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('store', 'Gildash: getFileStats failed', { cause: e });
  }
}

/** Retrieve metadata for an indexed file. */
export function getFileInfo(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): FileRecord | null {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.fileRepo.getFile(project ?? ctx.defaultProject, filePath);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('store', 'Gildash: getFileInfo failed', { cause: e });
  }
}

/** List all symbols declared in a specific file. */
export function getSymbolsByFile(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): SymbolSearchResult[] {
  return searchSymbols(ctx, { filePath, project: project ?? undefined, limit: 10_000 });
}

/** Return the public interface of a module. */
export function getModuleInterface(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): ModuleInterface {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const symbols = ctx.symbolSearchFn({
      symbolRepo: ctx.symbolRepo,
      project: project ?? ctx.defaultProject,
      query: { filePath, isExported: true },
    }) as SymbolSearchResult[];
    const exports = symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      parameters: (s.detail.parameters as string | undefined) ?? undefined,
      returnType: (s.detail.returnType as string | undefined) ?? undefined,
      jsDoc: (s.detail.jsDoc as string | undefined) ?? undefined,
    }));
    return { filePath, exports };
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getModuleInterface failed', { cause: e });
  }
}
