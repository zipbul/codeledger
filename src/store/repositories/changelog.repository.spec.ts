import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbConnection } from '../connection';
import { ChangelogRepository } from './changelog.repository';

let tmpDir: string;
let db: DbConnection;
let repo: ChangelogRepository;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gildash-changelog-test-'));
  db = new DbConnection({ projectRoot: tmpDir });
  db.open();
  repo = new ChangelogRepository(db);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('ChangelogRepository', () => {
  it('should insert and retrieve changelog entries', () => {
    const now = new Date().toISOString();
    repo.insertBatch([
      {
        project: 'test', changeType: 'added', symbolName: 'myFn',
        symbolKind: 'function', filePath: 'src/a.ts', oldName: null,
        oldFilePath: null, fingerprint: 'fp1', changedAt: now,
        isFullIndex: 0, indexRunId: 'run-1',
      },
    ]);

    const results = repo.getSince({ project: 'test', since: '2000-01-01', limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.symbolName).toBe('myFn');
    expect(results[0]!.changeType).toBe('added');
  });

  it('should filter by symbolName', () => {
    const now = new Date().toISOString();
    repo.insertBatch([
      { project: 'test', changeType: 'added', symbolName: 'fn1', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 0, indexRunId: 'r1' },
      { project: 'test', changeType: 'added', symbolName: 'fn2', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 0, indexRunId: 'r1' },
    ]);

    const results = repo.getSince({ project: 'test', since: '2000-01-01', symbolName: 'fn1', limit: 10 });
    expect(results.length).toBe(1);
  });

  it('should filter by changeTypes', () => {
    const now = new Date().toISOString();
    repo.insertBatch([
      { project: 'test', changeType: 'added', symbolName: 'fn1', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 0, indexRunId: 'r1' },
      { project: 'test', changeType: 'removed', symbolName: 'fn2', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 0, indexRunId: 'r1' },
    ]);

    const results = repo.getSince({ project: 'test', since: '2000-01-01', changeTypes: ['removed'], limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.symbolName).toBe('fn2');
  });

  it('should exclude full index entries by default', () => {
    const now = new Date().toISOString();
    repo.insertBatch([
      { project: 'test', changeType: 'added', symbolName: 'fn1', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 1, indexRunId: 'r1' },
      { project: 'test', changeType: 'added', symbolName: 'fn2', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 0, indexRunId: 'r2' },
    ]);

    const results = repo.getSince({ project: 'test', since: '2000-01-01', limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.symbolName).toBe('fn2');
  });

  it('should include full index entries when requested', () => {
    const now = new Date().toISOString();
    repo.insertBatch([
      { project: 'test', changeType: 'added', symbolName: 'fn1', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 1, indexRunId: 'r1' },
    ]);

    const results = repo.getSince({ project: 'test', since: '2000-01-01', includeFullIndex: true, limit: 10 });
    expect(results.length).toBe(1);
  });

  it('should prune old entries and return deleted count', () => {
    const old = '2020-01-01T00:00:00.000Z';
    const recent = new Date().toISOString();
    repo.insertBatch([
      { project: 'test', changeType: 'added', symbolName: 'fn1', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: old, isFullIndex: 0, indexRunId: 'r1' },
      { project: 'test', changeType: 'added', symbolName: 'fn2', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: recent, isFullIndex: 0, indexRunId: 'r2' },
    ]);

    const pruned = repo.pruneOlderThan('test', '2023-01-01T00:00:00.000Z');
    expect(pruned).toBe(1);
    const results = repo.getSince({ project: 'test', since: '2000-01-01', includeFullIndex: true, limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.symbolName).toBe('fn2');
  });

  it('should support afterId pagination', () => {
    const now = new Date().toISOString();
    repo.insertBatch([
      { project: 'test', changeType: 'added', symbolName: 'fn1', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 0, indexRunId: 'r1' },
      { project: 'test', changeType: 'added', symbolName: 'fn2', symbolKind: 'function', filePath: 'a.ts', oldName: null, oldFilePath: null, fingerprint: null, changedAt: now, isFullIndex: 0, indexRunId: 'r1' },
    ]);

    const all = repo.getSince({ project: 'test', since: '2000-01-01', limit: 10 });
    expect(all.length).toBe(2);
    const page2 = repo.getSince({ project: 'test', since: '2000-01-01', afterId: all[0]!.id, limit: 10 });
    expect(page2.length).toBe(1);
    expect(page2[0]!.symbolName).toBe('fn2');
  });
});
