import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SymbolRecord } from '../store/repositories/symbol.repository';
import { symbolSearch } from './symbol-search';
import type { ISymbolRepo, SymbolSearchQuery, SymbolSearchResult } from './symbol-search';

function makeSymbolRecord(overrides: Partial<SymbolRecord & { id: number }> = {}): SymbolRecord & { id: number } {
  return {
    id: 1,
    project: 'test-project',
    filePath: 'src/index.ts',
    kind: 'function',
    name: 'myFn',
    startLine: 1,
    startColumn: 0,
    endLine: 5,
    endColumn: 1,
    isExported: 1,
    signature: null,
    fingerprint: null,
    detailJson: null,
    contentHash: 'abc123',
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

let mockSearchByQuery: ReturnType<typeof mock>;
let mockRepo: ISymbolRepo;

beforeEach(() => {
  mockSearchByQuery = mock((opts: unknown) => [] as (SymbolRecord & { id: number })[]);
  mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
});

describe('symbolSearch', () => {

  it('should pass quoted FTS prefix query to searchByQuery when text is "User"', () => {
    const query: SymbolSearchQuery = { text: 'User' };
    symbolSearch({ symbolRepo: mockRepo, query });
    expect(mockSearchByQuery).toHaveBeenCalledTimes(1);
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('"User"*');
  });

  it('should pass quoted FTS prefix query for each token when text has multiple words', () => {
    const query: SymbolSearchQuery = { text: 'User Service' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('"User"* "Service"*');
  });

  it('should escape double quotes inside tokens when building ftsQuery', () => {
    const query: SymbolSearchQuery = { text: 'A"B' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('"A""B"*');
  });

  it('should call searchByQuery without ftsQuery when kind-only filter is given', () => {
    const query: SymbolSearchQuery = { kind: 'function' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBeUndefined();
    expect(opts.kind).toBe('function');
  });

  it('should pass filePath filter to searchByQuery when filePath-only filter is given', () => {
    const query: SymbolSearchQuery = { filePath: 'src/a.ts' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.filePath).toBe('src/a.ts');
  });

  it('should pass isExported=true to searchByQuery when isExported is true', () => {
    const query: SymbolSearchQuery = { isExported: true };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.isExported).toBe(true);
  });

  it('should pass isExported=false to searchByQuery when isExported is false', () => {
    const query: SymbolSearchQuery = { isExported: false };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.isExported).toBe(false);
  });

  it('should use options.project as effectiveProject when query.project is absent', () => {
    const query: SymbolSearchQuery = {};
    symbolSearch({ symbolRepo: mockRepo, project: 'p1', query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p1');
  });

  it('should use query.project as effectiveProject when options.project is absent', () => {
    const query: SymbolSearchQuery = { project: 'p2' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p2');
  });

  it('should use query.project and ignore options.project when both are set', () => {
    const query: SymbolSearchQuery = { project: 'p2' };
    symbolSearch({ symbolRepo: mockRepo, project: 'p1', query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p2');
  });

  it('should pass effectiveProject=undefined when neither options.project nor query.project is set', () => {
    const query: SymbolSearchQuery = {};
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBeUndefined();
  });

  it('should pass limit=10 to searchByQuery when query.limit is 10', () => {
    const query: SymbolSearchQuery = { limit: 10 };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(10);
  });

  it('should pass limit=100 to searchByQuery when query.limit is absent', () => {
    const query: SymbolSearchQuery = {};
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(100);
  });

  it('should set result.detail to {} when detailJson is null', () => {
    mockSearchByQuery = mock(() => [makeSymbolRecord({ detailJson: null })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    expect(results[0]!.detail).toEqual({});
  });

  it('should parse detailJson and set result.detail when detailJson is a JSON string', () => {
    mockSearchByQuery = mock(() => [makeSymbolRecord({ detailJson: '{"returnType":"void"}' })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    expect(results[0]!.detail).toEqual({ returnType: 'void' });
  });

  it('should set result.isExported=true when record.isExported is 1', () => {
    mockSearchByQuery = mock(() => [makeSymbolRecord({ isExported: 1 })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    expect(results[0]!.isExported).toBe(true);
  });

  it('should set result.isExported=false when record.isExported is 0', () => {
    mockSearchByQuery = mock(() => [makeSymbolRecord({ isExported: 0 })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    expect(results[0]!.isExported).toBe(false);
  });

  it('should map startLine/startColumn/endLine/endColumn correctly when building result.span', () => {
    mockSearchByQuery = mock(() => [
      makeSymbolRecord({ startLine: 10, startColumn: 2, endLine: 20, endColumn: 5 }),
    ]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    expect(results[0]!.span).toEqual({
      start: { line: 10, column: 2 },
      end: { line: 20, column: 5 },
    });
  });

  it('should pass all filters to searchByQuery when all query fields are provided', () => {
    const query: SymbolSearchQuery = {
      text: 'fn',
      kind: 'function',
      filePath: 'src/a.ts',
      isExported: true,
      project: 'proj',
      limit: 5,
    };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('"fn"*');
    expect(opts.kind).toBe('function');
    expect(opts.filePath).toBe('src/a.ts');
    expect(opts.isExported).toBe(true);
    expect(opts.project).toBe('proj');
    expect(opts.limit).toBe(5);
  });

  it('should return [] and call searchByQuery with limit=100 when empty query is given', () => {
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    expect(results).toEqual([]);
    expect(mockSearchByQuery).toHaveBeenCalledTimes(1);
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(100);
  });

  it('should return [] when symbolRepo.searchByQuery returns empty array', () => {
    const results = symbolSearch({ symbolRepo: mockRepo, query: { text: 'nothing' } });
    expect(results).toEqual([]);
  });

  it('should propagate error when symbolRepo.searchByQuery throws', () => {
    mockSearchByQuery = mock(() => { throw new Error('db error'); });
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    expect(() => symbolSearch({ symbolRepo: mockRepo, query: {} })).toThrow('db error');
  });

  it('should return detail:{} when detailJson is invalid JSON (safe parse)', () => {
    mockSearchByQuery = mock(() => [makeSymbolRecord({ detailJson: '{invalid' })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    expect(results).toHaveLength(1);
    expect(results[0]!.detail).toEqual({});
  });

  it('should call searchByQuery without ftsQuery when text is empty string', () => {
    const query: SymbolSearchQuery = { text: '' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBeUndefined();
  });

  it('should pass limit=0 to searchByQuery when query.limit is 0', () => {
    const query: SymbolSearchQuery = { limit: 0 };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(0);
  });

  it('should produce quoted ftsQuery when text is a single character "a"', () => {
    const query: SymbolSearchQuery = { text: 'a' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('"a"*');
  });

  it('should quote special FTS5 characters safely when escaping query terms', () => {
    const query: SymbolSearchQuery = { text: 'fn-auth' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    const ftsQuery = opts.ftsQuery as string;
    expect(ftsQuery).toBe('"fn-auth"*');
  });

  it('should skip FTS and apply kind filter when text is empty string and kind is set', () => {
    const query: SymbolSearchQuery = { text: '', kind: 'function' };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBeUndefined();
    expect(opts.kind).toBe('function');
  });

  it('should use empty string as effectiveProject when query.project is "" (not null/undefined)', () => {
    const query: SymbolSearchQuery = { project: '' };
    symbolSearch({ symbolRepo: mockRepo, project: 'real', query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('');
  });

  it('should pass exactName to searchByQuery when exact is true', () => {
    const query: SymbolSearchQuery = { text: 'handle', exact: true };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.exactName).toBe('handle');
    expect(opts.ftsQuery).toBeUndefined();
  });

  it('should not set ftsQuery when exact is true', () => {
    const query: SymbolSearchQuery = { text: 'User', exact: true };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBeUndefined();
    expect(opts.exactName).toBe('User');
  });

  it('should ignore exact flag and set no filters when text is not provided and exact is true', () => {
    const query: SymbolSearchQuery = { exact: true };
    symbolSearch({ symbolRepo: mockRepo, query });
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.exactName).toBeUndefined();
    expect(opts.ftsQuery).toBeUndefined();
  });
});
