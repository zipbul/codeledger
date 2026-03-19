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
  isTypeAssignableTo,
  getFileTypes,
  getResolvedTypeAt,
  isTypeAssignableToAt,
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
    notifyFileChanged: mock(() => {}),
    dispose: mock(() => {}),
    isDisposed: false,
    collectFileTypes: mock(() => []),
    isTypeAssignableTo: mock(() => null),
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
      query: { text: 'Foo', exact: true, filePath: '/project/src/a.ts', limit: 1 },
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

    resolveSymbolPosition(ctx, 'Bar', '/src/b.ts');

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { text: 'Bar', exact: true, filePath: '/src/b.ts', limit: 1 },
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

// ─── isTypeAssignableTo ─────────────────────────────────────────────

describe('isTypeAssignableTo', () => {
  it('should throw GildashError when source symbol not found', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => []) as any });

    expect(() =>
      isTypeAssignableTo(ctx, 'Missing', '/project/src/a.ts', 'Foo', '/project/src/b.ts'),
    ).toThrow(GildashError);
    try {
      isTypeAssignableTo(ctx, 'Missing', '/project/src/a.ts', 'Foo', '/project/src/b.ts');
    } catch (e) {
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).message).toContain('source symbol');
    }
  });

  it('should throw GildashError when target symbol not found', () => {
    const searchFn = mock(() => []) as any;
    // First call returns source, second returns empty for target
    searchFn.mockImplementationOnce(() => [dummySym]);
    searchFn.mockImplementationOnce(() => []);
    const ctx = makeCtx({ symbolSearchFn: searchFn });

    try {
      isTypeAssignableTo(ctx, 'Foo', '/project/src/a.ts', 'Missing', '/project/src/b.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('search');
      expect((e as GildashError).message).toContain('target symbol');
    }
  });

  it('should throw GildashError when semantic layer not enabled', () => {
    const ctx = makeCtx({ semanticLayer: null });

    expect(() =>
      isTypeAssignableTo(ctx, 'Foo', '/project/src/a.ts', 'Bar', '/project/src/b.ts'),
    ).toThrow(GildashError);
    try {
      isTypeAssignableTo(ctx, 'Foo', '/project/src/a.ts', 'Bar', '/project/src/b.ts');
    } catch (e) {
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).message).toContain('semantic layer is not enabled');
    }
  });

  it('should return null when tsc cannot resolve types', () => {
    const layer = makeSemanticLayer({ isTypeAssignableTo: mock(() => null) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableTo(ctx, 'Foo', '/project/src/a.ts', 'Bar', '/project/src/b.ts');

    expect(result).toBeNull();
  });

  it('should return true when source type is assignable to target type', () => {
    const layer = makeSemanticLayer({ isTypeAssignableTo: mock(() => true) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableTo(ctx, 'Foo', '/project/src/a.ts', 'Bar', '/project/src/b.ts');

    expect(result).toBe(true);
  });

  it('should return false when source type is not assignable to target type', () => {
    const layer = makeSemanticLayer({ isTypeAssignableTo: mock(() => false) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableTo(ctx, 'Foo', '/project/src/a.ts', 'Bar', '/project/src/b.ts');

    expect(result).toBe(false);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() =>
      isTypeAssignableTo(ctx, 'Foo', '/project/src/a.ts', 'Bar', '/project/src/b.ts'),
    ).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('assignable fail');
    const layer = makeSemanticLayer({ isTypeAssignableTo: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      isTypeAssignableTo(ctx, 'Foo', '/project/src/a.ts', 'Bar', '/project/src/b.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── getFileTypes ───────────────────────────────────────────────────

describe('getFileTypes', () => {
  it('should return type map for the given file', () => {
    const typeMap = new Map([[10, { type: 'string', text: 'string' }]]);
    const layer = makeSemanticLayer({ collectFileTypes: mock(() => typeMap) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getFileTypes(ctx, '/project/src/a.ts');

    expect(result).toBe(typeMap as any);
  });

  it('should throw when semantic layer not enabled', () => {
    const ctx = makeCtx({ semanticLayer: null });

    expect(() => getFileTypes(ctx, '/project/src/a.ts')).toThrow(GildashError);
    try {
      getFileTypes(ctx, '/project/src/a.ts');
    } catch (e) {
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).message).toContain('semantic layer is not enabled');
    }
  });

  it('should resolve relative path to absolute', () => {
    const collectFileTypes = mock(() => new Map());
    const layer = makeSemanticLayer({ collectFileTypes });
    const ctx = makeCtx({ semanticLayer: layer as any });

    getFileTypes(ctx, 'src/a.ts');

    expect(collectFileTypes).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'));
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getFileTypes(ctx, '/project/src/a.ts')).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('file types fail');
    const layer = makeSemanticLayer({ collectFileTypes: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getFileTypes(ctx, '/project/src/a.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── getResolvedTypeAt ──────────────────────────────────────────────

describe('getResolvedTypeAt', () => {
  it('should return type at position', () => {
    const typeResult = { type: 'number', text: 'number' };
    const layer = makeSemanticLayer({
      lineColumnToPosition: mock(() => 100),
      collectTypeAt: mock(() => typeResult),
    });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getResolvedTypeAt(ctx, '/project/src/a.ts', 5, 10);

    expect(result).toBe(typeResult as any);
    expect(layer.lineColumnToPosition).toHaveBeenCalledWith('/project/src/a.ts', 5, 10);
    expect(layer.collectTypeAt).toHaveBeenCalledWith('/project/src/a.ts', 100);
  });

  it('should return null when position cannot be resolved', () => {
    const layer = makeSemanticLayer({ lineColumnToPosition: mock(() => null) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getResolvedTypeAt(ctx, '/project/src/a.ts', 5, 10);

    expect(result).toBeNull();
  });

  it('should throw when semantic layer not enabled', () => {
    const ctx = makeCtx({ semanticLayer: null });

    expect(() => getResolvedTypeAt(ctx, '/project/src/a.ts', 5, 10)).toThrow(GildashError);
  });

  it('should resolve relative path to absolute', () => {
    const lineColumnToPosition = mock(() => 100);
    const collectTypeAt = mock(() => ({ type: 'string', text: 'string' }));
    const layer = makeSemanticLayer({ lineColumnToPosition, collectTypeAt });
    const ctx = makeCtx({ semanticLayer: layer as any });

    getResolvedTypeAt(ctx, 'src/a.ts', 5, 10);

    expect(lineColumnToPosition).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 5, 10);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getResolvedTypeAt(ctx, '/project/src/a.ts', 5, 10)).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('type at fail');
    const layer = makeSemanticLayer({ collectTypeAt: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      getResolvedTypeAt(ctx, '/project/src/a.ts', 5, 10);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
      expect((e as GildashError).cause).toBe(error);
    }
  });
});

// ─── isTypeAssignableToAt ───────────────────────────────────────────

describe('isTypeAssignableToAt', () => {
  it('should check assignability via positions', () => {
    const layer = makeSemanticLayer({
      lineColumnToPosition: mock(((_f: string, line: number) => line === 5 ? 100 : 200) as any),
      isTypeAssignableTo: mock(() => true),
    });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableToAt(ctx, {
      source: { filePath: '/project/src/a.ts', line: 5, column: 0 },
      target: { filePath: '/project/src/b.ts', line: 10, column: 0 },
    });

    expect(result).toBe(true);
  });

  it('should return false when types are not assignable', () => {
    const layer = makeSemanticLayer({
      isTypeAssignableTo: mock(() => false),
    });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableToAt(ctx, {
      source: { filePath: '/project/src/a.ts', line: 5, column: 0 },
      target: { filePath: '/project/src/b.ts', line: 10, column: 0 },
    });

    expect(result).toBe(false);
  });

  it('should return null when source position cannot be resolved', () => {
    const layer = makeSemanticLayer({ lineColumnToPosition: mock(() => null) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableToAt(ctx, {
      source: { filePath: '/project/src/a.ts', line: 5, column: 0 },
      target: { filePath: '/project/src/b.ts', line: 10, column: 0 },
    });

    expect(result).toBeNull();
  });

  it('should return null when target position cannot be resolved', () => {
    const lineColumnToPosition = mock(() => null) as any;
    lineColumnToPosition.mockImplementationOnce(() => 100);
    lineColumnToPosition.mockImplementationOnce(() => null);
    const layer = makeSemanticLayer({ lineColumnToPosition });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = isTypeAssignableToAt(ctx, {
      source: { filePath: '/project/src/a.ts', line: 5, column: 0 },
      target: { filePath: '/project/src/b.ts', line: 10, column: 0 },
    });

    expect(result).toBeNull();
  });

  it('should resolve relative paths', () => {
    const lineColumnToPosition = mock(() => 42);
    const isAssignable = mock(() => true);
    const layer = makeSemanticLayer({ lineColumnToPosition, isTypeAssignableTo: isAssignable });
    const ctx = makeCtx({ semanticLayer: layer as any });

    isTypeAssignableToAt(ctx, {
      source: { filePath: 'src/a.ts', line: 5, column: 0 },
      target: { filePath: 'src/b.ts', line: 10, column: 0 },
    });

    expect(lineColumnToPosition).toHaveBeenCalledWith(path.resolve('/project', 'src/a.ts'), 5, 0);
    expect(lineColumnToPosition).toHaveBeenCalledWith(path.resolve('/project', 'src/b.ts'), 10, 0);
  });

  it('should throw when semantic layer not enabled', () => {
    const ctx = makeCtx({ semanticLayer: null });

    expect(() => isTypeAssignableToAt(ctx, {
      source: { filePath: '/project/src/a.ts', line: 5, column: 0 },
      target: { filePath: '/project/src/b.ts', line: 10, column: 0 },
    })).toThrow(GildashError);
  });

  it('should throw with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => isTypeAssignableToAt(ctx, {
      source: { filePath: '/project/src/a.ts', line: 5, column: 0 },
      target: { filePath: '/project/src/b.ts', line: 10, column: 0 },
    })).toThrow(GildashError);
  });

  it('should catch exception and throw GildashError with cause', () => {
    const error = new Error('assignable at fail');
    const layer = makeSemanticLayer({ isTypeAssignableTo: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    try {
      isTypeAssignableToAt(ctx, {
        source: { filePath: '/project/src/a.ts', line: 5, column: 0 },
        target: { filePath: '/project/src/b.ts', line: 10, column: 0 },
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('semantic');
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
