import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(120_000);
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Gildash } from '../src/gildash';
import type { IndexResult } from '../src/indexer/index-coordinator';

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

  it('should search relations with srcFilePathPattern at scale', () => {
    const start = performance.now();

    // Pattern-match import relations from generated files
    const results = gildash.searchRelations({
      type: 'imports',
      srcFilePathPattern: '**/module_1*.ts',
      limit: FILES_WITH_IMPORTS,
    });

    const elapsed = performance.now() - start;
    console.log(`[stress] searchRelations(srcFilePathPattern) returned ${results.length} results in ${formatMs(elapsed)}`);

    // module_1, module_10..module_19, module_100..module_199, module_1000..module_1999
    // all import from the module before them in the chain (if index < FILES_WITH_IMPORTS)
    expect(results.length).toBeGreaterThan(0);

    // Every returned relation should be an 'imports' type
    for (const r of results) {
      expect(r.type).toBe('imports');
      expect(r.srcFilePath).toContain('module_1');
    }
  });

  it('should handle reindex with before/after snapshots at scale', async () => {
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    // reindex on unchanged files: before-snapshot covers all files in DB,
    // after-snapshot covers only changed files (none here)
    const result = await gildash.reindex();

    const elapsed = performance.now() - start;
    const heapAfter = process.memoryUsage().heapUsed;

    console.log(`[stress] reindex() completed in ${formatMs(elapsed)}`);
    console.log(`[stress] reindex() result: ${result.indexedFiles} indexed, ` +
      `${result.changedFiles.length} changed, ${result.deletedFiles.length} deleted`);
    console.log(`[stress] Heap during reindex: ${formatBytes(heapAfter)} (delta: ${formatBytes(heapAfter - heapBefore)})`);

    // No files changed on disk → 0 files were re-indexed
    expect(result.changedFiles).toHaveLength(0);
    expect(result.deletedFiles).toHaveLength(0);
    expect(result.failedFiles).toHaveLength(0);

    // renamedSymbols and movedSymbols should always be empty on fullIndex
    expect(result.renamedSymbols).toHaveLength(0);
    expect(result.movedSymbols).toHaveLength(0);

    // Verify IndexResult structure is complete (all required fields present)
    expect(typeof result.indexedFiles).toBe('number');
    expect(typeof result.removedFiles).toBe('number');
    expect(typeof result.totalSymbols).toBe('number');
    expect(typeof result.totalRelations).toBe('number');
    expect(typeof result.totalAnnotations).toBe('number');
    expect(typeof result.durationMs).toBe('number');
    expect(Array.isArray(result.changedSymbols.added)).toBe(true);
    expect(Array.isArray(result.changedSymbols.modified)).toBe(true);
    expect(Array.isArray(result.changedSymbols.removed)).toBe(true);
    expect(Array.isArray(result.changedRelations.added)).toBe(true);
    expect(Array.isArray(result.changedRelations.removed)).toBe(true);
    expect(Array.isArray(result.renamedSymbols)).toBe(true);
    expect(Array.isArray(result.movedSymbols)).toBe(true);
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

// ── IndexResult from fresh fullIndex ────────────────────────────────────────

describe('stress: IndexResult from fresh fullIndex', () => {
  const FRESH_FILE_COUNT = 200;
  const FRESH_FILES_WITH_IMPORTS = 50;

  let freshTmpDir: string;
  let freshGildash: Gildash;
  let indexResult: IndexResult;

  beforeAll(async () => {
    freshTmpDir = await mkdtemp(join(tmpdir(), 'gildash-stress-fresh-'));
    const srcDir = join(freshTmpDir, 'src');
    await mkdir(srcDir, { recursive: true });

    await writeFile(
      join(freshTmpDir, 'package.json'),
      JSON.stringify({ name: 'stress-fresh-test' }),
    );

    // Generate files using the same structure as the main stress fixture
    const writePromises: Promise<void>[] = [];
    for (let i = 0; i < FRESH_FILE_COUNT; i++) {
      const fileName = `gen_${i}.ts`;
      let content: string;

      if (i < FRESH_FILES_WITH_IMPORTS && i > 0) {
        const depIndex = i - 1;
        content = [
          `import { val_${depIndex} } from './gen_${depIndex}';`,
          '',
          `/** @deprecated Use val_${i}_v2 instead */`,
          `export const val_${i} = val_${depIndex} + ${i};`,
        ].join('\n');
      } else {
        content = `export const val_${i} = ${i};\n`;
      }

      writePromises.push(writeFile(join(srcDir, fileName), content));
    }
    await Promise.all(writePromises);

    // First open: indexes everything into the DB
    freshGildash = await Gildash.open({ projectRoot: freshTmpDir, watchMode: false });

    // Delete all source files so reindex sees them as removed
    const deletePromises: Promise<void>[] = [];
    for (let i = 0; i < FRESH_FILE_COUNT; i++) {
      deletePromises.push(unlink(join(srcDir, `gen_${i}.ts`)));
    }
    await Promise.all(deletePromises);
    await freshGildash.reindex();

    // Recreate all source files (same content as before)
    const recreatePromises: Promise<void>[] = [];
    for (let i = 0; i < FRESH_FILE_COUNT; i++) {
      const fileName = `gen_${i}.ts`;
      let content: string;

      if (i < FRESH_FILES_WITH_IMPORTS && i > 0) {
        const depIndex = i - 1;
        content = [
          `import { val_${depIndex} } from './gen_${depIndex}';`,
          '',
          `/** @deprecated Use val_${i}_v2 instead */`,
          `export const val_${i} = val_${depIndex} + ${i};`,
        ].join('\n');
      } else {
        content = `export const val_${i} = ${i};\n`;
      }

      recreatePromises.push(writeFile(join(srcDir, fileName), content));
    }
    await Promise.all(recreatePromises);

    // Reindex: DB is empty (all removed), files are back → everything appears as "added"
    indexResult = await freshGildash.reindex();

    console.log(`[stress-fresh] IndexResult: ${indexResult.indexedFiles} indexed, ` +
      `${indexResult.changedSymbols.added.length} symbols added, ` +
      `${indexResult.changedRelations.added.length} relations added`);
  });

  afterAll(async () => {
    if (freshGildash) {
      await freshGildash.close({ cleanup: true });
    }
    if (freshTmpDir) {
      await rm(freshTmpDir, { recursive: true, force: true });
    }
  });

  it('should report all relations as added on fresh fullIndex', () => {
    // Files 1..FRESH_FILES_WITH_IMPORTS-1 each import from the previous file
    const expectedRelations = FRESH_FILES_WITH_IMPORTS - 1;
    expect(indexResult.changedRelations.added.length).toBe(expectedRelations);
    expect(indexResult.changedRelations.removed).toHaveLength(0);

    // Every added relation should be an 'imports' type from the chain
    for (const rel of indexResult.changedRelations.added) {
      expect(rel.type).toBe('imports');
      expect(rel.srcFilePath).toContain('gen_');
      expect(rel.dstFilePath).toContain('gen_');
    }
  });

  it('should report all symbols as added with correct isExported property', () => {
    // Every file exports exactly one symbol
    expect(indexResult.changedSymbols.added.length).toBe(FRESH_FILE_COUNT);
    expect(indexResult.changedSymbols.removed).toHaveLength(0);
    expect(indexResult.changedSymbols.modified).toHaveLength(0);

    // All added symbols must have isExported as a boolean
    for (const sym of indexResult.changedSymbols.added) {
      expect(typeof sym.isExported).toBe('boolean');
    }

    // All symbols in this fixture are exported
    const exported = indexResult.changedSymbols.added.filter(s => s.isExported);
    const notExported = indexResult.changedSymbols.added.filter(s => !s.isExported);
    expect(exported.length).toBe(FRESH_FILE_COUNT);
    expect(notExported.length).toBe(0);
  });

  it('should report empty renamedSymbols and movedSymbols on fullIndex', () => {
    // Rename and move detection is incremental only; fullIndex should report none
    expect(indexResult.renamedSymbols).toBeArrayOfSize(0);
    expect(indexResult.movedSymbols).toBeArrayOfSize(0);
  });

  it('should search relations with srcFilePathPattern across generated files', () => {
    const results = freshGildash.searchRelations({
      type: 'imports',
      srcFilePathPattern: '**/gen_*',
      limit: FRESH_FILE_COUNT,
    });

    // Every file in the import chain (1..FRESH_FILES_WITH_IMPORTS-1) has one import relation
    expect(results.length).toBe(FRESH_FILES_WITH_IMPORTS - 1);
    for (const r of results) {
      expect(r.type).toBe('imports');
      expect(r.srcFilePath).toContain('gen_');
    }
  });

  it('should keep relation snapshots within memory budget', () => {
    const mem = process.memoryUsage();
    console.log('[stress-fresh] ── Memory After IndexResult ──');
    console.log(`[stress-fresh]   heapUsed:  ${formatBytes(mem.heapUsed)}`);

    // Per-file memory budget: < 0.5 MB per indexed file (same as main stress test)
    const perFileHeapMb = mem.heapUsed / 1024 / 1024 / FRESH_FILE_COUNT;
    expect(perFileHeapMb).toBeLessThan(0.5);
  });
});
