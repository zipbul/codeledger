/**
 * Benchmark: Real open-source project indexing & query performance.
 *
 * Clones three TypeScript projects of varying scale, indexes them
 * with Gildash, and measures indexing time, memory, search latency,
 * and graph operation performance.
 *
 * Projects:
 *   - Small:  Zod (v3)       (~80 TS files)
 *   - Medium: Valibot        (~300 TS files)
 *   - Large:  TypeScript     (~2,000+ TS files)
 *
 * Usage: bun run bench/oss-benchmark.ts
 */
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { Gildash } from '../src/gildash';

// ── Config ──────────────────────────────────────────────────────────────────

interface OSSProject {
  name: string;
  repo: string;
  /** Subdirectory to index (relative to clone root). Defaults to '.' */
  subdir?: string;
  /** Git tag to checkout after cloning (optional) */
  tag?: string;
}

const PROJECTS: OSSProject[] = [
  {
    name: 'Zod (v3)',
    repo: 'https://github.com/colinhacks/zod.git',
    /** v3.x had all source in src/ as plain .ts files */
    tag: 'v3.24.4',
  },
  {
    name: 'Valibot',
    repo: 'https://github.com/fabian-hiller/valibot.git',
    subdir: 'library',
  },
  {
    name: 'TypeScript',
    repo: 'https://github.com/microsoft/TypeScript.git',
  },
];

const SEARCH_ITERATIONS = 50;
const GRAPH_ITERATIONS = 20;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatMs(ms: number): string {
  return ms < 1_000 ? `${ms.toFixed(0)}ms` : `${(ms / 1_000).toFixed(2)}s`;
}

function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}

function p95(sorted: number[]): number {
  return sorted[Math.floor(sorted.length * 0.95)]!;
}

function cloneRepo(project: OSSProject, dest: string): void {
  const branchOpt = project.tag ? `--branch ${project.tag}` : '';
  execSync(`git clone --depth 1 --single-branch ${branchOpt} ${project.repo} "${dest}"`, {
    stdio: 'pipe',
    timeout: 120_000,
  });
}

// ── Benchmark runner ────────────────────────────────────────────────────────

async function benchProject(project: OSSProject): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'gildash-oss-bench-'));
  const cloneDir = join(tmpDir, 'repo');

  console.log(`\n--- ${project.name} ---`);
  console.log(`  Cloning ${project.repo} ...`);

  try {
    cloneRepo(project, cloneDir);
  } catch (err) {
    console.log(`  SKIP: clone failed — ${(err as Error).message}`);
    await rm(tmpDir, { recursive: true, force: true });
    return;
  }

  const projectRoot = project.subdir ? join(cloneDir, project.subdir) : cloneDir;

  try {
    // ── Indexing ───────────────────────────────────────────────────────

    const heapBefore = process.memoryUsage().heapUsed;
    const indexStart = performance.now();

    const g = await Gildash.open({ projectRoot, watchMode: false });

    const indexElapsed = performance.now() - indexStart;
    const heapAfter = process.memoryUsage().heapUsed;
    const stats = g.getStats();

    console.log(`  Indexing: ${formatMs(indexElapsed)}`);
    console.log(`  Files: ${stats.fileCount}  |  Symbols: ${stats.symbolCount}`);
    console.log(`  Heap: ${formatBytes(heapAfter)} (delta: ${formatBytes(heapAfter - heapBefore)})`);

    // ── Search ────────────────────────────────────────────────────────

    const searchQueries = ['export', 'Config', 'handler', 'index', 'Error'];
    console.log(`  Search (${SEARCH_ITERATIONS} iterations):`);

    for (const query of searchQueries) {
      const times: number[] = [];
      let resultCount = 0;

      for (let i = 0; i < SEARCH_ITERATIONS; i++) {
        const start = performance.now();
        const results = g.searchSymbols({ text: query });
        times.push(performance.now() - start);
        resultCount = results.length;
      }

      times.sort((a, b) => a - b);
      console.log(
        `    ${query.padEnd(12)} | ` +
        `p50: ${median(times).toFixed(2).padStart(6)}ms | ` +
        `p95: ${p95(times).toFixed(2).padStart(6)}ms | ` +
        `results: ${resultCount}`,
      );
    }

    // ── Graph ─────────────────────────────────────────────────────────

    console.log(`  Graph operations (${GRAPH_ITERATIONS} iterations):`);

    // hasCycle
    {
      const times: number[] = [];
      let result: boolean = false;
      for (let i = 0; i < GRAPH_ITERATIONS; i++) {
        const start = performance.now();
        result = await g.hasCycle();
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      console.log(
        `    ${'hasCycle'.padEnd(25)} | ` +
        `p50: ${median(times).toFixed(2).padStart(6)}ms | ` +
        `p95: ${p95(times).toFixed(2).padStart(6)}ms | ` +
        `result: ${result}`,
      );
    }

    // getImportGraph
    {
      const times: number[] = [];
      let nodeCount = 0;
      for (let i = 0; i < GRAPH_ITERATIONS; i++) {
        const start = performance.now();
        const graph = await g.getImportGraph();
        times.push(performance.now() - start);
        nodeCount = graph.size;
      }
      times.sort((a, b) => a - b);
      console.log(
        `    ${'getImportGraph'.padEnd(25)} | ` +
        `p50: ${median(times).toFixed(2).padStart(6)}ms | ` +
        `p95: ${p95(times).toFixed(2).padStart(6)}ms | ` +
        `nodes: ${nodeCount}`,
      );
    }

    // getAffected — pick a file from the middle of the indexed list
    {
      const indexedFiles = g.listIndexedFiles();
      if (indexedFiles.length > 0) {
        const midFile = indexedFiles[Math.floor(indexedFiles.length / 2)]!;
        const times: number[] = [];
        let affectedCount = 0;
        for (let i = 0; i < GRAPH_ITERATIONS; i++) {
          const start = performance.now();
          const affected = await g.getAffected([midFile.filePath]);
          times.push(performance.now() - start);
          affectedCount = affected.length;
        }
        times.sort((a, b) => a - b);
        console.log(
          `    ${'getAffected (mid file)'.padEnd(25)} | ` +
          `p50: ${median(times).toFixed(2).padStart(6)}ms | ` +
          `p95: ${p95(times).toFixed(2).padStart(6)}ms | ` +
          `affected: ${affectedCount}`,
        );
      }
    }

    await g.close({ cleanup: true });
  } catch (err) {
    console.log(`  ERROR: ${(err as Error).message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log('=== Open-Source Project Benchmark ===');
console.log(`Date: ${new Date().toISOString()}`);
console.log(`Runtime: Bun ${Bun.version}`);

for (const project of PROJECTS) {
  await benchProject(project);
}

console.log('\nDone.');
