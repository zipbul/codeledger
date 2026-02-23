import { describe, expect, it, mock } from 'bun:test';
import type { Mock } from 'bun:test';
import { FileRepository } from './file.repository';
import type { FileRecord } from './file.repository';
import type { DbConnection } from '../connection';

function makeChainMock() {
  const chain: Record<string, Mock<any>> = {};
  for (const m of [
    'select', 'from', 'where', 'insert', 'values', 'onConflictDoUpdate',
    'delete', 'update', 'set',
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

function makeFileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
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

describe('FileRepository', () => {
  it('should return FileRecord when getFile finds matching record', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord();
    chain['get']!.mockReturnValue(record as unknown);

    const repo = new FileRepository(db);
    const result = repo.getFile('test-project', 'src/index.ts');

    expect(result).toEqual(record);
    expect(chain['select']).toHaveBeenCalled();
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['get']).toHaveBeenCalled();
  });

  it('should call insert chain with all record fields when upsertFile is invoked', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ filePath: 'src/utils.ts', contentHash: 'xyz789' });

    const repo = new FileRepository(db);
    repo.upsertFile(record);

    expect(chain['insert']).toHaveBeenCalled();
    expect(chain['values']).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'src/utils.ts',
        contentHash: 'xyz789',
        project: 'test-project',
      }),
    );
    expect(chain['run']).toHaveBeenCalled();
  });

  it('should return all file records when getAllFiles is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeFileRecord({ filePath: 'src/a.ts' }), makeFileRecord({ filePath: 'src/b.ts' })];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new FileRepository(db);
    const result = repo.getAllFiles('test-project');

    expect(result).toEqual(records);
    expect(chain['all']).toHaveBeenCalled();
  });

  it('should return Map with 3 entries keyed by filePath when getFilesMap is called with 3 records', () => {
    const { db, chain } = makeDbMock();
    const records = [
      makeFileRecord({ filePath: 'src/a.ts' }),
      makeFileRecord({ filePath: 'src/b.ts' }),
      makeFileRecord({ filePath: 'src/c.ts' }),
    ];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new FileRepository(db);
    const map = repo.getFilesMap('test-project');

    expect(map.size).toBe(3);
    expect(map.get('src/a.ts')).toEqual(records[0]);
    expect(map.get('src/b.ts')).toEqual(records[1]);
    expect(map.get('src/c.ts')).toEqual(records[2]);
  });

  it('should call delete chain when deleteFile is invoked', () => {
    const { db, chain } = makeDbMock();

    const repo = new FileRepository(db);
    repo.deleteFile('test-project', 'src/index.ts');

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  it('should return null when getFile does not find a matching record', () => {
    const { db, chain } = makeDbMock();
    chain['get']!.mockReturnValue(undefined as unknown);

    const repo = new FileRepository(db);
    const result = repo.getFile('test-project', 'src/missing.ts');

    expect(result).toBeNull();
  });

  it('should return empty array when getAllFiles finds no records', () => {
    const { db, chain } = makeDbMock();
    chain['all']!.mockReturnValue([]);

    const repo = new FileRepository(db);
    const result = repo.getAllFiles('unknown-project');

    expect(result).toEqual([]);
  });

  it('should return empty Map when getFilesMap finds no records', () => {
    const { db, chain } = makeDbMock();
    chain['all']!.mockReturnValue([]);

    const repo = new FileRepository(db);
    const map = repo.getFilesMap('test-project');

    expect(map.size).toBe(0);
    expect(map).toBeInstanceOf(Map);
  });

  it('should return Map with exactly 1 entry when getFilesMap receives 1 record', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ filePath: 'src/only.ts' });
    chain['all']!.mockReturnValue([record as unknown]);

    const repo = new FileRepository(db);
    const map = repo.getFilesMap('test-project');

    expect(map.size).toBe(1);
    expect(map.get('src/only.ts')).toEqual(record);
  });

  it('should support sequential upsertFile then getFile calls on the same repository instance', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord();

    const repo = new FileRepository(db);
    repo.upsertFile(record);

    chain['get']!.mockReturnValue(record as unknown);
    const fetched = repo.getFile('test-project', 'src/index.ts');

    expect(fetched).toEqual(record);
    expect(chain['insert']).toHaveBeenCalled();
    expect(chain['select']).toHaveBeenCalled();
  });

  it('should not throw when multiple methods are called on the same FileRepository instance', () => {
    const { db, chain } = makeDbMock();
    chain['all']!.mockReturnValue([makeFileRecord() as unknown]);

    const repo = new FileRepository(db);
    expect(() => repo.getAllFiles('test-project')).not.toThrow();
    expect(() => repo.deleteFile('test-project', 'src/index.ts')).not.toThrow();
    expect(() => repo.upsertFile(makeFileRecord())).not.toThrow();
  });

  // --- IMP-D: lineCount ---

  // 1. [HP] upsertFile passes lineCount in insert values
  it('should pass lineCount in insert values when upsertFile is called with lineCount=10', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ lineCount: 10 } as any);

    const repo = new FileRepository(db);
    repo.upsertFile(record);

    expect(chain['values']).toHaveBeenCalledWith(
      expect.objectContaining({ lineCount: 10 }),
    );
  });

  // 2. [HP] upsertFile passes lineCount in onConflictDoUpdate set
  it('should include lineCount in onConflictDoUpdate set when upsertFile is called with lineCount=10', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ lineCount: 10 } as any);

    const repo = new FileRepository(db);
    repo.upsertFile(record);

    expect(chain['onConflictDoUpdate']).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ lineCount: 10 }) }),
    );
  });

  // 3. [NE] upsertFile with lineCount=null passes null to DB
  it('should pass null lineCount in insert values when upsertFile is called with lineCount=null', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ lineCount: null } as any);

    const repo = new FileRepository(db);
    repo.upsertFile(record);

    expect(chain['values']).toHaveBeenCalledWith(
      expect.objectContaining({ lineCount: null }),
    );
  });

  // 4. [ED] upsertFile with lineCount=1 (minimum valid)
  it('should pass lineCount=1 in insert values when upsertFile is called with lineCount=1', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ lineCount: 1 } as any);

    const repo = new FileRepository(db);
    repo.upsertFile(record);

    expect(chain['values']).toHaveBeenCalledWith(
      expect.objectContaining({ lineCount: 1 }),
    );
  });

  // 5. [HP] upsertFile with lineCount in both values and set
  it('should include lineCount in both values and onConflictDoUpdate set in a single upsertFile call', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ lineCount: 7 } as any);

    const repo = new FileRepository(db);
    repo.upsertFile(record);

    expect(chain['values']).toHaveBeenCalledWith(expect.objectContaining({ lineCount: 7 }));
    expect(chain['onConflictDoUpdate']).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ lineCount: 7 }) }),
    );
  });

  // 6. [OR] second upsertFile call with different lineCount carries updated value
  it('should pass updated lineCount in second upsertFile call when lineCount changes from 5 to 10', () => {
    const { db, chain } = makeDbMock();
    const repo = new FileRepository(db);

    repo.upsertFile(makeFileRecord({ lineCount: 5 } as any));
    repo.upsertFile(makeFileRecord({ lineCount: 10 } as any));

    const calls = chain['values']!.mock.calls as any[][];
    expect(calls[1]![0]).toEqual(expect.objectContaining({ lineCount: 10 }));
  });

  // 7. [ID] upsertFile twice with same lineCount → both calls have same lineCount
  it('should pass same lineCount in both calls when upsertFile is invoked twice with lineCount=5', () => {
    const { db, chain } = makeDbMock();
    const repo = new FileRepository(db);

    repo.upsertFile(makeFileRecord({ lineCount: 5 } as any));
    repo.upsertFile(makeFileRecord({ lineCount: 5 } as any));

    const calls = chain['values']!.mock.calls as any[][];
    expect(calls[0]![0]).toEqual(expect.objectContaining({ lineCount: 5 }));
    expect(calls[1]![0]).toEqual(expect.objectContaining({ lineCount: 5 }));
  });
});
