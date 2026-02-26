import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

const mockGlob = mock(async function* (): AsyncGenerator<string> {});

const mockHashString = mock((input: string) => 'mocked-hash');

import { detectChanges } from './file-indexer';

const PROJECT_ROOT = '/project';
const EXTENSIONS = ['.ts'];
const IGNORE_PATTERNS = ['**/node_modules/**'];

function makeFileRepo(filesMap: Map<string, any> = new Map()) {
  return {
    getFilesMap: mock(() => filesMap),
    upsertFile: mock(() => {}),
  };
}

function makeBunFile(opts: { size: number; lastModified: number; text?: string }) {
  return {
    size: opts.size,
    lastModified: opts.lastModified,
    text: mock(async () => opts.text ?? 'content'),
  } as any;
}

describe('detectChanges', () => {
  beforeEach(() => {
    mock.module('node:fs', () => ({
      promises: { glob: mockGlob },
    }));
    mock.module('../common/hasher', () => ({
      hashString: mockHashString,
    }));
    mockGlob.mockReset();
    mockHashString.mockReset();
    mockHashString.mockReturnValue('mocked-hash');
    spyOn(Bun, 'file').mockRestore();
  });

  afterEach(() => {
    spyOn(Bun, 'file').mockRestore();
  });
  it('should put new file in changed[] when it does not exist in DB', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 1000 }));
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'src/index.ts')).toBe(true);
  });

  it('should put file in unchanged[] when mtime and size match DB record', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 1000 }));
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.unchanged.some((f) => f.filePath === 'src/index.ts')).toBe(true);
    expect(result.changed).toEqual([]);
  });

  it('should put file in changed[] when mtime changed and contentHash differs', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 9999, text: 'new content' }));
    mockHashString.mockReturnValue('new-hash');
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'old-hash' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'src/index.ts')).toBe(true);
  });

  it('should put file in unchanged[] when mtime changed but contentHash is same', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 9999, text: 'same content' }));
    mockHashString.mockReturnValue('same-hash');
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'same-hash' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.unchanged.some((f) => f.filePath === 'src/index.ts')).toBe(true);
    expect(result.changed).toEqual([]);
  });

  it('should put file in deleted[] when it exists in DB but not on disk', async () => {
    mockGlob.mockImplementation(async function* () {});
    const existing = new Map([['src/gone.ts', { filePath: 'src/gone.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.deleted).toContain('src/gone.ts');
  });

  it('should return all empty arrays when directory has no matching files and DB is empty', async () => {
    mockGlob.mockImplementation(async function* () {});
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('should compute contentHash when files are newly discovered', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/new.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    mockHashString.mockReturnValue('computed-hash');
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed[0]?.contentHash).toBe('computed-hash');
  });

  it('should not call hashString when mtime and size are unchanged', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 1000 }));
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(mockHashString).not.toHaveBeenCalled();
  });

  it('should exclude files when extensions do not match', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/styles.css'; });
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed).toEqual([]);
  });

  it('should exclude files when paths match ignorePatterns', async () => {
    mockGlob.mockImplementation(async function* () { yield 'node_modules/lib/index.ts'; });
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed).toEqual([]);
  });

  it('should propagate error when Bun.file().text() throws', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/bad.ts'; });
    spyOn(Bun, 'file').mockReturnValue({
      size: 50, lastModified: 500,
      text: mock(async () => { throw new Error('read error'); }),
    } as any);
    const fileRepo = makeFileRepo(new Map());

    await expect(
      detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any })
    ).rejects.toThrow('read error');
  });

  it('should return same result on second call when no files changed', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 1000 }));
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    const r1 = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });
    const r2 = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(r1.unchanged.length).toBe(r2.unchanged.length);
    expect(r1.changed.length).toBe(r2.changed.length);
  });

  it('should categorize new and deleted files correctly when scanned together', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/new.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    const existing = new Map([['src/gone.ts', { filePath: 'src/gone.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'src/new.ts')).toBe(true);
    expect(result.deleted).toContain('src/gone.ts');
  });

  describe('when new, changed, unchanged, and deleted files appear simultaneously', () => {
    let result: Awaited<ReturnType<typeof detectChanges>>;

    beforeEach(async () => {
      mockGlob.mockImplementation(async function* () {
        yield 'src/new.ts';
        yield 'src/changed.ts';
        yield 'src/same.ts';
      });
      spyOn(Bun, 'file').mockImplementation((p: any) => {
        return makeBunFile({ size: 50, lastModified: 9999 });
      });
      mockHashString.mockImplementation((text: string) => text === 'same' ? 'hash-same' : 'hash-new');
      const existing = new Map([
        ['src/changed.ts', { filePath: 'src/changed.ts', mtimeMs: 1, size: 50, contentHash: 'hash-old' }],
        ['src/same.ts', { filePath: 'src/same.ts', mtimeMs: 9999, size: 50, contentHash: 'hash-same' }],
        ['src/deleted.ts', { filePath: 'src/deleted.ts', mtimeMs: 1, size: 50, contentHash: 'hash-x' }],
      ]);
      const fileRepo = makeFileRepo(existing);

      result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });
    });

    it('should include newly discovered file in changed list', () => {
      expect(result.changed.some((f) => f.filePath === 'src/new.ts')).toBe(true);
    });

    it('should include modified file in changed list', () => {
      expect(result.changed.some((f) => f.filePath === 'src/changed.ts')).toBe(true);
    });

    it('should exclude unchanged file from changed and deleted lists', () => {
      expect(result.changed.some((f) => f.filePath === 'src/same.ts')).toBe(false);
      expect(result.deleted).not.toContain('src/same.ts');
    });

    it('should include missing file in deleted list', () => {
      expect(result.deleted).toContain('src/deleted.ts');
    });
  });

  // ─── node_modules hard-exclude ────────────────────────────────────

  it('should exclude top-level node_modules path from results', async () => {
    mockGlob.mockImplementation(async function* () {
      yield 'node_modules/lodash/index.ts';
      yield 'src/app.ts';
    });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: [], fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'node_modules/lodash/index.ts')).toBe(false);
    expect(result.changed.some((f) => f.filePath === 'src/app.ts')).toBe(true);
  });

  it('should exclude nested node_modules path from results', async () => {
    mockGlob.mockImplementation(async function* () {
      yield 'packages/a/node_modules/express/index.ts';
      yield 'packages/a/src/index.ts';
    });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: [], fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'packages/a/node_modules/express/index.ts')).toBe(false);
    expect(result.changed.some((f) => f.filePath === 'packages/a/src/index.ts')).toBe(true);
  });

  it('should not exclude file whose name contains node_modules as substring', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/node_modules_helper.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: [], fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'src/node_modules_helper.ts')).toBe(true);
  });

  it('should exclude node_modules even when ignorePatterns is empty', async () => {
    mockGlob.mockImplementation(async function* () { yield 'node_modules/pkg/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: [], fileRepo: fileRepo as any });

    expect(result.changed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it('should report previously indexed node_modules file as deleted', async () => {
    mockGlob.mockImplementation(async function* () { yield 'node_modules/pkg/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    const existing = new Map([
      ['node_modules/pkg/index.ts', { filePath: 'node_modules/pkg/index.ts', mtimeMs: 500, size: 50, contentHash: 'abc' }],
    ]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: [], fileRepo: fileRepo as any });

    expect(result.deleted).toContain('node_modules/pkg/index.ts');
  });
});
