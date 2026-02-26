import { describe, it, expect, mock } from 'bun:test';
import { err, isErr } from '@zipbul/result';
import path from 'node:path';
import { gildashError } from '../errors';
import type { GildashContext } from './context';
import {
  resolveSymbolPosition,
  getResolvedType,
  getSemanticReferences,
  getImplementations,
  getSemanticModuleInterface,
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

    expect(isErr(result)).toBe(false);
    expect(result).toBe(typeResult as any);
  });

  it('should return err with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    const result = getResolvedType(ctx, 'Foo', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('closed');
    }
  });

  it('should return err with type semantic when semanticLayer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });

    const result = getResolvedType(ctx, 'Foo', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('semantic');
      expect(result.data.message).toContain('semantic layer is not enabled');
    }
  });

  it('should return err with type search when resolveSymbolPosition returns null', () => {
    const ctx = makeCtx({ symbolSearchFn: mock(() => []) as any });

    const result = getResolvedType(ctx, 'Missing', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.message).toContain("'Missing'");
    }
  });

  it('should catch exception and return err with cause', () => {
    const error = new Error('boom');
    const layer = makeSemanticLayer({ collectTypeAt: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getResolvedType(ctx, 'Foo', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBe(error);
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

    expect(isErr(result)).toBe(false);
    expect(result).toBe(refs as any);
  });

  it('should return err with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    const result = getSemanticReferences(ctx, 'Foo', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('closed');
    }
  });

  it('should catch exception and return err with cause', () => {
    const error = new Error('ref fail');
    const layer = makeSemanticLayer({ findReferences: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getSemanticReferences(ctx, 'Foo', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBe(error);
    }
  });

  it('should return err when resolveSymbolPosition returns null', () => {
    const layer = makeSemanticLayer();
    const ctx = makeCtx({
      semanticLayer: layer as any,
      symbolSearchFn: mock(() => []) as any,
    });

    const result = getSemanticReferences(ctx, 'Missing', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.message).toContain('Missing');
    }
  });
});

// ─── getImplementations ─────────────────────────────────────────────

describe('getImplementations', () => {
  it('should return findImplementations result when symbol is resolved', () => {
    const impls = [{ filePath: '/src/c.ts', span: { start: { line: 1, column: 0 }, end: { line: 10, column: 1 } } }];
    const layer = makeSemanticLayer({ findImplementations: mock(() => impls) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getImplementations(ctx, 'Foo', '/project/src/a.ts');

    expect(isErr(result)).toBe(false);
    expect(result).toBe(impls as any);
  });

  it('should return err with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    const result = getImplementations(ctx, 'Foo', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('closed');
    }
  });

  it('should catch exception and return err with cause', () => {
    const error = new Error('impl fail');
    const layer = makeSemanticLayer({ findImplementations: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getImplementations(ctx, 'Foo', '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBe(error);
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

    expect(isErr(result)).toBe(false);
    expect(result).toBe(iface as any);
  });

  it('should return err with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    const result = getSemanticModuleInterface(ctx, '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('closed');
    }
  });

  it('should return err with type semantic when semanticLayer is null', () => {
    const ctx = makeCtx({ semanticLayer: null });

    const result = getSemanticModuleInterface(ctx, '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('semantic');
    }
  });

  it('should catch exception and return err with cause', () => {
    const error = new Error('iface fail');
    const layer = makeSemanticLayer({ getModuleInterface: mock(() => { throw error; }) });
    const ctx = makeCtx({ semanticLayer: layer as any });

    const result = getSemanticModuleInterface(ctx, '/project/src/a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBe(error);
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

  it('should return err from getResolvedType after ctx transitions from open to closed', () => {
    const ctx = makeCtx();

    const first = getResolvedType(ctx, 'Foo', '/project/src/a.ts');
    expect(isErr(first)).toBe(false);

    ctx.closed = true;

    const second = getResolvedType(ctx, 'Foo', '/project/src/a.ts');
    expect(isErr(second)).toBe(true);
    if (isErr(second)) {
      expect(second.data.type).toBe('closed');
    }
  });
});
