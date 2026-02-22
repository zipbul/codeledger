import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { isErr } from '@zipbul/result';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash } from '../src/gildash';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gildash-integration-'));
  await mkdir(join(tmpDir, 'src'), { recursive: true });
  await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
  await writeFile(join(tmpDir, 'src', 'index.ts'), 'export const x = 1;');
  jest.useFakeTimers();
});

afterEach(async () => {
  jest.useRealTimers();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('Gildash integration', () => {
  it('should open successfully with default repositoryFactory when only projectRoot is given', async () => {
    const watcher = {
      start: mock(async (cb: any) => {}),
      close: mock(async () => {}),
    };
    const coordinator = {
      fullIndex: mock(async () => ({
        indexedFiles: 0, removedFiles: 0,
        totalSymbols: 0, totalRelations: 0,
        durationMs: 0, changedFiles: [], deletedFiles: [],
      })),
      shutdown: mock(async () => {}),
      onIndexed: mock((cb: any) => (() => {})),
      handleWatcherEvent: mock(() => {}),
    };

    const result = await Gildash.open({
      projectRoot: tmpDir,
      extensions: ['.ts'],
      watcherFactory: () => watcher,
      coordinatorFactory: () => coordinator as any,
      acquireWatcherRoleFn: mock(async () => 'owner' as const) as any,
      releaseWatcherRoleFn: mock(() => {}) as any,
      updateHeartbeatFn: mock(() => {}) as any,
      discoverProjectsFn: mock(async () => [{ dir: '.', project: 'test-project' }]) as any,
      loadTsconfigPathsFn: mock(async () => null) as any,
      parseSourceFn: mock((fp: string, text: string) => ({
        filePath: fp, program: { body: [] }, errors: [], comments: [], sourceText: text,
      })) as any,
      extractSymbolsFn: mock(() => []) as any,
      extractRelationsFn: mock(() => []) as any,
      symbolSearchFn: mock(() => []) as any,
      relationSearchFn: mock(() => []) as any,
    } as any);
    if (isErr(result)) throw result.data;

    expect(result).toBeInstanceOf(Gildash);
    await result.close();
  });
});
