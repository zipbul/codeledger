import { describe, expect, it, mock } from 'bun:test';
import type { Mock } from 'bun:test';
import { RelationRepository } from './relation.repository';
import type { RelationRecord } from './relation.repository';
import type { DbConnection } from '../connection';

function makeChainMock() {
  const chain: Record<string, Mock<any>> = {};
  for (const m of [
    'select', 'from', 'where', 'insert', 'values', 'delete',
    'update', 'set', 'limit',
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
  (db as unknown as Record<string, unknown>)['transaction'] = (fn: (tx: DbConnection) => unknown) => fn(db);
  return { db, chain };
}

function makeRelRecord(overrides: Partial<RelationRecord> = {}): Partial<RelationRecord> {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath: 'src/index.ts',
    srcSymbolName: null,
    dstProject: 'test-project',
    dstFilePath: 'src/utils.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

describe('RelationRepository', () => {
  it('should call delete and then insert once when replaceFileRelations receives 1 relation', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    repo.replaceFileRelations('test-project', 'src/index.ts', [makeRelRecord()]);

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['insert']).toHaveBeenCalledTimes(1);
    expect(chain['run']).toHaveBeenCalled();
  });

  it('should call insert N times when replaceFileRelations receives N relations', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);
    const rels = [
      makeRelRecord({ dstFilePath: 'src/a.ts' }),
      makeRelRecord({ dstFilePath: 'src/b.ts' }),
      makeRelRecord({ dstFilePath: 'src/c.ts' }),
    ];

    repo.replaceFileRelations('test-project', 'src/index.ts', rels);

    expect(chain['insert']).toHaveBeenCalledTimes(3);
  });

  it('should execute unfiltered query when getOutgoing is called without srcSymbolName', () => {
    const { db, chain } = makeDbMock();
    const records = [makeRelRecord() as RelationRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new RelationRepository(db);
    const result = repo.getOutgoing('test-project', 'src/index.ts');

    expect(result).toEqual(records);
    expect(chain['select']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should execute filtered query when getOutgoing is called with srcSymbolName', () => {
    const { db, chain } = makeDbMock();
    const records = [makeRelRecord({ srcSymbolName: 'myFn' }) as RelationRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new RelationRepository(db);
    const result = repo.getOutgoing('test-project', 'src/index.ts', 'myFn');

    expect(result).toEqual(records);
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should return incoming relations when getIncoming is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeRelRecord() as RelationRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new RelationRepository(db);
    const result = repo.getIncoming({ dstProject: 'test-project', dstFilePath: 'src/utils.ts' });

    expect(result).toEqual(records);
  });

  it('should return only matching-type relations when getByType is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeRelRecord({ type: 'calls' }) as RelationRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new RelationRepository(db);
    const result = repo.getByType('test-project', 'calls');

    expect(result).toEqual(records);
  });

  it('should call delete chain when deleteFileRelations is invoked', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    repo.deleteFileRelations('test-project', 'src/index.ts');

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  it('should pass all filter conditions when searchRelations receives all opts', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() => repo.searchRelations({
      srcFilePath: 'src/a.ts',
      srcSymbolName: 'fn',
      dstFilePath: 'src/b.ts',
      dstSymbolName: 'handler',
      type: 'calls',
      project: 'test-project',
      limit: 10,
    })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should apply only the project filter when searchRelations receives only project opt', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() => repo.searchRelations({ project: 'test-project', limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should use eq(dstSymbolName) condition when retargetRelations is called with non-null oldSymbol', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() =>
      repo.retargetRelations({ dstProject: 'test-project', oldFile: 'src/old.ts', oldSymbol: 'OldFn', newFile: 'src/new.ts', newSymbol: 'NewFn' }),
    ).not.toThrow();
    expect(chain['update']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  it('should use isNull(dstSymbolName) condition when retargetRelations is called with null oldSymbol', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() =>
      repo.retargetRelations({ dstProject: 'test-project', oldFile: 'src/old.ts', oldSymbol: null, newFile: 'src/new.ts', newSymbol: null }),
    ).not.toThrow();
    expect(chain['update']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  it('should not call insert when replaceFileRelations receives an empty array', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    repo.replaceFileRelations('test-project', 'src/index.ts', []);

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['insert']).not.toHaveBeenCalled();
  });

  it('should return empty array when getOutgoing finds no relations for unknown file', () => {
    const { db, chain } = makeDbMock();
    chain['all']!.mockReturnValue([]);

    const repo = new RelationRepository(db);
    const result = repo.getOutgoing('test-project', 'src/nonexistent.ts');

    expect(result).toEqual([]);
  });

  it('should use filtered query path when getOutgoing is called with empty-string srcSymbolName', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() => repo.getOutgoing('test-project', 'src/index.ts', '')).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should execute a fresh delete+insert sequence on each replaceFileRelations call', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);
    const rel = makeRelRecord();

    repo.replaceFileRelations('test-project', 'src/index.ts', [rel]);
    repo.replaceFileRelations('test-project', 'src/index.ts', [rel, rel]);

    expect(chain['delete']).toHaveBeenCalledTimes(2);
    expect(chain['insert']).toHaveBeenCalledTimes(3);
  });

  it('should apply srcFilePath and type filters together when both are provided to searchRelations', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() =>
      repo.searchRelations({ srcFilePath: 'src/a.ts', type: 'imports', limit: 5 }),
    ).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should include explicit dstProject in insert values when replaceFileRelations receives dstProject field', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    repo.replaceFileRelations('proj-a', 'src/a.ts', [
      makeRelRecord({ type: 'imports', dstFilePath: 'src/b.ts', dstProject: 'proj-b' }),
    ]);

    const insertedValues = (chain['values'] as { mock: { calls: any[][] } }).mock.calls[0]?.[0];
    expect(insertedValues?.dstProject).toBe('proj-b');
  });

  it('should fallback dstProject to project when replaceFileRelations receives no dstProject field', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    const relNoProject: Partial<RelationRecord> = { type: 'imports', dstFilePath: 'src/b.ts' };
    repo.replaceFileRelations('proj-a', 'src/a.ts', [relNoProject]);

    const insertedValues = (chain['values'] as { mock: { calls: any[][] } }).mock.calls[0]?.[0];
    expect(insertedValues?.dstProject).toBe('proj-a');
  });
});
