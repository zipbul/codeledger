import { describe, it, expect, mock } from 'bun:test';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import {
  getStats,
  searchSymbols,
  searchRelations,
  searchAllSymbols,
  searchAllRelations,
  listIndexedFiles,
  getInternalRelations,
  getFullSymbol,
  getFileStats,
  getFileInfo,
  getSymbolsByFile,
  getModuleInterface,
} from './query-api';

// ─── Fixtures ───────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<GildashContext>): GildashContext {
  return {
    closed: false,
    defaultProject: 'default',
    projectRoot: '/project',
    symbolRepo: {
      getStats: mock(() => ({ total: 10, exported: 3 })),
      getFileSymbols: mock(() => []),
    } as any,
    relationRepo: {
      getOutgoing: mock(() => []),
    } as any,
    fileRepo: {
      getAllFiles: mock(() => []),
      getFile: mock(() => null),
    } as any,
    symbolSearchFn: mock(() => []),
    relationSearchFn: mock(() => []),
    logger: { error: () => {} } as any,
    semanticLayer: null,
    ...overrides,
  } as unknown as GildashContext;
}

function makeSym(name: string, detail?: Record<string, unknown>) {
  return {
    name,
    kind: 'function',
    filePath: 'src/a.ts',
    project: 'default',
    isExported: true,
    fingerprint: 'fp1',
    span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
    detail: detail ?? {},
  };
}

// ─── getStats ───────────────────────────────────────────────────────

describe('getStats', () => {
  it('should return stats for default project', () => {
    const stats = { total: 10, exported: 3 };
    const ctx = makeCtx({ symbolRepo: { getStats: mock(() => stats) } as any });

    const result = getStats(ctx);

    expect(result).toBe(stats as any);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getStats(ctx)).toThrow(GildashError);
  });

  it('should throw when repo throws', () => {
    const error = new Error('db fail');
    const ctx = makeCtx({ symbolRepo: { getStats: mock(() => { throw error; }) } as any });

    expect(() => getStats(ctx)).toThrow(GildashError);
    try {
      getStats(ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('store');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── searchSymbols ──────────────────────────────────────────────────

describe('searchSymbols', () => {
  it('should return matching symbols', () => {
    const symbols = [makeSym('Foo')];
    const ctx = makeCtx({ symbolSearchFn: mock(() => symbols) as any });

    const result = searchSymbols(ctx, { text: 'Foo' });

    expect(result).toBe(symbols as any);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => searchSymbols(ctx, { text: 'Foo' })).toThrow(GildashError);
  });

  it('should throw when fn throws', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => { throw new Error('fail'); }) as any });
    expect(() => searchSymbols(ctx, { text: 'X' })).toThrow(GildashError);
  });
});

// ─── searchRelations ────────────────────────────────────────────────

describe('searchRelations', () => {
  it('should return matching relations', () => {
    const rels = [{ type: 'imports', srcFilePath: 'a.ts', dstFilePath: 'b.ts' }];
    const ctx = makeCtx({ relationSearchFn: mock(() => rels) as any });

    const result = searchRelations(ctx, { type: 'imports' });

    expect(result).toBe(rels as any);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => searchRelations(ctx, {})).toThrow(GildashError);
  });

  it('should throw when fn throws', () => {
    const ctx = makeCtx({ relationSearchFn: mock(() => { throw new Error('fail'); }) as any });
    expect(() => searchRelations(ctx, {})).toThrow(GildashError);
  });
});

// ─── searchAllSymbols ───────────────────────────────────────────────

describe('searchAllSymbols', () => {
  it('should pass project=undefined to search across all projects', () => {
    const searchFn = mock(() => []);
    const ctx = makeCtx({ symbolSearchFn: searchFn as any });

    searchAllSymbols(ctx, { text: 'Foo' });

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: undefined }),
    );
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => searchAllSymbols(ctx, { text: 'Foo' })).toThrow(GildashError);
  });

  it('should throw when fn throws', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => { throw new Error(); }) as any });
    expect(() => searchAllSymbols(ctx, { text: 'X' })).toThrow(GildashError);
  });
});

// ─── searchAllRelations ─────────────────────────────────────────────

describe('searchAllRelations', () => {
  it('should pass project=undefined to search across all projects', () => {
    const searchFn = mock(() => []);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    searchAllRelations(ctx, {});

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: undefined }),
    );
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => searchAllRelations(ctx, {})).toThrow(GildashError);
  });

  it('should throw when fn throws', () => {
    const ctx = makeCtx({ relationSearchFn: mock(() => { throw new Error(); }) as any });
    expect(() => searchAllRelations(ctx, {})).toThrow(GildashError);
  });
});

// ─── listIndexedFiles ───────────────────────────────────────────────

describe('listIndexedFiles', () => {
  it('should return file records for default project', () => {
    const files = [{ filePath: 'a.ts', lineCount: 10, size: 200 }];
    const ctx = makeCtx({ fileRepo: { getAllFiles: mock(() => files) } as any });

    const result = listIndexedFiles(ctx);

    expect(result).toBe(files as any);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => listIndexedFiles(ctx)).toThrow(GildashError);
  });

  it('should throw when repo throws', () => {
    const ctx = makeCtx({ fileRepo: { getAllFiles: mock(() => { throw new Error(); }) } as any });
    expect(() => listIndexedFiles(ctx)).toThrow(GildashError);
  });
});

// ─── getInternalRelations ───────────────────────────────────────────

describe('getInternalRelations', () => {
  it('should pass srcFilePath and dstFilePath both as the given file', () => {
    const searchFn = mock(() => []);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    getInternalRelations(ctx, 'src/foo.ts');

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          srcFilePath: 'src/foo.ts',
          dstFilePath: 'src/foo.ts',
        }),
      }),
    );
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getInternalRelations(ctx, 'a.ts')).toThrow(GildashError);
  });

  it('should throw when fn throws', () => {
    const ctx = makeCtx({ relationSearchFn: mock(() => { throw new Error(); }) as any });
    expect(() => getInternalRelations(ctx, 'a.ts')).toThrow(GildashError);
  });
});

// ─── getFullSymbol ──────────────────────────────────────────────────

describe('getFullSymbol', () => {
  it('should return enriched symbol with all detail fields present', () => {
    const detail = {
      members: [{ name: 'm1', kind: 'property' }],
      jsDoc: '/** docs */',
      parameters: '(a: number)',
      returnType: 'void',
      heritage: ['Base'],
      decorators: [{ name: 'Component', args: '()' }],
      typeParameters: '<T>',
    };
    const sym = makeSym('Foo', detail);
    const ctx = makeCtx({ symbolSearchFn: mock(() => [sym]) as any });

    const result = getFullSymbol(ctx, 'Foo', 'src/a.ts');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Foo');
    expect(result!.members).toEqual(detail.members);
    expect(result!.jsDoc).toBe('/** docs */');
    expect(result!.parameters).toBe('(a: number)');
    expect(result!.returnType).toBe('void');
    expect(result!.heritage).toEqual(['Base']);
    expect(result!.decorators).toEqual(detail.decorators);
    expect(result!.typeParameters).toBe('<T>');
  });

  it('should return undefined for missing or wrong-type detail fields', () => {
    const detail = {
      members: 'not-array',
      jsDoc: 42,
      parameters: {},
      returnType: null,
      heritage: 'not-array',
      decorators: 'not-array',
      typeParameters: 123,
    };
    const sym = makeSym('Bar', detail);
    const ctx = makeCtx({ symbolSearchFn: mock(() => [sym]) as any });

    const result = getFullSymbol(ctx, 'Bar', 'src/a.ts');

    expect(result).not.toBeNull();
    expect(result!.members).toBeUndefined();
    expect(result!.jsDoc).toBeUndefined();
    expect(result!.parameters).toBeUndefined();
    expect(result!.returnType).toBeUndefined();
    expect(result!.heritage).toBeUndefined();
    expect(result!.decorators).toBeUndefined();
    expect(result!.typeParameters).toBeUndefined();
  });

  it('should enrich with semantic resolvedType when semantic layer available', () => {
    const sym = makeSym('X', {});
    const semanticLayer = {
      lineColumnToPosition: mock(() => 10),
      findNamePosition: mock(() => 15),
      collectTypeAt: mock(() => 'string'),
    };
    const ctx = makeCtx({
      symbolSearchFn: mock(() => [sym]) as any,
      semanticLayer: semanticLayer as any,
    });

    const result = getFullSymbol(ctx, 'X', '/project/src/a.ts');

    expect(result!.resolvedType as any).toBe('string');
  });

  it('should skip enrichment when declPos is null', () => {
    const sym = makeSym('X', {});
    const semanticLayer = {
      lineColumnToPosition: mock(() => null),
      findNamePosition: mock(() => null),
      collectTypeAt: mock(() => 'number'),
    };
    const ctx = makeCtx({
      symbolSearchFn: mock(() => [sym]) as any,
      semanticLayer: semanticLayer as any,
    });

    const result = getFullSymbol(ctx, 'X', 'src/a.ts');

    expect(result!.resolvedType).toBeUndefined();
    expect(semanticLayer.findNamePosition).not.toHaveBeenCalled();
  });

  it('should use declPos when findNamePosition returns null', () => {
    const sym = makeSym('X', {});
    const semanticLayer = {
      lineColumnToPosition: mock(() => 10),
      findNamePosition: mock(() => null),
      collectTypeAt: mock(() => 'boolean'),
    };
    const ctx = makeCtx({
      symbolSearchFn: mock(() => [sym]) as any,
      semanticLayer: semanticLayer as any,
    });

    const result = getFullSymbol(ctx, 'X', '/project/src/a.ts');

    expect(semanticLayer.collectTypeAt).toHaveBeenCalledWith('/project/src/a.ts', 10);
    expect(result!.resolvedType as any).toBe('boolean');
  });

  it('should skip resolvedType when collectTypeAt returns null', () => {
    const sym = makeSym('X', {});
    const semanticLayer = {
      lineColumnToPosition: mock(() => 10),
      findNamePosition: mock(() => 15),
      collectTypeAt: mock(() => null),
    };
    const ctx = makeCtx({
      symbolSearchFn: mock(() => [sym]) as any,
      semanticLayer: semanticLayer as any,
    });

    const result = getFullSymbol(ctx, 'X', '/project/src/a.ts');

    expect(result!.resolvedType).toBeUndefined();
  });

  it('should silently catch semantic layer exception', () => {
    const sym = makeSym('X', {});
    const semanticLayer = {
      lineColumnToPosition: mock(() => { throw new Error('tsc crash'); }),
    };
    const ctx = makeCtx({
      symbolSearchFn: mock(() => [sym]) as any,
      semanticLayer: semanticLayer as any,
    });

    const result = getFullSymbol(ctx, 'X', 'src/a.ts');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('X');
  });

  it('should resolve relative filePath with projectRoot for semantic lookup', () => {
    const sym = makeSym('X', {});
    const semanticLayer = {
      lineColumnToPosition: mock(() => 5),
      findNamePosition: mock(() => 5),
      collectTypeAt: mock(() => null),
    };
    const ctx = makeCtx({
      symbolSearchFn: mock(() => [sym]) as any,
      semanticLayer: semanticLayer as any,
      projectRoot: '/my/project',
    });

    getFullSymbol(ctx, 'X', 'src/a.ts');

    expect(semanticLayer.lineColumnToPosition).toHaveBeenCalledWith(
      '/my/project/src/a.ts',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getFullSymbol(ctx, 'X', 'a.ts')).toThrow(GildashError);
  });

  it('should return null when symbol not found', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => []) as any });

    const result = getFullSymbol(ctx, 'Nope', 'a.ts');

    expect(result).toBeNull();
  });

  it('should throw when fn throws', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => { throw new Error('fail'); }) as any });
    expect(() => getFullSymbol(ctx, 'X', 'a.ts')).toThrow(GildashError);
  });
});

// ─── getFileStats ───────────────────────────────────────────────────

describe('getFileStats', () => {
  it('should return stats for existing file', () => {
    const file = { filePath: 'a.ts', lineCount: null, size: 500 };
    const symbols = [
      { name: 'A', isExported: true },
      { name: 'B', isExported: false },
    ];
    const relations = [{ type: 'imports' }];
    const ctx = makeCtx({
      fileRepo: { getFile: mock(() => file) } as any,
      symbolRepo: { getFileSymbols: mock(() => symbols) } as any,
      relationRepo: { getOutgoing: mock(() => relations) } as any,
    });

    const result = getFileStats(ctx, 'a.ts');

    expect(result.filePath).toBe('a.ts');
    expect(result.lineCount).toBe(0); // lineCount null → 0
    expect(result.size).toBe(500);
    expect(result.symbolCount).toBe(2);
    expect(result.exportedSymbolCount).toBe(1);
    expect(result.relationCount).toBe(1);
  });

  it('should throw when file not found', () => {
    const ctx = makeCtx({ fileRepo: { getFile: mock(() => null) } as any });

    expect(() => getFileStats(ctx, 'missing.ts')).toThrow(GildashError);
    expect(() => getFileStats(ctx, 'missing.ts')).toThrow(/missing\.ts/);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getFileStats(ctx, 'a.ts')).toThrow(GildashError);
  });

  it('should throw when repo throws', () => {
    const ctx = makeCtx({ fileRepo: { getFile: mock(() => { throw new Error(); }) } as any });
    expect(() => getFileStats(ctx, 'a.ts')).toThrow(GildashError);
  });
});

// ─── getFileInfo ────────────────────────────────────────────────────

describe('getFileInfo', () => {
  it('should return file record', () => {
    const file = { filePath: 'a.ts', lineCount: 5, size: 100 };
    const ctx = makeCtx({ fileRepo: { getFile: mock(() => file) } as any });

    const result = getFileInfo(ctx, 'a.ts');

    expect(result).toBe(file as any);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getFileInfo(ctx, 'a.ts')).toThrow(GildashError);
  });

  it('should throw when repo throws', () => {
    const ctx = makeCtx({ fileRepo: { getFile: mock(() => { throw new Error(); }) } as any });
    expect(() => getFileInfo(ctx, 'a.ts')).toThrow(GildashError);
  });
});

// ─── getSymbolsByFile ───────────────────────────────────────────────

describe('getSymbolsByFile', () => {
  it('should delegate to searchSymbols with filePath', () => {
    const symbols = [makeSym('A')];
    const searchFn = mock(() => symbols);
    const ctx = makeCtx({ symbolSearchFn: searchFn as any });

    const result = getSymbolsByFile(ctx, 'src/a.ts');

    expect(result).toBe(symbols as any);
    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ filePath: 'src/a.ts' }),
      }),
    );
  });

  it('should pass undefined project when not specified', () => {
    const searchFn = mock(() => []);
    const ctx = makeCtx({ symbolSearchFn: searchFn as any });

    getSymbolsByFile(ctx, 'a.ts');

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ project: undefined }),
      }),
    );
  });
});

// ─── getModuleInterface ─────────────────────────────────────────────

describe('getModuleInterface', () => {
  it('should return exports with detail fields', () => {
    const sym = makeSym('Foo', {
      parameters: '(x: string)',
      returnType: 'void',
      jsDoc: '/** doc */',
    });
    const ctx = makeCtx({ symbolSearchFn: mock(() => [sym]) as any });

    const result = getModuleInterface(ctx, 'src/a.ts');

    expect(result.filePath).toBe('src/a.ts');
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]!.name).toBe('Foo');
    expect(result.exports[0]!.parameters).toBe('(x: string)');
    expect(result.exports[0]!.returnType).toBe('void');
    expect(result.exports[0]!.jsDoc).toBe('/** doc */');
  });

  it('should return undefined for missing optional fields', () => {
    const sym = makeSym('Bar', {});
    const ctx = makeCtx({ symbolSearchFn: mock(() => [sym]) as any });

    const result = getModuleInterface(ctx, 'src/a.ts');

    expect(result.exports[0]!.parameters).toBeUndefined();
    expect(result.exports[0]!.returnType).toBeUndefined();
    expect(result.exports[0]!.jsDoc).toBeUndefined();
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getModuleInterface(ctx, 'a.ts')).toThrow(GildashError);
  });

  it('should throw when fn throws', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => { throw new Error('fail'); }) as any });
    expect(() => getModuleInterface(ctx, 'a.ts')).toThrow(GildashError);
  });
});
