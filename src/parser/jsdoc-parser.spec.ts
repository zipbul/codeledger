import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockParse = mock(() => [{ description: 'A description.', tags: [] as any[] }]);

import { parseJsDoc } from './jsdoc-parser';
import { ParseError } from '../errors';

describe('parseJsDoc', () => {
  beforeEach(() => {
    mock.module('comment-parser', () => ({
      parse: mockParse,
    }));
    mockParse.mockClear();
    mockParse.mockImplementation(() => [{ description: 'A description.', tags: [] as any[] }]);
  });
  it('should return description and empty tags when comment is simple', () => {
    const result = parseJsDoc('/** A description. */');
    expect(result.description).toBe('A description.');
    expect(result.tags).toEqual([]);
  });

  it('should return parsed tags when comment-parser returns tags', () => {
    mockParse.mockImplementationOnce(() => ([
      {
        description: 'Handles auth.',
        tags: [
          { tag: 'param', name: 'userId', type: 'string', description: 'The user ID.', optional: false },
        ],
      },
    ]));
    const result = parseJsDoc('/** Handles auth. @param {string} userId The user ID. */');
    expect(result.description).toBe('Handles auth.');
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0]!.tag).toBe('param');
    expect(result.tags[0]!.name).toBe('userId');
    expect(result.tags[0]!.type).toBe('string');
  });

  it('should map optional field when comment-parser tag includes optional', () => {
    mockParse.mockImplementationOnce(() => ([
      {
        description: '',
        tags: [
          { tag: 'param', name: 'x', type: 'number', description: '', optional: true },
        ],
      },
    ]));
    const result = parseJsDoc('/** @param {number} [x] */');
    expect(result.tags[0]!.optional).toBe(true);
  });

  it('should map default field from comment-parser tag when present', () => {
    mockParse.mockImplementationOnce(() => ([
      {
        description: '',
        tags: [
          { tag: 'param', name: 'x', type: 'number', description: '', optional: true, default: '42' },
        ],
      },
    ]));
    const result = parseJsDoc('/** @param {number} [x=42] */');
    expect(result.tags[0]!.default).toBe('42');
  });

  it('should throw ParseError when comment-parser throws', () => {
    mockParse.mockImplementationOnce(() => { throw new Error('parse failure'); });
    expect(() => parseJsDoc('/** broken */')).toThrow(ParseError);
  });

  it('should preserve original error as cause when ParseError is thrown', () => {
    const cause = new Error('inner');
    mockParse.mockImplementationOnce(() => { throw cause; });
    let thrown: unknown;
    try { parseJsDoc('/** broken */'); } catch (e) { thrown = e; }
    expect((thrown as ParseError).cause).toBe(cause);
  });

  it('should handle empty comment text when parser returns empty description', () => {
    mockParse.mockImplementationOnce(() => ([{ description: '', tags: [] }]));
    expect(() => parseJsDoc('')).not.toThrow();
  });

  it('should handle undefined default gracefully when tag has no default field', () => {
    mockParse.mockImplementationOnce(() => ([
      {
        description: '',
        tags: [
          { tag: 'param', name: 'x', type: 'string', description: '', optional: false, default: undefined },
        ],
      },
    ]));
    const result = parseJsDoc('/** @param {string} x */');
    expect(result.tags[0]!.default).toBeUndefined();
  });

  it('should return identical results when called twice with the same input', () => {
    mockParse.mockImplementation(() => ([{ description: 'Same.', tags: [] }]));
    const r1 = parseJsDoc('/** Same. */');
    const r2 = parseJsDoc('/** Same. */');
    expect(r1).toEqual(r2);
  });

  it('should parse input as description when /** wrapper is not present', () => {
    mockParse.mockImplementationOnce(() => ([{ description: 'plain text', tags: [] }]));
    const result = parseJsDoc('plain text');
    expect(result.description).toBe('plain text');
    expect(result.tags).toHaveLength(0);
  });
});
