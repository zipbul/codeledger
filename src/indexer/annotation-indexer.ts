import type { ParsedFile } from '../parser/types';
import { extractAnnotations } from '../extractor/annotation-extractor';
import type { AnnotationRepository } from '../store/repositories/annotation.repository';

interface AnnotationRepoPart {
  deleteFileAnnotations(project: string, filePath: string): void;
  insertBatch(
    project: string,
    filePath: string,
    rows: ReadonlyArray<{
      project: string;
      filePath: string;
      tag: string;
      value: string;
      source: string;
      symbolName: string | null;
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
      indexedAt: string;
    }>,
  ): void;
}

export interface IndexFileAnnotationsOptions {
  parsed: ParsedFile;
  project: string;
  filePath: string;
  annotationRepo: AnnotationRepoPart;
}

export function indexFileAnnotations(opts: IndexFileAnnotationsOptions): number {
  const { parsed, project, filePath, annotationRepo } = opts;

  const extracted = extractAnnotations(parsed);

  annotationRepo.deleteFileAnnotations(project, filePath);

  if (!extracted.length) return 0;

  const now = new Date().toISOString();
  const rows = extracted.map((a) => ({
    project,
    filePath,
    tag: a.tag,
    value: a.value,
    source: a.source,
    symbolName: a.symbolName,
    startLine: a.span.start.line,
    startColumn: a.span.start.column,
    endLine: a.span.end.line,
    endColumn: a.span.end.column,
    indexedAt: now,
  }));

  annotationRepo.insertBatch(project, filePath, rows);
  return extracted.length;
}
