import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash } from '../src/gildash';
import type { FullSymbol } from '../src/gildash';
import type { SemanticModuleInterface, ResolvedType, SemanticReference, Implementation } from '../src/semantic/types';

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
}

async function openGildash(
  projectRoot: string,
  opts: { semantic?: boolean } = {},
): Promise<Gildash> {
  const result = await Gildash.open({
    projectRoot,
    extensions: ['.ts'],
    watchMode: false,
    semantic: opts.semantic ?? false,
  } as any);
  if (isErr(result)) {
    const e = (result as any).data;
    const cause = e.cause instanceof Error ? e.cause.message : '';
    throw new Error(`Failed to open: ${e.message} | cause: ${cause}`);
  }
  return result as Gildash;
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
      if (isErr(files)) throw (files as any).data;
      expect((files as any[]).length).toBeGreaterThan(0);

      await g.close();
    });

    // 7. [NE] open with semantic:true but no tsconfig.json → returns error
    it('should return error when semantic:true but no tsconfig.json exists', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'no-tsconfig' }));
      await writeFile(join(tmpDir, 'src', 'index.ts'), 'export const x = 1;');
      // No tsconfig.json

      const result = await Gildash.open({
        projectRoot: tmpDir,
        extensions: ['.ts'],
        watchMode: false,
        semantic: true,
      } as any);
      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('semantic');
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
      if (isErr(result)) throw (result as any).data;
      const resolved = result as ResolvedType | null;
      expect(resolved).not.toBeNull();
      expect(resolved!.text).toBe('string');
    });

    // 3. [HP] getSemanticReferences for exported function → returns references including definition
    it('should return semantic references for an exported function including its definition', () => {
      const result = g.getSemanticReferences('createService', 'src/service.ts');
      if (isErr(result)) throw (result as any).data;
      const refs = result as SemanticReference[];
      expect(refs.length).toBeGreaterThanOrEqual(1);
      // At least one reference should be the definition itself
      expect(refs.some((r) => r.isDefinition)).toBe(true);
    });

    // 4. [HP] getImplementations for interface → finds implementing class
    it('should find implementing class for an interface', () => {
      const result = g.getImplementations('IService', 'src/types.ts');
      if (isErr(result)) throw (result as any).data;
      const impls = result as Implementation[];
      expect(impls.length).toBeGreaterThanOrEqual(1);
      expect(impls.some((i) => i.symbolName === 'MyService')).toBe(true);
    });

    // 5. [HP] getSemanticModuleInterface → returns exports with resolved types
    it('should return module interface with exported symbols and resolved types', () => {
      const result = g.getSemanticModuleInterface(join(tmpDir, 'src', 'service.ts'));
      if (isErr(result)) throw (result as any).data;
      const iface = result as SemanticModuleInterface;
      expect(iface.exports.length).toBeGreaterThanOrEqual(2);
      const names = iface.exports.map((e) => e.name);
      expect(names).toContain('MyService');
      expect(names).toContain('createService');
      expect(names).toContain('SERVICE_NAME');
    });

    // 6. [HP] getFullSymbol with semantic → includes resolvedType field
    it('should include resolvedType in getFullSymbol result when semantic is enabled', () => {
      const result = g.getFullSymbol('SERVICE_NAME', 'src/service.ts');
      if (isErr(result)) throw (result as any).data;
      const full = result as FullSymbol;
      expect(full.name).toBe('SERVICE_NAME');
      // resolvedType should be populated by semantic layer
      expect(full.resolvedType).toBeDefined();
      expect(full.resolvedType!.text).toBe('string');
    });

    // 8. [NE] getResolvedType for non-existent symbol → returns search error
    it('should return search error when getResolvedType queries a non-existent symbol', () => {
      const result = g.getResolvedType('NonExistent', 'src/service.ts');
      expect(isErr(result)).toBe(true);
      expect((result as any).data.type).toBe('search');
    });

    // 10. [ED] getSemanticModuleInterface for file with no exports → empty exports array
    it('should return empty exports for a file with no exported symbols', () => {
      const result = g.getSemanticModuleInterface(join(tmpDir, 'src', 'internal.ts'));
      if (isErr(result)) throw (result as any).data;
      const iface = result as SemanticModuleInterface;
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

      const result = g.getFullSymbol('SERVICE_NAME', 'src/service.ts');
      if (isErr(result)) throw (result as any).data;
      const full = result as FullSymbol;
      expect(full.name).toBe('SERVICE_NAME');
      expect(full.resolvedType).toBeUndefined();

      await g.close();
    });

    // 11. [CO] all semantic APIs return closed error after close
    it('should return closed error for all semantic APIs after close', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-sem-'));
      await createSemanticProject(tmpDir);
      const g = await openGildash(tmpDir, { semantic: true });
      await g.close();

      const rt = g.getResolvedType('SERVICE_NAME', 'src/service.ts');
      expect(isErr(rt)).toBe(true);
      expect((rt as any).data.type).toBe('closed');

      const refs = g.getSemanticReferences('createService', 'src/service.ts');
      expect(isErr(refs)).toBe(true);
      expect((refs as any).data.type).toBe('closed');

      const impls = g.getImplementations('IService', 'src/types.ts');
      expect(isErr(impls)).toBe(true);
      expect((impls as any).data.type).toBe('closed');

      const mi = g.getSemanticModuleInterface(join(tmpDir, 'src', 'service.ts'));
      expect(isErr(mi)).toBe(true);
      expect((mi as any).data.type).toBe('closed');
    });
  });
});
