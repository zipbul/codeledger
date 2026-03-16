import type { GildashContext } from './context';
import type { AnnotationSearchQuery, AnnotationSearchResult } from '../search/annotation-search';
import { GildashError } from '../errors';

export function searchAnnotations(
  ctx: GildashContext,
  query: AnnotationSearchQuery,
): AnnotationSearchResult[] {
  if (ctx.closed) throw new GildashError('closed', 'Gildash: instance is closed');
  if (!ctx.annotationRepo || !ctx.annotationSearchFn) return [];

  return ctx.annotationSearchFn({
    annotationRepo: ctx.annotationRepo,
    project: query.project ?? ctx.defaultProject,
    query,
  });
}
