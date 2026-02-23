import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ParsedFile } from '../parser/types';

const mockExtractSymbols = mock((parsed: any) => [] as any[]);

const mockHashString = mock((input: string) => 'fp-hash');
mock.module('../extractor/symbol-extractor', () => ({ extractSymbols: mockExtractSymbols }));
mock.module('../common/hasher', () => ({ hashString: mockHashString }));
import { indexFileSymbols } from './symbol-indexer';

const PROJECT = 'test-project';
const FILE_PATH = 'src/index.ts';
const CONTENT_HASH = 'abc123';

function makeParsedFile(): ParsedFile {
  return { filePath: '/project/src/index.ts', program: {} as any, errors: [], comments: [], sourceText: '' };
}

function makeSymbol(overrides: Partial<{
  kind: string; name: string; isExported: boolean;
  parameters: any[]; returnType: string; modifiers: string[];
  heritage: any[]; decorators: any[]; members: any[];
  jsDoc: any; methodKind: string; typeParameters: string[];
}> = {}) {
  return {
    kind: 'function',
    name: 'myFn',
    span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
    isExported: true,
    modifiers: [],
    ...overrides,
  };
}

function makeSymbolRepo() {
  return { replaceFileSymbols: mock((p: any, f: any, h: any, syms: any) => {}) };
}

describe('indexFileSymbols', () => {
  beforeEach(() => {
    mock.module('../extractor/symbol-extractor', () => ({ extractSymbols: mockExtractSymbols }));
    mock.module('../common/hasher', () => ({ hashString: mockHashString }));
    mockExtractSymbols.mockReset();
    mockExtractSymbols.mockReturnValue([]);
    mockHashString.mockReset();
    mockHashString.mockReturnValue('fp-hash');
  });
  it('should set signature to params:2|async:0 when function has 2 params and is not async', () => {
    const sym = makeSymbol({ kind: 'function', parameters: [{ name: 'a', isOptional: false }, { name: 'b', isOptional: false }], modifiers: [] });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].signature).toBe('params:2|async:0');
  });

  it('should set signature to params:1|async:1 when function is async with 1 param', () => {
    const sym = makeSymbol({ kind: 'function', parameters: [{ name: 'a', isOptional: false }], modifiers: ['async'] });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].signature).toBe('params:1|async:1');
  });

  it('should produce 4 rows when class has 3 methods', () => {
    const cls = makeSymbol({
      kind: 'class', name: 'MyClass', modifiers: [],
      members: [
        makeSymbol({ kind: 'method', name: 'foo', modifiers: [] }),
        makeSymbol({ kind: 'method', name: 'bar', modifiers: [] }),
        makeSymbol({ kind: 'method', name: 'baz', modifiers: [] }),
      ],
    });
    mockExtractSymbols.mockReturnValue([cls]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols.length).toBe(4);
    expect(symbols.some((s: any) => s.name === 'MyClass.foo')).toBe(true);
    expect(symbols.some((s: any) => s.name === 'MyClass.bar')).toBe(true);
    expect(symbols.some((s: any) => s.name === 'MyClass.baz')).toBe(true);
  });

  it('should include jsDoc in detail_json when symbol has jsDoc', () => {
    const sym = makeSymbol({ jsDoc: { description: 'A function', tags: [] } });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const detail = JSON.parse(symbols[0].detailJson);
    expect(detail.jsDoc).toEqual({ description: 'A function', tags: [] });
  });

  it('should omit jsDoc from detail_json when symbol has no jsDoc', () => {
    mockExtractSymbols.mockReturnValue([makeSymbol()]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const detail = symbols[0].detailJson ? JSON.parse(symbols[0].detailJson) : {};
    expect(detail.jsDoc).toBeUndefined();
  });

  it('should set signature to params:0|async:0 when function has no params', () => {
    const sym = makeSymbol({ kind: 'function', parameters: [], modifiers: [] });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].signature).toBe('params:0|async:0');
  });

  it('should set signature to null when symbol kind is type alias', () => {
    mockExtractSymbols.mockReturnValue([makeSymbol({ kind: 'type' })]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].signature).toBeNull();
  });

  it('should compute fingerprint when name kind and signature are available', () => {
    mockHashString.mockReturnValue('fingerprint-val');
    const sym = makeSymbol({ kind: 'function', name: 'fn', parameters: [], modifiers: [] });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].fingerprint).toBe('fingerprint-val');
    expect(mockHashString).toHaveBeenCalledWith(expect.stringContaining('fn'));
  });

  it('should call replaceFileSymbols when contentHash is provided', () => {
    mockExtractSymbols.mockReturnValue([makeSymbol()]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: 'the-hash', symbolRepo: symbolRepo as any });

    const [, , hash] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(hash).toBe('the-hash');
  });

  it('should call replaceFileSymbols with empty array when extractSymbols returns nothing', () => {
    mockExtractSymbols.mockReturnValue([]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols).toEqual([]);
  });

  it('should produce 1 row when class has no members', () => {
    const cls = makeSymbol({ kind: 'class', name: 'Empty', members: [], modifiers: [] });
    mockExtractSymbols.mockReturnValue([cls]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe('Empty');
  });

  it('should flatten interface members when interface symbols are indexed', () => {
    const iface = makeSymbol({
      kind: 'interface', name: 'IUser', members: [
        makeSymbol({ kind: 'property', name: 'id', modifiers: [] }),
      ],
    });
    mockExtractSymbols.mockReturnValue([iface]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols.some((s: any) => s.name === 'IUser.id')).toBe(true);
  });

  it('should produce 4 rows when enum has 3 members', () => {
    const en = makeSymbol({
      kind: 'enum', name: 'Color', members: [
        makeSymbol({ kind: 'property', name: 'Red', modifiers: [] }),
        makeSymbol({ kind: 'property', name: 'Green', modifiers: [] }),
        makeSymbol({ kind: 'property', name: 'Blue', modifiers: [] }),
      ],
    });
    mockExtractSymbols.mockReturnValue([en]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols.length).toBe(4);
  });

  it('should omit undefined fields when building detail_json', () => {
    mockExtractSymbols.mockReturnValue([makeSymbol({ kind: 'variable' })]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const raw = symbols[0].detailJson;
    if (raw) {
      const detail = JSON.parse(raw);
      expect(Object.keys(detail)).not.toContain('parameters');
      expect(Object.keys(detail)).not.toContain('returnType');
    } else {
      expect(raw).toBeNull();
    }
  });

  it('should include parameters and returnType when symbol kind is function', () => {
    const sym = makeSymbol({
      kind: 'function',
      parameters: [{ name: 'x', type: 'string', isOptional: false }],
      returnType: 'void',
      modifiers: [],
    });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const detail = JSON.parse(symbols[0].detailJson);
    expect(detail.parameters).toBeDefined();
    expect(detail.returnType).toBe('void');
  });

  // --- IMP-C: members full info ---

  function makeClassWithMember(memberOverrides: Parameters<typeof makeSymbol>[0]) {
    return makeSymbol({
      kind: 'class', name: 'MyClass', modifiers: [],
      members: [makeSymbol({ kind: 'method', name: 'doThing', modifiers: [], ...memberOverrides })],
    });
  }

  function getMemberDetail(memberOverrides: Parameters<typeof makeClassWithMember>[0] = {}) {
    const cls = makeClassWithMember(memberOverrides);
    mockExtractSymbols.mockReturnValue([cls]);
    const symbolRepo = makeSymbolRepo();
    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });
    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const classRow = symbols.find((s: any) => s.name === 'MyClass')!;
    return JSON.parse(classRow.detailJson!).members[0] as Record<string, unknown>;
  }

  // 1. [HP] method → kind:'method'
  it('should store kind method for a regular method member when building detailJson', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: [] });
    expect(m.kind).toBe('method');
    expect(m.name).toBe('doThing');
  });

  // 2. [HP] getter → kind:'getter' (methodKind 우선)
  it('should store kind getter for a getter member when methodKind is getter', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: [], methodKind: 'getter' });
    expect(m.kind).toBe('getter');
  });

  // 3. [HP] setter → kind:'setter'
  it('should store kind setter for a setter member when methodKind is setter', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: [], methodKind: 'setter' });
    expect(m.kind).toBe('setter');
  });

  // 4. [HP] constructor → kind:'constructor'
  it('should store kind constructor for a constructor member when methodKind is constructor', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: [], methodKind: 'constructor' });
    expect(m.kind).toBe('constructor');
  });

  // 5. [HP] property with returnType → kind:'property', type
  it('should store kind property and type annotation when member is a property with return type', () => {
    const m = getMemberDetail({ kind: 'property', name: 'doThing', modifiers: [], returnType: 'string' });
    expect(m.kind).toBe('property');
    expect(m.type).toBe('string');
  });

  // 6. [HP] private member → visibility:'private'
  it('should store visibility private when member has private modifier', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: ['private'] });
    expect(m.visibility).toBe('private');
  });

  // 7. [HP] protected member → visibility:'protected'
  it('should store visibility protected when member has protected modifier', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: ['protected'] });
    expect(m.visibility).toBe('protected');
  });

  // 8. [HP] public member → visibility:'public'
  it('should store visibility public when member has explicit public modifier', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: ['public'] });
    expect(m.visibility).toBe('public');
  });

  // 9. [HP] static member → isStatic:true
  it('should store isStatic true when member has static modifier', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: ['static'] });
    expect(m.isStatic).toBe(true);
  });

  // 10. [HP] readonly member → isReadonly:true
  it('should store isReadonly true when member has readonly modifier', () => {
    const m = getMemberDetail({ kind: 'property', name: 'doThing', modifiers: ['readonly'] });
    expect(m.isReadonly).toBe(true);
  });

  // 11. [NE] empty members array → detail.members absent
  it('should not include members key in detailJson when class has empty members array', () => {
    const cls = makeSymbol({ kind: 'class', name: 'Empty', modifiers: [], members: [] });
    mockExtractSymbols.mockReturnValue([cls]);
    const symbolRepo = makeSymbolRepo();
    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });
    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const detail = symbols[0].detailJson ? JSON.parse(symbols[0].detailJson) : {};
    expect(detail.members).toBeUndefined();
  });

  // 12. [CO] static+private → both flags
  it('should store both isStatic true and visibility private when member has static and private modifiers', () => {
    const m = getMemberDetail({ kind: 'method', name: 'doThing', modifiers: ['static', 'private'] });
    expect(m.isStatic).toBe(true);
    expect(m.visibility).toBe('private');
  });

  // 13. [ID] same sym twice → identical
  it('should produce identical members detail when indexFileSymbols called twice with same class', () => {
    const cls = makeClassWithMember({ kind: 'method', name: 'doThing', modifiers: ['public'] });
    mockExtractSymbols.mockReturnValue([cls]);
    const repo1 = makeSymbolRepo();
    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: repo1 as any });
    const [, , , syms1] = repo1.replaceFileSymbols.mock.calls[0]!;

    mockExtractSymbols.mockReturnValue([cls]);
    const repo2 = makeSymbolRepo();
    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: repo2 as any });
    const [, , , syms2] = repo2.replaceFileSymbols.mock.calls[0]!;

    expect(syms1[0].detailJson).toBe(syms2[0].detailJson);
  });
});
