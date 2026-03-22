import { describe, it, expect, mock } from 'bun:test';
import path from 'node:path';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import {
  resolveSymbolPosition,
  getResolvedType,
  getSemanticReferences,
  getImplementations,
  getSemanticModuleInterface,
  getResolvedTypeAtPosition,
  getSemanticReferencesAtPosition,
  getImplementationsAtPosition,
  isTypeAssignableToAtPosition,
  lineColumnToPosition,
  findNamePosition,
  getSymbolNode,
  getSemanticDiagnostics,
  isTypeAssignableToType,
} from './semantic-api';

// ─── Fixtures ───────────────────────────────────────────────────────

const dummySym = {
  name: 'Foo',
  kind: 'class' as const,
  filePath: '/project/src/a.ts',
  project: 'default',
  span: { start: { line: 5, column: 10 }, end: { line: 5, column: 13 } },
};

function makeSemanticLayer(overrides?: Record<string, unknown>) {
  return {
    lineColumnToPosition: mock(() => 42),
    findNamePosition: mock(() => 50),
    collectTypeAt: mock(() => ({ type: 'string', text: 'string' })),
    findReferences: mock(() => []),
    findImplementations: mock(() => []),
    getModuleInterface: mock(() => ({ exports: [] })),
    getSymbolNode: mock(() => null),
    getDiagnostics: mock(() => []),
    isTypeAssignableTo: mock(() => true),
    isTypeAssignableToType: mock(() => true),
    notifyFileChanged: mock(() => {}),
    dispose: mock(() => {}),
    isDisposed: false,
    collectFileTypes: mock(() => []),
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<GildashContext>): GildashContext {
  return {
    closed: false,
    defaultProject: 'default',
    projectRoot: '/project',
    symbolRepo: {} as any,
    symbolSearchFn: mock(() => [dummySym]),
    semanticLayer: makeSemanticLayer() as any,
    ...overrides,
  } as unknown as GildashContext;
}

// ─── resolveSymbolPosition ──────────────────────────────────────────

describe('resolveSymbolPosition', () => {
  it('should return {sym, position, absPath} for absolute path with found symbol', () => {
    const ctx = makeCtx();

    const result = resolveSymbolPosition(ctx, 'Foo', '/project/src/a.ts');

    expect(result).not.toBeNull();
    expect(result!.sym).toBe(dummySym as any);
    expect(result!.position).toBe(50); // findNamePosition returned 50
    expect(result!.absPath).toBe('/project/src/a.ts');
  });

  it('should resolve relative path via path.resolve with projectRoot', () => {
    const ctx = makeCtx();

    const result = resolveSymbolPosition(ctx, 'Foo', 'src/a.ts');

    expect(result).not.toBeNull();
    expect(result!.absPath).toBe(path.resolve('/project', 'src/a.ts'));
  });

  it('should pass explicit project to symbolSearchFn', () => {
    const searchFn = mock(() => [dummySym]);
    const ctx = makeCtx({ symbolSearchFn: searchFn as any });

    resolveSymbolPosition(ctx, 'Foo', '/project/src/a.ts', 'custom-project');

    expect(searchFn).toHaveBeenCalledWith({
      symbolRepo: ctx.symbolRepo,
      project: 'custom-project',
      query: { text: 'Foo', exact: true, filePath: 'src/a.ts', limit: 1 },
    });
  });

  it('should use ctx.defaultProject when project is omitted', () => {
    const searchFn = mock(() => [dummySym]);
    const ctx = makeCtx({ symbolSearchFn: searchFn as any, defaultProject: 'my-proj' });

    resolveSymbolPosition(ctx, 'Foo', '/project/src/a.ts');

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'my-proj' }),
    );
  });

  it('should use declPos when findNamePosition returns null', () => {
    const layer = makeSemanticLayer({
      lineColumnToPosition: mock(() => 42),
      findNamePosition: mock(() => null),
    });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = resolveSymbolPosition(ctx, 'Foo', '/project/src/a.ts');

    expect(result).not.toBeNull();
    expect(result!.position).toBe(42); // falls back to declPos
  });

  it('should return null when symbolSearchFn returns empty array', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => []) as any });

    const result = resolveSymbolPosition(ctx, 'Missing', '/project/src/a.ts');

    expect(result).toBeNull();
  });

  it('should return null when lineColumnToPosition returns null', () => {
    const layer = makeSemanticLayer({ lineColumnToPosition: mock(() => null) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = resolveSymbolPosition(ctx, 'Foo', '/project/src/a.ts');

    expect(result).toBeNull();
  });

  it('should pass exact:true, filePath, and limit:1 to symbolSearchFn', () => {
    const searchFn = mock(() => [dummySym]);
    const ctx = makeCtx({ symbolSearchFn: searchFn as any });

    resolveSymbolPosition(ctx, 'Bar', 'src/b.ts');

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { text: 'Bar', exact: true, filePath: 'src/b.ts', limit: 1 },
      }),
    );
  });

  it('should convert absolute filePath to relative before DB search', () => {
    const searchFn = mock(() => [dummySym]);
    const ctx = makeCtx({ symbolSearchFn: searchFn as any });

    resolveSymbolPosition(ctx, 'Foo', '/project/src/a.ts');

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ filePath: 'src/a.ts' }),
      }),
    );
  });
});

// ─── getResolvedType ────────────────────────────────────────────────

describe('getResolvedType', () => {
  it('should return collectTypeAt result when symbol is resolved', () => {
    const typeResult = { type: 'number', text: 'number' };
    const layer = makeSemanticLayer({ collectTypeAt: mock(() => typeResult) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getResolvedType(ctx, 'Foo', '/project/src/a.ts');

    expect(result).toBe(typeResult as any);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getResolvedType(ctx, 'Foo', '/project/src/a.ts')).toThrow(GildashError);
  });

  it('should throw with type semantic when semanticLayer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });

    expect(() => getResolvedType(ctx, 'Foo', '/project/src/a.ts')).toThrow(GildashError);
    try {
      getResolvedType(ctx, 'Foo', '/project/src/a.ts');
    } catch (e) {
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).message).toContain('semantic layer is not enabled');
    }
  });

  it('should return null when resolveSymbolPosition returns null', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => []) as any });

    const result = getResolvedType(ctx, 'Missing', '/project/src/a.ts');

    expect(result).toBeNull();
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('boom');
    const layer = makeSemanticLayer({ collectTypeAt: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getResolvedType(ctx, 'Foo', '/project/src/a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── getSemanticReferences ──────────────────────────────────────────

describe('getSemanticReferences', () => {
  it('should return findReferences result when symbol is resolved', () => {
    const refs = [{ filePath: '/src/b.ts', line: 10, column: 5 }];
    const layer = makeSemanticLayer({ findReferences: mock(() => refs) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getSemanticReferences(ctx, 'Foo', '/project/src/a.ts');

    expect(result).toBe(refs as any);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getSemanticReferences(ctx, 'Foo', '/project/src/a.ts')).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('ref fail');
    const layer = makeSemanticLayer({ findReferences: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getSemanticReferences(ctx, 'Foo', '/project/src/a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBe(error);
    }
  });

  it('should throw when resolveSymbolPosition returns null', () => {
    const layer = makeSemanticLayer();
    const ctx = makeCtx({
      semanticLayer: layer as any,
      symbolSearchFn: mock(() => []) as any,
    });

    expect(() => getSemanticReferences(ctx, 'Missing', '/project/src/a.ts')).toThrow(GildashError);
    expect(() => getSemanticReferences(ctx, 'Missing', '/project/src/a.ts')).toThrow(/Missing/);
  });
});

// ─── getImplementations ─────────────────────────────────────────────

describe('getImplementations', () => {
  it('should return findImplementations result when symbol is resolved', () => {
    const impls = [{ filePath: '/src/c.ts', span: { start: { line: 1, column: 0 }, end: { line: 10, column: 1 } } }];
    const layer = makeSemanticLayer({ findImplementations: mock(() => impls) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getImplementations(ctx, 'Foo', '/project/src/a.ts');

    expect(result).toBe(impls as any);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getImplementations(ctx, 'Foo', '/project/src/a.ts')).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('impl fail');
    const layer = makeSemanticLayer({ findImplementations: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getImplementations(ctx, 'Foo', '/project/src/a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── getSemanticModuleInterface ─────────────────────────────────────

describe('getSemanticModuleInterface', () => {
  it('should return getModuleInterface result', () => {
    const iface = { exports: [{ name: 'Foo', kind: 'class' }] };
    const layer = makeSemanticLayer({ getModuleInterface: mock(() => iface) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getSemanticModuleInterface(ctx, '/project/src/a.ts');

    expect(result).toBe(iface as any);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getSemanticModuleInterface(ctx, '/project/src/a.ts')).toThrow(GildashError);
  });

  it('should throw with type semantic when semanticLayer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });

    expect(() => getSemanticModuleInterface(ctx, '/project/src/a.ts')).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('iface fail');
    const layer = makeSemanticLayer({ getModuleInterface: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getSemanticModuleInterface(ctx, '/project/src/a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── State Transition ───────────────────────────────────────────────

describe('semantic-api state transitions', () => {
  it('should return null from resolveSymbolPosition after symbolSearchFn is changed to return empty', () => {
    const searchFn = mock(() => [dummySym]);
    const ctx = makeCtx({ symbolSearchFn: searchFn as any });

    const first = resolveSymbolPosition(ctx, 'Foo', '/project/src/a.ts');
    expect(first).not.toBeNull();

    searchFn.mockImplementation(() => []);

    const second = resolveSymbolPosition(ctx, 'Foo', '/project/src/a.ts');
    expect(second).toBeNull();
  });

  it('should throw from getResolvedType after ctx transitions from open to closed', () => {
    const ctx = makeCtx();

    const first = getResolvedType(ctx, 'Foo', '/project/src/a.ts');
    expect(first).not.toBeNull();

    ctx.closed = true;

    expect(() => getResolvedType(ctx, 'Foo', '/project/src/a.ts')).toThrow(GildashError);
  });
});

// ─── Position-based semantic API ──────────────────────────────────────

describe('getResolvedTypeAtPosition', () => {
  it('should delegate to collectTypeAt with resolved absolute path', () => {
    const typeResult = { text: 'number', flags: 0, isUnion: false, isIntersection: false, isGeneric: false };
    const collectTypeAt = mock(() => typeResult);
    const layer = makeSemanticLayer({ collectTypeAt });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getResolvedTypeAtPosition(ctx, '/project/src/a.ts', 100);

    expect(result).toBe(typeResult as any);
    expect(collectTypeAt).toHaveBeenCalledWith('/project/src/a.ts', 100);
  });

  it('should resolve relative path via projectRoot', () => {
    const collectTypeAt = mock(() => null);
    const layer = makeSemanticLayer({ collectTypeAt });
    const ctx = makeCtx({ semanticLayer: layer as any });

    getResolvedTypeAtPosition(ctx, 'src/a.ts', 100);

    expect(collectTypeAt).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 100);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getResolvedTypeAtPosition(ctx, '/a.ts', 0)).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => getResolvedTypeAtPosition(ctx, '/a.ts', 0)).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('type fail');
    const layer = makeSemanticLayer({ collectTypeAt: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getResolvedTypeAtPosition(ctx, '/a.ts', 0);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

describe('getSemanticReferencesAtPosition', () => {
  it('should delegate to findReferences with absolute path', () => {
    const refs = [{ filePath: '/b.ts', position: 10, line: 1, column: 0, isDefinition: false, isWrite: false }];
    const findReferences = mock(() => refs);
    const layer = makeSemanticLayer({ findReferences });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getSemanticReferencesAtPosition(ctx, '/project/src/a.ts', 50);

    expect(result).toBe(refs as any);
    expect(findReferences).toHaveBeenCalledWith('/project/src/a.ts', 50);
  });

  it('should resolve relative path via projectRoot', () => {
    const findReferences = mock(() => []);
    const layer = makeSemanticLayer({ findReferences });
    const ctx = makeCtx({ semanticLayer: layer as any });

    getSemanticReferencesAtPosition(ctx, 'src/a.ts', 50);

    expect(findReferences).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 50);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getSemanticReferencesAtPosition(ctx, '/a.ts', 0)).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => getSemanticReferencesAtPosition(ctx, '/a.ts', 0)).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('ref fail');
    const layer = makeSemanticLayer({ findReferences: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getSemanticReferencesAtPosition(ctx, '/a.ts', 0);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

describe('getImplementationsAtPosition', () => {
  it('should delegate to findImplementations with absolute path', () => {
    const impls = [{ filePath: '/c.ts', symbolName: 'Bar', position: 20, kind: 'class' as const, isExplicit: true }];
    const findImplementations = mock(() => impls);
    const layer = makeSemanticLayer({ findImplementations });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getImplementationsAtPosition(ctx, '/project/src/a.ts', 30);

    expect(result).toBe(impls as any);
    expect(findImplementations).toHaveBeenCalledWith('/project/src/a.ts', 30);
  });

  it('should resolve relative path via projectRoot', () => {
    const findImplementations = mock(() => []);
    const layer = makeSemanticLayer({ findImplementations });
    const ctx = makeCtx({ semanticLayer: layer as any });

    getImplementationsAtPosition(ctx, 'src/a.ts', 30);

    expect(findImplementations).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 30);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getImplementationsAtPosition(ctx, '/a.ts', 0)).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => getImplementationsAtPosition(ctx, '/a.ts', 0)).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('impl fail');
    const layer = makeSemanticLayer({ findImplementations: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getImplementationsAtPosition(ctx, '/a.ts', 0);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

describe('isTypeAssignableToAtPosition', () => {
  it('should delegate to isTypeAssignableTo with absolute paths', () => {
    const isTypeAssignableTo = mock(() => true);
    const layer = makeSemanticLayer({ isTypeAssignableTo });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableToAtPosition(ctx, '/project/src/a.ts', 10, '/project/src/b.ts', 20);

    expect(result).toBe(true);
    expect(isTypeAssignableTo).toHaveBeenCalledWith('/project/src/a.ts', 10, '/project/src/b.ts', 20);
  });

  it('should resolve relative paths', () => {
    const isTypeAssignableTo = mock(() => false);
    const layer = makeSemanticLayer({ isTypeAssignableTo });
    const ctx = makeCtx({ semanticLayer: layer as any });

    isTypeAssignableToAtPosition(ctx, 'src/a.ts', 10, 'src/b.ts', 20);

    expect(isTypeAssignableTo).toHaveBeenCalledWith(
      path.resolve('/project', 'src/a.ts'), 10,
      path.resolve('/project', 'src/b.ts'), 20,
    );
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => isTypeAssignableToAtPosition(ctx, '/a.ts', 0, '/b.ts', 0)).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => isTypeAssignableToAtPosition(ctx, '/a.ts', 0, '/b.ts', 0)).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('assign fail');
    const layer = makeSemanticLayer({ isTypeAssignableTo: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      isTypeAssignableToAtPosition(ctx, '/a.ts', 0, '/b.ts', 0);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── Internal utility exposure ────────────────────────────────────────

describe('lineColumnToPosition', () => {
  it('should delegate to semanticLayer.lineColumnToPosition with absolute path', () => {
    const lctp = mock(() => 42);
    const layer = makeSemanticLayer({ lineColumnToPosition: lctp });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = lineColumnToPosition(ctx, '/project/src/a.ts', 5, 10);

    expect(result).toBe(42);
    expect(lctp).toHaveBeenCalledWith('/project/src/a.ts', 5, 10);
  });

  it('should resolve relative path via projectRoot', () => {
    const lctp = mock(() => 42);
    const layer = makeSemanticLayer({ lineColumnToPosition: lctp });
    const ctx = makeCtx({ semanticLayer: layer as any });

    lineColumnToPosition(ctx, 'src/a.ts', 5, 10);

    expect(lctp).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 5, 10);
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => lineColumnToPosition(ctx, '/a.ts', 1, 0)).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => lineColumnToPosition(ctx, '/a.ts', 1, 0)).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('lc fail');
    const layer = makeSemanticLayer({ lineColumnToPosition: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      lineColumnToPosition(ctx, '/a.ts', 1, 0);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

describe('findNamePosition', () => {
  it('should delegate to semanticLayer.findNamePosition with absolute path', () => {
    const fnp = mock(() => 55);
    const layer = makeSemanticLayer({ findNamePosition: fnp });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = findNamePosition(ctx, '/project/src/a.ts', 40, 'Foo');

    expect(result).toBe(55);
    expect(fnp).toHaveBeenCalledWith('/project/src/a.ts', 40, 'Foo');
  });

  it('should resolve relative path via projectRoot', () => {
    const fnp = mock(() => 55);
    const layer = makeSemanticLayer({ findNamePosition: fnp });
    const ctx = makeCtx({ semanticLayer: layer as any });

    findNamePosition(ctx, 'src/a.ts', 40, 'Foo');

    expect(fnp).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 40, 'Foo');
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => findNamePosition(ctx, '/a.ts', 0, 'x')).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => findNamePosition(ctx, '/a.ts', 0, 'x')).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('fnp fail');
    const layer = makeSemanticLayer({ findNamePosition: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      findNamePosition(ctx, '/a.ts', 0, 'x');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

describe('getSymbolNode', () => {
  it('should delegate to semanticLayer.getSymbolNode with absolute path', () => {
    const node = { name: 'Foo', filePath: '/project/src/a.ts', position: 10 };
    const gsn = mock(() => node);
    const layer = makeSemanticLayer({ getSymbolNode: gsn });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getSymbolNode(ctx, '/project/src/a.ts', 10);

    expect(result).toBe(node as any);
    expect(gsn).toHaveBeenCalledWith('/project/src/a.ts', 10);
  });

  it('should resolve relative path via projectRoot', () => {
    const gsn = mock(() => null);
    const layer = makeSemanticLayer({ getSymbolNode: gsn });
    const ctx = makeCtx({ semanticLayer: layer as any });

    getSymbolNode(ctx, 'src/a.ts', 10);

    expect(gsn).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 10);
  });

  it('should return null when symbol not found', () => {
    const layer = makeSemanticLayer({ getSymbolNode: mock(() => null) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    expect(getSymbolNode(ctx, '/a.ts', 0)).toBeNull();
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getSymbolNode(ctx, '/a.ts', 0)).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => getSymbolNode(ctx, '/a.ts', 0)).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('sym fail');
    const layer = makeSemanticLayer({ getSymbolNode: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getSymbolNode(ctx, '/a.ts', 0);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── Diagnostics ──────────────────────────────────────────────────────

describe('getSemanticDiagnostics', () => {
  it('should delegate to semanticLayer.getDiagnostics with absolute path', () => {
    const diags = [{ filePath: '/a.ts', line: 1, column: 0, message: 'err', code: 2322, category: 'error' as const }];
    const gd = mock(() => diags);
    const layer = makeSemanticLayer({ getDiagnostics: gd });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getSemanticDiagnostics(ctx, '/project/src/a.ts');

    expect(result).toBe(diags as any);
    expect(gd).toHaveBeenCalledWith('/project/src/a.ts');
  });

  it('should resolve relative path', () => {
    const gd = mock(() => []);
    const layer = makeSemanticLayer({ getDiagnostics: gd });
    const ctx = makeCtx({ semanticLayer: layer as any });

    getSemanticDiagnostics(ctx, 'src/a.ts');

    expect(gd).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'));
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => getSemanticDiagnostics(ctx, '/a.ts')).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => getSemanticDiagnostics(ctx, '/a.ts')).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('diag fail');
    const layer = makeSemanticLayer({ getDiagnostics: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getSemanticDiagnostics(ctx, '/a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── isTypeAssignableToType ───────────────────────────────────────────

describe('isTypeAssignableToType', () => {
  it('should delegate to semanticLayer.isTypeAssignableToType with absolute path', () => {
    const iatt = mock(() => true);
    const layer = makeSemanticLayer({ isTypeAssignableToType: iatt });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableToType(ctx, '/project/src/a.ts', 100, 'PromiseLike<any>');

    expect(result).toBe(true);
    expect(iatt).toHaveBeenCalledWith('/project/src/a.ts', 100, 'PromiseLike<any>');
  });

  it('should resolve relative path via projectRoot', () => {
    const iatt = mock(() => false);
    const layer = makeSemanticLayer({ isTypeAssignableToType: iatt });
    const ctx = makeCtx({ semanticLayer: layer as any });

    isTypeAssignableToType(ctx, 'src/a.ts', 100, 'Error');

    expect(iatt).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 100, 'Error');
  });

  it('should return null when semanticLayer returns null', () => {
    const layer = makeSemanticLayer({ isTypeAssignableToType: mock(() => null) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    expect(isTypeAssignableToType(ctx, '/a.ts', 0, 'Error')).toBeNull();
  });

  it('should throw when closed', () => {
    const ctx = makeCtx({ closed: true });
    expect(() => isTypeAssignableToType(ctx, '/a.ts', 0, 'Error')).toThrow(GildashError);
  });

  it('should throw when semantic layer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });
    expect(() => isTypeAssignableToType(ctx, '/a.ts', 0, 'Error')).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('type check fail');
    const layer = makeSemanticLayer({ isTypeAssignableToType: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      isTypeAssignableToType(ctx, '/a.ts', 0, 'Error');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});
