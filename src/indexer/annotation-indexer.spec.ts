import { describe, expect, it, mock, beforeEach } from 'bun:test';
import type { ParsedFile } from '../parser/types';
import { parseSource } from '../parser/parse-source';
import { isErr } from '@zipbul/result';
import { indexFileAnnotations } from './annotation-indexer';

function parse(source: string): ParsedFile {
  const result = parseSource('/test.ts', source);
  if (isErr(result)) throw result.data;
  return result;
}

function makeAnnotationRepo() {
  return {
    deleteFileAnnotations: mock((p: string, f: string) => {}),
    insertBatch: mock((p: string, f: string, rows: any[]) => {}),
  };
}

describe('indexFileAnnotations', () => {
  it('should return count of extracted annotations', () => {
    const parsed = parse(`
/** @deprecated Use newFn */
function oldFn() {}
`);
    const repo = makeAnnotationRepo();
    const count = indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('should call deleteFileAnnotations before insert', () => {
    const parsed = parse(`
/** @todo fix */
function fn() {}
`);
    const repo = makeAnnotationRepo();
    indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(repo.deleteFileAnnotations).toHaveBeenCalledWith('p', 'a.ts');
    expect(repo.insertBatch).toHaveBeenCalled();

    // delete should be called before insert
    const deleteOrder = repo.deleteFileAnnotations.mock.invocationCallOrder[0]!;
    const insertOrder = repo.insertBatch.mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeLessThan(insertOrder);
  });

  it('should return 0 and not call insertBatch when no annotations found', () => {
    const parsed = parse(`function fn() {}`);
    const repo = makeAnnotationRepo();
    const count = indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(count).toBe(0);
    expect(repo.deleteFileAnnotations).toHaveBeenCalled();
    expect(repo.insertBatch).not.toHaveBeenCalled();
  });

  it('should pass correct fields to insertBatch', () => {
    const parsed = parse(`
/** @deprecated old */
function fn() {}
`);
    const repo = makeAnnotationRepo();
    indexFileAnnotations({ parsed, project: 'myProject', filePath: 'src/file.ts', annotationRepo: repo });

    const [project, filePath, rows] = repo.insertBatch.mock.calls[0]!;
    expect(project).toBe('myProject');
    expect(filePath).toBe('src/file.ts');
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const row = rows[0]!;
    expect(row.project).toBe('myProject');
    expect(row.filePath).toBe('src/file.ts');
    expect(row.tag).toBe('deprecated');
    expect(row.source).toBe('jsdoc');
    expect(typeof row.startLine).toBe('number');
    expect(typeof row.indexedAt).toBe('string');
  });
});
