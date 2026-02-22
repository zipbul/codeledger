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
    const result = parseSource(filePath, sourceText, mockParseSync);
    if (isErr(result)) throw result.data;
    expect(result.filePath).toBe(filePath);
    expect(result.sourceText).toBe(sourceText);
  });

  it('should return program when oxc-parser parseSync returns program', () => {
    const filePath = '/project/src/foo.ts';
    const sourceText = 'export const y = 2;';
    const result = parseSource(filePath, sourceText, mockParseSync);
    if (isErr(result)) throw result.data;
    expect(result.program).toBeDefined();
    expect(result.program.type).toBe('Program');
  });

  it('should return errors array when parseSync provides errors', () => {
    const result = parseSource('/project/a.ts', '', mockParseSync);
    if (isErr(result)) throw result.data;
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('should return comments array when parseSync provides comments', () => {
    const result = parseSource('/project/a.ts', '', mockParseSync);
    if (isErr(result)) throw result.data;
    expect(Array.isArray(result.comments)).toBe(true);
  });

  it('should pass filePath and sourceText when delegating to oxc-parser parseSync', () => {
    mockParseSync.mockClear();
    const filePath = '/project/src/bar.ts';
    const sourceText = 'function foo() {}';
    parseSource(filePath, sourceText, mockParseSync);
    expect(mockParseSync).toHaveBeenCalledTimes(1);
    expect(mockParseSync).toHaveBeenCalledWith(filePath, sourceText);
  });

  it('should return Err with parse type when oxc-parser parseSync throws', () => {
    const cause = new Error('internal parser crash');
    mockParseSync.mockImplementationOnce(() => { throw cause; });
    const result = parseSource('/project/crash.ts', 'bad source', mockParseSync);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.type).toBe('parse');
  });

  it('should preserve original error as cause when parse Err is returned', () => {
    const cause = new Error('crash');
    mockParseSync.mockImplementationOnce(() => { throw cause; });
    const result = parseSource('/project/crash.ts', '', mockParseSync);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.data.cause).toBe(cause);
  });

  it('should handle empty sourceText when parseSource is called', () => {
    expect(isErr(parseSource('/project/empty.ts', '', mockParseSync))).toBe(false);
  });

  it('should return identical program reference when called twice with the same input', () => {
    const program = { type: 'Program', body: [] };
    mockParseSync.mockImplementation(() => ({ program, errors: [], comments: [], module: {} }));
    const r1 = parseSource('/project/x.ts', 'const a = 1;', mockParseSync);
    const r2 = parseSource('/project/x.ts', 'const a = 1;', mockParseSync);
    if (isErr(r1)) throw r1.data;
    if (isErr(r2)) throw r2.data;
    expect(r1).not.toBe(r2);
    expect(r1.program).toBe(r2.program);
  });
});
