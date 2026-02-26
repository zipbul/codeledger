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
          `export const value_${i} = value_${depIndex} + ${i};`,
        ].join('\n');
      } else {
        // Standalone files (no imports)
        content = `export const value_${i} = ${i};\n`;
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

  it('should report a positive symbol count', () => {
    const stats = gildash.getStats();
    // Every file exports at least one symbol
    expect(stats.symbolCount).toBeGreaterThanOrEqual(FILE_COUNT);
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

  it('should log final memory usage summary', () => {
    const mem = process.memoryUsage();
    console.log('[stress] ── Final Memory Summary ──');
    console.log(`[stress]   heapUsed:  ${formatBytes(mem.heapUsed)}`);
    console.log(`[stress]   heapTotal: ${formatBytes(mem.heapTotal)}`);
    console.log(`[stress]   rss:       ${formatBytes(mem.rss)}`);
    console.log(`[stress]   external:  ${formatBytes(mem.external)}`);

    // Sanity check: heap should not exceed 2 GB
    expect(mem.heapUsed).toBeLessThan(2 * 1024 * 1024 * 1024);
  });
});
