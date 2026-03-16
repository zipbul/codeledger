import type { AnnotationSource } from '../extractor/types';
import type { AnnotationRecord } from '../store/repositories/annotation.repository';
import { toFtsPrefixQuery } from '../store/repositories/fts-utils';

export interface AnnotationSearchQuery {
  text?: string;
  tag?: string;
  filePath?: string;
  symbolName?: string;
  source?: AnnotationSource;
  project?: string;
  limit?: number;
}

export interface AnnotationSearchResult {
  tag: string;
  value: string;
  source: AnnotationSource;
  filePath: string;
  symbolName: string | null;
  span: { start: { line: number; column: number }; end: { line: number; column: number } };
}

export interface IAnnotationRepo {
  search(opts: {
    project?: string;
    tag?: string;
    filePath?: string;
    symbolName?: string;
    source?: string;
    ftsQuery?: string;
    limit: number;
  }): AnnotationRecord[];
}

export function annotationSearch(options: {
  annotationRepo: IAnnotationRepo;
  project?: string;
  query: AnnotationSearchQuery;
}): AnnotationSearchResult[] {
  const { annotationRepo, project, query } = options;
  const effectiveProject = query.project ?? project;
  const limit = query.limit ?? 100;

  let ftsQuery: string | undefined;
  if (query.text) {
    ftsQuery = toFtsPrefixQuery(query.text) ?? undefined;
  }

  const records = annotationRepo.search({
    project: effectiveProject,
    tag: query.tag,
    filePath: query.filePath,
    symbolName: query.symbolName,
    source: query.source,
    ftsQuery,
    limit,
  });

  return records.map((r) => ({
    tag: r.tag,
    value: r.value,
    source: r.source as AnnotationSource,
    filePath: r.filePath,
    symbolName: r.symbolName,
    span: {
      start: { line: r.startLine, column: r.startColumn },
      end: { line: r.endLine, column: r.endColumn },
    },
  }));
}
