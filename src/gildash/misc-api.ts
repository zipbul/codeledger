import type { SymbolSearchResult } from '../search/symbol-search';
import type { CodeRelation } from '../extractor/types';
import type { IndexResult } from '../indexer/index-coordinator';
import type { PatternMatch } from '../search/pattern-search';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import type { SymbolDiff, ResolvedSymbol, HeritageNode } from './types';
import { invalidateGraphCache } from './graph-api';

/** Compare two snapshots of symbol search results and return a structured diff. */
export function diffSymbols(
  before: SymbolSearchResult[],
  after: SymbolSearchResult[],
): SymbolDiff {
  const beforeMap = new Map<string, SymbolSearchResult>(before.map(s => [`${s.name}::${s.filePath}`, s]));
  const afterMap = new Map<string, SymbolSearchResult>(after.map(s => [`${s.name}::${s.filePath}`, s]));
  const added: SymbolSearchResult[] = [];
  const removed: SymbolSearchResult[] = [];
  const modified: Array<{ before: SymbolSearchResult; after: SymbolSearchResult }> = [];
  for (const [key, afterSym] of afterMap) {
    const beforeSym = beforeMap.get(key);
    if (!beforeSym) {
      added.push(afterSym);
    } else if (beforeSym.fingerprint !== afterSym.fingerprint) {
      modified.push({ before: beforeSym, after: afterSym });
    }
  }
  for (const [key, beforeSym] of beforeMap) {
    if (!afterMap.has(key)) removed.push(beforeSym);
  }
  return { added, removed, modified };
}

/** Register a callback that fires after each indexing run completes. */
export function onIndexed(
  ctx: GildashContext,
  callback: (result: IndexResult) => void,
): () => void {
  ctx.onIndexedCallbacks.add(callback);
  if (!ctx.coordinator) {
    return () => { ctx.onIndexedCallbacks.delete(callback); };
  }
  const unsubscribe = ctx.coordinator.onIndexed(callback);
  return () => {
    ctx.onIndexedCallbacks.delete(callback);
    unsubscribe();
  };
}

/** Trigger a full re-index of all tracked files. */
export async function reindex(
  ctx: GildashContext,
): Promise<IndexResult> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.coordinator) {
    throw new GildashError('closed', 'Gildash: reindex() is not available for readers');
  }
  try {
    const result = await ctx.coordinator.fullIndex();
    invalidateGraphCache(ctx);
    return result;
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('index', 'Gildash: reindex failed', { cause: e });
  }
}

/** Resolve the original definition location of a symbol by following its re-export chain. */
export function resolveSymbol(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): ResolvedSymbol {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  const effectiveProject = project ?? ctx.defaultProject;
  const visited = new Set<string>();
  const chain: Array<{ filePath: string; exportedAs: string }> = [];

  let currentName = symbolName;
  let currentFile = filePath;

  for (;;) {
    const key = `${currentFile}::${currentName}`;
    if (visited.has(key)) {
      return { originalName: currentName, originalFilePath: currentFile, reExportChain: chain, circular: true };
    }
    visited.add(key);

    const rels = ctx.relationSearchFn({
      relationRepo: ctx.relationRepo,
      project: effectiveProject,
      query: { type: 're-exports', srcFilePath: currentFile, limit: 500 },
    }) as CodeRelation[];

    let nextFile: string | undefined;
    let nextName: string | undefined;

    for (const rel of rels) {
      let specifiers: Array<{ local: string; exported: string }> | undefined;
      if (rel.metaJson) {
        try {
          const meta = JSON.parse(rel.metaJson) as Record<string, unknown>;
          if (Array.isArray(meta['specifiers'])) {
            specifiers = meta['specifiers'] as Array<{ local: string; exported: string }>;
          }
        } catch { /* ignore malformed metaJson */ }
      }
      if (!specifiers) continue;
      const match = specifiers.find((s) => s.exported === currentName);
      if (!match) continue;
      nextFile = rel.dstFilePath;
      nextName = match.local;
      break;
    }

    if (!nextFile || !nextName) {
      return { originalName: currentName, originalFilePath: currentFile, reExportChain: chain, circular: false };
    }

    chain.push({ filePath: currentFile, exportedAs: currentName });
    currentFile = nextFile;
    currentName = nextName;
  }
}

/** Search for an AST structural pattern across indexed TypeScript files. */
export async function findPattern(
  ctx: GildashContext,
  pattern: string,
  opts?: { filePaths?: string[]; project?: string },
): Promise<PatternMatch[]> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const effectiveProject = opts?.project ?? ctx.defaultProject;
    const filePaths: string[] = opts?.filePaths
      ? opts.filePaths
      : ctx.fileRepo.getAllFiles(effectiveProject).map((f) => f.filePath);

    return await ctx.patternSearchFn({ pattern, filePaths });
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: findPattern failed', { cause: e });
  }
}

/** Recursively traverse extends/implements relations to build a heritage tree. */
export async function getHeritageChain(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): Promise<HeritageNode> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const proj = project ?? ctx.defaultProject;
    const visited = new Set<string>();

    const buildNode = (symName: string, fp: string, kind?: 'extends' | 'implements'): HeritageNode => {
      const key = `${symName}::${fp}`;
      if (visited.has(key)) {
        return { symbolName: symName, filePath: fp, kind, children: [] };
      }
      visited.add(key);

      const rels = ctx.relationSearchFn({
        relationRepo: ctx.relationRepo,
        project: proj,
        query: { srcFilePath: fp, srcSymbolName: symName, limit: 1000 },
      }) as CodeRelation[];

      const heritageRels = rels.filter(
        (r): r is CodeRelation & { type: 'extends' | 'implements' } =>
          r.type === 'extends' || r.type === 'implements',
      );

      const children = heritageRels
        .filter((r) => r.dstSymbolName != null)
        .map((r) => buildNode(r.dstSymbolName!, r.dstFilePath, r.type));

      return { symbolName: symName, filePath: fp, kind, children };
    };

    return buildNode(symbolName, filePath);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getHeritageChain failed', { cause: e });
  }
}
