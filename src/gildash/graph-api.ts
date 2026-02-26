import { GildashError } from '../errors';
import { DependencyGraph } from '../search/dependency-graph';
import type { GildashContext } from './context';
import type { FanMetrics } from './types';

/** Invalidate the cached DependencyGraph (called after every index run). */
export function invalidateGraphCache(ctx: GildashContext): void {
  ctx.graphCache = null;
  ctx.graphCacheKey = null;
}

/**
 * Return a cached or freshly-built DependencyGraph for the given project.
 * Builds once per key; subsequent calls with the same key return the cached instance.
 */
export function getOrBuildGraph(ctx: GildashContext, project?: string): DependencyGraph {
  const key = project ?? '__cross__';
  if (ctx.graphCache && ctx.graphCacheKey === key) {
    return ctx.graphCache;
  }
  const g = new DependencyGraph({
    relationRepo: ctx.relationRepo,
    project: project ?? ctx.defaultProject,
    additionalProjects: project ? undefined : ctx.boundaries?.map(b => b.project),
  });
  g.build();
  ctx.graphCache = g;
  ctx.graphCacheKey = key;
  return g;
}

/** List the files that a given file directly imports. */
export function getDependencies(
  ctx: GildashContext,
  filePath: string,
  project?: string,
  limit = 10_000,
): string[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.relationSearchFn({
      relationRepo: ctx.relationRepo,
      project: project ?? ctx.defaultProject,
      query: { srcFilePath: filePath, type: 'imports', project: project ?? ctx.defaultProject, limit },
    }).map(r => r.dstFilePath);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getDependencies failed', { cause: e });
  }
}

/** List the files that directly import a given file. */
export function getDependents(
  ctx: GildashContext,
  filePath: string,
  project?: string,
  limit = 10_000,
): string[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    return ctx.relationSearchFn({
      relationRepo: ctx.relationRepo,
      project: project ?? ctx.defaultProject,
      query: { dstFilePath: filePath, type: 'imports', project: project ?? ctx.defaultProject, limit },
    }).map(r => r.srcFilePath);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getDependents failed', { cause: e });
  }
}

/** Compute the full set of files transitively affected by changes. */
export async function getAffected(
  ctx: GildashContext,
  changedFiles: string[],
  project?: string,
): Promise<string[]> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.getAffectedByChange(changedFiles);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getAffected failed', { cause: e });
  }
}

/** Check whether the import graph contains a circular dependency. */
export async function hasCycle(
  ctx: GildashContext,
  project?: string,
): Promise<boolean> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.hasCycle();
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: hasCycle failed', { cause: e });
  }
}

/** Return the full import graph as an adjacency list. */
export async function getImportGraph(
  ctx: GildashContext,
  project?: string,
): Promise<Map<string, string[]>> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.getAdjacencyList();
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getImportGraph failed', { cause: e });
  }
}

/** Return all files that `filePath` transitively imports (forward BFS). */
export async function getTransitiveDependencies(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): Promise<string[]> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.getTransitiveDependencies(filePath);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getTransitiveDependencies failed', { cause: e });
  }
}

/** Return all cycle paths in the import graph. */
export async function getCyclePaths(
  ctx: GildashContext,
  project?: string,
  options?: { maxCycles?: number },
): Promise<string[][]> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.getCyclePaths(options);
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getCyclePaths failed', { cause: e });
  }
}

/** Compute import-graph fan metrics (fan-in / fan-out) for a single file. */
export async function getFanMetrics(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): Promise<FanMetrics> {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  try {
    const g = getOrBuildGraph(ctx, project);
    return {
      filePath,
      fanIn: g.getDependents(filePath).length,
      fanOut: g.getDependencies(filePath).length,
    };
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError('search', 'Gildash: getFanMetrics failed', { cause: e });
  }
}
