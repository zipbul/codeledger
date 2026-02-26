/**
 * Benchmark: Dependency graph build and query performance.
 *
 * Creates a project with a known graph topology, indexes it,
 * then measures graph build and various query operations.
 *
 * Usage: bun run bench/graph-benchmark.ts
 */
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Gildash } from '../src/gildash';

const FILE_COUNT = 1_000;
const QUERY_ITERATIONS = 50;

async function generateProject(dir: string): Promise<void> {
  const srcDir = join(dir, 'src');
  await mkdir(srcDir, { recursive: true });

  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'graph-bench-project' }),
  );

  // Create a chain topology: file_0 ← file_1 ← file_2 ← ... ← file_N
  // Plus some cross-links for complexity
  for (let i = 0; i < FILE_COUNT; i++) {
    const lines: string[] = [];

    // Chain import
    if (i > 0) {
      lines.push(`import { value_${i - 1} } from './file_${i - 1}';`);
    }

    // Cross-link: every 10th file imports from file at i-5 (if available)
    if (i % 10 === 0 && i >= 5) {
      lines.push(`import { value_${i - 5} } from './file_${i - 5}';`);
    }

    lines.push(`export const value_${i} = ${i};`);
    await writeFile(join(srcDir, `file_${i}.ts`), lines.join('\n') + '\n');
  }
}

function benchFn(label: string, fn: () => unknown): void {
  const times: number[] = [];
  let result: unknown;

  for (let i = 0; i < QUERY_ITERATIONS; i++) {
    const start = performance.now();
    result = fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)]!;
  const p95 = times[Math.floor(times.length * 0.95)]!;

  const resultStr = Array.isArray(result)
    ? `${result.length} items`
    : typeof result === 'boolean'
      ? String(result)
      : typeof result === 'object' && result instanceof Map
        ? `${result.size} entries`
        : String(result);

  console.log(
    `  ${label.padEnd(35)} | ` +
    `p50: ${p50.toFixed(2).padStart(8)} ms | ` +
    `p95: ${p95.toFixed(2).padStart(8)} ms | ` +
    `result: ${resultStr}`,
  );
}

async function benchAsync(label: string, fn: () => Promise<unknown>): Promise<void> {
  const times: number[] = [];
  let result: unknown;

  for (let i = 0; i < QUERY_ITERATIONS; i++) {
    const start = performance.now();
    result = await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)]!;
  const p95 = times[Math.floor(times.length * 0.95)]!;

  const resultStr = Array.isArray(result)
    ? `${result.length} items`
    : typeof result === 'boolean'
      ? String(result)
      : typeof result === 'object' && result instanceof Map
        ? `${result.size} entries`
        : String(result);

  console.log(
    `  ${label.padEnd(35)} | ` +
    `p50: ${p50.toFixed(2).padStart(8)} ms | ` +
    `p95: ${p95.toFixed(2).padStart(8)} ms | ` +
    `result: ${resultStr}`,
  );
}

const tmpDir = await mkdtemp(join(tmpdir(), 'gildash-bench-graph-'));

try {
  await generateProject(tmpDir);

  console.log(`=== Graph Benchmark (${FILE_COUNT} files, ${QUERY_ITERATIONS} iterations) ===`);

  const g = await Gildash.open({ projectRoot: tmpDir, watchMode: false });

  // Graph operations (first call builds the cache, subsequent calls use it)
  await benchAsync('hasCycle (cold build)', () => g.hasCycle());
  await benchAsync('hasCycle (cached)', () => g.hasCycle());
  await benchAsync('getImportGraph', () => g.getImportGraph());

  // Query operations — use indexed paths to avoid absolute/relative mismatch
  const files = g.listIndexedFiles();
  const midFile = files.find(f => f.filePath.endsWith(`file_${Math.floor(FILE_COUNT / 2)}.ts`))!;
  const leafFile = files.find(f => f.filePath.endsWith(`file_${FILE_COUNT - 1}.ts`))!;
  const rootFile = files.find(f => f.filePath.endsWith('file_0.ts'))!;

  benchFn('getDependencies (mid)', () => g.getDependencies(midFile.filePath));
  benchFn('getDependents (mid)', () => g.getDependents(midFile.filePath));
  await benchAsync('getTransitiveDeps (mid)', () => g.getTransitiveDependencies(midFile.filePath));
  await benchAsync('getAffected (root)', () => g.getAffected([rootFile.filePath]));
  await benchAsync('getFanMetrics (mid)', () => g.getFanMetrics(midFile.filePath));

  await g.close({ cleanup: true });
  console.log('Done.');
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
