import { describe, it, expect, mock } from 'bun:test';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import type { ParsedFile } from '../parser/types';
import { extractSymbols, extractRelations } from './extract-api';

// ─── Fixtures ───────────────────────────────────────────────────────

function makeParsed(overrides?: Partial<ParsedFile>): ParsedFile {
  return {
    filePath: '/test/file.ts',
    program: { type: 'Program', body: [], sourceType: 'module' } as any,
    errors: [],
    comments: [],
    sourceText: 'const a = 1;',
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<GildashContext>): GildashContext {
  return {
    closed: false,
    extractSymbolsFn: mock(() => []),
    extractRelationsFn: mock(() => []),
    tsconfigPaths: null,
    ...overrides,
  } as unknown as GildashContext;
}

// ─── extractSymbols ─────────────────────────────────────────────────

describe('extractSymbols', () => {
  it('should delegate parsed to extractSymbolsFn and return its result when ctx is open', () => {
    const symbols = [{ name: 'Foo', kind: 'class' }];
    const fn = mock(() => symbols);
    const ctx = makeCtx({ extractSymbolsFn: fn as any });
    const parsed = makeParsed();

    const result = extractSymbols(ctx, parsed);

    expect(result).toBe(symbols as any);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(parsed);
  });

  it('should throw GildashError with type closed when ctx.closed is true', () => {
    const ctx = makeCtx({ closed: true });
    const parsed = makeParsed();

    expect(() => extractSymbols(ctx, parsed)).toThrow(GildashError);
    expect(() => extractSymbols(ctx, parsed)).toThrow(/instance is closed/);
  });

  it('should not call extractSymbolsFn when ctx.closed is true', () => {
    const fn = mock(() => []);
    const ctx = makeCtx({ closed: true, extractSymbolsFn: fn as any });
    const parsed = makeParsed();

    try { extractSymbols(ctx, parsed); } catch {}

    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('should throw after ctx transitions from open to closed', () => {
    const ctx = makeCtx();
    const parsed = makeParsed();

    const firstResult = extractSymbols(ctx, parsed);
    expect(firstResult).toEqual([]);

    ctx.closed = true;

    expect(() => extractSymbols(ctx, parsed)).toThrow(GildashError);
  });

  it('should call extractSymbolsFn on every invocation without caching', () => {
    const fn = mock(() => []);
    const ctx = makeCtx({ extractSymbolsFn: fn as any });
    const parsed = makeParsed();

    extractSymbols(ctx, parsed);
    extractSymbols(ctx, parsed);

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ─── extractRelations ───────────────────────────────────────────────

describe('extractRelations', () => {
  it('should delegate (program, filePath, tsconfigPaths) to extractRelationsFn when ctx is open', () => {
    const relations = [{ src: 'a.ts', target: 'b.ts' }];
    const tsconfigPaths = { '@/*': ['src/*'] };
    const fn = mock(() => relations);
    const parsed = makeParsed();
    const ctx = makeCtx({
      extractRelationsFn: fn as any,
      tsconfigPaths: tsconfigPaths as any,
    });

    const result = extractRelations(ctx, parsed);

    expect(result).toBe(relations as any);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(parsed.program, parsed.filePath, tsconfigPaths);
  });

  it('should pass undefined when ctx.tsconfigPaths is null', () => {
    const fn = mock(() => []);
    const ctx = makeCtx({ extractRelationsFn: fn as any, tsconfigPaths: null });
    const parsed = makeParsed();

    extractRelations(ctx, parsed);

    expect(fn).toHaveBeenCalledWith(parsed.program, parsed.filePath, undefined);
  });

  it('should pass undefined when ctx.tsconfigPaths is undefined', () => {
    const fn = mock(() => []);
    const ctx = makeCtx({
      extractRelationsFn: fn as any,
      tsconfigPaths: undefined as any,
    });
    const parsed = makeParsed();

    extractRelations(ctx, parsed);

    expect(fn).toHaveBeenCalledWith(parsed.program, parsed.filePath, undefined);
  });

  it('should pass empty object when ctx.tsconfigPaths is empty object', () => {
    const emptyPaths = {};
    const fn = mock(() => []);
    const ctx = makeCtx({
      extractRelationsFn: fn as any,
      tsconfigPaths: emptyPaths as any,
    });
    const parsed = makeParsed();

    extractRelations(ctx, parsed);

    expect(fn).toHaveBeenCalledWith(parsed.program, parsed.filePath, emptyPaths);
  });

  it('should throw GildashError with type closed when ctx.closed is true', () => {
    const ctx = makeCtx({ closed: true });
    const parsed = makeParsed();

    expect(() => extractRelations(ctx, parsed)).toThrow(GildashError);
    expect(() => extractRelations(ctx, parsed)).toThrow(/instance is closed/);
  });

  it('should not call extractRelationsFn when ctx.closed is true', () => {
    const fn = mock(() => []);
    const ctx = makeCtx({ closed: true, extractRelationsFn: fn as any });
    const parsed = makeParsed();

    try { extractRelations(ctx, parsed); } catch {}

    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('should throw after ctx transitions from open to closed', () => {
    const ctx = makeCtx();
    const parsed = makeParsed();

    const firstResult = extractRelations(ctx, parsed);
    expect(firstResult).toEqual([]);

    ctx.closed = true;

    expect(() => extractRelations(ctx, parsed)).toThrow(GildashError);
  });
});
