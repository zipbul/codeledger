import type { CodeRelation } from '../extractor/types';
import type { RelationRecord } from '../store/repositories/relation.repository';

/**
 * Filters for {@link relationSearch}.
 *
 * All fields are optional. Omitted fields impose no constraint.
 */
export interface RelationSearchQuery {
  /** Source file path. */
  srcFilePath?: string;
  /** Source symbol name. */
  srcSymbolName?: string;
  /** Destination file path. */
  dstFilePath?: string;
  /** Destination symbol name. */
  dstSymbolName?: string;
  /** Relationship type: `'imports'`, `'calls'`, `'extends'`, or `'implements'`. */
  type?: CodeRelation['type'];
  /** Limit results to this project. */
  project?: string;
  /** Maximum number of results. Defaults to `500`. */
  limit?: number;
}

export interface IRelationRepo {
  searchRelations(opts: {
    srcFilePath?: string;
    srcSymbolName?: string;
    dstFilePath?: string;
    dstSymbolName?: string;
    type?: string;
    project?: string;
    limit: number;
  }): RelationRecord[];
}

/**
 * Search the relation index using the given query filters.
 *
 * @param options - Relation repository, default project, and search query.
 * @returns An array of {@link CodeRelation} entries matching the query.
 */
export function relationSearch(options: {
  relationRepo: IRelationRepo;
  project?: string;
  query: RelationSearchQuery;
}): CodeRelation[] {
  const { relationRepo, project, query } = options;
  const effectiveProject = query.project ?? project;
  const limit = query.limit ?? 500;

  const records = relationRepo.searchRelations({
    srcFilePath: query.srcFilePath,
    srcSymbolName: query.srcSymbolName,
    dstFilePath: query.dstFilePath,
    dstSymbolName: query.dstSymbolName,
    type: query.type,
    project: effectiveProject,
    limit,
  });

  return records.map(r => {
    let meta: Record<string, unknown> | undefined;
    if (r.metaJson) {
      try {
        meta = JSON.parse(r.metaJson) as Record<string, unknown>;
      } catch {
        console.error('[relationSearch] malformed metaJson:', r.metaJson);
      }
    }
    return {
      type: r.type as CodeRelation['type'],
      srcFilePath: r.srcFilePath,
      srcSymbolName: r.srcSymbolName,
      dstFilePath: r.dstFilePath,
      dstSymbolName: r.dstSymbolName,
      metaJson: r.metaJson ?? undefined,
      meta,
    };
  });
}
