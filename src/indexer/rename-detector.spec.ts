import { describe, expect, it } from 'bun:test';
import { detectRenames } from './rename-detector';
import type { SymbolSnap } from './rename-detector';

function snap(overrides: Partial<SymbolSnap> & { name: string; filePath: string }): SymbolSnap {
  return {
    kind: 'function',
    fingerprint: null,
    structuralFingerprint: 'fp1',
    startLine: 1,
    ...overrides,
  };
}

function makeMap(snaps: SymbolSnap[]): Map<string, SymbolSnap> {
  const map = new Map<string, SymbolSnap>();
  for (const s of snaps) {
    map.set(`${s.filePath}::${s.name}`, s);
  }
  return map;
}

describe('detectRenames', () => {
  it('should detect a simple function rename', () => {
    const before = makeMap([snap({ name: 'oldFn', filePath: 'a.ts', structuralFingerprint: 'sfp1', startLine: 5 })]);
    const after = makeMap([snap({ name: 'newFn', filePath: 'a.ts', structuralFingerprint: 'sfp1', startLine: 5 })]);

    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(1);
    expect(result.renamed[0]!.oldName).toBe('oldFn');
    expect(result.renamed[0]!.newName).toBe('newFn');
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  it('should propagate member renames when parent is renamed', () => {
    const before = makeMap([
      snap({ name: 'OldClass', filePath: 'a.ts', kind: 'class', structuralFingerprint: 'cls1', startLine: 1 }),
      snap({ name: 'OldClass.method', filePath: 'a.ts', kind: 'method', structuralFingerprint: 'm1', startLine: 3 }),
    ]);
    const after = makeMap([
      snap({ name: 'NewClass', filePath: 'a.ts', kind: 'class', structuralFingerprint: 'cls1', startLine: 1 }),
      snap({ name: 'NewClass.method', filePath: 'a.ts', kind: 'method', structuralFingerprint: 'm1', startLine: 3 }),
    ]);

    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(2);
    const parentRename = result.renamed.find(r => r.oldName === 'OldClass');
    const memberRename = result.renamed.find(r => r.oldName === 'OldClass.method');
    expect(parentRename).toBeDefined();
    expect(memberRename).toBeDefined();
    expect(memberRename!.newName).toBe('NewClass.method');
  });

  it('should handle N:M fingerprint collision with startLine proximity', () => {
    const before = makeMap([
      snap({ name: 'fn1', filePath: 'a.ts', structuralFingerprint: 'same', startLine: 1 }),
      snap({ name: 'fn2', filePath: 'a.ts', structuralFingerprint: 'same', startLine: 10 }),
    ]);
    const after = makeMap([
      snap({ name: 'renamed1', filePath: 'a.ts', structuralFingerprint: 'same', startLine: 1 }),
      snap({ name: 'renamed2', filePath: 'a.ts', structuralFingerprint: 'same', startLine: 10 }),
    ]);

    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(2);
    const r1 = result.renamed.find(r => r.newName === 'renamed1');
    const r2 = result.renamed.find(r => r.newName === 'renamed2');
    expect(r1!.oldName).toBe('fn1');
    expect(r2!.oldName).toBe('fn2');
  });

  it('should return empty for no changes', () => {
    const snapshot = makeMap([snap({ name: 'fn', filePath: 'a.ts' })]);
    const result = detectRenames(snapshot, snapshot);
    expect(result.renamed.length).toBe(0);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  it('should not match different kinds', () => {
    const before = makeMap([snap({ name: 'Foo', filePath: 'a.ts', kind: 'class', structuralFingerprint: 'x' })]);
    const after = makeMap([snap({ name: 'Bar', filePath: 'a.ts', kind: 'function', structuralFingerprint: 'x' })]);

    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(0);
    expect(result.added.length).toBe(1);
    expect(result.removed.length).toBe(1);
  });

  it('should not match across different files', () => {
    const before = makeMap([snap({ name: 'fn', filePath: 'a.ts', structuralFingerprint: 'x' })]);
    const after = makeMap([snap({ name: 'fn2', filePath: 'b.ts', structuralFingerprint: 'x' })]);

    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(0);
    expect(result.added.length).toBe(1);
    expect(result.removed.length).toBe(1);
  });

  it('should handle only added symbols (no removed)', () => {
    const before = makeMap([]);
    const after = makeMap([snap({ name: 'newFn', filePath: 'a.ts' })]);
    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(0);
    expect(result.added.length).toBe(1);
    expect(result.removed.length).toBe(0);
  });

  it('should handle only removed symbols (no added)', () => {
    const before = makeMap([snap({ name: 'oldFn', filePath: 'a.ts' })]);
    const after = makeMap([]);
    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(0);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(1);
  });

  it('should handle empty snapshots', () => {
    const result = detectRenames(new Map(), new Map());
    expect(result.renamed.length).toBe(0);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  it('should handle modified symbol (same key, different fingerprint) without rename', () => {
    const before = makeMap([snap({ name: 'fn', filePath: 'a.ts', fingerprint: 'old' })]);
    const after = makeMap([snap({ name: 'fn', filePath: 'a.ts', fingerprint: 'new' })]);
    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(0);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  it('should not match when structuralFingerprint is null', () => {
    const before = makeMap([snap({ name: 'fn', filePath: 'a.ts', structuralFingerprint: null })]);
    const after = makeMap([snap({ name: 'fn2', filePath: 'a.ts', structuralFingerprint: null })]);

    const result = detectRenames(before, after);
    expect(result.renamed.length).toBe(0);
  });
});
