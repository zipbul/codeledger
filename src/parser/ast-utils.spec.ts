import { describe, it, expect } from 'bun:test';
import {
  isNode,
  isNodeArray,
  visit,
  collectNodes,
  getNodeHeader,
  isFunctionNode,
  getNodeName,
  getStringLiteralValue,
  getQualifiedName,
} from './ast-utils';

describe('isNode', () => {
  it('should return true when input is a plain object', () => {
    expect(isNode({ type: 'Identifier' })).toBe(true);
  });

  it('should return false when input is null', () => {
    expect(isNode(null)).toBe(false);
  });

  it('should return false when input is an array', () => {
    expect(isNode([1, 2])).toBe(false);
  });

  it('should return false when input is a primitive string', () => {
    expect(isNode('hello')).toBe(false);
  });

  it('should return false when input is undefined', () => {
    expect(isNode(undefined)).toBe(false);
  });
});

describe('isNodeArray', () => {
  it('should return true when input is an array', () => {
    expect(isNodeArray([])).toBe(true);
  });

  it('should return true when input is a non-empty array', () => {
    expect(isNodeArray([{ type: 'Identifier' }])).toBe(true);
  });

  it('should return false when input is a plain object', () => {
    expect(isNodeArray({ length: 0 })).toBe(false);
  });

  it('should return false when input is null', () => {
    expect(isNodeArray(null)).toBe(false);
  });

  it('should return false when input is a string', () => {
    expect(isNodeArray('hello')).toBe(false);
  });
});

describe('visit', () => {
  it('should call callback when visit is called with a single root node', () => {
    const visited: string[] = [];
    const node = { type: 'Identifier', name: 'x' };
    visit(node, (n) => visited.push(n.type as string));
    expect(visited).toContain('Identifier');
  });

  it('should visit nested child nodes recursively when child object nodes exist', () => {
    const visited: string[] = [];
    const node = {
      type: 'ExpressionStatement',
      expression: { type: 'Identifier', name: 'x' },
    };
    visit(node, (n) => visited.push(n.type as string));
    expect(visited).toContain('ExpressionStatement');
    expect(visited).toContain('Identifier');
  });

  it('should visit nodes inside an array child when array node children exist', () => {
    const visited: string[] = [];
    const node = {
      type: 'Program',
      body: [
        { type: 'FunctionDeclaration', id: { type: 'Identifier', name: 'foo' } },
      ],
    };
    visit(node, (n) => visited.push(n.type as string));
    expect(visited).toContain('FunctionDeclaration');
    expect(visited).toContain('Identifier');
  });

  it('should not crash when node is null or falsy', () => {
    expect(() => visit(null, () => {})).not.toThrow();
    expect(() => visit(undefined, () => {})).not.toThrow();
  });

  it('should skip loc, start, end, scope keys when cloning node', () => {
    const visited: Record<string, unknown>[] = [];
    const node = {
      type: 'Identifier',
      name: 'x',
      loc: { type: 'SomeLocNode' },
      start: 0,
      end: 1,
      scope: { type: 'ScopeNode' },
    };
    visit(node, (n) => visited.push(n));
    const types = visited.map((n) => n.type);
    expect(types).not.toContain('SomeLocNode');
    expect(types).not.toContain('ScopeNode');
  });

  it('should call callback before recursing when visit traverses parent-child nodes', () => {
    const order: string[] = [];
    const node = {
      type: 'Parent',
      child: { type: 'Child' },
    };
    visit(node, (n) => order.push(n.type as string));
    expect(order[0]).toBe('Parent');
    expect(order[1]).toBe('Child');
  });
});

describe('collectNodes', () => {
  it('should collect nodes when predicate matches node type', () => {
    const tree = {
      type: 'Program',
      body: [
        { type: 'FunctionDeclaration', id: { type: 'Identifier', name: 'foo' } },
        { type: 'VariableDeclaration', declarations: [] },
      ],
    };
    const result = collectNodes(tree, (n) => n.type === 'FunctionDeclaration');
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe('FunctionDeclaration');
  });

  it('should return empty array when no nodes match', () => {
    const tree = { type: 'Program', body: [] };
    const result = collectNodes(tree, (n) => n.type === 'ClassDeclaration');
    expect(result).toEqual([]);
  });

  it('should collect deeply nested nodes when nested children match predicate', () => {
    const tree = {
      type: 'Program',
      body: [
        {
          type: 'BlockStatement',
          body: [
            { type: 'Identifier', name: 'x' },
          ],
        },
      ],
    };
    const result = collectNodes(tree, (n) => n.type === 'Identifier');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((n) => n.name === 'x')).toBe(true);
  });
});

describe('getNodeHeader', () => {
  it('should return node.id.name when node is FunctionDeclaration-like', () => {
    const node = { type: 'FunctionDeclaration', id: { name: 'myFunc' } };
    expect(getNodeHeader(node)).toBe('myFunc');
  });

  it('should return node.key.name when node is MethodDefinition-like', () => {
    const node = { type: 'MethodDefinition', key: { name: 'render' } };
    expect(getNodeHeader(node)).toBe('render');
  });

  it('should use parent.id.name when parent is VariableDeclarator', () => {
    const node = { type: 'ArrowFunctionExpression' };
    const parent = { type: 'VariableDeclarator', id: { name: 'myArrow' } };
    expect(getNodeHeader(node, parent)).toBe('myArrow');
  });

  it('should fall back to "anonymous" when no name can be resolved', () => {
    const node = { type: 'ArrowFunctionExpression' };
    expect(getNodeHeader(node)).toBe('anonymous');
  });

  it('should handle string literal key when method key is computed string literal', () => {
    const node = { type: 'MethodDefinition', key: { type: 'StringLiteral', value: 'myMethod' } };
    expect(getNodeHeader(node)).toBe('myMethod');
  });

  it('should use parent.key.name when parent is MethodDefinition', () => {
    const node = { type: 'FunctionExpression' };
    const parent = { type: 'MethodDefinition', key: { name: 'render' } };
    expect(getNodeHeader(node, parent)).toBe('render');
  });

  it('should use parent.key.name when parent is Property', () => {
    const node = { type: 'FunctionExpression' };
    const parent = { type: 'Property', key: { name: 'handler' } };
    expect(getNodeHeader(node, parent)).toBe('handler');
  });
});

describe('isFunctionNode', () => {
  it('should return true when node type is FunctionDeclaration', () => {
    expect(isFunctionNode({ type: 'FunctionDeclaration' })).toBe(true);
  });

  it('should return true when node type is FunctionExpression', () => {
    expect(isFunctionNode({ type: 'FunctionExpression' })).toBe(true);
  });

  it('should return true when node type is ArrowFunctionExpression', () => {
    expect(isFunctionNode({ type: 'ArrowFunctionExpression' })).toBe(true);
  });

  it('should return false when node type is ClassDeclaration', () => {
    expect(isFunctionNode({ type: 'ClassDeclaration' })).toBe(false);
  });

  it('should return false when node type is Identifier', () => {
    expect(isFunctionNode({ type: 'Identifier' })).toBe(false);
  });
});

describe('getNodeName', () => {
  it('should return the name string when node has a string name property', () => {
    expect(getNodeName({ type: 'Identifier', name: 'foo' })).toBe('foo');
  });

  it('should return null when node has no name property', () => {
    expect(getNodeName({ type: 'Program' })).toBeNull();
  });

  it('should return null when input is non-object', () => {
    expect(getNodeName(42)).toBeNull();
    expect(getNodeName(null)).toBeNull();
  });

  it('should return null when name property is not a string', () => {
    expect(getNodeName({ name: 123 })).toBeNull();
  });
});

describe('getStringLiteralValue', () => {
  it('should return value when node is StringLiteral', () => {
    expect(getStringLiteralValue({ type: 'StringLiteral', value: 'hello' })).toBe('hello');
  });

  it('should return value when node is Literal with string value', () => {
    expect(getStringLiteralValue({ type: 'Literal', value: 'world' })).toBe('world');
  });

  it('should return null when node is Literal with numeric value', () => {
    expect(getStringLiteralValue({ type: 'Literal', value: 42 })).toBeNull();
  });

  it('should return null when node is Identifier', () => {
    expect(getStringLiteralValue({ type: 'Identifier', name: 'x' })).toBeNull();
  });

  it('should return null when non-object input is provided', () => {
    expect(getStringLiteralValue(null)).toBeNull();
    expect(getStringLiteralValue('raw string')).toBeNull();
  });
});

describe('getQualifiedName', () => {
  it('should return { root, parts: [], full } when node is Identifier', () => {
    const node = { type: 'Identifier', name: 'foo' };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'foo', parts: [], full: 'foo' });
  });

  it('should return root "this" when node is ThisExpression', () => {
    const node = { type: 'ThisExpression' };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'this', parts: [], full: 'this' });
  });

  it('should return root "super" when node is Super', () => {
    const node = { type: 'Super' };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'super', parts: [], full: 'super' });
  });

  it('should resolve a simple MemberExpression when node is a.b', () => {
    const node = {
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'a' },
      property: { type: 'Identifier', name: 'b' },
      computed: false,
    };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'a', parts: ['b'], full: 'a.b' });
  });

  it('should resolve a nested MemberExpression when node is a.b.c', () => {
    const node = {
      type: 'MemberExpression',
      object: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'a' },
        property: { type: 'Identifier', name: 'b' },
        computed: false,
      },
      property: { type: 'Identifier', name: 'c' },
      computed: false,
    };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'a', parts: ['b', 'c'], full: 'a.b.c' });
  });

  it('should return null when node is CallExpression', () => {
    const node = { type: 'CallExpression', callee: { type: 'Identifier', name: 'foo' } };
    expect(getQualifiedName(node)).toBeNull();
  });

  it('should return null when input is null', () => {
    expect(getQualifiedName(null)).toBeNull();
  });

  it('should resolve this.method when node combines ThisExpression and MemberExpression', () => {
    const node = {
      type: 'MemberExpression',
      object: { type: 'ThisExpression' },
      property: { type: 'Identifier', name: 'method' },
      computed: false,
    };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'this', parts: ['method'], full: 'this.method' });
  });

  it('should resolve super.method when node combines Super and MemberExpression', () => {
    const node = {
      type: 'MemberExpression',
      object: { type: 'Super' },
      property: { type: 'Identifier', name: 'connect' },
      computed: false,
    };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'super', parts: ['connect'], full: 'super.connect' });
  });
});

describe('getNodeHeader (additional coverage)', () => {
  it('should return key.value when key is a StringLiteral', () => {
    const node = { type: 'PropertyDefinition', key: { type: 'StringLiteral', value: 'myProp' } };
    expect(getNodeHeader(node)).toBe('myProp');
  });

  it('should return key.value when key is a Literal with string value', () => {
    const node = { type: 'Property', key: { type: 'Literal', value: 'literalKey' } };
    expect(getNodeHeader(node)).toBe('literalKey');
  });

  it('should return parent key.value when parent is PropertyDefinition with string-valued key', () => {
    const node = { type: 'FunctionExpression' };
    const parent = { type: 'PropertyDefinition', key: { value: 'computed' } };
    expect(getNodeHeader(node, parent)).toBe('computed');
  });
});
