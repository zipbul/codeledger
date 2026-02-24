import { describe, it, expect, mock } from 'bun:test';
import { isErr } from '@zipbul/result';
import { parseSource } from './parse-source';

const mockParseSync = mock(() => ({
  program: { type: 'Program', body: [], sourceType: 'module' },
  errors: [],
  comments: [],
  module: {},
})) as any;

describe('parseSource', () => {
  it('should return a ParsedFile when filePath and sourceText are provided', () => {
    const filePath = '/project/src/index.ts';
    const sourceText = 'const x = 1;';
    const result = parseSource(filePath, sourceText, undefined, mockParseSync);
    if (isErr(result)) throw result.data;
    expect(result.filePath).toBe(filePath);
    expect(result.sourceText).toBe(sourceText);
  });

  it('should return program when oxc-parser parseSync returns program', () => {
    const filePath = '/project/src/foo.ts';
    const sourceText = 'export const y = 2;';
    const result = parseSource(filePath, sourceText, undefined, mockParseSync);
    if (isErr(result)) throw result.data;
    expect(result.program).toBeDefined();
    expect(result.program.type).toBe('Program');
  });

  it('should return errors array when parseSync provides errors', () => {
    const result = parseSource('/project/a.ts', '', undefined, mockParseSync);
    if (isErr(result)) throw result.data;
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('should return comments array when parseSync provides comments', () => {
    const result = parseSource('/project/a.ts', '', undefined, mockParseSync);
    if (isErr(result)) throw result.data;
    expect(Array.isArray(result.comments)).toBe(true);
  });

  it('should pass filePath and sourceText when delegating to oxc-parser parseSync', () => {
    mockParseSync.mockClear();
    const filePath = '/project/src/bar.ts';
    const sourceText = 'function foo() {}';
    parseSource(filePath, sourceText, undefined, mockParseSync);
    expect(mockParseSync).toHaveBeenCalledTimes(1);
    expect(mockParseSync).toHaveBeenCalledWith(filePath, sourceText, undefined);
  });

  it('should pass options as third argument to parseSyncFn when options are provided', () => {
    mockParseSync.mockClear();
    const filePath = '/project/src/typed.ts';
    const sourceText = 'const a = 1;';
    const options = { sourceType: 'module' as const };
    parseSource(filePath, sourceText, options, mockParseSync);
    expect(mockParseSync).toHaveBeenCalledWith(filePath, sourceText, options);
  });

  it('should return ParsedFile when options with lang tsx are provided', () => {
    const filePath = '/project/src/comp.tsx';
    const sourceText = 'const x = <div />;';
    const options = { lang: 'tsx' as const };
    const result = parseSource(filePath, sourceText, options, mockParseSync);
    expect(result).toMatchObject({ filePath });
  });

  it('should return Err with parse type when oxc-parser parseSync throws', () => {
    const cause = new Error('internal parser crash');
    mockParseSync.mockImplementationOnce(() => { throw cause; });
    const result = parseSource('/project/crash.ts', 'bad source', undefined, mockParseSync);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('parse');
  });

  it('should preserve original error as cause when parse Err is returned', () => {
    const cause = new Error('crash');
    mockParseSync.mockImplementationOnce(() => { throw cause; });
    const result = parseSource('/project/crash.ts', '', undefined, mockParseSync);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.cause).toBe(cause);
  });

  it('should handle empty sourceText when parseSource is called', () => {
    expect(isErr(parseSource('/project/empty.ts', '', undefined, mockParseSync))).toBe(false);
  });

  it('should return identical program reference when called twice with the same input', () => {
    const program = { type: 'Program', body: [] };
    mockParseSync.mockImplementation(() => ({ program, errors: [], comments: [], module: {} }));
    const r1 = parseSource('/project/x.ts', 'const a = 1;', undefined, mockParseSync);
    const r2 = parseSource('/project/x.ts', 'const a = 1;', undefined, mockParseSync);
    if (isErr(r1)) throw r1.data;
    if (isErr(r2)) throw r2.data;
    expect(r1).not.toBe(r2);
    expect(r1.program).toBe(r2.program);
  });
});
