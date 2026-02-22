import { describe, it, expect, mock } from 'bun:test';
import { parseSource } from './parse-source';
import { ParseError } from '../errors';

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
    expect(result.filePath).toBe(filePath);
    expect(result.sourceText).toBe(sourceText);
  });

  it('should return program when oxc-parser parseSync returns program', () => {
    const filePath = '/project/src/foo.ts';
    const sourceText = 'export const y = 2;';
    const result = parseSource(filePath, sourceText, mockParseSync);
    expect(result.program).toBeDefined();
    expect(result.program.type).toBe('Program');
  });

  it('should return errors array when parseSync provides errors', () => {
    const result = parseSource('/project/a.ts', '', mockParseSync);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('should return comments array when parseSync provides comments', () => {
    const result = parseSource('/project/a.ts', '', mockParseSync);
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

  it('should throw ParseError when oxc-parser parseSync throws', () => {
    const cause = new Error('internal parser crash');
    mockParseSync.mockImplementationOnce(() => { throw cause; });
    expect(() => parseSource('/project/crash.ts', 'bad source', mockParseSync)).toThrow(ParseError);
  });

  it('should preserve original error as cause when ParseError is thrown', () => {
    const cause = new Error('crash');
    mockParseSync.mockImplementationOnce(() => { throw cause; });
    let thrown: unknown;
    try {
      parseSource('/project/crash.ts', '', mockParseSync);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as ParseError).cause).toBe(cause);
  });

  it('should handle empty sourceText when parseSource is called', () => {
    expect(() => parseSource('/project/empty.ts', '', mockParseSync)).not.toThrow();
  });

  it('should return identical program reference when called twice with the same input', () => {
    const program = { type: 'Program', body: [] };
    mockParseSync.mockImplementation(() => ({ program, errors: [], comments: [], module: {} }));
    const r1 = parseSource('/project/x.ts', 'const a = 1;', mockParseSync);
    const r2 = parseSource('/project/x.ts', 'const a = 1;', mockParseSync);
    expect(r1).not.toBe(r2);
    expect(r1.program).toBe(r2.program);
  });
});
