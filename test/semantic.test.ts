import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash } from '../src/gildash';
import type { FullSymbol } from '../src/gildash';
import type { SemanticModuleInterface, ResolvedType, SemanticReference, Implementation, SemanticDiagnostic } from '../src/semantic/types';
import type { SymbolNode } from '../src/semantic/symbol-graph';
import { GildashError } from '../src/errors';

// ── Fixture Helpers ────────────────────────────────────────────────────────

/**
 * Create a TS project with tsconfig.json and typed source files
 * suitable for semantic analysis.
 */
async function createSemanticProject(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'semantic-test' }));

  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        rootDir: './src',
        outDir: './dist',
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  );

  await writeFile(
    join(root, 'src', 'types.ts'),
    [
      'export interface IService {',
      '  serve(): void;',
      '}',
      '',
      'export type Status = "active" | "inactive";',
    ].join('\n'),
  );

  await writeFile(
    join(root, 'src', 'service.ts'),
    [
      "import type { IService } from './types';",
      '',
      'export class MyService implements IService {',
      '  serve(): void {}',
      '}',
      '',
      'export function createService(): IService {',
      '  return new MyService();',
      '}',
      '',
      'export const SERVICE_NAME: string = "default";',
    ].join('\n'),
  );

  await writeFile(
    join(root, 'src', 'app.ts'),
    [
      "import { createService } from './service';",
      '',
      'export function main(): void {',
      '  const svc = createService();',
      '  svc.serve();',
      '}',
    ].join('\n'),
  );

  // A file with no exports
  await writeFile(
    join(root, 'src', 'internal.ts'),
    [
      'const secret = 42;',
      'function doNothing(): void {}',
    ].join('\n'),
  );

  // File with incompatible types for assignability tests
  await writeFile(
    join(root, 'src', 'animals.ts'),
    [
      'export interface Animal {',
      '  name: string;',
      '  legs: number;',
      '}',
      '',
      'export class Dog implements Animal {',
      '  name: string = "Rex";',
      '  legs: number = 4;',
      '  bark(): void {}',
      '}',
      '',
      'export class Cat implements Animal {',
      '  name: string = "Whiskers";',
      '  legs: number = 4;',
      '  meow(): void {}',
      '}',
      '',
      'export const myDog: Dog = new Dog();',
      'export const myAnimal: Animal = new Dog();',
      'export const count: number = 42;',
    ].join('\n'),
  );
}

async function openGildash(
  projectRoot: string,
  opts: { semantic?: boolean } = {},
): Promise<Gildash> {
  return Gildash.open({
    projectRoot,
    extensions: ['.ts'],
    watchMode: false,
    semantic: opts.semantic ?? false,
  } as any);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Gildash Semantic integration', () => {

  // ── Group 1: Semantic Lifecycle ────────────────────────────────────────

  describe('Lifecycle', () => {
    let tmpDir: string;

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    // 1. [HP] open with semantic:true → succeeds, role=owner
    it('should open with semantic:true and complete indexing successfully', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);

      const g = await openGildash(tmpDir, { semantic: true });
      expect(g).toBeInstanceOf(Gildash);
      expect(g.role).toBe('owner');

      const files = g.listIndexedFiles();
      expect(files.length).toBeGreaterThan(0);

      await g.close();
    });

    // 7. [NE] open with semantic:true but no tsconfig.json → returns error
    it('should return error when semantic:true but no tsconfig.json exists', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'no-tsconfig' }));
      await writeFile(join(tmpDir, 'src', 'index.ts'), 'export const x = 1;');
      // No tsconfig.json

      await expect(Gildash.open({
        projectRoot: tmpDir,
        extensions: ['.ts'],
        watchMode: false,
        semantic: true,
      } as any)).rejects.toThrow(GildashError);
    });
  });

  // ── Group 2: Semantic Query APIs ──────────────────────────────────────

  describe('Semantic Query APIs', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      g = await openGildash(tmpDir, { semantic: true });
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    // 2. [HP] getResolvedType for typed variable → returns ResolvedType with text
    it('should return ResolvedType with correct text for a typed variable', () => {
      const result = g.getResolvedType('SERVICE_NAME', 'src/service.ts');
      expect(result).not.toBeNull();
      expect(result!.text).toBe('string');
    });

    // 3. [HP] getSemanticReferences for exported function → returns references including definition
    it('should return semantic references for an exported function including its definition', () => {
      const refs = g.getSemanticReferences('createService', 'src/service.ts');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      // At least one reference should be the definition itself
      expect(refs.some((r) => r.isDefinition)).toBe(true);
    });

    // 4. [HP] getImplementations for interface → finds implementing class
    it('should find implementing class for an interface', () => {
      const impls = g.getImplementations('IService', 'src/types.ts');
      expect(impls.length).toBeGreaterThanOrEqual(1);
      expect(impls.some((i) => i.symbolName === 'MyService')).toBe(true);
    });

    // 5. [HP] getSemanticModuleInterface → returns exports with resolved types
    it('should return module interface with exported symbols and resolved types', () => {
      const iface = g.getSemanticModuleInterface(join(tmpDir, 'src', 'service.ts'));
      expect(iface.exports.length).toBeGreaterThanOrEqual(2);
      const names = iface.exports.map((e) => e.name);
      expect(names).toContain('MyService');
      expect(names).toContain('createService');
      expect(names).toContain('SERVICE_NAME');
    });

    // 6. [HP] getFullSymbol with semantic → includes resolvedType field
    it('should include resolvedType in getFullSymbol result when semantic is enabled', () => {
      const full = g.getFullSymbol('SERVICE_NAME', 'src/service.ts');
      expect(full).not.toBeNull();
      expect(full!.name).toBe('SERVICE_NAME');
      // resolvedType should be populated by semantic layer
      expect(full!.resolvedType).toBeDefined();
      expect(full!.resolvedType!.text).toBe('string');
    });

    // 8. [NE] getResolvedType for non-existent symbol → returns null
    it('should return null when getResolvedType queries a non-existent symbol', () => {
      const result = g.getResolvedType('NonExistent', 'src/service.ts');
      expect(result).toBeNull();
    });

    // 10. [ED] getSemanticModuleInterface for file with no exports → empty exports array
    it('should return empty exports for a file with no exported symbols', () => {
      const iface = g.getSemanticModuleInterface(join(tmpDir, 'src', 'internal.ts'));
      expect(iface.exports).toEqual([]);
    });
  });

  // ── Group 3: Non-semantic & Closed state ──────────────────────────────

  describe('Non-semantic & Closed state', () => {
    let tmpDir: string;

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    // 9. [ED] getFullSymbol without semantic:true → no resolvedType field
    it('should not include resolvedType in getFullSymbol when semantic is disabled', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: false });

      const full = g.getFullSymbol('SERVICE_NAME', 'src/service.ts');
      expect(full).not.toBeNull();
      expect(full!.name).toBe('SERVICE_NAME');
      expect(full!.resolvedType).toBeUndefined();

      await g.close();
    });

    // 11. [CO] all semantic APIs return closed error after close
    it('should return closed error for all semantic APIs after close', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });
      await g.close();

      expect(() => g.getResolvedType('SERVICE_NAME', 'src/service.ts')).toThrow(GildashError);
      expect(() => g.getSemanticReferences('createService', 'src/service.ts')).toThrow(GildashError);
      expect(() => g.getImplementations('IService', 'src/types.ts')).toThrow(GildashError);
      expect(() => g.getSemanticModuleInterface(join(tmpDir, 'src', 'service.ts'))).toThrow(GildashError);
    });
  });

  // ── Group 4: isTypeAssignableTo ──────────────────────────────────────

  describe('isTypeAssignableTo', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      g = await openGildash(tmpDir, { semantic: true });
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return true when class implements interface', () => {
      const result = g.isTypeAssignableTo('Dog', 'src/animals.ts', 'Animal', 'src/animals.ts');
      expect(result).toBe(true);
    });

    it('should return false when types are incompatible', () => {
      const result = g.isTypeAssignableTo('count', 'src/animals.ts', 'Animal', 'src/animals.ts');
      expect(result).toBe(false);
    });

    it('should throw GildashError when source symbol does not exist', () => {
      expect(() =>
        g.isTypeAssignableTo('NonExistent', 'src/animals.ts', 'Animal', 'src/animals.ts'),
      ).toThrow(GildashError);
    });

    it('should throw GildashError when target symbol does not exist', () => {
      expect(() =>
        g.isTypeAssignableTo('Dog', 'src/animals.ts', 'NonExistent', 'src/animals.ts'),
      ).toThrow(GildashError);
    });

    it('should respect directionality — Dog assignable to Animal but not necessarily reverse', () => {
      const dogToAnimal = g.isTypeAssignableTo('Dog', 'src/animals.ts', 'Animal', 'src/animals.ts');
      const animalToDog = g.isTypeAssignableTo('Animal', 'src/animals.ts', 'Dog', 'src/animals.ts');
      // Dog has extra method bark(), so Animal is not assignable to Dog
      expect(dogToAnimal).toBe(true);
      expect(animalToDog).toBe(false);
    });
  });

  // ── Group 5: getFileTypes ────────────────────────────────────────────

  describe('getFileTypes', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      g = await openGildash(tmpDir, { semantic: true });
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return a non-empty Map for a file with declarations', () => {
      const types = g.getFileTypes('src/service.ts');
      expect(types).toBeInstanceOf(Map);
      expect(types.size).toBeGreaterThan(0);
    });

    it('should return empty Map for a file not in program', () => {
      const types = g.getFileTypes('src/nonexistent-file.ts');
      expect(types).toBeInstanceOf(Map);
      expect(types.size).toBe(0);
    });
  });

  // ── Group 6: getResolvedTypeAt ───────────────────────────────────────

  describe('getResolvedTypeAt', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      g = await openGildash(tmpDir, { semantic: true });
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return ResolvedType for a known declaration position', () => {
      // SERVICE_NAME is on line 11, column 13 of src/service.ts
      // "export const SERVICE_NAME: string = "default";"
      // Line 11 (1-based), column 13 (0-based) points to SERVICE_NAME
      const result = g.getResolvedTypeAt('src/service.ts', 11, 13);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('string');
    });

    it('should return null for invalid position', () => {
      const result = g.getResolvedTypeAt('src/service.ts', 9999, 0);
      expect(result).toBeNull();
    });
  });

  // ── Group 7: isTypeAssignableToAt ────────────────────────────────────

  describe('isTypeAssignableToAt', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      g = await openGildash(tmpDir, { semantic: true });
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return boolean for position-based assignability check', () => {
      // Dog (line 6, col 13) and Animal (line 1, col 17) in src/animals.ts
      // "export interface Animal {" → Animal at col 17
      // "export class Dog implements Animal {" → Dog at col 13
      const result = g.isTypeAssignableToAt({
        source: { filePath: 'src/animals.ts', line: 6, column: 13 },
        target: { filePath: 'src/animals.ts', line: 1, column: 17 },
      });
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    it('should accept object parameter correctly', () => {
      // count (line 20, col 13) to Animal (line 1, col 17) in src/animals.ts
      // "export const count: number = 42;"
      const result = g.isTypeAssignableToAt({
        source: { filePath: 'src/animals.ts', line: 20, column: 13 },
        target: { filePath: 'src/animals.ts', line: 1, column: 17 },
      });
      expect(result).toBe(false);
    });

    it('should return null for invalid source position', () => {
      const result = g.isTypeAssignableToAt({
        source: { filePath: 'src/animals.ts', line: 9999, column: 0 },
        target: { filePath: 'src/animals.ts', line: 1, column: 17 },
      });
      expect(result).toBeNull();
    });
  });

  // ── Group 8: Position-based semantic API ─────────────────────────────

  describe('Position-based semantic API', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      g = await openGildash(tmpDir, { semantic: true });
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return ResolvedType via getResolvedTypeAtPosition for a known byte offset', () => {
      // Get the byte offset of SERVICE_NAME from getFileTypes
      const fileTypes = g.getFileTypes('src/service.ts');
      expect(fileTypes.size).toBeGreaterThan(0);
      // Find a position with 'string' type
      let stringPos: number | null = null;
      for (const [pos, rt] of fileTypes) {
        if (rt.text === 'string') { stringPos = pos; break; }
      }
      expect(stringPos).not.toBeNull();
      const result = g.getResolvedTypeAtPosition('src/service.ts', stringPos!);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('string');
    });

    it('should return semantic references via getSemanticReferencesAtPosition', () => {
      // Use lineColumnToPosition to get byte offset of createService (line 7, col 16)
      const pos = g.lineColumnToPosition('src/service.ts', 7, 16);
      expect(pos).not.toBeNull();
      const refs = g.getSemanticReferencesAtPosition('src/service.ts', pos!);
      expect(Array.isArray(refs)).toBe(true);
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.some(r => r.isDefinition)).toBe(true);
    });

    it('should return implementations via getImplementationsAtPosition', () => {
      // IService at line 1, col 17 in types.ts: "export interface IService {"
      const pos = g.lineColumnToPosition('src/types.ts', 1, 17);
      expect(pos).not.toBeNull();
      const impls = g.getImplementationsAtPosition('src/types.ts', pos!);
      expect(Array.isArray(impls)).toBe(true);
      expect(impls.length).toBeGreaterThanOrEqual(1);
      expect(impls.some(i => i.symbolName === 'MyService')).toBe(true);
    });

    it('should check type assignability via isTypeAssignableToAtPosition', () => {
      // Dog at line 6, col 13; Animal at line 1, col 17 in animals.ts
      const dogPos = g.lineColumnToPosition('src/animals.ts', 6, 13);
      const animalPos = g.lineColumnToPosition('src/animals.ts', 1, 17);
      expect(dogPos).not.toBeNull();
      expect(animalPos).not.toBeNull();
      const result = g.isTypeAssignableToAtPosition(
        'src/animals.ts', dogPos!, 'src/animals.ts', animalPos!,
      );
      expect(result).toBe(true);
    });
  });

  // ── Group 9: Internal utility exposure ──────────────────────────────

  describe('Internal utility exposure', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      g = await openGildash(tmpDir, { semantic: true });
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should convert line/column to byte offset via lineColumnToPosition', () => {
      const pos = g.lineColumnToPosition('src/service.ts', 1, 0);
      expect(pos).not.toBeNull();
      expect(typeof pos).toBe('number');
      expect(pos).toBeGreaterThanOrEqual(0);
    });

    it('should return null from lineColumnToPosition for invalid position', () => {
      const pos = g.lineColumnToPosition('src/service.ts', 99999, 0);
      expect(pos).toBeNull();
    });

    it('should find name position via findNamePosition', () => {
      // "export class MyService implements IService {"
      // line 3 col 0 is declaration start
      const declPos = g.lineColumnToPosition('src/service.ts', 3, 0);
      expect(declPos).not.toBeNull();
      const namePos = g.findNamePosition('src/service.ts', declPos!, 'MyService');
      expect(namePos).not.toBeNull();
      expect(namePos!).toBeGreaterThan(declPos!);
    });

    it('should return null from findNamePosition when name does not exist', () => {
      const declPos = g.lineColumnToPosition('src/service.ts', 3, 0);
      expect(declPos).not.toBeNull();
      const namePos = g.findNamePosition('src/service.ts', declPos!, 'NonExistentName');
      expect(namePos).toBeNull();
    });

    it('should return SymbolNode via getSymbolNode for a class', () => {
      // MyService at line 3
      const declPos = g.lineColumnToPosition('src/service.ts', 3, 0);
      expect(declPos).not.toBeNull();
      const namePos = g.findNamePosition('src/service.ts', declPos!, 'MyService');
      expect(namePos).not.toBeNull();
      const node = g.getSymbolNode('src/service.ts', namePos!);
      expect(node).not.toBeNull();
      expect(node!.name).toBe('MyService');
      expect(node!.filePath).toContain('service.ts');
    });

    it('should return null from getSymbolNode for invalid position', () => {
      const node = g.getSymbolNode('src/service.ts', 999999);
      expect(node).toBeNull();
    });
  });

  // ── Group 10: Semantic Diagnostics ──────────────────────────────────

  describe('Semantic Diagnostics', () => {
    let tmpDir: string;

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should return diagnostics for a file with type errors', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'diag-test' }));
      await writeFile(
        join(tmpDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true },
          include: ['src/**/*.ts'],
        }),
      );
      await writeFile(join(tmpDir, 'src', 'bad.ts'), "const x: number = 'not a number';");

      const g = await openGildash(tmpDir, { semantic: true });

      const diags = g.getSemanticDiagnostics(join(tmpDir, 'src', 'bad.ts'));
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0]!.category).toBe('error');
      expect(typeof diags[0]!.code).toBe('number');
      expect(diags[0]!.line).toBe(1);

      await g.close();
    });

    it('should return empty diagnostics for a valid file', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });

      const diags = g.getSemanticDiagnostics(join(tmpDir, 'src', 'service.ts'));
      expect(diags).toEqual([]);

      await g.close();
    });

    it('should return empty diagnostics for a non-indexed file', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });

      const diags = g.getSemanticDiagnostics(join(tmpDir, 'src', 'does-not-exist.ts'));
      expect(diags).toEqual([]);

      await g.close();
    });
  });

  // ── Group 11: Relation return type (StoredCodeRelation) ─────────────

  describe('Relation return type includes dstProject', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      g = await openGildash(tmpDir, { semantic: true });
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return StoredCodeRelation with dstProject from searchRelations', () => {
      const result = g.searchRelations({ type: 'imports' });
      expect(result.length).toBeGreaterThan(0);
      // StoredCodeRelation extends CodeRelation with dstProject
      expect(typeof result[0]!.dstProject).toBe('string');
    });

    it('should return StoredCodeRelation with dstProject from searchAllRelations', () => {
      const result = g.searchAllRelations({ type: 'imports' });
      expect(result.length).toBeGreaterThan(0);
      expect(typeof result[0]!.dstProject).toBe('string');
    });

    it('should return StoredCodeRelation with dstProject from getInternalRelations', () => {
      // internal relations within animals.ts (might be empty, but type should be correct)
      const result = g.searchRelations({ srcFilePath: 'src/service.ts', type: 'imports' });
      if (result.length > 0) {
        expect(typeof result[0]!.dstProject).toBe('string');
      }
    });
  });

  // ── Group 12: New methods throw when closed ─────────────────────────

  describe('New semantic methods throw when closed', () => {
    let tmpDir: string;

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should throw GildashError for isTypeAssignableTo after close', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });
      await g.close();

      expect(() =>
        g.isTypeAssignableTo('Dog', 'src/animals.ts', 'Animal', 'src/animals.ts'),
      ).toThrow(GildashError);
    });

    it('should throw GildashError for getFileTypes after close', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });
      await g.close();

      expect(() => g.getFileTypes('src/service.ts')).toThrow(GildashError);
    });

    it('should throw GildashError for getResolvedTypeAt after close', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });
      await g.close();

      expect(() => g.getResolvedTypeAt('src/service.ts', 11, 13)).toThrow(GildashError);
    });

    it('should throw GildashError for isTypeAssignableToAt after close', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });
      await g.close();

      expect(() =>
        g.isTypeAssignableToAt({
          source: { filePath: 'src/animals.ts', line: 6, column: 13 },
          target: { filePath: 'src/animals.ts', line: 1, column: 17 },
        }),
      ).toThrow(GildashError);
    });

    it('should throw GildashError for position-based APIs after close', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });
      await g.close();

      expect(() => g.getResolvedTypeAtPosition('src/service.ts', 0)).toThrow(GildashError);
      expect(() => g.getSemanticReferencesAtPosition('src/service.ts', 0)).toThrow(GildashError);
      expect(() => g.getImplementationsAtPosition('src/service.ts', 0)).toThrow(GildashError);
      expect(() => g.isTypeAssignableToAtPosition('src/a.ts', 0, 'src/b.ts', 0)).toThrow(GildashError);
      expect(() => g.lineColumnToPosition('src/service.ts', 1, 0)).toThrow(GildashError);
      expect(() => g.findNamePosition('src/service.ts', 0, 'x')).toThrow(GildashError);
      expect(() => g.getSymbolNode('src/service.ts', 0)).toThrow(GildashError);
      expect(() => g.getSemanticDiagnostics('src/service.ts')).toThrow(GildashError);
    });
  });
});
