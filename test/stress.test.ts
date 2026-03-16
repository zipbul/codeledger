import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(120_000);
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Gildash } from '../src/gildash';

// ── Constants ───────────────────────────────────────────────────────────────

const FILE_COUNT = 10_000;
const FILES_WITH_IMPORTS = 2_000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  return ms < 1_000 ? `${ms.toFixed(0)}ms` : `${(ms / 1_000).toFixed(2)}s`;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('stress: large-scale indexing', () => {
  let tmpDir: string;
  let gildash: Gildash;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'gildash-stress-'));
    const srcDir = join(tmpDir, 'src');
    await mkdir(srcDir, { recursive: true });

    // package.json so project discovery finds a boundary
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'stress-test-project' }),
    );

    // ── Generate synthetic TypeScript files ──────────────────────────

    const heapBefore = process.memoryUsage().heapUsed;
    const genStart = performance.now();

    const writePromises: Promise<void>[] = [];

    for (let i = 0; i < FILE_COUNT; i++) {
      const fileName = `module_${i}.ts`;
      let content: string;

      if (i < FILES_WITH_IMPORTS && i > 0) {
        // Files 1..FILES_WITH_IMPORTS-1 import from the file before them,
        // forming a linear dependency chain: module_1 -> module_0, module_2 -> module_1, etc.
        const depIndex = i - 1;
        content = [
          `import { value_${depIndex} } from './module_${depIndex}';`,
          '',
          `/** @deprecated Use value_${i}_v2 instead */`,
          `export const value_${i} = value_${depIndex} + ${i};`,
        ].join('\n');
      } else {
        // Standalone files (no imports) — every 100th file gets a @todo annotation
        const annotation = i % 100 === 0 ? `// @todo refactor module_${i}\n` : '';
        content = `${annotation}export const value_${i} = ${i};\n`;
      }

      writePromises.push(writeFile(join(srcDir, fileName), content));
    }

    await Promise.all(writePromises);

    const genElapsed = performance.now() - genStart;
    const heapAfterGen = process.memoryUsage().heapUsed;

    console.log(`[stress] Generated ${FILE_COUNT} files in ${formatMs(genElapsed)}`);
    console.log(`[stress] Heap after file generation: ${formatBytes(heapAfterGen)} (delta: ${formatBytes(heapAfterGen - heapBefore)})`);

    // ── Index via Gildash.open() ─────────────────────────────────────

    const indexStart = performance.now();

    gildash = await Gildash.open({
      projectRoot: tmpDir,
      watchMode: false,
    });

    const indexElapsed = performance.now() - indexStart;
    const heapAfterIndex = process.memoryUsage().heapUsed;

    console.log(`[stress] Indexed ${FILE_COUNT} files in ${formatMs(indexElapsed)}`);
    console.log(`[stress] Heap after indexing: ${formatBytes(heapAfterIndex)} (delta from gen: ${formatBytes(heapAfterIndex - heapAfterGen)})`);
  });

  afterAll(async () => {
    if (gildash) {
      await gildash.close({ cleanup: true });
    }
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('should report correct file count in stats', () => {
    const stats = gildash.getStats();
    expect(stats.fileCount).toBe(FILE_COUNT);
  });

  it('should report exactly one symbol per file', () => {
    const stats = gildash.getStats();
    // Each file exports exactly one symbol (value_N)
    expect(stats.symbolCount).toBe(FILE_COUNT);
  });

  it('should detect no cycles in the linear dependency chain', async () => {
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    const cycleDetected = await gildash.hasCycle();

    const elapsed = performance.now() - start;
    const heapAfter = process.memoryUsage().heapUsed;

    console.log(`[stress] hasCycle() completed in ${formatMs(elapsed)}`);
    console.log(`[stress] Heap during hasCycle: ${formatBytes(heapAfter)} (delta: ${formatBytes(heapAfter - heapBefore)})`);

    expect(cycleDetected).toBe(false);
  });

  it('should compute affected files from a change at the start of the chain', async () => {
    // Use the path format from listIndexedFiles to ensure correct matching
    const files = gildash.listIndexedFiles();
    const module0 = files.find(f => f.filePath.endsWith('module_0.ts'))!;
    expect(module0).toBeDefined();

    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    const affected = await gildash.getAffected([module0.filePath]);

    const elapsed = performance.now() - start;
    const heapAfter = process.memoryUsage().heapUsed;

    console.log(`[stress] getAffected([module_0]) returned ${affected.length} files in ${formatMs(elapsed)}`);
    console.log(`[stress] Heap during getAffected: ${formatBytes(heapAfter)} (delta: ${formatBytes(heapAfter - heapBefore)})`);

    // module_0 itself is changed; modules 1..FILES_WITH_IMPORTS-1 are downstream dependents
    expect(affected.length).toBeGreaterThanOrEqual(FILES_WITH_IMPORTS - 1);
  });

  it('should compute affected files from a change in the middle of the chain', async () => {
    const midpoint = Math.floor(FILES_WITH_IMPORTS / 2);
    const files = gildash.listIndexedFiles();
    const moduleN = files.find(f => f.filePath.endsWith(`module_${midpoint}.ts`))!;
    expect(moduleN).toBeDefined();

    const affected = await gildash.getAffected([moduleN.filePath]);

    // Everything downstream of midpoint in the chain
    const expectedMinAffected = FILES_WITH_IMPORTS - midpoint - 1;
    expect(affected.length).toBeGreaterThanOrEqual(expectedMinAffected);
  });

  it('should return an empty affected set for a standalone file', async () => {
    // Files beyond FILES_WITH_IMPORTS have no dependents
    const files = gildash.listIndexedFiles();
    const standalone = files.find(f => f.filePath.endsWith(`module_${FILE_COUNT - 1}.ts`))!;
    expect(standalone).toBeDefined();

    const affected = await gildash.getAffected([standalone.filePath]);

    // The changed file itself may or may not be included; no downstream dependents exist
    expect(affected.length).toBeLessThanOrEqual(1);
  });

  it('should list all indexed files', () => {
    const files = gildash.listIndexedFiles();
    expect(files.length).toBe(FILE_COUNT);
  });

  it('should find symbols by prefix search', () => {
    const results = gildash.searchSymbols({ text: 'value_0' });
    // Should find at least value_0 (exact match)
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.name === 'value_0')).toBe(true);
  });

  it('should return dependencies for a file in the import chain', () => {
    const files = gildash.listIndexedFiles();
    const module1 = files.find(f => f.filePath.endsWith('module_1.ts'))!;
    expect(module1).toBeDefined();

    const deps = gildash.getDependencies(module1.filePath);
    // module_1 imports from module_0
    expect(deps.length).toBe(1);
    expect(deps[0]).toContain('module_0.ts');
  });

  it('should return dependents for the root of the chain', () => {
    const files = gildash.listIndexedFiles();
    const module0 = files.find(f => f.filePath.endsWith('module_0.ts'))!;
    expect(module0).toBeDefined();

    const dependents = gildash.getDependents(module0.filePath);
    // module_0 is imported by module_1
    expect(dependents.length).toBeGreaterThanOrEqual(1);
  });

  it('should index annotations across all files', () => {
    const start = performance.now();

    const deprecated = gildash.searchAnnotations({ tag: 'deprecated', limit: FILES_WITH_IMPORTS });
    const todos = gildash.searchAnnotations({ tag: 'todo', limit: FILE_COUNT });

    const elapsed = performance.now() - start;
    console.log(`[stress] searchAnnotations completed in ${formatMs(elapsed)}`);
    console.log(`[stress]   @deprecated: ${deprecated.length}, @todo: ${todos.length}`);

    // Files 1..FILES_WITH_IMPORTS-1 each have one @deprecated annotation
    expect(deprecated.length).toBe(FILES_WITH_IMPORTS - 1);
    // Every 100th standalone file (0, 2000, 2100, ...) has a @todo — count: floor((FILE_COUNT - FILES_WITH_IMPORTS) / 100) + 1 for index 0
    const standaloneWithTodo = Math.floor((FILE_COUNT - FILES_WITH_IMPORTS) / 100) + 1; // +1 for module_0
    expect(todos.length).toBe(standaloneWithTodo);

    // Verify symbol linking
    for (const d of deprecated.slice(0, 10)) {
      expect(d.symbolName).not.toBeNull();
      expect(d.source).toBe('jsdoc');
    }
  });

  it('should support FTS search across annotations', () => {
    const start = performance.now();
    const results = gildash.searchAnnotations({ text: 'refactor', limit: FILE_COUNT });
    const elapsed = performance.now() - start;
    console.log(`[stress] FTS "refactor" found ${results.length} annotations in ${formatMs(elapsed)}`);

    // @todo annotations contain "refactor module_N"
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.tag).toBe('todo');
      expect(r.value).toContain('refactor');
    }
  });

  it('should record changelog entries for all symbols after fullIndex', () => {
    const start = performance.now();
    const changes = gildash.getSymbolChanges(new Date(0), { includeFullIndex: true, limit: FILE_COUNT + 100 });
    const elapsed = performance.now() - start;
    console.log(`[stress] getSymbolChanges returned ${changes.length} entries in ${formatMs(elapsed)}`);

    // Every file has at least one symbol (value_N), all should be 'added' on first index
    expect(changes.length).toBe(FILE_COUNT);
    const addedCount = changes.filter(c => c.changeType === 'added').length;
    expect(addedCount).toBe(FILE_COUNT);

    // All should be marked as fullIndex
    for (const c of changes) {
      expect(c.isFullIndex).toBe(true);
    }
  });

  it('should prune changelog entries efficiently', () => {
    const start = performance.now();
    // Prune with future date to remove everything
    const pruned = gildash.pruneChangelog(new Date('2099-01-01'));
    const elapsed = performance.now() - start;
    console.log(`[stress] pruneChangelog removed ${pruned} entries in ${formatMs(elapsed)}`);

    expect(pruned).toBe(FILE_COUNT);

    // Verify empty
    const remaining = gildash.getSymbolChanges(new Date(0), { includeFullIndex: true });
    expect(remaining.length).toBe(0);
  });

  it('should stay within memory budget', () => {
    const mem = process.memoryUsage();
    console.log('[stress] ── Final Memory Summary ──');
    console.log(`[stress]   heapUsed:  ${formatBytes(mem.heapUsed)}`);
    console.log(`[stress]   heapTotal: ${formatBytes(mem.heapTotal)}`);
    console.log(`[stress]   rss:       ${formatBytes(mem.rss)}`);
    console.log(`[stress]   external:  ${formatBytes(mem.external)}`);

    // Per-file memory budget: < 0.5 MB per indexed file
    const perFileHeapMb = mem.heapUsed / 1024 / 1024 / FILE_COUNT;
    expect(perFileHeapMb).toBeLessThan(0.5);

    // Absolute cap: heap should not exceed 1 GB for 10k files
    expect(mem.heapUsed).toBeLessThan(1024 * 1024 * 1024);
  });
});
