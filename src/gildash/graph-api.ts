import { err, type Result } from '@zipbul/result';
import type { GildashError } from '../errors';
import { gildashError } from '../errors';
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
): Result<string[], GildashError> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    return ctx.relationSearchFn({
      relationRepo: ctx.relationRepo,
      project: project ?? ctx.defaultProject,
      query: { srcFilePath: filePath, type: 'imports', project: project ?? ctx.defaultProject, limit },
    }).map(r => r.dstFilePath);
  } catch (e) {
    return err(gildashError('search', 'Gildash: getDependencies failed', e));
  }
}

/** List the files that directly import a given file. */
export function getDependents(
  ctx: GildashContext,
  filePath: string,
  project?: string,
  limit = 10_000,
): Result<string[], GildashError> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    return ctx.relationSearchFn({
      relationRepo: ctx.relationRepo,
      project: project ?? ctx.defaultProject,
      query: { dstFilePath: filePath, type: 'imports', project: project ?? ctx.defaultProject, limit },
    }).map(r => r.srcFilePath);
  } catch (e) {
    return err(gildashError('search', 'Gildash: getDependents failed', e));
  }
}

/** Compute the full set of files transitively affected by changes. */
export async function getAffected(
  ctx: GildashContext,
  changedFiles: string[],
  project?: string,
): Promise<Result<string[], GildashError>> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.getAffectedByChange(changedFiles);
  } catch (e) {
    return err(gildashError('search', 'Gildash: getAffected failed', e));
  }
}

/** Check whether the import graph contains a circular dependency. */
export async function hasCycle(
  ctx: GildashContext,
  project?: string,
): Promise<Result<boolean, GildashError>> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.hasCycle();
  } catch (e) {
    return err(gildashError('search', 'Gildash: hasCycle failed', e));
  }
}

/** Return the full import graph as an adjacency list. */
export async function getImportGraph(
  ctx: GildashContext,
  project?: string,
): Promise<Result<Map<string, string[]>, GildashError>> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.getAdjacencyList();
  } catch (e) {
    return err(gildashError('search', 'Gildash: getImportGraph failed', e));
  }
}

/** Return all files that `filePath` transitively imports (forward BFS). */
export async function getTransitiveDependencies(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): Promise<Result<string[], GildashError>> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.getTransitiveDependencies(filePath);
  } catch (e) {
    return err(gildashError('search', 'Gildash: getTransitiveDependencies failed', e));
  }
}

/** Return all cycle paths in the import graph. */
export async function getCyclePaths(
  ctx: GildashContext,
  project?: string,
  options?: { maxCycles?: number },
): Promise<Result<string[][], GildashError>> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    const g = getOrBuildGraph(ctx, project);
    return g.getCyclePaths(options);
  } catch (e) {
    return err(gildashError('search', 'Gildash: getCyclePaths failed', e));
  }
}

/** Compute import-graph fan metrics (fan-in / fan-out) for a single file. */
export async function getFanMetrics(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): Promise<Result<FanMetrics, GildashError>> {
  if (ctx.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    const g = getOrBuildGraph(ctx, project);
    return {
      filePath,
      fanIn: g.getDependents(filePath).length,
      fanOut: g.getDependencies(filePath).length,
    };
  } catch (e) {
    return err(gildashError('search', 'Gildash: getFanMetrics failed', e));
  }
}
