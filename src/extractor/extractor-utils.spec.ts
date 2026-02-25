import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockResolve = mock((...args: string[]) => '');
const mockDirname = mock((p: string) => '');
const mockExtname = mock((p: string) => '');

import { resolveImport, buildImportMap } from './extractor-utils';

const FAKE_PROJECT = '/project';

function fakeAst(body: any[]): any {
  return { body };
}

function fakeImportDecl(source: string, specifiers: any[]): any {
  return { type: 'ImportDeclaration', source: { value: source }, specifiers };
}

function fakeNamedSpec(localName: string, importedName: string): any {
  return { type: 'ImportSpecifier', local: { name: localName }, imported: { name: importedName } };
}

function fakeDefaultSpec(localName: string): any {
  return { type: 'ImportDefaultSpecifier', local: { name: localName } };
}

function fakeNamespaceSpec(localName: string): any {
  return { type: 'ImportNamespaceSpecifier', local: { name: localName } };
}

describe('resolveImport', () => {
  beforeEach(() => {
    mock.module('node:path', () => ({
      resolve: mockResolve,
      dirname: mockDirname,
      extname: mockExtname,
    }));
    mockResolve.mockClear();
    mockDirname.mockClear();
    mockExtname.mockClear();
  });

  it('should resolve to absolute path when relative import already has .ts extension', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockReturnValue('/project/src/utils.ts');
    mockExtname.mockReturnValue('.ts');

    const result = resolveImport('/project/src/index.ts', './utils.ts');

    expect(result).toEqual(['/project/src/utils.ts']);
    expect(mockDirname).toHaveBeenCalledWith('/project/src/index.ts');
    expect(mockResolve).toHaveBeenCalledWith('/project/src', './utils.ts');
  });

  it('should append .ts extension when relative import specifier has no file extension', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockReturnValue('/project/src/utils');
    mockExtname.mockReturnValue('');

    const result = resolveImport('/project/src/index.ts', './utils');

    expect(result).toContain('/project/src/utils.ts');
    expect(mockExtname).toHaveBeenCalledWith('/project/src/utils');
  });

  it('should resolve to parent directory path when relative import starts with ../', () => {
    mockDirname.mockReturnValue('/project/src/nested');
    mockResolve.mockReturnValue('/project/src/helpers');
    mockExtname.mockReturnValue('');

    const result = resolveImport('/project/src/nested/index.ts', '../helpers');

    expect(result).toContain('/project/src/helpers.ts');
    expect(mockDirname).toHaveBeenCalledWith('/project/src/nested/index.ts');
    expect(mockResolve).toHaveBeenCalledWith('/project/src/nested', '../helpers');
  });

  it('should resolve correctly when relative import traverses multiple parent directories', () => {
    mockDirname.mockReturnValue('/project/src/a/b');
    mockResolve.mockReturnValue('/project/src/utils');
    mockExtname.mockReturnValue('');

    const result = resolveImport('/project/src/a/b/c.ts', '../../utils');

    expect(result).toContain('/project/src/utils.ts');
    expect(mockResolve).toHaveBeenCalledWith('/project/src/a/b', '../../utils');
  });

  it('should resolve to mapped path when import matches a wildcard tsconfig path alias', () => {
    mockResolve.mockReturnValue('/project/src/utils/formatter');
    mockExtname.mockReturnValue('');

    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@utils/*', ['src/utils/*']]]),
    };
    const result = resolveImport('/project/src/index.ts', '@utils/formatter', tsconfigPaths);

    expect(result).toContain('/project/src/utils/formatter.ts');
    expect(mockResolve).toHaveBeenCalledWith('/project', 'src/utils/formatter');
  });

  it('should resolve to mapped path when import matches an exact-match tsconfig path alias', () => {
    mockResolve.mockReturnValue('/project/src/index');
    mockExtname.mockReturnValue('');

    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@root', ['src/index']]]),
    };
    const result = resolveImport('/project/src/a.ts', '@root', tsconfigPaths);

    expect(result).toContain('/project/src/index.ts');
    expect(mockResolve).toHaveBeenCalledWith('/project', 'src/index');
  });

  it('should return null when import specifier is a bare npm package name', () => {
    const result = resolveImport('/project/src/index.ts', 'lodash');
    expect(result).toEqual([]);
  });

  it('should return null when import specifier is a scoped npm package', () => {
    const result = resolveImport('/project/src/index.ts', '@types/node');
    expect(result).toEqual([]);
  });

  it('should return null when import specifier does not match any tsconfig path alias', () => {
    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@utils/*', ['src/utils/*']]]),
    };
    const result = resolveImport('/project/src/index.ts', '@other/lib', tsconfigPaths);
    expect(result).toEqual([]);
  });

  it('should resolve to directory path with .ts when relative import is a bare "."', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockReturnValue('/project/src');
    mockExtname.mockReturnValue('');

    const result = resolveImport('/project/src/index.ts', '.');

    expect(result).toContain('/project/src.ts');
  });

  it('should return identical result when called twice with the same input arguments', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockReturnValue('/project/src/b');
    mockExtname.mockReturnValue('');

    const r1 = resolveImport('/project/src/a.ts', './b');
    const r2 = resolveImport('/project/src/a.ts', './b');
    expect(r1).toEqual(r2);
  });

  it('should append .ts to resolved alias path when alias target has no file extension', () => {
    mockResolve.mockReturnValue('/project/lib/utils');
    mockExtname.mockReturnValue('');

    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@lib/*', ['lib/*']]]),
    };
    const result = resolveImport('/project/src/index.ts', '@lib/utils', tsconfigPaths);

    expect(result).toContain('/project/lib/utils.ts');
    expect(mockResolve).toHaveBeenCalledWith('/project', 'lib/utils');
  });

  it('should not double-append .ts when alias target already includes .ts extension', () => {
    mockResolve.mockReturnValue('/project/lib/utils.ts');
    mockExtname.mockReturnValue('.ts');

    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@lib/utils', ['lib/utils.ts']]]),
    };
    const result = resolveImport('/project/src/index.ts', '@lib/utils', tsconfigPaths);

    expect(result).toEqual(['/project/lib/utils.ts']);
  });

  it('should include both .ts and /index.ts candidates when relative import has no extension', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockReturnValue('/project/src/utils');
    mockExtname.mockReturnValue('');

    const result = resolveImport('/project/src/index.ts', './utils');

    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('/project/src/utils.ts');
    expect(result).toContain('/project/src/utils/index.ts');
  });

  it('should include .mts, .cts, /index.mts, /index.cts candidates when relative import has no extension', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockReturnValue('/project/src/utils');
    mockExtname.mockReturnValue('');

    const result = resolveImport('/project/src/index.ts', './utils');

    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('/project/src/utils.mts');
    expect(result).toContain('/project/src/utils.cts');
    expect(result).toContain('/project/src/utils/index.mts');
    expect(result).toContain('/project/src/utils/index.cts');
  });

  it('should map .js/.mjs/.cjs imports when resolving .ts/.mts/.cts candidates', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockImplementation((base: string, target: string) => {
      if (target === './utils.js') return '/project/src/utils.js';
      if (target === './utils.mjs') return '/project/src/utils.mjs';
      return '/project/src/utils.cjs';
    });

    mockExtname
      .mockReturnValueOnce('.js')
      .mockReturnValueOnce('.mjs')
      .mockReturnValueOnce('.cjs');

    expect(resolveImport('/project/src/index.ts', './utils.js')).toEqual(['/project/src/utils.ts']);
    expect(resolveImport('/project/src/index.ts', './utils.mjs')).toEqual(['/project/src/utils.mts']);
    expect(resolveImport('/project/src/index.ts', './utils.cjs')).toEqual(['/project/src/utils.cts']);
  });

  it('should include .d.ts and /index.d.ts candidates when relative import has no extension', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockReturnValue('/project/src/utils');
    mockExtname.mockReturnValue('');

    const result = resolveImport('/project/src/index.ts', './utils');

    expect(result).toContain('/project/src/utils.d.ts');
    expect(result).toContain('/project/src/utils/index.d.ts');
  });

  it('should place .d.ts after .ts and before /index.ts in candidate order', () => {
    mockDirname.mockReturnValue('/project/src');
    mockResolve.mockReturnValue('/project/src/utils');
    mockExtname.mockReturnValue('');

    const result = resolveImport('/project/src/index.ts', './utils');

    const tsIdx = result.indexOf('/project/src/utils.ts');
    const dtsIdx = result.indexOf('/project/src/utils.d.ts');
    const indexTsIdx = result.indexOf('/project/src/utils/index.ts');
    const indexDtsIdx = result.indexOf('/project/src/utils/index.d.ts');

    expect(tsIdx).toBeLessThan(dtsIdx);
    expect(dtsIdx).toBeLessThan(indexTsIdx);
    expect(indexTsIdx).toBeLessThan(indexDtsIdx);
  });
});

describe('buildImportMap', () => {
  const mockResolveImportFn = mock(
    (currentFilePath: string, importPath: string, tsconfigPaths?: any) => [] as string[],
  );

  beforeEach(() => {
    mockResolveImportFn.mockClear();
    mockResolveImportFn.mockReturnValue([]);
  });

  it('should map local name to importedName and resolved path when declaration has a named specifier', () => {
    mockResolveImportFn.mockReturnValue([`${FAKE_PROJECT}/src/utils.ts`]);

    const ast = fakeAst([fakeImportDecl('./utils', [fakeNamedSpec('foo', 'foo')])]);
    const map = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    const ref = map.get('foo');
    expect(ref).toBeDefined();
    expect(ref!.importedName).toBe('foo');
    expect(ref!.path).toBe(`${FAKE_PROJECT}/src/utils.ts`);
    expect(mockResolveImportFn).toHaveBeenCalledWith(`${FAKE_PROJECT}/src/index.ts`, './utils', undefined);
  });

  it('should set importedName to "default" when declaration is a default import', () => {
    mockResolveImportFn.mockReturnValue([`${FAKE_PROJECT}/src/Foo.ts`]);

    const ast = fakeAst([fakeImportDecl('./Foo', [fakeDefaultSpec('Foo')])]);
    const map = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    const ref = map.get('Foo');
    expect(ref?.importedName).toBe('default');
  });

  it('should set importedName to "*" when declaration is a namespace import', () => {
    mockResolveImportFn.mockReturnValue([`${FAKE_PROJECT}/src/utils.ts`]);

    const ast = fakeAst([fakeImportDecl('./utils', [fakeNamespaceSpec('utils')])]);
    const map = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    const ref = map.get('utils');
    expect(ref?.importedName).toBe('*');
  });

  it('should return an empty map when source has no import declarations', () => {
    const ast = fakeAst([{ type: 'VariableDeclaration' }]);
    const map = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    expect(map.size).toBe(0);
  });

  it('should skip mapping when import source is an external npm package', () => {
    mockResolveImportFn.mockReturnValue([]);

    const ast = fakeAst([fakeImportDecl('react', [fakeDefaultSpec('React')])]);
    const map = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    expect(map.size).toBe(0);
  });

  it('should map by local alias name when import specifier uses "as" renaming', () => {
    mockResolveImportFn.mockReturnValue([`${FAKE_PROJECT}/src/utils.ts`]);

    const ast = fakeAst([fakeImportDecl('./utils', [fakeNamedSpec('bar', 'foo')])]);
    const map = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    expect(map.has('bar')).toBe(true);
    expect(map.get('bar')!.importedName).toBe('foo');
    expect(map.has('foo')).toBe(false);
  });

  it('should map all specifiers when import declaration has multiple named specifiers', () => {
    mockResolveImportFn.mockReturnValue([`${FAKE_PROJECT}/src/multi.ts`]);

    const ast = fakeAst([
      fakeImportDecl('./multi', [
        fakeNamedSpec('a', 'a'),
        fakeNamedSpec('b', 'b'),
        fakeNamedSpec('c', 'c'),
      ]),
    ]);
    const map = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(true);
    expect(map.has('c')).toBe(true);
  });

  it('should not include dynamic imports from function bodies when processing only top-level nodes', () => {
    const ast = fakeAst([
      {
        type: 'FunctionDeclaration',
        body: {
          body: [
            { type: 'ExpressionStatement', expression: { type: 'ImportExpression', source: { value: './lazy' } } },
          ],
        },
      },
    ]);
    const map = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    expect(map.size).toBe(0);
  });

  it('should produce identical maps when called repeatedly with the same AST input', () => {
    mockResolveImportFn.mockReturnValue([`${FAKE_PROJECT}/src/x.ts`]);

    const ast = fakeAst([fakeImportDecl('./x', [fakeNamedSpec('x', 'x')])]);
    const m1 = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);
    const m2 = buildImportMap(ast, `${FAKE_PROJECT}/src/index.ts`, undefined, mockResolveImportFn);

    expect([...m1.entries()]).toEqual([...m2.entries()]);
  });
});

