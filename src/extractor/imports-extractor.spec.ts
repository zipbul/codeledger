import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockResolveImport = mock(() => [] as string[]);

const mockVisit = mock((_node: any, _cb: any) => {});
const mockGetStringLiteralValue = mock(() => null as string | null);

import { extractImports } from './imports-extractor';

const FILE = '/project/src/index.ts';
const RESOLVED = '/resolved/path.ts';

function fakeAst(body: any[]): any {
  return { body };
}

describe('extractImports', () => {
  beforeEach(() => {
    mock.module('../parser/ast-utils', () => ({
      visit: mockVisit,
      getStringLiteralValue: mockGetStringLiteralValue,
    }));
    mockResolveImport.mockClear();
    mockVisit.mockClear();
    mockGetStringLiteralValue.mockClear();
    mockResolveImport.mockReturnValue([RESOLVED]);
    mockVisit.mockImplementation(() => {});
    mockGetStringLiteralValue.mockReturnValue(null);
  });

  // 1. [HP] side-effect import
  it('should produce 1 relation with null dstSymbolName and null srcSymbolName when import has no specifiers', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './side' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBeNull();
    expect(relations[0]!.srcSymbolName).toBeNull();
    expect(relations[0]!.type).toBe('imports');
  });

  // 2. [HP] single named import
  it('should produce 1 relation with dstSymbolName Foo and srcSymbolName Foo when named import has one specifier', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Foo' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('Foo');
    expect(relations[0]!.srcSymbolName).toBe('Foo');
    expect(relations[0]!.type).toBe('imports');
  });

  // 3. [HP] alias named import
  it('should set dstSymbolName to original name and srcSymbolName to alias when named import uses alias', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Bar' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('Foo');
    expect(relations[0]!.srcSymbolName).toBe('Bar');
  });

  // 4. [HP] default import
  it('should produce 1 relation with dstSymbolName default and srcSymbolName equal to local name when default import is used', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportDefaultSpecifier', local: { name: 'MyDefault' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('default');
    expect(relations[0]!.srcSymbolName).toBe('MyDefault');
  });

  // 5. [HP] namespace import
  it('should produce 1 relation with dstSymbolName asterisk and importKind namespace in meta when namespace import is used', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportNamespaceSpecifier', local: { name: 'NS' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('*');
    expect(relations[0]!.srcSymbolName).toBe('NS');
    expect(relations[0]!.metaJson).toContain('"importKind":"namespace"');
  });

  // 6. [HP] multiple named imports
  it('should produce N relations matching specifier count when import has multiple named specifiers', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'A' }, local: { name: 'A' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'B' }, local: { name: 'B' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'C' }, local: { name: 'C' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(3);
    expect(relations.map((r) => r.dstSymbolName)).toEqual(['A', 'B', 'C']);
  });

  // 7. [HP] type-only import statement
  it('should include isType true in metaJson when import declaration has type-only statement-level import', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './types' },
        importKind: 'type',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'MyType' }, local: { name: 'MyType' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe('imports');
    expect(relations[0]!.metaJson).toContain('"isType":true');
  });

  // 8. [HP] ExportAllDeclaration regression
  it('should produce an imports relation with isReExport true when declaration is export star from', () => {
    const ast = fakeAst([
      { type: 'ExportAllDeclaration', source: { value: './barrel' }, exportKind: 'value' },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isReExport":true'));

    expect(rel).toBeDefined();
  });

  // 9. [HP] ExportNamedDeclaration regression
  it('should produce an imports relation with isReExport true when declaration is named re-export', () => {
    const ast = fakeAst([
      { type: 'ExportNamedDeclaration', source: { value: './local' } },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isReExport":true'));

    expect(rel).toBeDefined();
    expect(rel!.type).toBe('imports');
  });

  // 10. [HP] dynamic import regression
  it('should produce an imports relation with isDynamic true when declaration is a dynamic import expression', () => {
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb({ type: 'ImportExpression', source: { type: 'StringLiteral', value: './dynamic' } });
    });
    mockGetStringLiteralValue.mockReturnValue('./dynamic');

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isDynamic":true'));

    expect(rel).toBeDefined();
  });

  // 11. [NE] candidates empty → 0 relations
  it('should return no relation when import source path cannot be resolved', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: 'react' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'useState' }, local: { name: 'useState' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(0);
  });

  // 12. [NE] dynamic import sourceValue null
  it('should return no relation when dynamic import source value cannot be extracted as string literal', () => {
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb({ type: 'ImportExpression', source: { type: 'Identifier', name: 'dynamicPath' } });
    });
    mockGetStringLiteralValue.mockReturnValue(null);

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(0);
  });

  // 13. [ED] empty body
  it('should return empty array when body has no statements', () => {
    const ast = fakeAst([]);
    expect(extractImports(ast, FILE, undefined, mockResolveImport)).toEqual([]);
  });

  // 14. [ED] specifiers=[] → exactly 1 relation (side-effect)
  it('should return exactly 1 relation when ImportDeclaration has empty specifiers array', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './side' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
  });

  // 15. [CO] default + named in same declaration
  it('should produce 2 relations with correct dstSymbolNames when import has both default and named specifiers', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './mixed' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportDefaultSpecifier', local: { name: 'Def' } },
          { type: 'ImportSpecifier', imported: { name: 'Named' }, local: { name: 'Named' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(2);
    expect(relations[0]!.dstSymbolName).toBe('default');
    expect(relations[1]!.dstSymbolName).toBe('Named');
  });

  // 16. [CO] type-only + alias
  it('should set isType true and correct dstSymbolName when type-only import uses alias specifier', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './types' },
        importKind: 'type',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'OriginalType' }, local: { name: 'Alias' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.metaJson).toContain('"isType":true');
    expect(relations[0]!.dstSymbolName).toBe('OriginalType');
    expect(relations[0]!.srcSymbolName).toBe('Alias');
  });

  // 17. [OR] specifier order preserved
  it('should preserve specifier order in output relations when import has multiple specifiers', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './ordered' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'First' }, local: { name: 'First' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'Second' }, local: { name: 'Second' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'Third' }, local: { name: 'Third' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations[0]!.dstSymbolName).toBe('First');
    expect(relations[1]!.dstSymbolName).toBe('Second');
    expect(relations[2]!.dstSymbolName).toBe('Third');
  });

  // 18. [ID] idempotency
  it('should return identical results when called twice with the same AST', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './stable' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'X' }, local: { name: 'X' }, importKind: 'value' },
        ],
      },
    ]);
    const r1 = extractImports(ast, FILE, undefined, mockResolveImport);
    const r2 = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(r1).toEqual(r2);
  });
});
