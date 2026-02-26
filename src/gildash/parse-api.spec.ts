import { describe, it, expect, mock } from 'bun:test';
import { err } from '@zipbul/result';
import { GildashError, gildashError } from '../errors';
import type { GildashContext } from './context';
import type { ParsedFile } from '../parser/types';
import { parseSource, batchParse, getParsedAst } from './parse-api';

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
    parseSourceFn: mock(() => makeParsed()),
    parseCache: { set: mock(() => {}), get: mock(() => undefined), invalidate: mock(() => {}) },
    readFileFn: mock(async () => 'const a = 1;'),
    ...overrides,
  } as unknown as GildashContext;
}

// ─── parseSource ────────────────────────────────────────────────────

describe('parseSource', () => {
  it('should delegate (filePath, sourceText, options) to parseSourceFn and return its result', () => {
    const parsed = makeParsed({ filePath: '/src/a.ts' });
    const fn = mock(() => parsed);
    const ctx = makeCtx({ parseSourceFn: fn as any });
    const options = { sourceType: 'module' as const };

    const result = parseSource(ctx, '/src/a.ts', 'const x = 1;', options);

    expect(result).toBe(parsed);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('/src/a.ts', 'const x = 1;', options);
  });

  it('should call parseCache.set with filePath and result on success', () => {
    const parsed = makeParsed({ filePath: '/src/b.ts' });
    const fn = mock(() => parsed);
    const cacheSet = mock(() => {});
    const ctx = makeCtx({
      parseSourceFn: fn as any,
      parseCache: { set: cacheSet, get: mock(() => undefined), invalidate: mock(() => {}) } as any,
    });

    parseSource(ctx, '/src/b.ts', 'const y = 2;');

    expect(cacheSet).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledWith('/src/b.ts', parsed);
  });

  it('should throw GildashError and skip parseSourceFn and parseCache.set when closed', () => {
    const fn = mock(() => makeParsed());
    const cacheSet = mock(() => {});
    const ctx = makeCtx({
      closed: true,
      parseSourceFn: fn as any,
      parseCache: { set: cacheSet, get: mock(() => undefined), invalidate: mock(() => {}) } as any,
    });

    expect(() => parseSource(ctx, '/src/a.ts', 'code')).toThrow(GildashError);
    expect(() => parseSource(ctx, '/src/a.ts', 'code')).toThrow(/instance is closed/);
    expect(fn).toHaveBeenCalledTimes(0);
    expect(cacheSet).toHaveBeenCalledTimes(0);
  });

  it('should throw GildashError and skip parseCache.set when parseSourceFn returns err', () => {
    const parseErr = err(gildashError('parse', 'syntax error'));
    const fn = mock(() => parseErr);
    const cacheSet = mock(() => {});
    const ctx = makeCtx({
      parseSourceFn: fn as any,
      parseCache: { set: cacheSet, get: mock(() => undefined), invalidate: mock(() => {}) } as any,
    });

    expect(() => parseSource(ctx, '/src/bad.ts', 'invalid{')).toThrow(GildashError);
    expect(() => parseSource(ctx, '/src/bad.ts', 'invalid{')).toThrow(/syntax error/);
    expect(cacheSet).toHaveBeenCalledTimes(0);
  });

  it('should pass undefined to parseSourceFn when options is omitted', () => {
    const fn = mock(() => makeParsed());
    const ctx = makeCtx({ parseSourceFn: fn as any });

    parseSource(ctx, '/src/a.ts', 'code');

    expect(fn).toHaveBeenCalledWith('/src/a.ts', 'code', undefined);
  });

  it('should throw GildashError after ctx transitions from open to closed', () => {
    const ctx = makeCtx();

    const first = parseSource(ctx, '/src/a.ts', 'code');
    expect(first).toBeDefined();

    ctx.closed = true;

    expect(() => parseSource(ctx, '/src/a.ts', 'code')).toThrow(GildashError);
  });
});

// ─── batchParse ─────────────────────────────────────────────────────

describe('batchParse', () => {
  it('should read each file and parse all successfully into a Map', async () => {
    const parsedA = makeParsed({ filePath: '/src/a.ts' });
    const parsedB = makeParsed({ filePath: '/src/b.ts' });
    const readFn = mock(async (fp: string) => `content of ${fp}`);
    const parseFn = mock((fp: string) => {
      if (fp === '/src/a.ts') return parsedA;
      return parsedB;
    });
    const ctx = makeCtx({ readFileFn: readFn as any, parseSourceFn: parseFn as any });

    const map = await batchParse(ctx, ['/src/a.ts', '/src/b.ts']);

    expect(map.size).toBe(2);
    expect(map.get('/src/a.ts')).toBe(parsedA);
    expect(map.get('/src/b.ts')).toBe(parsedB);
  });

  it('should pass readFileFn result as sourceText and forward options to parseSourceFn', async () => {
    const readFn = mock(async () => 'file content');
    const parseFn = mock(() => makeParsed());
    const options = { sourceType: 'module' as const };
    const ctx = makeCtx({ readFileFn: readFn as any, parseSourceFn: parseFn as any });

    await batchParse(ctx, ['/src/a.ts'], options);

    expect(parseFn).toHaveBeenCalledWith('/src/a.ts', 'file content', options);
  });

  it('should throw GildashError and skip readFileFn and parseSourceFn when closed', async () => {
    const readFn = mock(async () => 'code');
    const parseFn = mock(() => makeParsed());
    const ctx = makeCtx({
      closed: true,
      readFileFn: readFn as any,
      parseSourceFn: parseFn as any,
    });

    await expect(batchParse(ctx, ['/src/a.ts'])).rejects.toThrow(GildashError);
    expect(readFn).toHaveBeenCalledTimes(0);
    expect(parseFn).toHaveBeenCalledTimes(0);
  });

  it('should exclude files where readFileFn throws', async () => {
    const readFn = mock(async (fp: string) => {
      if (fp === '/src/bad.ts') throw new Error('read fail');
      return 'ok';
    });
    const parseFn = mock(() => makeParsed());
    const ctx = makeCtx({ readFileFn: readFn as any, parseSourceFn: parseFn as any });

    const map = await batchParse(ctx, ['/src/bad.ts', '/src/good.ts']);

    expect(map.size).toBe(1);
    expect(map.has('/src/bad.ts')).toBe(false);
    expect(map.has('/src/good.ts')).toBe(true);
  });

  it('should exclude files where parseSourceFn returns err', async () => {
    const readFn = mock(async () => 'code');
    const parseFn = mock((fp: string) => {
      if (fp === '/src/bad.ts') return err(gildashError('parse', 'fail'));
      return makeParsed({ filePath: fp });
    });
    const ctx = makeCtx({ readFileFn: readFn as any, parseSourceFn: parseFn as any });

    const map = await batchParse(ctx, ['/src/bad.ts', '/src/good.ts']);

    expect(map.size).toBe(1);
    expect(map.has('/src/bad.ts')).toBe(false);
    expect(map.has('/src/good.ts')).toBe(true);
  });

  it('should return empty Map when filePaths is empty', async () => {
    const ctx = makeCtx();

    const map = await batchParse(ctx, []);

    expect(map.size).toBe(0);
  });

  it('should handle mixed failures: 1 readFileFn throw + 1 parseSourceFn err + 1 success', async () => {
    const parsed = makeParsed({ filePath: '/src/ok.ts' });
    const readFn = mock(async (fp: string) => {
      if (fp === '/src/read-fail.ts') throw new Error('read');
      return 'code';
    });
    const parseFn = mock((fp: string) => {
      if (fp === '/src/parse-fail.ts') return err(gildashError('parse', 'fail'));
      return parsed;
    });
    const ctx = makeCtx({ readFileFn: readFn as any, parseSourceFn: parseFn as any });

    const map = await batchParse(ctx, ['/src/read-fail.ts', '/src/parse-fail.ts', '/src/ok.ts']);

    expect(map.size).toBe(1);
    expect(map.has('/src/ok.ts')).toBe(true);
  });

  it('should throw GildashError after ctx transitions from open to closed', async () => {
    const ctx = makeCtx();

    const first = await batchParse(ctx, []);
    expect(first.size).toBe(0);

    ctx.closed = true;

    await expect(batchParse(ctx, [])).rejects.toThrow(GildashError);
  });
});

// ─── getParsedAst ───────────────────────────────────────────────────

describe('getParsedAst', () => {
  it('should return ParsedFile from cache when hit', () => {
    const parsed = makeParsed();
    const cacheGet = mock(() => parsed);
    const ctx = makeCtx({
      parseCache: { set: mock(() => {}), get: cacheGet, invalidate: mock(() => {}) } as any,
    });

    const result = getParsedAst(ctx, '/src/a.ts');

    expect(result).toBe(parsed);
    expect(cacheGet).toHaveBeenCalledWith('/src/a.ts');
  });

  it('should return undefined when cache misses', () => {
    const cacheGet = mock(() => undefined);
    const ctx = makeCtx({
      parseCache: { set: mock(() => {}), get: cacheGet, invalidate: mock(() => {}) } as any,
    });

    const result = getParsedAst(ctx, '/src/missing.ts');

    expect(result).toBeUndefined();
  });

  it('should return undefined and skip parseCache.get when closed', () => {
    const cacheGet = mock(() => makeParsed());
    const ctx = makeCtx({
      closed: true,
      parseCache: { set: mock(() => {}), get: cacheGet, invalidate: mock(() => {}) } as any,
    });

    const result = getParsedAst(ctx, '/src/a.ts');

    expect(result).toBeUndefined();
    expect(cacheGet).toHaveBeenCalledTimes(0);
  });

  it('should return undefined after ctx transitions from open to closed', () => {
    const parsed = makeParsed();
    const cacheGet = mock(() => parsed);
    const ctx = makeCtx({
      parseCache: { set: mock(() => {}), get: cacheGet, invalidate: mock(() => {}) } as any,
    });

    const first = getParsedAst(ctx, '/src/a.ts');
    expect(first).toBe(parsed);

    ctx.closed = true;

    const second = getParsedAst(ctx, '/src/a.ts');
    expect(second).toBeUndefined();
  });
});
