/**
 * Benchmark: Symbol search latency at various index sizes.
 *
 * Creates a project with N files, indexes them, then measures
 * search performance across multiple query patterns.
 *
 * Usage: bun run bench/search-benchmark.ts
 */
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Gildash } from '../src/gildash';

const FILE_COUNT = 1_000;
const SEARCH_ITERATIONS = 100;

async function generateProject(dir: string): Promise<void> {
  const srcDir = join(dir, 'src');
  await mkdir(srcDir, { recursive: true });

  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'search-bench-project' }),
  );

  for (let i = 0; i < FILE_COUNT; i++) {
    const content = [
      `export interface Config_${i} { key: string; value: number; }`,
      `export function handler_${i}(cfg: Config_${i}): void {}`,
      `export class Service_${i} { run(): void {} }`,
      `export const CONSTANT_${i} = ${i};`,
    ].join('\n');
    await writeFile(join(srcDir, `module_${i}.ts`), content);
  }
}

function benchSearch(g: Gildash, label: string, query: Parameters<Gildash['searchSymbols']>[0]): void {
  const times: number[] = [];
  let totalResults = 0;

  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const start = performance.now();
    const results = g.searchSymbols(query);
    times.push(performance.now() - start);
    totalResults = results.length;
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)]!;
  const p95 = times[Math.floor(times.length * 0.95)]!;
  const p99 = times[Math.floor(times.length * 0.99)]!;

  console.log(
    `  ${label.padEnd(25)} | ` +
    `p50: ${p50.toFixed(2).padStart(6)} ms | ` +
    `p95: ${p95.toFixed(2).padStart(6)} ms | ` +
    `p99: ${p99.toFixed(2).padStart(6)} ms | ` +
    `results: ${totalResults}`,
  );
}

const tmpDir = await mkdtemp(join(tmpdir(), 'gildash-bench-search-'));

try {
  await generateProject(tmpDir);

  console.log(`=== Search Benchmark (${FILE_COUNT} files, ${SEARCH_ITERATIONS} iterations) ===`);

  const g = await Gildash.open({ projectRoot: tmpDir, watchMode: false });

  benchSearch(g, 'exact name match', { text: 'handler_500' });
  benchSearch(g, 'prefix match (handler)', { text: 'handler' });
  benchSearch(g, 'kind filter (class)', { text: 'Service', kind: 'class' });
  benchSearch(g, 'prefix match (Config)', { text: 'Config' });
  benchSearch(g, 'broad match (CONSTANT)', { text: 'CONSTANT' });

  await g.close({ cleanup: true });
  console.log('Done.');
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
