/**
 * Benchmark: Indexing performance at various file counts.
 *
 * Measures wall-clock time and memory usage for full indexing
 * at 100, 500, 1000, and 2000 file scales.
 *
 * Usage: bun run bench/index-benchmark.ts
 */
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Gildash } from '../src/gildash';

const FILE_COUNTS = [100, 500, 1_000, 2_000];

async function generateProject(dir: string, fileCount: number): Promise<void> {
  const srcDir = join(dir, 'src');
  await mkdir(srcDir, { recursive: true });

  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'index-bench-project' }),
  );

  for (let i = 0; i < fileCount; i++) {
    const imports = i > 0 ? `import { value_${i - 1} } from './file_${i - 1}';\n` : '';
    const content = `${imports}export const value_${i} = ${i};\nexport function fn_${i}(x: number): number { return x + ${i}; }\n`;
    await writeFile(join(srcDir, `file_${i}.ts`), content);
  }
}

async function runBenchmark(fileCount: number): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'gildash-bench-idx-'));

  try {
    await generateProject(tmpDir, fileCount);

    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    const g = await Gildash.open({ projectRoot: tmpDir, watchMode: false });
    const stats = g.getStats();

    const elapsed = performance.now() - start;
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = ((heapAfter - heapBefore) / 1024 / 1024).toFixed(1);

    console.log(
      `  ${String(fileCount).padStart(5)} files | ` +
      `${elapsed.toFixed(0).padStart(6)} ms | ` +
      `${String(stats.symbolCount).padStart(6)} symbols | ` +
      `heap +${heapDeltaMb} MB`,
    );

    await g.close({ cleanup: true });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

console.log('=== Index Benchmark ===');
console.log('  Files |   Time |  Symbols | Heap Delta');
console.log('  ------|--------|----------|----------');

for (const count of FILE_COUNTS) {
  await runBenchmark(count);
}

console.log('Done.');
