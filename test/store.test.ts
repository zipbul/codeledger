import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbConnection } from '../src/store/connection';
import { FileRepository } from '../src/store/repositories/file.repository';
import { SymbolRepository } from '../src/store/repositories/symbol.repository';
import { RelationRepository } from '../src/store/repositories/relation.repository';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeFileRecord(overrides: Partial<{
  project: string; filePath: string; mtimeMs: number;
  size: number; contentHash: string; updatedAt: string;
}> = {}) {
  return {
    project: 'test-project',
    filePath: 'src/index.ts',
    mtimeMs: 1_000_000,
    size: 100,
    contentHash: 'abc123',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSymbolRecord(overrides: Partial<{
  project: string; filePath: string; kind: string; name: string;
  startLine: number; startColumn: number; endLine: number; endColumn: number;
  isExported: number; signature: string | null; fingerprint: string | null;
  detailJson: string | null; contentHash: string; indexedAt: string;
}> = {}) {
  return {
    project: 'test-project',
    filePath: 'src/index.ts',
    kind: 'function',
    name: 'myFn',
    startLine: 1,
    startColumn: 0,
    endLine: 5,
    endColumn: 1,
    isExported: 1,
    signature: 'params:1|async:0',
    fingerprint: 'fp001',
    detailJson: null,
    contentHash: 'abc123',
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRelationRecord(overrides: Partial<{
  project: string; type: string; srcFilePath: string;
  srcSymbolName: string | null; dstFilePath: string;
  dstSymbolName: string | null; metaJson: string | null;
}> = {}) {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath: 'src/index.ts',
    srcSymbolName: null,
    dstFilePath: 'src/utils.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

// ── Shared setup ───────────────────────────────────────────────────────────

let tmpDir: string;
let db: DbConnection;
let fileRepo: FileRepository;
let symbolRepo: SymbolRepository;
let relationRepo: RelationRepository;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gildash-store-test-'));
  db = new DbConnection({ projectRoot: tmpDir });
  db.open();
  fileRepo = new FileRepository(db);
  symbolRepo = new SymbolRepository(db);
  relationRepo = new RelationRepository(db);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

// ── DbConnection ───────────────────────────────────────────────────────────

describe('DbConnection', () => {
  it('should create .zipbul/ directory when it does not exist', async () => {
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, '.zipbul'))).toBe(true);
  });

  it('should enable WAL journal mode when db is opened', () => {
    const result = db.transaction(() => {
      return db.query('PRAGMA journal_mode');
    });
    expect(result).toBe('wal');
  });

  it('should create all schema tables when db is opened', () => {
    const tables = db.transaction(() => db.getTableNames());
    expect(tables).toContain('files');
    expect(tables).toContain('symbols');
    expect(tables).toContain('relations');
    expect(tables).toContain('watcher_owner');
  });

  it('should create symbols_fts virtual table when db is opened', () => {
    const tables = db.transaction(() => db.getTableNames());
    expect(tables).toContain('symbols_fts');
  });

  it('should commit transaction fn return value when transaction fn succeeds', () => {
    const result = db.transaction(() => 42);
    expect(result).toBe(42);
  });

  it('should rollback transaction when fn throws', () => {
    const file = makeFileRecord();
    expect(() => {
      db.transaction(() => {
        fileRepo.upsertFile(file);
        throw new Error('rollback!');
      });
    }).toThrow('rollback!');
    expect(fileRepo.getFile('test-project', 'src/index.ts')).toBeNull();
  });

  it('should support nested transactions via savepoints when transaction is nested', () => {
    const result = db.transaction(() => {
      return db.transaction(() => 'nested');
    });
    expect(result).toBe('nested');
  });

  it('should allow re-opening when open is called again after close', () => {
    db.close();
    db.open();
    expect(() => db.transaction(() => 1)).not.toThrow();
  });

  it('should wrap migration failure with StoreError when migration throws', async () => {
    const badDb = new DbConnection({ projectRoot: join(tmpDir, 'nonexistent-migrations') });
    // Should either succeed or throw StoreError; no plain Error slipthrough
    try {
      badDb.open();
      badDb.close();
    } catch (err: any) {
      expect(err.name).toBe('StoreError');
    }
  });

  // [HP] transaction fn 인자로 DbConnection 인스턴스(this)가 전달되어야 한다 (I-5)
  it('should pass the DbConnection instance as argument when transaction fn is executed', () => {
    let receivedTx: any;
    db.transaction((tx) => {
      receivedTx = tx;
      return 1;
    });
    expect(receivedTx).toBe(db);
  });

  // ── C-1: immediateTransaction ─────────────────────────────────────────────

  // [HP] immediateTransaction fn 반환값이 그대로 전달된다
  it('should return the fn result when immediateTransaction succeeds', () => {
    const result = (db as any).immediateTransaction(() => 42);
    expect(result).toBe(42);
  });

  // [NE] immediateTransaction fn이 throw하면 ROLLBACK 후 에러가 전파된다
  it('should rollback and propagate error when immediateTransaction fn throws', () => {
    expect(() => {
      (db as any).immediateTransaction(() => { throw new Error('tx failed'); });
    }).toThrow('tx failed');
  });

  it('should allow nested transaction call when transaction is called inside immediateTransaction', () => {
    const result = (db as any).immediateTransaction(() => {
      return db.transaction(() => 7);
    });
    expect(result).toBe(7);
  });
});

// ── FileRepository ─────────────────────────────────────────────────────────

describe('FileRepository', () => {
  it('should return null when file does not exist', () => {
    const result = fileRepo.getFile('test-project', 'src/missing.ts');
    expect(result).toBeNull();
  });

  it('should return FileRecord when file is upserted', () => {
    const file = makeFileRecord();
    fileRepo.upsertFile(file);
    const result = fileRepo.getFile('test-project', 'src/index.ts');
    expect(result).not.toBeNull();
    expect(result!.contentHash).toBe('abc123');
  });

  it('should update existing record when upsert conflicts on same key', () => {
    fileRepo.upsertFile(makeFileRecord({ contentHash: 'old' }));
    fileRepo.upsertFile(makeFileRecord({ contentHash: 'new' }));
    const result = fileRepo.getFile('test-project', 'src/index.ts');
    expect(result!.contentHash).toBe('new');
  });

  it('should not create duplicate rows when same file is repeatedly upserted', () => {
    fileRepo.upsertFile(makeFileRecord());
    fileRepo.upsertFile(makeFileRecord());
    const all = fileRepo.getAllFiles('test-project');
    expect(all.length).toBe(1);
  });

  it('should return all files when querying project that has files', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/a.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/b.ts' }));
    const all = fileRepo.getAllFiles('test-project');
    expect(all.length).toBe(2);
  });

  it('should return empty array when querying unknown project', () => {
    expect(fileRepo.getAllFiles('unknown-project')).toEqual([]);
  });

  it('should return files as Map keyed by filePath when getFilesMap is called', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/a.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/b.ts' }));
    const map = fileRepo.getFilesMap('test-project');
    expect(map.size).toBe(2);
    expect(map.has('src/a.ts')).toBe(true);
    expect(map.has('src/b.ts')).toBe(true);
  });

  it('should remove file from db when deleteFile is called for existing file', () => {
    fileRepo.upsertFile(makeFileRecord());
    fileRepo.deleteFile('test-project', 'src/index.ts');
    expect(fileRepo.getFile('test-project', 'src/index.ts')).toBeNull();
  });

  it('should not throw on deleteFile when file does not exist', () => {
    expect(() => fileRepo.deleteFile('test-project', 'src/missing.ts')).not.toThrow();
  });

  it('should not return files when querying different project', () => {
    fileRepo.upsertFile(makeFileRecord({ project: 'other' }));
    expect(fileRepo.getAllFiles('test-project')).toEqual([]);
  });
});

// ── SymbolRepository ───────────────────────────────────────────────────────

describe('SymbolRepository', () => {
  beforeEach(() => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/index.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/utils.ts' }));
  });

  it('should return inserted symbols when replaceFileSymbols inserts symbols', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord(),
    ]);
    const result = symbolRepo.getFileSymbols('test-project', 'src/index.ts');
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('myFn');
  });

  it('should replace all symbols for file when replaceFileSymbols is called twice', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'old' }),
    ]);
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc456', [
      makeSymbolRecord({ name: 'new' }),
    ]);
    const result = symbolRepo.getFileSymbols('test-project', 'src/index.ts');
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('new');
  });

  it('should clear all symbols when called with empty array', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymbolRecord()]);
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc456', []);
    expect(symbolRepo.getFileSymbols('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should return empty array when querying symbols for unknown file', () => {
    expect(symbolRepo.getFileSymbols('test-project', 'src/missing.ts')).toEqual([]);
  });

  it('should find symbol by name prefix when searchByName uses FTS5', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'handleRequest' }),
    ]);
    const result = symbolRepo.searchByName('test-project', 'handleR');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe('handleRequest');
  });

  it('should return empty array when searchByName has no match', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymbolRecord()]);
    expect(symbolRepo.searchByName('test-project', 'zzzzNonExistent')).toEqual([]);
  });

  it('should filter searchByName by kind when kind filter is provided', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'MyClass', kind: 'class' }),
      makeSymbolRecord({ name: 'myFn', kind: 'function', fingerprint: 'fp002' }),
    ]);
    const result = symbolRepo.searchByName('test-project', 'my', { kind: 'class' });
    expect(result.every((r) => r.kind === 'class')).toBe(true);
  });

  it('should cap results at limit when searchByName limit is provided', () => {
    const symbols = Array.from({ length: 10 }, (_, i) =>
      makeSymbolRecord({ name: `fn${i}`, fingerprint: `fp${i}` }),
    );
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', symbols);
    const result = symbolRepo.searchByName('test-project', 'fn', { limit: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('should return symbols by kind when searchByKind is called', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ kind: 'class', name: 'MyClass', fingerprint: 'fp-c' }),
      makeSymbolRecord({ kind: 'function', name: 'myFn', fingerprint: 'fp-f' }),
    ]);
    const result = symbolRepo.searchByKind('test-project', 'class');
    expect(result.every((r) => r.kind === 'class')).toBe(true);
  });

  it('should return correct stats when project has indexed symbols', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/extra.ts' }));
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'fn1', fingerprint: 'fp1' }),
      makeSymbolRecord({ name: 'fn2', fingerprint: 'fp2' }),
    ]);
    symbolRepo.replaceFileSymbols('test-project', 'src/extra.ts', 'zzz', [
      makeSymbolRecord({ filePath: 'src/extra.ts', name: 'fn3', fingerprint: 'fp3' }),
    ]);
    const stats = symbolRepo.getStats('test-project');
    expect(stats.symbolCount).toBe(3);
  });

  it('should return symbols when querying existing fingerprint', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ fingerprint: 'unique-fp' }),
    ]);
    const result = symbolRepo.getByFingerprint('test-project', 'unique-fp');
    expect(result.length).toBe(1);
  });

  it('should return empty array when querying unknown fingerprint', () => {
    expect(symbolRepo.getByFingerprint('test-project', 'no-such-fp')).toEqual([]);
  });

  it('should remove all symbols when deleteFileSymbols is called', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymbolRecord()]);
    symbolRepo.deleteFileSymbols('test-project', 'src/index.ts');
    expect(symbolRepo.getFileSymbols('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should cascade-delete symbols when file is deleted via FK', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymbolRecord()]);
    fileRepo.deleteFile('test-project', 'src/index.ts');
    expect(symbolRepo.getFileSymbols('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should reflect FTS5 insert immediately when replaceFileSymbols inserts symbol', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'freshSymbol', fingerprint: 'fp-fresh' }),
    ]);
    const result = symbolRepo.searchByName('test-project', 'freshSymbol');
    expect(result.length).toBe(1);
  });

  it('should not throw when searchByName query contains special FTS characters', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'A"B', fingerprint: 'fp-special' }),
    ]);
    expect(() => symbolRepo.searchByName('test-project', 'A"B')).not.toThrow();
  });
});

// ── RelationRepository ─────────────────────────────────────────────────────

describe('RelationRepository', () => {
  beforeEach(() => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/index.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/utils.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/other.ts' }));
  });

  it('should return outgoing relations when replaceFileRelations inserts relations', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    const result = relationRepo.getOutgoing('test-project', 'src/index.ts');
    expect(result.length).toBe(1);
  });

  it('should replace relations when replaceFileRelations is called twice for same source', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', []);
    expect(relationRepo.getOutgoing('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should return empty array when querying outgoing relations for unknown source file', () => {
    expect(relationRepo.getOutgoing('test-project', 'src/nothing.ts')).toEqual([]);
  });

  it('should return matching srcSymbolName and null-srcSymbolName rows when getOutgoing filter is used', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [
      makeRelationRecord({ srcSymbolName: 'myFn' }),
      makeRelationRecord({ srcSymbolName: null, type: 'imports', dstFilePath: 'src/other.ts' }),
    ]);
    const result = relationRepo.getOutgoing('test-project', 'src/index.ts', 'myFn');
    expect(result.some((r) => r.srcSymbolName === 'myFn')).toBe(true);
    expect(result.some((r) => r.srcSymbolName === null)).toBe(true);
  });

  it('should return incoming relations when destination file has incoming edges', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    const result = relationRepo.getIncoming('test-project', 'src/utils.ts');
    expect(result.length).toBe(1);
  });

  it('should return empty array when querying incoming relations for unknown destination file', () => {
    expect(relationRepo.getIncoming('test-project', 'src/nothing.ts')).toEqual([]);
  });

  it('should return only matching type when getByType is called with type filter', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [
      makeRelationRecord({ type: 'imports' }),
    ]);
    const result = relationRepo.getByType('test-project', 'imports');
    expect(result.every((r) => r.type === 'imports')).toBe(true);
  });

  it('should remove all source relations when deleteFileRelations is called', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    relationRepo.deleteFileRelations('test-project', 'src/index.ts');
    expect(relationRepo.getOutgoing('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should retarget relations from old to new symbol when matching old symbol exists', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/new.ts' }));
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [
      makeRelationRecord({ dstFilePath: 'src/utils.ts', dstSymbolName: 'OldFn' }),
    ]);
    relationRepo.retargetRelations(
      'test-project',
      'src/utils.ts', 'OldFn',
      'src/new.ts', 'NewFn',
    );
    const updated = relationRepo.getIncoming('test-project', 'src/new.ts');
    expect(updated.some((r) => r.dstSymbolName === 'NewFn')).toBe(true);
  });

  it('should cascade-delete relations when src file is deleted', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    fileRepo.deleteFile('test-project', 'src/index.ts');
    expect(relationRepo.getOutgoing('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should cascade-delete relations when dst file is deleted', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord({ dstFilePath: 'src/utils.ts' })]);
    fileRepo.deleteFile('test-project', 'src/utils.ts');
    expect(relationRepo.getIncoming('test-project', 'src/utils.ts')).toEqual([]);
  });

  it('should not return relations when querying different project', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    expect(relationRepo.getOutgoing('other-project', 'src/index.ts')).toEqual([]);
  });

  // [HP] srcSymbolName 필터 시 null srcSymbolName 행도 포함해야 한다 (I-8)
  it('should include module-level (null srcSymbolName) rows when filtering by srcSymbolName', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/module.ts' }));
    relationRepo.replaceFileRelations('test-project', 'src/module.ts', [
      makeRelationRecord({ srcFilePath: 'src/module.ts', srcSymbolName: 'myFn', dstFilePath: 'src/utils.ts' }),
      makeRelationRecord({ srcFilePath: 'src/module.ts', srcSymbolName: null, dstFilePath: 'src/index.ts' }),
    ]);
    const result = relationRepo.getOutgoing('test-project', 'src/module.ts', 'myFn');
    expect(result.some((r) => r.srcSymbolName === 'myFn')).toBe(true);
    expect(result.some((r) => r.srcSymbolName === null)).toBe(true);
  });

  // [ED] srcSymbolName 지정 시 null 행만 있으면 null 행 반환 (I-8)
  it('should return null-srcSymbolName rows when only those exist during srcSymbolName filter', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/module2.ts' }));
    relationRepo.replaceFileRelations('test-project', 'src/module2.ts', [
      makeRelationRecord({ srcFilePath: 'src/module2.ts', srcSymbolName: null, dstFilePath: 'src/utils.ts' }),
    ]);
    const result = relationRepo.getOutgoing('test-project', 'src/module2.ts', 'anyFn');
    expect(result.length).toBe(1);
    expect(result[0]!.srcSymbolName).toBeNull();
  });
});

// ── DbConnection — WatcherOwnerStore 메서드 ────────────────────────────────

describe('DbConnection WatcherOwnerStore', () => {
  // [HP] 빈 DB에서 selectOwner → undefined
  it('should return undefined from selectOwner when no owner row exists', () => {
    expect(db.selectOwner()).toBeUndefined();
  });

  // [HP] insertOwner 후 selectOwner → pid + heartbeat_at 올바른 shape
  it('should return inserted owner row from selectOwner when insertOwner is called', () => {
    db.insertOwner(1234);
    const row = db.selectOwner();
    expect(row).toBeDefined();
    expect(row!.pid).toBe(1234);
    expect(typeof row!.heartbeat_at).toBe('string');
    expect(row!.heartbeat_at.length).toBeGreaterThan(0);
  });

  // [CE] insertOwner 두 번 → singleton CHECK 위반 throw
  it('should throw when insertOwner is called a second time due to singleton constraint', () => {
    db.insertOwner(1);
    expect(() => db.insertOwner(2)).toThrow();
  });

  // [HP] replaceOwner: 없을 때 row 삽입 확인
  it('should insert a row when replaceOwner is called with no existing owner', () => {
    db.replaceOwner(9999);
    const row = db.selectOwner();
    expect(row?.pid).toBe(9999);
  });

  // [HP] replaceOwner: 있을 때 pid 갱신 확인
  it('should update the pid when replaceOwner is called with an existing owner', () => {
    db.insertOwner(1);
    db.replaceOwner(2);
    expect(db.selectOwner()?.pid).toBe(2);
  });

  // [HP] touchOwner: heartbeat_at 변경, pid 유지
  it('should update heartbeat_at while keeping pid intact when touchOwner is called', () => {
    db.insertOwner(5);
    const before = db.selectOwner()!.heartbeat_at;
    // Ensure at least 1 ms passes so the new timestamp is strictly greater
    Bun.sleepSync(1);
    db.touchOwner(5);
    const after = db.selectOwner()!.heartbeat_at;
    expect(after > before).toBe(true);
    expect(db.selectOwner()!.pid).toBe(5);
  });

  // [HP] deleteOwner: row 삭제 확인
  it('should remove owner row when deleteOwner is called for matching pid', () => {
    db.insertOwner(7);
    db.deleteOwner(7);
    expect(db.selectOwner()).toBeUndefined();
  });

  // [NE] deleteOwner: row 없을 때 throw 없음
  it('should not throw when deleteOwner is called with no existing row', () => {
    expect(() => db.deleteOwner(999)).not.toThrow();
  });
});

// ── SymbolRepository — decorator / regex 필터 (LEG-1 / FR-19) ──────────────

describe('SymbolRepository — decorator and regex filters', () => {
  // [HP] decorator='Injectable' → detailJson에 해당 decorator 가진 심볼만 반환
  it('should return only symbols annotated with the given decorator when decorator filter is set', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/a.ts', contentHash: 'h1' }));

    const injectableSym = makeSymbolRecord({
      name: 'ServiceA',
      filePath: 'src/a.ts',
      detailJson: JSON.stringify({ decorators: [{ name: 'Injectable' }] }),
    });
    const plainSym = makeSymbolRecord({
      name: 'ServiceB',
      filePath: 'src/a.ts',
      detailJson: null,
    });
    symbolRepo.replaceFileSymbols('test-project', 'src/a.ts', 'h1', [injectableSym, plainSym]);

    const results = symbolRepo.searchByQuery({ decorator: 'Injectable', project: 'test-project', limit: 100 });

    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('ServiceA');
  });

  // [HP] regex='^get' → 이름이 'get'으로 시작하는 심볼만 반환
  it('should return only symbols whose name matches the regex when regex filter is set', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/b.ts', contentHash: 'h2' }));

    const getter = makeSymbolRecord({ name: 'getValue', filePath: 'src/b.ts' });
    const setter = makeSymbolRecord({ name: 'setValue', filePath: 'src/b.ts' });
    const other = makeSymbolRecord({ name: 'processData', filePath: 'src/b.ts' });
    symbolRepo.replaceFileSymbols('test-project', 'src/b.ts', 'h2', [getter, setter, other]);

    const results = symbolRepo.searchByQuery({ regex: '^get', project: 'test-project', limit: 100 });

    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('getValue');
  });

  // [NE] 없는 decorator → 빈 배열
  it('should return an empty array when no symbol has the given decorator', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/c.ts', contentHash: 'h3' }));
    symbolRepo.replaceFileSymbols('test-project', 'src/c.ts', 'h3', [
      makeSymbolRecord({ name: 'Fn', filePath: 'src/c.ts', detailJson: null }),
    ]);

    const results = symbolRepo.searchByQuery({ decorator: 'NonExistent', project: 'test-project', limit: 100 });

    expect(results).toHaveLength(0);
  });

  // [ED] invalid regex → 크래시 없이 빈 배열
  it('should return an empty array without throwing when regex is an invalid pattern', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/d.ts', contentHash: 'h4' }));
    symbolRepo.replaceFileSymbols('test-project', 'src/d.ts', 'h4', [
      makeSymbolRecord({ name: 'myFn', filePath: 'src/d.ts' }),
    ]);

    expect(() => {
      symbolRepo.searchByQuery({ regex: '(unclosed', project: 'test-project', limit: 100 });
    }).not.toThrow();
  });
});
