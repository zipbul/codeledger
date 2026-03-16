import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbConnection } from '../connection';
import { DATA_DIR } from '../../constants';
import { FileRepository } from './file.repository';
import { AnnotationRepository } from './annotation.repository';

let tmpDir: string;
let db: DbConnection;
let fileRepo: FileRepository;
let annotationRepo: AnnotationRepository;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gildash-annotation-test-'));
  db = new DbConnection({ projectRoot: tmpDir });
  db.open();
  fileRepo = new FileRepository(db);
  annotationRepo = new AnnotationRepository(db);

  fileRepo.upsertFile({
    project: 'test', filePath: 'src/index.ts',
    mtimeMs: 1000, size: 100, contentHash: 'hash1',
    updatedAt: new Date().toISOString(),
  });
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('AnnotationRepository', () => {
  it('should insert and search annotations', () => {
    const now = new Date().toISOString();
    annotationRepo.insertBatch('test', 'src/index.ts', [
      {
        project: 'test', filePath: 'src/index.ts',
        tag: 'deprecated', value: 'Use newFn', source: 'jsdoc',
        symbolName: 'oldFn', startLine: 1, startColumn: 0,
        endLine: 1, endColumn: 20, indexedAt: now,
      },
    ]);

    const results = annotationRepo.search({ project: 'test', limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.tag).toBe('deprecated');
    expect(results[0]!.symbolName).toBe('oldFn');
  });

  it('should delete annotations by file', () => {
    const now = new Date().toISOString();
    annotationRepo.insertBatch('test', 'src/index.ts', [
      {
        project: 'test', filePath: 'src/index.ts',
        tag: 'todo', value: 'fix this', source: 'line',
        symbolName: null, startLine: 1, startColumn: 0,
        endLine: 1, endColumn: 10, indexedAt: now,
      },
    ]);

    annotationRepo.deleteFileAnnotations('test', 'src/index.ts');
    const results = annotationRepo.search({ project: 'test', limit: 10 });
    expect(results.length).toBe(0);
  });

  it('should filter by tag', () => {
    const now = new Date().toISOString();
    annotationRepo.insertBatch('test', 'src/index.ts', [
      { project: 'test', filePath: 'src/index.ts', tag: 'todo', value: 'a', source: 'line', symbolName: null, startLine: 1, startColumn: 0, endLine: 1, endColumn: 5, indexedAt: now },
      { project: 'test', filePath: 'src/index.ts', tag: 'deprecated', value: 'b', source: 'jsdoc', symbolName: null, startLine: 2, startColumn: 0, endLine: 2, endColumn: 5, indexedAt: now },
    ]);

    const results = annotationRepo.search({ project: 'test', tag: 'todo', limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.tag).toBe('todo');
  });

  it('should filter by symbolName', () => {
    const now = new Date().toISOString();
    annotationRepo.insertBatch('test', 'src/index.ts', [
      { project: 'test', filePath: 'src/index.ts', tag: 'todo', value: 'a', source: 'line', symbolName: 'foo', startLine: 1, startColumn: 0, endLine: 1, endColumn: 5, indexedAt: now },
      { project: 'test', filePath: 'src/index.ts', tag: 'todo', value: 'b', source: 'line', symbolName: 'bar', startLine: 2, startColumn: 0, endLine: 2, endColumn: 5, indexedAt: now },
    ]);

    const results = annotationRepo.search({ project: 'test', symbolName: 'foo', limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.value).toBe('a');
  });

  it('should search via FTS', () => {
    const now = new Date().toISOString();
    annotationRepo.insertBatch('test', 'src/index.ts', [
      { project: 'test', filePath: 'src/index.ts', tag: 'todo', value: 'implement caching', source: 'line', symbolName: null, startLine: 1, startColumn: 0, endLine: 1, endColumn: 5, indexedAt: now },
      { project: 'test', filePath: 'src/index.ts', tag: 'see', value: 'other module', source: 'jsdoc', symbolName: null, startLine: 2, startColumn: 0, endLine: 2, endColumn: 5, indexedAt: now },
    ]);

    const results = annotationRepo.search({ project: 'test', ftsQuery: 'caching', limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.tag).toBe('todo');
  });
});
