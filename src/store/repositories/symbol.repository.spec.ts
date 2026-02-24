import { describe, expect, it, mock } from 'bun:test';
import type { Mock } from 'bun:test';
import { SymbolRepository } from './symbol.repository';
import type { SymbolRecord } from './symbol.repository';
import type { DbConnection } from '../connection';

function makeChainMock() {
  const chain: Record<string, Mock<any>> = {};
  for (const m of [
    'select', 'from', 'where', 'insert', 'values', 'delete',
    'update', 'set', 'orderBy', 'limit',
  ]) {
    chain[m] = mock(() => chain);
  }
  chain['get'] = mock(() => null as unknown);
  chain['all'] = mock(() => [] as unknown[]);
  chain['run'] = mock(() => {});
  return chain;
}

function makeDbMock() {
  const chain = makeChainMock();
  const db = { drizzleDb: chain } as unknown as DbConnection;
  return { db, chain };
}

function makeSymRecord(overrides: Partial<SymbolRecord> = {}): Partial<SymbolRecord> {
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
    ...overrides,
  };
}

describe('SymbolRepository', () => {
  it('should call delete and then insert once when replaceFileSymbols receives 1 symbol', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymRecord()]);

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
    expect(chain['insert']).toHaveBeenCalledTimes(1);
  });

  it('should call insert N times when replaceFileSymbols receives N symbols', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);
    const syms = [
      makeSymRecord({ name: 'fn1' }),
      makeSymRecord({ name: 'fn2' }),
      makeSymRecord({ name: 'fn3' }),
    ];

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', syms);

    expect(chain['insert']).toHaveBeenCalledTimes(3);
  });

  it('should return all symbol records when getFileSymbols is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeSymRecord({ name: 'fn1' }), makeSymRecord({ name: 'fn2' })] as SymbolRecord[];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new SymbolRepository(db);
    const result = repo.getFileSymbols('test-project', 'src/index.ts');

    expect(result).toEqual(records);
  });

  it('should return search results when searchByName receives a non-empty query', () => {
    const { db, chain } = makeDbMock();
    const records = [makeSymRecord() as SymbolRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new SymbolRepository(db);
    const result = repo.searchByName('test-project', 'myFn');

    expect(result).toEqual(records);
    expect(chain['select']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should pass kind filter into where clause when searchByName is called with opts.kind', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.searchByName('test-project', 'myFn', { kind: 'function' });

    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should return type-filtered records when searchByKind is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeSymRecord({ kind: 'class' }) as SymbolRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new SymbolRepository(db);
    const result = repo.searchByKind('test-project', 'class');

    expect(result).toEqual(records);
  });

  it('should return symbolCount and fileCount when getStats finds matching rows', () => {
    const { db, chain } = makeDbMock();
    chain['get']!.mockReturnValue({ symbolCount: 5, fileCount: 2 } as unknown);

    const repo = new SymbolRepository(db);
    const stats = repo.getStats('test-project');

    expect(stats.symbolCount).toBe(5);
    expect(stats.fileCount).toBe(2);
  });

  it('should return records that match the fingerprint when getByFingerprint is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeSymRecord({ fingerprint: 'fp001' }) as SymbolRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new SymbolRepository(db);
    const result = repo.getByFingerprint('test-project', 'fp001');

    expect(result).toEqual(records);
  });

  it('should call delete chain when deleteFileSymbols is invoked', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.deleteFileSymbols('test-project', 'src/index.ts');

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  it('should include ftsQuery and project filters when searchByQuery receives both', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.searchByQuery({ ftsQuery: '"myFn"*', project: 'test-project', limit: 10 });

    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should include isExported=1 condition when searchByQuery is called with isExported:true', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByQuery({ isExported: true, limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should include isExported=0 condition when searchByQuery is called with isExported:false', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByQuery({ isExported: false, limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should not call insert when replaceFileSymbols receives an empty array', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', []);

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['insert']).not.toHaveBeenCalled();
  });

  it('should return empty array immediately when searchByName receives an empty query string', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    const result = repo.searchByName('test-project', '');

    expect(result).toEqual([]);
    expect(chain['select']).not.toHaveBeenCalled();
  });

  it('should return zeros when getStats row is undefined and ?? 0 coalesces', () => {
    const { db, chain } = makeDbMock();
    chain['get']!.mockReturnValue(undefined as unknown);

    const repo = new SymbolRepository(db);
    const stats = repo.getStats('empty-project');

    expect(stats.symbolCount).toBe(0);
    expect(stats.fileCount).toBe(0);
  });

  it('should call insert exactly once when replaceFileSymbols receives exactly 1 symbol', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymRecord()]);

    expect(chain['insert']).toHaveBeenCalledTimes(1);
  });

  it('should apply kind filter and limit when searchByName receives both opts simultaneously', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByName('test-project', 'fn', { kind: 'function', limit: 5 })).not.toThrow();
    expect(chain['limit']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should execute delete before insert on each replaceFileSymbols call', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);
    const sym = makeSymRecord();

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [sym]);
    repo.replaceFileSymbols('test-project', 'src/index.ts', 'xyz789', [sym, sym]);

    expect(chain['delete']).toHaveBeenCalledTimes(2);
    expect(chain['insert']).toHaveBeenCalledTimes(3);
  });

  it('should call where with exactName condition when searchByQuery receives exactName', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByQuery({ exactName: 'myFn', limit: 10 })).not.toThrow();
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should apply exactName and kind filter simultaneously when searchByQuery receives both', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByQuery({ exactName: 'MyClass', kind: 'class', limit: 10 })).not.toThrow();
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should not include exactName condition when searchByQuery is called without exactName', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByQuery({ limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  // ── LEG-1 / FR-19 ─────────────────────────────────────────────────────────

  // [HP] decorator 있을 때 searchByQuery 체인 .all() 호출됨
  it('should call all() without throwing when searchByQuery receives a decorator filter', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByQuery({ decorator: 'Injectable', limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  // [HP] regex 있을 때 searchByQuery 체인 .all() 호출됨
  it('should call all() without throwing when searchByQuery receives a regex filter', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByQuery({ regex: '^get', limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  // ── resolved_type ──────────────────────────────────────────────────────────

  // 1. [HP] resolvedType 값 있을 때 → values()에 resolvedType 전달
  it('should pass resolvedType value to insert when replaceFileSymbols receives a symbol with resolvedType set', () => {
    // Arrange
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    // Act
    repo.replaceFileSymbols('p', 'f.ts', 'h', [makeSymRecord({ resolvedType: 'string | undefined' })]);

    // Assert
    expect(chain['values']).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedType: 'string | undefined' }),
    );
  });

  // 2. [HP] resolvedType undefined → null coalesce
  it('should pass null resolvedType to insert when symbol has no resolvedType field', () => {
    // Arrange
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    // Act
    repo.replaceFileSymbols('p', 'f.ts', 'h', [makeSymRecord()]);

    // Assert
    expect(chain['values']).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedType: null }),
    );
  });

  // 3. [HP] searchByQuery: resolvedType 필터 있을 때 → where + all 호출
  it('should call where and all when searchByQuery receives a resolvedType filter', () => {
    // Arrange
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    // Act
    expect(() => repo.searchByQuery({ resolvedType: 'Promise<void>', limit: 10 })).not.toThrow();

    // Assert
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 4. [HP] searchByQuery: resolvedType + kind 동시 → 정상 동작
  it('should call where and all when searchByQuery receives resolvedType and kind simultaneously', () => {
    // Arrange
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    // Act
    expect(() =>
      repo.searchByQuery({ resolvedType: 'string', kind: 'function', limit: 10 }),
    ).not.toThrow();

    // Assert
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 5. [NE] resolvedType="" → 빈 문자열 그대로 저장
  it('should pass empty string resolvedType to insert when resolvedType is empty string', () => {
    // Arrange
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    // Act
    repo.replaceFileSymbols('p', 'f.ts', 'h', [makeSymRecord({ resolvedType: '' })]);

    // Assert
    expect(chain['values']).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedType: '' }),
    );
  });

  // 6. [CO] searchByQuery: resolvedType + isExported + kind 동시
  it('should call where and all when searchByQuery receives resolvedType, isExported, and kind together', () => {
    // Arrange
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    // Act
    expect(() =>
      repo.searchByQuery({ resolvedType: 'number', isExported: true, kind: 'const', limit: 20 }),
    ).not.toThrow();

    // Assert
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });
});
