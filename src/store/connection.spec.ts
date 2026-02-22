import { beforeEach, describe, expect, it, mock } from 'bun:test';

let dbErrors: Array<Error | null> = [null];
let dbCallIdx = 0;
let lastDbInst: InstanceType<typeof MockDatabase> | null = null;

const mockMkdirSync = mock((path: string, opts?: unknown) => {});
const mockExistsSync = mock((path: string): boolean => true);
const mockUnlinkSync = mock((path: string) => {});

const mockDrizzleDb: Record<string, ReturnType<typeof mock>> = (() => {
  const chain: Record<string, ReturnType<typeof mock>> = {};
  for (const m of ['select', 'from', 'where', 'insert', 'values', 'delete', 'update', 'set', 'get', 'all', 'run']) {
    chain[m] = mock(() => chain as unknown);
  }
  chain['get'] = mock(() => null as unknown);
  chain['all'] = mock(() => [] as unknown[]);
  chain['run'] = mock(() => {});
  return chain;
})();

const mockDrizzleFn = mock((client: unknown, opts?: unknown) => mockDrizzleDb);
const mockMigrateFn = mock((db: unknown, opts?: unknown) => {});

mock.module('node:fs', () => ({
  mkdirSync: mockMkdirSync,
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
}));

mock.module('drizzle-orm/bun-sqlite', () => ({
  drizzle: mockDrizzleFn,
}));

mock.module('drizzle-orm/bun-sqlite/migrator', () => ({
  migrate: mockMigrateFn,
}));

class MockDatabase {
  readonly close = mock(() => {});
  readonly run = mock((sql: string) => {});
  readonly query = mock((sql: string) => ({ all: mock(() => [] as unknown[]) }));
  readonly transaction = mock((fn: Function) => () => fn());
  prepare(sql: string) {
    return {
      run: mock((...args: unknown[]) => {}),
      get: mock((...args: unknown[]) => null as unknown),
      all: mock((...args: unknown[]) => [] as unknown[]),
    };
  }
  constructor(path: string) {
    const idx = dbCallIdx++;
    const err = dbErrors[idx] ?? null;
    (this.constructor as unknown as { lastInst: MockDatabase }).lastInst = this;
    lastDbInst = this;
    if (err) throw err;
  }
}

mock.module('bun:sqlite', () => ({ Database: MockDatabase }));

import { isErr } from '@zipbul/result';
import { DbConnection } from './connection';

beforeEach(() => {
  dbCallIdx = 0;
  dbErrors = [null];
  lastDbInst = null;
  mockMkdirSync.mockClear();
  mockExistsSync.mockClear();
  mockUnlinkSync.mockClear();
  mockDrizzleFn.mockClear();
  mockMigrateFn.mockClear();
  mockExistsSync.mockImplementation((_: string) => true);
  mockDrizzleFn.mockImplementation((client: unknown, opts?: unknown) => mockDrizzleDb);
  mockMigrateFn.mockImplementation(() => {});
  mock.module('node:fs', () => ({
    mkdirSync: mockMkdirSync,
    existsSync: mockExistsSync,
    unlinkSync: mockUnlinkSync,
  }));
});

describe('DbConnection', () => {
  it('should call mkdirSync and migrate when open() succeeds normally', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();

    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzleFn).toHaveBeenCalledTimes(1);
    expect(mockMigrateFn).toHaveBeenCalledTimes(1);
    expect(lastDbInst).not.toBeNull();
  });

  it('should call client.close() when DbConnection.close() is invoked', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    const capturedInst = lastDbInst!;

    db.close();

    expect(capturedInst.close).toHaveBeenCalledTimes(1);
  });

  it('should invoke the bun-native client.transaction() when txDepth is 0', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    const capturedInst = lastDbInst!;
    const fn = mock((tx: DbConnection) => 'result');

    const result = db.transaction(fn);

    expect(result).toBe('result');
    expect(capturedInst.transaction).toHaveBeenCalled();
  });

  it('should return the fn return value when transaction() succeeds', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();

    const actual = db.transaction(() => 42);

    expect(actual).toBe(42);
  });

  it('should return the fn result when immediateTransaction() fn succeeds', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();

    const result = db.immediateTransaction(() => 'imt-result');

    expect(result).toBe('imt-result');
  });

  it('should retry open() when Database throws containing "malformed" error message', () => {
    dbErrors = [new Error('malformed database schema'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockDrizzleFn).toHaveBeenCalledTimes(1);
  });

  it('should retry open() when Database throws containing "corrupt" error message', () => {
    dbErrors = [new Error('database disk image is corrupt'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('should retry open() when Database throws containing "not a database" error message', () => {
    dbErrors = [new Error('file is not a database'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('should retry open() when Database throws containing "disk i/o error" error message', () => {
    dbErrors = [new Error('disk I/O error during read'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('should retry open() when Database throws containing "sqlite_corrupt" error message', () => {
    dbErrors = [new Error('SQLITE_CORRUPT: malformed result'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('should return Err with store type without retry when Database throws a non-corruption error', () => {
    dbErrors = [new Error('ENOMEM: out of memory')];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(isErr(db.open())).toBe(true);

    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('should rollback and rethrow when immediateTransaction() fn throws', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    const capturedInst = lastDbInst!;

    expect(() => db.immediateTransaction(() => { throw new Error('tx error'); })).toThrow('tx error');

    const runs = (capturedInst.run.mock.calls as [string][]).map(([sql]) => sql);
    expect(runs.some((sql) => sql?.includes('ROLLBACK'))).toBe(true);
  });

  it('should return Err with store type without retry when db file does not exist during corruption recovery', () => {
    dbErrors = [new Error('malformed database schema')];
    mockExistsSync.mockImplementation((_: string) => false);

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(isErr(db.open())).toBe(true);

    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
  });

  it('should recover from corruption by deleting the file and retrying open() successfully', () => {
    dbErrors = [new Error('corrupt: database image is malformed'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockDrizzleFn).toHaveBeenCalledTimes(1);
    expect(mockMigrateFn).toHaveBeenCalledTimes(1);
  });

  it('should use SAVEPOINT when transaction() is called while already inside a transaction', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    const capturedInst = lastDbInst!;

    db.transaction((tx) => {
      tx.transaction(() => 'inner-result');
      return 'outer-result';
    });

    const runs = (capturedInst.run.mock.calls as [string][]).map(([sql]) => sql);
    expect(runs.some((sql) => sql?.includes('SAVEPOINT'))).toBe(true);
  });
});
