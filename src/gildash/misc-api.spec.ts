import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { err, isErr } from '@zipbul/result';
import type { GildashContext } from './context';
import type { SymbolSearchResult } from '../search/symbol-search';

// ─── Mocks ──────────────────────────────────────────────────────────

const mockFullIndex = mock(async () => ({ indexed: 5 }));
mock.module('../indexer/index-coordinator', () => ({
  IndexCoordinator: class {
    fullIndex = mockFullIndex;
  },
}));

const {
  diffSymbols,
  onIndexed,
  reindex,
  resolveSymbol,
  findPattern,
  getHeritageChain,
} = await import('./misc-api');

// ─── Fixtures ───────────────────────────────────────────────────────

function makeSym(name: string, filePath: string, fingerprint = 'fp1'): SymbolSearchResult {
  return {
    name,
    filePath,
    fingerprint,
    kind: 'function' as any,
    project: 'default',
    span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
  } as unknown as SymbolSearchResult;
}

function makeCtx(overrides?: Partial<GildashContext>): GildashContext {
  return {
    closed: false,
    defaultProject: 'default',
    projectRoot: '/project',
    role: 'owner' as const,
    relationRepo: {} as any,
    symbolRepo: {} as any,
    fileRepo: { getAllFiles: mock(() => [{ filePath: 'a.ts' }]) } as any,
    db: {} as any,
    parseCache: {} as any,
    logger: { error: () => {} } as any,
    onIndexedCallbacks: new Set(),
    coordinator: null,
    relationSearchFn: mock(() => []),
    patternSearchFn: mock(async () => []),
    existsSyncFn: mock(() => true),
    ...overrides,
  } as unknown as GildashContext;
}

beforeEach(() => {
  mockFullIndex.mockClear();
});

// ─── diffSymbols ────────────────────────────────────────────────────

describe('diffSymbols', () => {
  it('should detect added symbols', () => {
    const before = [makeSym('A', 'a.ts')];
    const after = [makeSym('A', 'a.ts'), makeSym('B', 'b.ts')];

    const result = diffSymbols(before, after);

    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.name).toBe('B');
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it('should detect removed symbols', () => {
    const before = [makeSym('A', 'a.ts'), makeSym('B', 'b.ts')];
    const after = [makeSym('A', 'a.ts')];

    const result = diffSymbols(before, after);

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.name).toBe('B');
  });

  it('should detect modified symbols via fingerprint change', () => {
    const before = [makeSym('A', 'a.ts', 'fp1')];
    const after = [makeSym('A', 'a.ts', 'fp2')];

    const result = diffSymbols(before, after);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0]!.before.fingerprint).toBe('fp1');
    expect(result.modified[0]!.after.fingerprint).toBe('fp2');
  });

  it('should return empty diff when before and after are identical', () => {
    const before = [makeSym('A', 'a.ts')];
    const after = [makeSym('A', 'a.ts')];

    const result = diffSymbols(before, after);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it('should handle empty before array', () => {
    const after = [makeSym('A', 'a.ts')];

    const result = diffSymbols([], after);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
  });

  it('should handle empty after array', () => {
    const before = [makeSym('A', 'a.ts')];

    const result = diffSymbols(before, []);

    expect(result.removed).toHaveLength(1);
    expect(result.added).toHaveLength(0);
  });
});

// ─── onIndexed ──────────────────────────────────────────────────────

describe('onIndexed', () => {
  it('should add callback to onIndexedCallbacks and subscribe via coordinator', () => {
    const unsubMock = mock(() => {});
    const coordinatorOnIndexed = mock(() => unsubMock);
    const ctx = makeCtx({
      coordinator: { onIndexed: coordinatorOnIndexed, fullIndex: mock(async () => ({})), shutdown: mock(() => {}) } as any,
    });
    const callback = mock(() => {});

    onIndexed(ctx, callback);

    expect(ctx.onIndexedCallbacks.has(callback)).toBe(true);
    expect(coordinatorOnIndexed).toHaveBeenCalledWith(callback);
  });

  it('should add callback without coordinator subscription when coordinator is null', () => {
    const ctx = makeCtx({ coordinator: null });
    const callback = mock(() => {});

    onIndexed(ctx, callback);

    expect(ctx.onIndexedCallbacks.has(callback)).toBe(true);
  });

  it('should remove callback and call unsubscribe when dispose is called with coordinator', () => {
    const unsubMock = mock(() => {});
    const coordinatorOnIndexed = mock(() => unsubMock);
    const ctx = makeCtx({
      coordinator: { onIndexed: coordinatorOnIndexed, fullIndex: mock(async () => ({})), shutdown: mock(() => {}) } as any,
    });
    const callback = mock(() => {});

    const dispose = onIndexed(ctx, callback);
    dispose();

    expect(ctx.onIndexedCallbacks.has(callback)).toBe(false);
    expect(unsubMock).toHaveBeenCalledTimes(1);
  });

  it('should remove callback when dispose is called without coordinator', () => {
    const ctx = makeCtx({ coordinator: null });
    const callback = mock(() => {});

    const dispose = onIndexed(ctx, callback);
    dispose();

    expect(ctx.onIndexedCallbacks.has(callback)).toBe(false);
  });
});

// ─── reindex ────────────────────────────────────────────────────────

describe('reindex', () => {
  it('should call coordinator.fullIndex and invalidateGraphCache and return result', async () => {
    const indexResult = { indexed: 10, added: 3, removed: 1 };
    const fullIndex = mock(async () => indexResult);
    const ctx = makeCtx({
      coordinator: { fullIndex, onIndexed: mock(() => () => {}), shutdown: mock(() => {}) } as any,
      graphCache: {} as any,
      graphCacheKey: 'old',
    });

    const result = await reindex(ctx);

    expect(isErr(result)).toBe(false);
    expect(result).toBe(indexResult as any);
    expect(fullIndex).toHaveBeenCalledTimes(1);
    expect(ctx.graphCache).toBeNull();
    expect(ctx.graphCacheKey).toBeNull();
  });

  it('should return err with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    const result = await reindex(ctx);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('closed');
  });

  it('should return err when coordinator is null', async () => {
    const ctx = makeCtx({ coordinator: null });

    const result = await reindex(ctx);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('closed');
      expect(result.data.message).toContain('not available for readers');
    }
  });

  it('should catch exception and return err with type index', async () => {
    const error = new Error('index fail');
    const fullIndex = mock(async () => { throw error; });
    const ctx = makeCtx({
      coordinator: { fullIndex, onIndexed: mock(() => () => {}), shutdown: mock(() => {}) } as any,
    });

    const result = await reindex(ctx);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('index');
      expect(result.data.cause).toBe(error);
    }
  });
});

// ─── resolveSymbol ──────────────────────────────────────────────────

describe('resolveSymbol', () => {
  it('should return original position when no re-export found', () => {
    const searchFn = mock(() => []);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = resolveSymbol(ctx, 'Foo', 'src/a.ts');

    expect(isErr(result)).toBe(false);
    const resolved = result as any;
    expect(resolved.originalName).toBe('Foo');
    expect(resolved.originalFilePath).toBe('src/a.ts');
    expect(resolved.reExportChain).toEqual([]);
  });

  it('should follow single-hop re-export chain', () => {
    const searchFn = mock((opts: any) => {
      if (opts.query.srcFilePath === 'src/index.ts') {
        return [{
          type: 're-exports',
          srcFilePath: 'src/index.ts',
          dstFilePath: 'src/foo.ts',
          metaJson: JSON.stringify({ specifiers: [{ local: 'FooImpl', exported: 'Foo' }] }),
        }];
      }
      return [];
    });
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = resolveSymbol(ctx, 'Foo', 'src/index.ts');

    expect(isErr(result)).toBe(false);
    const resolved = result as any;
    expect(resolved.originalName).toBe('FooImpl');
    expect(resolved.originalFilePath).toBe('src/foo.ts');
    expect(resolved.reExportChain).toEqual([
      { filePath: 'src/index.ts', exportedAs: 'Foo' },
    ]);
  });

  it('should follow multi-hop re-export chain', () => {
    const searchFn = mock((opts: any) => {
      const fp = opts.query.srcFilePath;
      if (fp === 'src/index.ts') {
        return [{
          type: 're-exports', srcFilePath: 'src/index.ts', dstFilePath: 'src/re.ts',
          metaJson: JSON.stringify({ specifiers: [{ local: 'Foo', exported: 'Foo' }] }),
        }];
      }
      if (fp === 'src/re.ts') {
        return [{
          type: 're-exports', srcFilePath: 'src/re.ts', dstFilePath: 'src/real.ts',
          metaJson: JSON.stringify({ specifiers: [{ local: 'RealFoo', exported: 'Foo' }] }),
        }];
      }
      return [];
    });
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = resolveSymbol(ctx, 'Foo', 'src/index.ts');

    expect(isErr(result)).toBe(false);
    const resolved = result as any;
    expect(resolved.originalName).toBe('RealFoo');
    expect(resolved.originalFilePath).toBe('src/real.ts');
    expect(resolved.reExportChain).toHaveLength(2);
  });

  it('should return err with type closed when ctx is closed', () => {
    const ctx = makeCtx({ closed: true });

    const result = resolveSymbol(ctx, 'Foo', 'a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('closed');
  });

  it('should return err on circular re-export detected', () => {
    const searchFn = mock(() => [{
      type: 're-exports', srcFilePath: 'a.ts', dstFilePath: 'a.ts',
      metaJson: JSON.stringify({ specifiers: [{ local: 'Foo', exported: 'Foo' }] }),
    }]);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = resolveSymbol(ctx, 'Foo', 'a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.message).toContain('circular');
    }
  });

  it('should skip relations with malformed metaJson', () => {
    const searchFn = mock(() => [{
      type: 're-exports', srcFilePath: 'a.ts', dstFilePath: 'b.ts',
      metaJson: 'invalid json{',
    }]);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = resolveSymbol(ctx, 'Foo', 'a.ts');

    expect(isErr(result)).toBe(false);
    const resolved = result as any;
    expect(resolved.originalName).toBe('Foo');
    expect(resolved.reExportChain).toEqual([]);
  });

  it('should use defaultProject when project is omitted', () => {
    const searchFn = mock(() => []);
    const ctx = makeCtx({ relationSearchFn: searchFn as any, defaultProject: 'my-proj' });

    resolveSymbol(ctx, 'Foo', 'a.ts');

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'my-proj' }),
    );
  });
});

// ─── findPattern ────────────────────────────────────────────────────

describe('findPattern', () => {
  it('should call patternSearchFn with explicit filePaths', async () => {
    const matches = [{ filePath: 'a.ts', line: 5, match: 'if(' }];
    const searchFn = mock(async () => matches);
    const ctx = makeCtx({ patternSearchFn: searchFn as any });

    const result = await findPattern(ctx, 'if(', { filePaths: ['a.ts', 'b.ts'] });

    expect(isErr(result)).toBe(false);
    expect(result).toBe(matches as any);
    expect(searchFn).toHaveBeenCalledWith({ pattern: 'if(', filePaths: ['a.ts', 'b.ts'] });
  });

  it('should use fileRepo.getAllFiles when filePaths not provided', async () => {
    const getAllFiles = mock(() => [{ filePath: 'x.ts' }, { filePath: 'y.ts' }]);
    const searchFn = mock(async () => []);
    const ctx = makeCtx({
      patternSearchFn: searchFn as any,
      fileRepo: { getAllFiles } as any,
    });

    await findPattern(ctx, 'pattern');

    expect(searchFn).toHaveBeenCalledWith({ pattern: 'pattern', filePaths: ['x.ts', 'y.ts'] });
  });

  it('should return err with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    const result = await findPattern(ctx, 'p');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('closed');
  });

  it('should catch exception and return err with cause', async () => {
    const error = new Error('search fail');
    const ctx = makeCtx({ patternSearchFn: mock(async () => { throw error; }) as any });

    const result = await findPattern(ctx, 'p');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBe(error);
    }
  });
});

// ─── getHeritageChain ───────────────────────────────────────────────

describe('getHeritageChain', () => {
  it('should return leaf node with empty children when no heritage relations', async () => {
    const ctx = makeCtx({ relationSearchFn: mock(() => []) as any });

    const result = await getHeritageChain(ctx, 'Foo', 'src/a.ts');

    expect(isErr(result)).toBe(false);
    const node = result as any;
    expect(node.symbolName).toBe('Foo');
    expect(node.filePath).toBe('src/a.ts');
    expect(node.children).toEqual([]);
  });

  it('should build heritage tree with extends relation', async () => {
    const searchFn = mock((opts: any) => {
      if (opts.query.srcSymbolName === 'Child') {
        return [{
          type: 'extends', srcFilePath: 'src/child.ts', srcSymbolName: 'Child',
          dstFilePath: 'src/parent.ts', dstSymbolName: 'Parent',
        }];
      }
      return [];
    });
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = await getHeritageChain(ctx, 'Child', 'src/child.ts');

    expect(isErr(result)).toBe(false);
    const node = result as any;
    expect(node.symbolName).toBe('Child');
    expect(node.children).toHaveLength(1);
    expect(node.children[0].symbolName).toBe('Parent');
    expect(node.children[0].kind).toBe('extends');
  });

  it('should return err with type closed when ctx is closed', async () => {
    const ctx = makeCtx({ closed: true });

    const result = await getHeritageChain(ctx, 'Foo', 'a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('closed');
  });

  it('should catch exception and return err with cause', async () => {
    const error = new Error('heritage fail');
    const ctx = makeCtx({ relationSearchFn: mock(() => { throw error; }) as any });

    const result = await getHeritageChain(ctx, 'Foo', 'a.ts');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.type).toBe('search');
      expect(result.data.cause).toBe(error);
    }
  });

  it('should handle circular heritage by returning empty children on revisit', async () => {
    const searchFn = mock(() => [{
      type: 'extends', srcFilePath: 'a.ts', srcSymbolName: 'A',
      dstFilePath: 'a.ts', dstSymbolName: 'A',
    }]);
    const ctx = makeCtx({ relationSearchFn: searchFn as any });

    const result = await getHeritageChain(ctx, 'A', 'a.ts');

    expect(isErr(result)).toBe(false);
    const node = result as any;
    expect(node.children).toHaveLength(1);
    expect(node.children[0].children).toEqual([]);
  });
});

// ─── State Transition ───────────────────────────────────────────────

describe('misc-api state transitions', () => {
  it('should return err from reindex after ctx transitions open to closed', async () => {
    const fullIndex = mock(async () => ({ indexed: 5 }));
    const ctx = makeCtx({
      coordinator: { fullIndex, onIndexed: mock(() => () => {}), shutdown: mock(() => {}) } as any,
    });

    const first = await reindex(ctx);
    expect(isErr(first)).toBe(false);

    ctx.closed = true;

    const second = await reindex(ctx);
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.data.type).toBe('closed');
  });
});
