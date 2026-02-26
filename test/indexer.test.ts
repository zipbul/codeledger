import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbConnection } from '../src/store/connection';
import { FileRepository } from '../src/store/repositories/file.repository';
import { SymbolRepository } from '../src/store/repositories/symbol.repository';
import { RelationRepository } from '../src/store/repositories/relation.repository';
import { ParseCache } from '../src/parser/parse-cache';
import { IndexCoordinator } from '../src/indexer/index-coordinator';
import type { ParsedFile } from '../src/parser/types';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeFileRecord(overrides: Partial<{
  project: string; filePath: string; mtimeMs: number;
  size: number; contentHash: string; updatedAt: string;
}> = {}) {
  return {
    project: 'test-project',
    filePath: 'src/index.ts',
    mtimeMs: 1_000_000,
    size: 100,
    contentHash: 'abc123',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRelationRecord(overrides: Partial<{
  project: string; type: string; srcFilePath: string;
  srcSymbolName: string | null; dstFilePath: string;
  dstSymbolName: string | null; metaJson: string | null;
}> = {}) {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath: 'src/index.ts',
    srcSymbolName: null,
    dstFilePath: 'src/utils.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

// ── Shared DB setup ────────────────────────────────────────────────────────

let tmpDir: string;
let db: DbConnection;
let fileRepo: FileRepository;
let symbolRepo: SymbolRepository;
let relationRepo: RelationRepository;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gildash-indexer-test-'));
  db = new DbConnection({ projectRoot: tmpDir });
  db.open();
  fileRepo = new FileRepository(db);
  symbolRepo = new SymbolRepository(db);
  relationRepo = new RelationRepository(db);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

// ── ParseCache (MISS-10) ───────────────────────────────────────────────────

describe('ParseCache', () => {
  // [HP] capacity=2 인 캐시에 항목 3개 추가 → 첫 번째 항목 축출
  it('should evict the least-recently-used entry when capacity is exceeded', () => {
    const cache = new ParseCache(2);
    const a = { filePath: 'a.ts', sourceText: 'a' } as ParsedFile;
    const b = { filePath: 'b.ts', sourceText: 'b' } as ParsedFile;
    const c = { filePath: 'c.ts', sourceText: 'c' } as ParsedFile;

    cache.set('a.ts', a);
    cache.set('b.ts', b);
    cache.set('c.ts', c); // a.ts 축출

    expect(cache.get('a.ts')).toBeUndefined();
    expect(cache.get('b.ts')).toBe(b);
    expect(cache.get('c.ts')).toBe(c);
    expect(cache.size()).toBe(2);
  });

  // [HP] 축출된 키를 재삽입하면 새 값 반환 (stale 데이터 없음)
  it('should return the newly inserted value when an evicted key is re-inserted', () => {
    const cache = new ParseCache(2);
    const v1 = { filePath: 'a.ts', sourceText: 'version-1' } as ParsedFile;
    const v2 = { filePath: 'a.ts', sourceText: 'version-2' } as ParsedFile;

    cache.set('a.ts', v1);
    cache.set('b.ts', { filePath: 'b.ts', sourceText: '' } as ParsedFile);
    cache.set('c.ts', { filePath: 'c.ts', sourceText: '' } as ParsedFile); // a.ts 축출

    expect(cache.get('a.ts')).toBeUndefined(); // 축출 확인

    cache.set('a.ts', v2); // 새 값으로 재삽입
    expect(cache.get('a.ts')).toBe(v2); // stale v1이 아닌 새 v2 반환
    expect(cache.get('a.ts')).not.toBe(v1);
  });
});

// ── RelationRepository.retargetRelations null symbol (MISS-11) ─────────────

describe('RelationRepository.retargetRelations — null symbol (file-level move)', () => {
  // [HP] dstSymbolName=null 인 파일 레벨 관계를 retargetRelations(null→null)로 교체
  it('should retarget file-level relations to the new file path when both symbols are null', () => {
    // 필요한 파일 레코드 먼저 삽입 (FK 제약)
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/a.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/old.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/new.ts' }));

    // src/a.ts → src/old.ts (파일 레벨 import, symbol 없음)
    relationRepo.replaceFileRelations('test-project', 'src/a.ts', [
      makeRelationRecord({
        srcFilePath: 'src/a.ts',
        dstFilePath: 'src/old.ts',
        dstSymbolName: null,
      }),
    ]);

    // src/old.ts → src/new.ts 파일 이동 반영 (null→null)
    relationRepo.retargetRelations({ dstProject: 'test-project', oldFile: 'src/old.ts', oldSymbol: null, newFile: 'src/new.ts', newSymbol: null });

    // src/new.ts에 들어오는 관계가 갱신되어야 한다
    const incoming = relationRepo.getIncoming({ dstProject: 'test-project', dstFilePath: 'src/new.ts' });
    expect(incoming.length).toBeGreaterThan(0);
    expect(incoming[0]!.dstFilePath).toBe('src/new.ts');
    expect(incoming[0]!.dstSymbolName).toBeNull();
  });
});

// ── IndexCoordinator.fullIndex() (MISS-12) ─────────────────────────────────

describe('IndexCoordinator.fullIndex()', () => {
  // [HP] 빈 디렉터리에서 fullIndex() → 모든 카운트 0
  it('should return zero counts when the project directory contains no files', async () => {
    const projectDir = join(tmpDir, 'empty-proj');
    await mkdir(projectDir, { recursive: true });

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [{ dir: '.', project: 'empty' }],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(10),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    const result = await coordinator.fullIndex();

    expect(result.indexedFiles).toBe(0);
    expect(result.removedFiles).toBe(0);
    expect(result.totalSymbols).toBe(0);
    expect(result.totalRelations).toBe(0);
  });

  // [NE] .ts 확장자 아닌 파일만 있는 디렉터리에서 fullIndex() → 모든 카운트 0
  it('should return zero counts when the project directory contains only non-.ts files', async () => {
    const projectDir = join(tmpDir, 'non-ts-proj');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'README.md'), '# README');
    await writeFile(join(projectDir, 'config.json'), '{}');

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [{ dir: '.', project: 'non-ts' }],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(10),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    const result = await coordinator.fullIndex();

    expect(result.indexedFiles).toBe(0);
    expect(result.removedFiles).toBe(0);
    expect(result.totalSymbols).toBe(0);
    expect(result.totalRelations).toBe(0);
  });

  // [ED/ID] fullIndex() 두 번 순차 실행, 변경 없음 → 파일·relation 레코드 보존
  it('should preserve all indexed records when fullIndex is called a second time without any file changes', async () => {
    const projectDir = join(tmpDir, 'two-run-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'a.ts'), `import { foo } from './b';`);
    await writeFile(join(projectDir, 'src', 'b.ts'), `export function foo(): void {}`);

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [{ dir: '.', project: 'two-run' }],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(10),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    const result1 = await coordinator.fullIndex();
    expect(result1.indexedFiles).toBe(2);

    // 두 번째 실행 — 파일 변경 없음
    const result2 = await coordinator.fullIndex();
    expect(result2.indexedFiles).toBe(0); // 변경분 없음

    // 파일 레코드가 사라지지 않았어야 한다
    const files = fileRepo.getAllFiles('two-run');
    expect(files.length).toBe(2);
  });

  // [CO] A imports B + A만 변경 → fullIndex() → FK constraint 충돌 없음
  it('should not throw FK constraint error when only the importing file changes and the imported file remains unchanged', async () => {
    const projectDir = join(tmpDir, 'fk-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'a.ts'), `import { foo } from './b';`);
    await writeFile(join(projectDir, 'src', 'b.ts'), `export function foo(): void {}`);

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [{ dir: '.', project: 'fk-test' }],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(10),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    await coordinator.fullIndex();

    // A만 변경 (내용 추가)
    await writeFile(join(projectDir, 'src', 'a.ts'), `import { foo } from './b';\n// changed`);

    // 두 번째 fullIndex() — B는 unchanged, A만 re-index → FK 충돌 없어야 함
    let thrownError: unknown = null;
    try {
      await coordinator.fullIndex();
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeNull();
  });
});
