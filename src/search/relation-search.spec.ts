import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { RelationRecord } from '../store/repositories/relation.repository';
import { relationSearch } from './relation-search';
import type { IRelationRepo, RelationSearchQuery, StoredCodeRelation } from './relation-search';
import type { CodeRelation } from '../extractor/types';

function makeRelationRecord(overrides: Partial<RelationRecord> = {}): RelationRecord {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath: 'src/a.ts',
    srcSymbolName: null,
    dstProject: 'test-project',
    dstFilePath: 'src/b.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

let mockSearchRelations: ReturnType<typeof mock>;
let mockRepo: IRelationRepo;

beforeEach(() => {
  mockSearchRelations = mock((opts: unknown) => [] as RelationRecord[]);
  mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
});

describe('relationSearch', () => {

  it('should pass srcFilePath to searchRelations when srcFilePath is set', () => {
    const query: RelationSearchQuery = { srcFilePath: 'src/a.ts' };
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.srcFilePath).toBe('src/a.ts');
  });

  it('should pass srcSymbolName to searchRelations when srcSymbolName is set', () => {
    const query: RelationSearchQuery = { srcSymbolName: 'myFn' };
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.srcSymbolName).toBe('myFn');
  });

  it('should pass dstFilePath to searchRelations when dstFilePath is set', () => {
    const query: RelationSearchQuery = { dstFilePath: 'src/b.ts' };
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.dstFilePath).toBe('src/b.ts');
  });

  it('should pass dstSymbolName to searchRelations when dstSymbolName is set', () => {
    const query: RelationSearchQuery = { dstSymbolName: 'MyClass' };
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.dstSymbolName).toBe('MyClass');
  });

  it('should pass type to searchRelations when type is set', () => {
    const query: RelationSearchQuery = { type: 'imports' };
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.type).toBe('imports');
  });

  it('should use options.project as effectiveProject when query.project is absent', () => {
    const query: RelationSearchQuery = {};
    relationSearch({ relationRepo: mockRepo, project: 'p1', query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p1');
  });

  it('should use query.project as effectiveProject when options.project is also provided', () => {
    const query: RelationSearchQuery = { project: 'p2' };
    relationSearch({ relationRepo: mockRepo, project: 'p1', query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p2');
  });

  it('should pass effectiveProject=undefined when neither project is set', () => {
    const query: RelationSearchQuery = {};
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBeUndefined();
  });

  it('should pass limit=50 to searchRelations when query.limit is 50', () => {
    const query: RelationSearchQuery = { limit: 50 };
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(50);
  });

  it('should pass limit=500 to searchRelations when query.limit is absent', () => {
    const query: RelationSearchQuery = {};
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(500);
  });

  it('should set result.srcSymbolName=null when record.srcSymbolName is null', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ srcSymbolName: null })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.srcSymbolName).toBeNull();
  });

  it('should preserve result.srcSymbolName when record.srcSymbolName is a string', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ srcSymbolName: 'myFn' })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.srcSymbolName).toBe('myFn');
  });

  it('should set result.dstSymbolName=null when record.dstSymbolName is null', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ dstSymbolName: null })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.dstSymbolName).toBeNull();
  });

  it('should set result.metaJson=undefined when record.metaJson is null', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: null })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.metaJson).toBeUndefined();
  });

  it('should call searchRelations with limit=500 and no filters when empty query is given', () => {
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results).toEqual([]);
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(500);
  });

  it('should pass all filters to searchRelations when all query fields are provided', () => {
    const query: RelationSearchQuery = {
      srcFilePath: 'src/a.ts',
      srcSymbolName: 'fn',
      dstFilePath: 'src/b.ts',
      dstSymbolName: 'cls',
      type: 'calls',
      project: 'proj',
      limit: 10,
    };
    relationSearch({ relationRepo: mockRepo, query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.srcFilePath).toBe('src/a.ts');
    expect(opts.srcSymbolName).toBe('fn');
    expect(opts.dstFilePath).toBe('src/b.ts');
    expect(opts.dstSymbolName).toBe('cls');
    expect(opts.type).toBe('calls');
    expect(opts.project).toBe('proj');
    expect(opts.limit).toBe(10);
  });

  it('should propagate error when relationRepo.searchRelations throws', () => {
    mockSearchRelations = mock(() => { throw new Error('db error'); });
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    expect(() => relationSearch({ relationRepo: mockRepo, query: {} })).toThrow('db error');
  });

  it('should return [] when searchRelations returns empty array', () => {
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results).toEqual([]);
  });

  it('should use empty string as effectiveProject when query.project is "" (not null/undefined)', () => {
    const query: RelationSearchQuery = { project: '' };
    relationSearch({ relationRepo: mockRepo, project: 'real', query });
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('');
  });

  it('should map a single RelationRecord correctly when building CodeRelation', () => {
    mockSearchRelations = mock(() => [
      makeRelationRecord({
        type: 'imports',
        srcFilePath: 'src/a.ts',
        srcSymbolName: 'fnA',
        dstFilePath: 'src/b.ts',
        dstSymbolName: 'fnB',
        metaJson: '{}',
      }),
    ]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.type).toBe('imports');
    expect(r.srcFilePath).toBe('src/a.ts');
    expect(r.srcSymbolName).toBe('fnA');
    expect(r.dstFilePath).toBe('src/b.ts');
    expect(r.dstSymbolName).toBe('fnB');
    expect(r.metaJson).toBe('{}');
  });

  // --- META: meta field auto-parsing ---

  // 1. [HP] valid metaJson → meta object parsed
  it('should set meta to parsed object when metaJson is valid JSON', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: '{"isType":true}' })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toEqual({ isType: true });
  });

  // 2. [HP] multi-key metaJson → meta with all keys
  it('should set meta with all key-value pairs when metaJson has multiple entries', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: '{"a":1,"b":"hello","flag":true}' })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toEqual({ a: 1, b: 'hello', flag: true });
  });

  // 3. [HP] result still includes metaJson alongside meta (backward compat)
  it('should preserve metaJson field alongside meta in the returned CodeRelation', () => {
    const json = '{"isReExport":true}';
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: json })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.metaJson).toBe(json);
    expect(results[0]!.meta).toEqual({ isReExport: true });
  });

  // 4. [HP] multiple records all with valid metaJson → all get meta
  it('should parse meta for each record independently when multiple records have valid metaJson', () => {
    mockSearchRelations = mock(() => [
      makeRelationRecord({ metaJson: '{"k":1}', srcFilePath: 'a.ts' }),
      makeRelationRecord({ metaJson: '{"k":2}', srcFilePath: 'b.ts' }),
    ]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toEqual({ k: 1 });
    expect(results[1]!.meta).toEqual({ k: 2 });
  });

  // 5. [NE] metaJson=null → meta=undefined
  it('should set meta to undefined when metaJson is null', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: null })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toBeUndefined();
  });

  // 6. [NE] malformed JSON → meta=undefined, console.error called
  it('should set meta to undefined and log error when metaJson is malformed JSON', () => {
    const spyError = spyOn(console, 'error').mockImplementation(() => {});
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: '{broken' })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toBeUndefined();
    expect(spyError).toHaveBeenCalled();
    spyError.mockRestore();
  });

  // 7. [NE] mixed [null, valid] records → [undefined, parsed]
  it('should return undefined meta for null record and parsed meta for valid record in mixed array', () => {
    mockSearchRelations = mock(() => [
      makeRelationRecord({ metaJson: null, srcFilePath: 'a.ts' }),
      makeRelationRecord({ metaJson: '{"a":1}', srcFilePath: 'b.ts' }),
    ]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toBeUndefined();
    expect(results[1]!.meta).toEqual({ a: 1 });
  });

  // 8. [ED] empty string metaJson → falsy → meta=undefined
  it('should set meta to undefined when metaJson is empty string', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: '' as any })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toBeUndefined();
  });

  // 9. [ED] metaJson='{}' → meta={}
  it('should set meta to empty object when metaJson is empty JSON object', () => {
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: '{}' })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toEqual({});
  });

  // 10. [ED] records=[] → returns [] no meta parsing
  it('should return empty array with no meta parsing when searchRelations returns no records', () => {
    mockSearchRelations = mock(() => []);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results).toHaveLength(0);
  });

  // 11. [CO] malformed first + valid second → independent parsing
  it('should independently handle malformed first record and valid second record meta parsing', () => {
    const spyError = spyOn(console, 'error').mockImplementation(() => {});
    mockSearchRelations = mock(() => [
      makeRelationRecord({ metaJson: '{bad}', srcFilePath: 'a.ts' }),
      makeRelationRecord({ metaJson: '{"ok":1}', srcFilePath: 'b.ts' }),
    ]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(results[0]!.meta).toBeUndefined();
    expect(results[1]!.meta).toEqual({ ok: 1 });
    spyError.mockRestore();
  });

  // 12. [ID] same query called twice → same meta result
  it('should return same meta value on repeated calls with identical records', () => {
    const json = '{"k":42}';
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: json })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    const r1 = relationSearch({ relationRepo: mockRepo, query: {} });
    const r2 = relationSearch({ relationRepo: mockRepo, query: {} });
    expect(r1[0]!.meta).toEqual({ k: 42 });
    expect(r2[0]!.meta).toEqual({ k: 42 });
  });

  it('should include dstProject in the returned relation when record has dstProject set', () => {
    mockSearchRelations.mockReturnValue([makeRelationRecord({ dstProject: 'ext-project' })]);

    const results = relationSearch({ relationRepo: mockRepo, query: {} }) as StoredCodeRelation[];
    expect(results[0]?.dstProject).toBe('ext-project');
  });

  it('should forward dstProject filter to searchRelations when dstProject is set in query', () => {
    mockSearchRelations.mockReturnValue([]);

    relationSearch({ relationRepo: mockRepo, query: { dstProject: 'ext-project' } });

    const callArgs = (mockSearchRelations as { mock: { calls: any[][] } }).mock.calls[0]?.[0];
    expect(callArgs?.dstProject).toBe('ext-project');
  });
});
