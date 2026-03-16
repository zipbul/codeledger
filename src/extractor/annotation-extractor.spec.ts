import { describe, expect, it } from 'bun:test';
import { extractAnnotations } from './annotation-extractor';
import type { ParsedFile } from '../parser/types';
import { parseSource } from '../parser/parse-source';
import { isErr } from '@zipbul/result';

function parse(source: string): ParsedFile {
  const result = parseSource('/test.ts', source);
  if (isErr(result)) throw result.data;
  return result;
}

describe('extractAnnotations', () => {
  it('should extract JSDoc tags from a JSDoc comment', () => {
    const parsed = parse(`
/** @deprecated Use newFn instead */
function oldFn() {}
`);
    const annotations = extractAnnotations(parsed);
    expect(annotations.length).toBeGreaterThanOrEqual(1);
    const dep = annotations.find(a => a.tag === 'deprecated');
    expect(dep).toBeDefined();
    expect(dep!.source).toBe('jsdoc');
    expect(dep!.value).toContain('Use newFn instead');
    expect(dep!.symbolName).toBe('oldFn');
  });

  it('should extract @param and @returns from JSDoc', () => {
    const parsed = parse(`
/**
 * Add two numbers.
 * @param a - First number
 * @param b - Second number
 * @returns The sum
 */
function add(a: number, b: number): number { return a + b; }
`);
    const annotations = extractAnnotations(parsed);
    const params = annotations.filter(a => a.tag === 'param');
    expect(params.length).toBe(2);
    const returns = annotations.find(a => a.tag === 'returns');
    expect(returns).toBeDefined();
    expect(returns!.symbolName).toBe('add');
  });

  it('should extract tags from line comments', () => {
    const parsed = parse(`
// @todo implement error handling
function process() {}
`);
    const annotations = extractAnnotations(parsed);
    const todo = annotations.find(a => a.tag === 'todo');
    expect(todo).toBeDefined();
    expect(todo!.source).toBe('line');
    expect(todo!.value).toBe('implement error handling');
    expect(todo!.symbolName).toBe('process');
  });

  it('should group continuation lines for line comments', () => {
    const parsed = parse(`
// @todo implement error handling
// across multiple lines
function process() {}
`);
    const annotations = extractAnnotations(parsed);
    const todo = annotations.find(a => a.tag === 'todo');
    expect(todo).toBeDefined();
    expect(todo!.value).toContain('across multiple lines');
  });

  it('should extract tags from block comments', () => {
    const parsed = parse(`
/* @internal Do not use externally */
function secret() {}
`);
    const annotations = extractAnnotations(parsed);
    const internal = annotations.find(a => a.tag === 'internal');
    expect(internal).toBeDefined();
    expect(internal!.source).toBe('block');
  });

  it('should not match email addresses as tags', () => {
    const parsed = parse(`
// Contact user@example.com for help
function help() {}
`);
    const annotations = extractAnnotations(parsed);
    const emailTag = annotations.find(a => a.tag === 'example');
    expect(emailTag).toBeUndefined();
  });

  it('should not match numeric tags like @123', () => {
    const parsed = parse(`
// See @123 for reference
function ref() {}
`);
    const annotations = extractAnnotations(parsed);
    expect(annotations.find(a => a.tag === '123')).toBeUndefined();
  });

  it('should link annotations to class members', () => {
    const parsed = parse(`
class MyClass {
  /** @deprecated Use newMethod */
  oldMethod() {}
}
`);
    const annotations = extractAnnotations(parsed);
    const dep = annotations.find(a => a.tag === 'deprecated');
    expect(dep).toBeDefined();
    expect(dep!.symbolName).toBe('MyClass.oldMethod');
  });

  it('should return empty array for file with no comments', () => {
    const parsed = parse(`function foo() {}`);
    const annotations = extractAnnotations(parsed);
    expect(annotations).toEqual([]);
  });

  it('should return empty array for comments with no tags', () => {
    const parsed = parse(`
// This is a regular comment
function foo() {}
`);
    const annotations = extractAnnotations(parsed);
    expect(annotations).toEqual([]);
  });

  it('should handle orphan JSDoc (not linked to any symbol)', () => {
    const parsed = parse(`
/** @see https://example.com */



// far away code
`);
    const annotations = extractAnnotations(parsed);
    const see = annotations.find(a => a.tag === 'see');
    expect(see).toBeDefined();
    expect(see!.symbolName).toBeNull();
  });

  it('should handle tags with hyphens like @my-tag', () => {
    const parsed = parse(`
// @my-tag some value
function foo() {}
`);
    const annotations = extractAnnotations(parsed);
    expect(annotations.find(a => a.tag === 'my-tag')).toBeDefined();
  });

  it('should handle @TODO(author) pattern', () => {
    const parsed = parse(`
/** @TODO(author) fix this */
function broken() {}
`);
    const annotations = extractAnnotations(parsed);
    // comment-parser treats TODO(author) as a single tag name
    const todo = annotations.find(a => a.tag === 'TODO(author)');
    expect(todo).toBeDefined();
  });

  it('should have correct span line numbers for JSDoc tags', () => {
    const parsed = parse(`const x = 1;
/** @deprecated old */
function foo() {}
`);
    const annotations = extractAnnotations(parsed);
    const dep = annotations.find(a => a.tag === 'deprecated');
    expect(dep).toBeDefined();
    // @deprecated is on line 2
    expect(dep!.span.start.line).toBe(2);
  });

  it('should have correct span for line comment tags', () => {
    const parsed = parse(`const x = 1;
// @todo fix this
function foo() {}
`);
    const annotations = extractAnnotations(parsed);
    const todo = annotations.find(a => a.tag === 'todo');
    expect(todo).toBeDefined();
    expect(todo!.span.start.line).toBe(2);
  });

  it('should handle multiple JSDoc tags in one comment', () => {
    const parsed = parse(`
/**
 * @param x - input
 * @returns output
 * @throws Error
 */
function process(x: string) {}
`);
    const annotations = extractAnnotations(parsed);
    expect(annotations.length).toBe(3);
    expect(annotations.map(a => a.tag).sort()).toEqual(['param', 'returns', 'throws']);
  });

  it('should handle file with only comments and no symbols', () => {
    const parsed = parse(`// @todo add implementation`);
    const annotations = extractAnnotations(parsed);
    expect(annotations.length).toBe(1);
    expect(annotations[0]!.symbolName).toBeNull();
  });

  it('should not link annotation when symbol is more than 3 lines away', () => {
    const parsed = parse(`
// @todo fix




function farAway() {}
`);
    const annotations = extractAnnotations(parsed);
    const todo = annotations.find(a => a.tag === 'todo');
    expect(todo).toBeDefined();
    expect(todo!.symbolName).toBeNull();
  });

  it('should handle block comment with * prefix lines', () => {
    const parsed = parse(`
/*
 * @internal
 * This is internal API
 */
function internal() {}
`);
    const annotations = extractAnnotations(parsed);
    const internal = annotations.find(a => a.tag === 'internal');
    expect(internal).toBeDefined();
    expect(internal!.source).toBe('block');
  });
});
