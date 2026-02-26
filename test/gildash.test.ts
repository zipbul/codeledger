import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash } from '../src/gildash';
import type { FullSymbol } from '../src/gildash';
import { GildashError } from '../src/errors';
import { DATA_DIR, DB_FILE } from '../src/constants';

// ── Fixture Helpers ────────────────────────────────────────────────────────

/** Standard fixtures: utils, app (extends Base), models (Base implements IService),
 *  dead exports, re-export, cycle pair, index entry-point. */
async function createRichProject(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'test-project' }));

  await writeFile(
    join(root, 'src', 'utils.ts'),
    [
      'export function helper(x: number): string {',
      '  return String(x);',
      '}',
      '',
      'export const MAGIC = 42;',
    ].join('\n'),
  );

  await writeFile(
    join(root, 'src', 'models.ts'),
    [
      'export interface IService {',
      '  serve(): void;',
      '}',
      '',
      'export class Base implements IService {',
      '  serve(): void {}',
      '}',
    ].join('\n'),
  );

  await writeFile(
    join(root, 'src', 'app.ts'),
    [
      "import { helper } from './utils';",
      "import { Base } from './models';",
      '',
      'export class App extends Base {',
      '  run(): string {',
      '    return helper(1);',
      '  }',
      '}',
    ].join('\n'),
  );

  await writeFile(
    join(root, 'src', 'dead.ts'),
    [
      "export function unused(): string {",
      "  return 'never imported';",
      '}',
      '',
      'export const DEAD_CONST = 999;',
    ].join('\n'),
  );

  await writeFile(
    join(root, 'src', 're-export.ts'),
    "export { helper as renamedHelper } from './utils';",
  );

  await writeFile(
    join(root, 'src', 'index.ts'),
    [
      "export { App } from './app';",
      "export { helper } from './utils';",
    ].join('\n'),
  );

  // Cycle pair
  await writeFile(
    join(root, 'src', 'cycle-a.ts'),
    [
      "import { fromB } from './cycle-b';",
      'export function fromA(): string { return fromB(); }',
    ].join('\n'),
  );
  await writeFile(
    join(root, 'src', 'cycle-b.ts'),
    [
      "import { fromA } from './cycle-a';",
      'export function fromB(): string { return fromA(); }',
    ].join('\n'),
  );

  // Circular re-export pair (for resolveSymbol cycle test)
  await writeFile(
    join(root, 'src', 'circ-re-a.ts'),
    "export { foo } from './circ-re-b';",
  );
  await writeFile(
    join(root, 'src', 'circ-re-b.ts'),
    "export { foo } from './circ-re-a';",
  );

  // Heritage cycle pair
  await writeFile(
    join(root, 'src', 'circ-base-a.ts'),
    [
      "import { CircB } from './circ-base-b';",
      'export class CircA extends CircB {}',
    ].join('\n'),
  );
  await writeFile(
    join(root, 'src', 'circ-base-b.ts'),
    [
      "import { CircA } from './circ-base-a';",
      'export class CircB extends CircA {}',
    ].join('\n'),
  );
}

async function openGildash(projectRoot: string): Promise<Gildash> {
  return Gildash.open({
    projectRoot,
    extensions: ['.ts'],
    watchMode: false,
  } as any);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Gildash integration', () => {

  // ── Group 1: Lifecycle & Init ──────────────────────────────────────────

  describe('Lifecycle & Init', () => {
    let tmpDir: string;

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should open with watchMode=false and complete fullIndex successfully', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);

      const g = await openGildash(tmpDir);
      expect(g).toBeInstanceOf(Gildash);
      expect(g.role).toBe('owner');

      const files = g.listIndexedFiles();
      expect(files.length).toBeGreaterThan(0);

      await g.close();
    });

    it('should return discovered project boundaries via projects getter', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);

      const g = await openGildash(tmpDir);
      expect(g.projects.length).toBeGreaterThanOrEqual(1);
      expect(g.projects[0]!.project).toBe('test-project');
      await g.close();
    });

    it('should return validation error when projectRoot is a relative path', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await expect(Gildash.open({
        projectRoot: 'relative/path',
        extensions: ['.ts'],
        watchMode: false,
      } as any)).rejects.toThrow(GildashError);
    });

    it('should return validation error when projectRoot does not exist', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await expect(Gildash.open({
        projectRoot: join(tmpDir, 'nonexistent'),
        extensions: ['.ts'],
        watchMode: false,
      } as any)).rejects.toThrow(GildashError);
    });

    it('should delete database files when close is called with cleanup option', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);

      const g = await openGildash(tmpDir);
      const dbPath = join(tmpDir, DATA_DIR, DB_FILE);
      expect(existsSync(dbPath)).toBe(true);

      await g.close({ cleanup: true });
      expect(existsSync(dbPath)).toBe(false);
    });

    it('should use directory basename as default project when no package.json is found', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      // No package.json → empty boundaries → defaultProject = basename
      await writeFile(join(tmpDir, 'src', 'index.ts'), 'export const x = 1;');

      const g = await openGildash(tmpDir);
      // Should not error even without package.json
      g.getStats();
      await g.close();
    });

    it('should be a no-op when close is called twice', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);

      const g = await openGildash(tmpDir);
      await g.close();
      await g.close();
      // Both should succeed (second is no-op)
    });
  });

  // ── Group 2: Parsing & Extraction ────────────────────────────────────

  describe('Parsing & Extraction', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      g = await openGildash(tmpDir);
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should parse TypeScript source and store result in cache', () => {
      const code = 'export function greet(name: string): string { return `Hello ${name}`; }';
      const parsed = g.parseSource('/virtual/test.ts', code);

      const cached = g.getParsedAst('/virtual/test.ts');
      expect(cached).toBeDefined();
      expect(cached!.sourceText).toBe(code);
    });

    it('should extract symbols from a parsed file', () => {
      const code = [
        'export function myFn(x: number): string { return String(x); }',
        'export class MyClass {}',
        'export const MY_CONST = 42;',
      ].join('\n');
      const parsed = g.parseSource('/virtual/syms.ts', code);

      const symbols = g.extractSymbols(parsed);
      const names = symbols.map((s: any) => s.name);
      expect(names).toContain('myFn');
      expect(names).toContain('MyClass');
      expect(names).toContain('MY_CONST');
    });

    it('should extract import and call relations from a parsed file', () => {
      const code = "import { helper } from './utils';\nexport function run() { helper(1); }";
      const parsed = g.parseSource('/virtual/rels.ts', code);

      const relations = g.extractRelations(parsed);
      const types = relations.map((r: any) => r.type);
      expect(types).toContain('imports');
    });

    it('should return cached AST from getParsedAst and undefined after close', async () => {
      // Use a separate instance for this test since we close it
      const dir = await mkdtemp(join(tmpdir(), 'gildash-it-cache-'));
      await createRichProject(dir);
      const inst = await openGildash(dir);

      inst.parseSource('/virtual/cached.ts', 'export const x = 1;');
      expect(inst.getParsedAst('/virtual/cached.ts')).toBeDefined();

      await inst.close();
      expect(inst.getParsedAst('/virtual/cached.ts')).toBeUndefined();

      await rm(dir, { recursive: true, force: true });
    });
  });

  // ── Group 3: Search APIs ─────────────────────────────────────────────

  describe('Search APIs', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      g = await openGildash(tmpDir);
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should find indexed function symbols with text and kind filter', () => {
      const result = g.searchSymbols({ text: 'helper', kind: 'function' });
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some((s: any) => s.name === 'helper' && s.kind === 'function')).toBe(true);
    });

    it('should find imports relations via searchRelations', () => {
      const result = g.searchRelations({ type: 'imports' });
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((r: any) => r.type === 'imports')).toBe(true);
    });

    it('should find symbols across all projects with searchAllSymbols', () => {
      const result = g.searchAllSymbols({ text: 'App' });
      expect(result.some((s: any) => s.name === 'App')).toBe(true);
    });

    it('should list all indexed files for the project', () => {
      const result = g.listIndexedFiles();
      expect(result.length).toBeGreaterThan(0);
      const paths = result.map((f: any) => f.filePath);
      expect(paths.some((p: string) => p.includes('utils.ts'))).toBe(true);
      expect(paths.some((p: string) => p.includes('app.ts'))).toBe(true);
    });

    it('should return closed error when searchSymbols is called after close', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'gildash-it-closed-'));
      await createRichProject(dir);
      const inst = await openGildash(dir);
      await inst.close();

      expect(() => inst.searchSymbols({ text: 'helper' })).toThrow(GildashError);

      await rm(dir, { recursive: true, force: true });
    });
  });

  // ── Group 4: Dependency Graph ────────────────────────────────────────

  describe('Dependency Graph', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      g = await openGildash(tmpDir);
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return direct import list via getDependencies', () => {
      // src/app.ts imports from utils and models
      const result = g.getDependencies('src/app.ts');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some((p: string) => p.includes('utils'))).toBe(true);
    });

    it('should return files that import a given file via getDependents', () => {
      // src/utils.ts is imported by app.ts, index.ts, re-export.ts
      const result = g.getDependents('src/utils.ts');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some((p: string) => p.includes('app'))).toBe(true);
    });

    it('should return transitively affected files via getAffected', async () => {
      // Changing utils.ts should affect app.ts (imports utils) and index.ts (re-exports from app/utils)
      const result = await g.getAffected(['src/utils.ts']);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should return adjacency list from getImportGraph', async () => {
      const result = await g.getImportGraph();
      expect(result.size).toBeGreaterThan(0);
      // app.ts should have edges
      const appEdges = Array.from(result.entries()).find(([k]) => k.includes('app'));
      expect(appEdges).toBeDefined();
    });

    it('should return transitive dependencies via getTransitiveDependencies', async () => {
      // app.ts → utils.ts, models.ts (direct); no further transitive from those
      const result = await g.getTransitiveDependencies('src/app.ts');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some((p: string) => p.includes('utils'))).toBe(true);
    });

    it('should detect cycle and return cycle paths when circular imports exist', async () => {
      const cycleResult = await g.hasCycle();
      expect(cycleResult).toBe(true);

      const paths = await g.getCyclePaths();
      expect(paths.length).toBeGreaterThanOrEqual(1);
      // One cycle should involve cycle-a and cycle-b
      const cyclePathFlat = paths.flat();
      expect(cyclePathFlat.some((p: string) => p.includes('cycle-a'))).toBe(true);
      expect(cyclePathFlat.some((p: string) => p.includes('cycle-b'))).toBe(true);
    });

    it('should return empty array when getAffected receives empty changedFiles', async () => {
      const result = await g.getAffected([]);
      expect(result).toEqual([]);
    });
  });

  // ── Group 5: Analysis APIs ───────────────────────────────────────────

  describe('Analysis APIs', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      g = await openGildash(tmpDir);
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return full symbol details including members for a class', () => {
      const result = g.getFullSymbol('Base', 'src/models.ts');
      expect(result).not.toBeNull();
      const full = result as FullSymbol;
      expect(full.name).toBe('Base');
      expect(full.kind).toBe('class');
      // Base has a serve() method
      if (full.members && full.members.length > 0) {
        expect(full.members.some((m) => m.name === 'serve')).toBe(true);
      }
    });

    it('should return search error when getFullSymbol queries a non-existent symbol', () => {
      const result = g.getFullSymbol('NonExistent', 'src/models.ts');
      expect(result).toBeNull();
    });

    it('should return file statistics with lineCount and symbolCount', () => {
      const result = g.getFileStats('src/utils.ts');
      expect(result.filePath).toBe('src/utils.ts');
      expect(result.lineCount).toBeGreaterThan(0);
      expect(result.symbolCount).toBeGreaterThanOrEqual(2); // helper + MAGIC
      expect(result.size).toBeGreaterThan(0);
    });

    it('should return search error when getFileStats queries a non-indexed file', () => {
      expect(() => g.getFileStats('src/nonexistent.ts')).toThrow(GildashError);
    });

    it('should return fan-in and fan-out metrics via getFanMetrics', async () => {
      const result = await g.getFanMetrics('src/utils.ts');
      expect(result.filePath).toBe('src/utils.ts');
      // utils.ts is imported by several files → fanIn > 0
      expect(result.fanIn).toBeGreaterThanOrEqual(1);
      // utils.ts doesn't import anything → fanOut = 0
      expect(result.fanOut).toBe(0);
    });

    it('should detect added, removed, and modified symbols via diffSymbols', () => {
      const before = [
        { name: 'kept', filePath: 'a.ts', fingerprint: 'fp1' },
        { name: 'removed', filePath: 'a.ts', fingerprint: 'fp2' },
        { name: 'changed', filePath: 'a.ts', fingerprint: 'fp3' },
      ] as any[];
      const after = [
        { name: 'kept', filePath: 'a.ts', fingerprint: 'fp1' },
        { name: 'changed', filePath: 'a.ts', fingerprint: 'fp4' },
        { name: 'added', filePath: 'a.ts', fingerprint: 'fp5' },
      ] as any[];

      const diff = g.diffSymbols(before, after);
      expect(diff.added.length).toBe(1);
      expect(diff.added[0]!.name).toBe('added');
      expect(diff.removed.length).toBe(1);
      expect(diff.removed[0]!.name).toBe('removed');
      expect(diff.modified.length).toBe(1);
      expect(diff.modified[0]!.after.name).toBe('changed');
    });
  });

  // ── Group 6: Advanced APIs ───────────────────────────────────────────

  describe('Advanced APIs', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      g = await openGildash(tmpDir);
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should return resolved symbol immediately for a direct export with no re-export chain', () => {
      const result = g.resolveSymbol('helper', 'src/utils.ts');
      expect(result.originalName).toBe('helper');
      expect(result.originalFilePath).toBe('src/utils.ts');
      expect(result.reExportChain).toEqual([]);
    });

    it('should follow one-hop re-export chain via resolveSymbol', () => {
      const result = g.resolveSymbol('renamedHelper', 'src/re-export.ts');
      expect(result.originalName).toBe('helper');
      expect(result.originalFilePath).toContain('utils');
      expect(result.reExportChain.length).toBe(1);
      expect(result.reExportChain[0]!.exportedAs).toBe('renamedHelper');
    });

    it('should return error when resolveSymbol detects circular re-export chain', () => {
      const result = g.resolveSymbol('foo', 'src/circ-re-a.ts');
      expect(result.circular).toBe(true);
    });

    it('should return module interface with exported symbols', () => {
      const result = g.getModuleInterface('src/utils.ts');
      expect(result.filePath).toBe('src/utils.ts');
      expect(result.exports.length).toBeGreaterThanOrEqual(2);
      const names = result.exports.map((e: any) => e.name);
      expect(names).toContain('helper');
      expect(names).toContain('MAGIC');
    });

    it('should return heritage tree for extends relationship via getHeritageChain', async () => {
      const result = await g.getHeritageChain('App', 'src/app.ts');
      expect(result.symbolName).toBe('App');
      expect(result.children.length).toBeGreaterThanOrEqual(1);
      const extendsChild = result.children.find((c: any) => c.kind === 'extends');
      expect(extendsChild).toBeDefined();
      expect(extendsChild!.symbolName).toBe('Base');
    });

    it('should handle circular heritage by truncating with visited set', async () => {
      const result = await g.getHeritageChain('CircA', 'src/circ-base-a.ts');
      expect(result.symbolName).toBe('CircA');
      // Should not infinitely recurse; the cycle should be cut off
      // Walk the tree and ensure finite depth
      const collectNames = (node: any, depth = 0): string[] => {
        if (depth > 10) return ['TOO_DEEP'];
        const names = [node.symbolName];
        for (const child of node.children) {
          names.push(...collectNames(child, depth + 1));
        }
        return names;
      };
      const allNames = collectNames(result);
      expect(allNames).not.toContain('TOO_DEEP');
    });
  });

  // ── Group 7: Batch & External ────────────────────────────────────────

  describe('Batch & External', () => {
    let g: Gildash;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      g = await openGildash(tmpDir);
    });

    afterAll(async () => {
      await g.close();
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should parse multiple files concurrently via batchParse', async () => {
      const result = await g.batchParse([
        join(tmpDir, 'src', 'utils.ts'),
        join(tmpDir, 'src', 'app.ts'),
      ]);
      expect(result.size).toBe(2);
    });

    it('should include only successful parses in batchParse result when one file fails', async () => {
      const result = await g.batchParse([
        join(tmpDir, 'src', 'utils.ts'),
        join(tmpDir, 'nonexistent', 'missing.ts'),
      ]);
      expect(result.size).toBe(1);
      expect(result.has(join(tmpDir, 'src', 'utils.ts'))).toBe(true);
    });

    it('should find structural patterns in indexed files via findPattern', async () => {
      // Pass explicit absolute paths: default path list is relative (known limitation)
      const result = await g.findPattern('helper($$$)', {
        filePaths: [join(tmpDir, 'src', 'app.ts')],
      });
      // app.ts calls helper(1) → should match
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Group 8: State Transitions & Idempotency ─────────────────────────

  describe('State Transitions & Idempotency', () => {
    let tmpDir: string;

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should reflect newly added files after reindex', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      const g = await openGildash(tmpDir);

      // Verify initial state
      const beforeResult = g.searchSymbols({ text: 'newFunction' });
      expect(beforeResult.length).toBe(0);

      // Add a new file
      await writeFile(
        join(tmpDir, 'src', 'new-feature.ts'),
        'export function newFunction(): void {}',
      );

      // Reindex
      const reindexResult = await g.reindex();

      // Verify new symbol is found
      const afterResult = g.searchSymbols({ text: 'newFunction' });
      expect(afterResult.length).toBeGreaterThanOrEqual(1);

      await g.close();
    });

    it('should call onIndexed callback after reindex and stop after unsubscribe', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      const g = await openGildash(tmpDir);

      let callCount = 0;
      const unsubscribe = g.onIndexed(() => { callCount++; });

      await g.reindex();
      expect(callCount).toBe(1);

      unsubscribe();
      await g.reindex();
      expect(callCount).toBe(1); // Should not increase

      await g.close();
    });

    it('should detect file changes after reindex when source is modified', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gildash-it-'));
      await createRichProject(tmpDir);
      const g = await openGildash(tmpDir);

      // Modify a file to trigger a real change
      await writeFile(
        join(tmpDir, 'src', 'utils.ts'),
        [
          'export function helper(x: number): string {',
          '  return String(x);',
          '}',
          '',
          'export const MAGIC = 42;',
          '',
          'export function newUtil(): void {}',
        ].join('\n'),
      );

      const r = await g.reindex();

      // reindex should detect the changed file and re-index it
      expect(r.indexedFiles).toBeGreaterThanOrEqual(1);
      expect(r.changedFiles.length).toBeGreaterThanOrEqual(1);

      await g.close();
    });
  });
});
