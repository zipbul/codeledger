import { describe, expect, it } from 'bun:test';
import { buildStructuralFingerprint } from './symbol-indexer';
import type { ExtractedSymbol } from '../extractor/types';

function makeSym(overrides: Partial<ExtractedSymbol> = {}): ExtractedSymbol {
  return {
    kind: 'function',
    name: 'testFn',
    span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
    isExported: false,
    modifiers: [],
    ...overrides,
  };
}

describe('buildStructuralFingerprint', () => {
  it('should produce a deterministic hash for the same symbol', () => {
    const sym = makeSym({ parameters: [{ name: 'a', isOptional: false }], returnType: 'string' });
    const fp1 = buildStructuralFingerprint(sym);
    const fp2 = buildStructuralFingerprint(sym);
    expect(fp1).toBe(fp2);
    expect(typeof fp1).toBe('string');
    expect(fp1.length).toBeGreaterThan(0);
  });

  it('should produce different hashes for different parameter counts', () => {
    const sym1 = makeSym({ parameters: [{ name: 'a', isOptional: false }] });
    const sym2 = makeSym({ parameters: [{ name: 'a', isOptional: false }, { name: 'b', isOptional: false }] });
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should produce different hashes for different return types', () => {
    const sym1 = makeSym({ returnType: 'string' });
    const sym2 = makeSym({ returnType: 'number' });
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should produce same hash regardless of symbol name (structural only)', () => {
    const sym1 = makeSym({ name: 'foo', parameters: [], returnType: 'void' });
    const sym2 = makeSym({ name: 'bar', parameters: [], returnType: 'void' });
    expect(buildStructuralFingerprint(sym1)).toBe(buildStructuralFingerprint(sym2));
  });

  it('should include modifiers in fingerprint', () => {
    const sym1 = makeSym({ modifiers: ['async'] });
    const sym2 = makeSym({ modifiers: [] });
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should sort modifiers for deterministic output', () => {
    const sym1 = makeSym({ modifiers: ['async', 'static'] });
    const sym2 = makeSym({ modifiers: ['static', 'async'] });
    expect(buildStructuralFingerprint(sym1)).toBe(buildStructuralFingerprint(sym2));
  });

  it('should include heritage in fingerprint', () => {
    const sym1 = makeSym({ kind: 'class', heritage: [{ kind: 'extends', name: 'Base' }] });
    const sym2 = makeSym({ kind: 'class' });
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should sort heritage deterministically', () => {
    const sym1 = makeSym({ kind: 'class', heritage: [
      { kind: 'implements', name: 'B' },
      { kind: 'extends', name: 'A' },
    ]});
    const sym2 = makeSym({ kind: 'class', heritage: [
      { kind: 'extends', name: 'A' },
      { kind: 'implements', name: 'B' },
    ]});
    expect(buildStructuralFingerprint(sym1)).toBe(buildStructuralFingerprint(sym2));
  });

  it('should include member structure in fingerprint', () => {
    const sym1 = makeSym({
      kind: 'class',
      members: [makeSym({ kind: 'method', name: 'doStuff', parameters: [], returnType: 'void' })],
    });
    const sym2 = makeSym({ kind: 'class' });
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should produce different hashes for different kinds', () => {
    const sym1 = makeSym({ kind: 'function' });
    const sym2 = makeSym({ kind: 'variable' });
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should include decorators in fingerprint', () => {
    const sym1 = makeSym({ decorators: [{ name: 'Injectable' }] });
    const sym2 = makeSym();
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should sort decorators deterministically', () => {
    const sym1 = makeSym({ decorators: [{ name: 'B' }, { name: 'A' }] });
    const sym2 = makeSym({ decorators: [{ name: 'A' }, { name: 'B' }] });
    expect(buildStructuralFingerprint(sym1)).toBe(buildStructuralFingerprint(sym2));
  });

  it('should include typeParameters count in fingerprint', () => {
    const sym1 = makeSym({ typeParameters: ['T'] });
    const sym2 = makeSym();
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should include methodKind in fingerprint', () => {
    const sym1 = makeSym({ kind: 'method', methodKind: 'getter' });
    const sym2 = makeSym({ kind: 'method', methodKind: 'setter' });
    expect(buildStructuralFingerprint(sym1)).not.toBe(buildStructuralFingerprint(sym2));
  });

  it('should not depend on member names (only structure)', () => {
    const sym1 = makeSym({
      kind: 'class',
      members: [makeSym({ kind: 'method', name: 'alpha', parameters: [], modifiers: [] })],
    });
    const sym2 = makeSym({
      kind: 'class',
      members: [makeSym({ kind: 'method', name: 'beta', parameters: [], modifiers: [] })],
    });
    // Member names are not in the signature, so structural fingerprints should be equal
    expect(buildStructuralFingerprint(sym1)).toBe(buildStructuralFingerprint(sym2));
  });
});
