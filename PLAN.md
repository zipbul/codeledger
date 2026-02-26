# gildash — relations FK 근본 수정 + 크로스 프로젝트 관계

## 버전 전략

- 타겟 버전: **0.6.0** (minor)
- `StoredCodeRelation` 타입 도입 + `RelationSearchQuery.dstProject` API 확장 + DB migration → minor 변경
- changeset: `minor` 레벨로 작성

---

## 문제 정의

### 증상

`fullIndex()` 실행 시 `SQLITE_CONSTRAINT_FOREIGNKEY` (errno 787) 발생. 소비자 블로커.

### 근본 원인

`relations` 테이블의 FK 구조가 세 가지 시나리오에서 위반된다:

```sql
-- 현재 FK 구조 (0000_soft_revanche.sql)
FOREIGN KEY (project, src_file_path) REFERENCES files(project, file_path) ON DELETE CASCADE
FOREIGN KEY (project, dst_file_path) REFERENCES files(project, file_path) ON DELETE CASCADE
```

`PRAGMA foreign_keys = ON` (connection.ts L39) 상태에서:

| # | 시나리오 | 예시 | 원인 |
|---|---------|------|------|
| 1 | **디렉터리/배럴 임포트** | `import { x } from './store'` → `dstFilePath='store.ts'` (실제: `store/index.ts`) | `resolveImport`이 후보 배열의 첫 번째(`candidates[0]`)를 맹목적으로 선택. 해당 경로가 `files` 테이블에 없으면 FK 위반 |
| 2 | **크로스 프로젝트 참조** | `default` 프로젝트에서 `@external/lodash`의 파일 참조 | `relations.project`가 단일 컬럼 — src/dst 모두 같은 project여야 함. 크로스 프로젝트 관계 구조적 불가 |
| 3 | **비-TS 파일 임포트** | `import data from './config.json'` | `.json`은 인덱싱 대상이 아니므로 `files`에 없음 → FK 위반 |

### 구조적 한계

```
relations.project ──┬── (project, srcFilePath) → files(project, filePath)  ← src FK
                    └── (project, dstFilePath) → files(project, filePath)  ← dst FK (같은 project 강제)
```

`project` 컬럼이 하나이므로 src와 dst가 반드시 같은 project에 속해야 한다.
`indexExternalPackages()` 로 외부 패키지를 인덱싱해도, 기본 프로젝트에서 그 패키지를 사용한다는 관계를 기록할 수 없다.

### 크로스 프로젝트 범위

이 PLAN의 크로스 프로젝트 범위: **monorepo 내 복수 `package.json` 프로젝트 간 참조만 해당.**
`node_modules` 외부 패키지와의 관계는 `dstProject` 분리로 **구조적 기반만 마련**. 실제 외부 패키지 relation 생성에는 별도 `indexExternalPackages()` 구현이 필요하며, 이 PLAN의 범위가 아님.

### 비-TS 파일 임포트 정책

`.json`, `.css`, `.svg` 등 비-TypeScript 파일은 인덱싱 대상이 아님. 이들에 대한 import 구문은 `knownFiles` 검증에서 자동 필터링되어 relation 미생성. 의도적 설계:
1. 비-TS 파일은 심볼 추출 불가
2. FK 정합성 보장
3. dependency graph는 코드 의존성 분석 목적

---

## 수정 전략: Option F (resolver DI + knownFiles + dstProject 분리)

### 핵심 변경 5가지

1. **스키마**: `relations`에 `dstProject` 컬럼 추가 → dst FK를 `(dstProject, dstFilePath)` → `files`로 변경
2. **경로 해석**: `resolveImport`에 `.d.ts` 후보 추가 + extractor DI 파이프라인으로 `knownFiles` 기반 정확한 후보 선택 + `resolveBareSpecifier` 추가
3. **인덱싱**: `relation-indexer`에서 `dstProject` 독립 결정 + 커스텀 resolver 조립 + 증분 인덱싱 2-pass 구조
4. **공개 API**: `CodeRelation` 타입에 `dstProject` 추가, `DependencyGraph` 크로스 프로젝트 지원
5. **안전성**: migration FK 토글, `replaceFileRelations` 원자성 보장, AUTOINCREMENT 시퀀스 보존

---

## 파일별 상세 변경사항

### 레이어 1: 스키마

#### `src/store/schema.ts`

```diff
 export const relations = sqliteTable(
   'relations',
   {
     id: integer('id').primaryKey({ autoIncrement: true }),
     project: text('project').notNull(),
     type: text('type').notNull(),
     srcFilePath: text('src_file_path').notNull(),
     srcSymbolName: text('src_symbol_name'),
+    dstProject: text('dst_project').notNull(),
     dstFilePath: text('dst_file_path').notNull(),
     dstSymbolName: text('dst_symbol_name'),
     metaJson: text('meta_json'),
   },
   (table) => [
     index('idx_relations_src').on(table.project, table.srcFilePath),
-    index('idx_relations_dst').on(table.project, table.dstFilePath),
+    index('idx_relations_dst').on(table.dstProject, table.dstFilePath),
     index('idx_relations_type').on(table.project, table.type),
     foreignKey({
       columns: [table.project, table.srcFilePath],
       foreignColumns: [files.project, files.filePath],
     }).onDelete('cascade'),
     foreignKey({
-      columns: [table.project, table.dstFilePath],
+      columns: [table.dstProject, table.dstFilePath],
       foreignColumns: [files.project, files.filePath],
     }).onDelete('cascade'),
   ],
 );
```

#### `src/store/migrations/0004_relations_dst_project.sql`

SQLite는 `ALTER TABLE`로 FK를 변경할 수 없으므로 테이블 재생성.

```sql
-- 1. 새 테이블 생성 (dstProject 추가, dst FK 변경)
CREATE TABLE `relations_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project` text NOT NULL,
  `type` text NOT NULL,
  `src_file_path` text NOT NULL,
  `src_symbol_name` text,
  `dst_project` text NOT NULL,
  `dst_file_path` text NOT NULL,
  `dst_symbol_name` text,
  `meta_json` text,
  FOREIGN KEY (`project`,`src_file_path`) REFERENCES `files`(`project`,`file_path`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`dst_project`,`dst_file_path`) REFERENCES `files`(`project`,`file_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- 2. 데이터 마이그레이션 (기존 데이터: dstProject = project)
INSERT INTO `relations_new` (`id`, `project`, `type`, `src_file_path`, `src_symbol_name`, `dst_project`, `dst_file_path`, `dst_symbol_name`, `meta_json`)
  SELECT `id`, `project`, `type`, `src_file_path`, `src_symbol_name`, `project`, `dst_file_path`, `dst_symbol_name`, `meta_json` FROM `relations`;
--> statement-breakpoint

-- 3. 교체
DROP TABLE `relations`;
--> statement-breakpoint
ALTER TABLE `relations_new` RENAME TO `relations`;
--> statement-breakpoint

-- 4. 인덱스 재생성
CREATE INDEX `idx_relations_src` ON `relations` (`project`,`src_file_path`);
--> statement-breakpoint
CREATE INDEX `idx_relations_dst` ON `relations` (`dst_project`,`dst_file_path`);
--> statement-breakpoint
CREATE INDEX `idx_relations_type` ON `relations` (`project`,`type`);
--> statement-breakpoint

-- 5. AUTOINCREMENT 시퀀스 복원 (DROP TABLE 시 sqlite_sequence 엔트리 삭제됨)
INSERT OR REPLACE INTO sqlite_sequence (name, seq)
  SELECT 'relations', COALESCE(MAX(id), 0) FROM relations;
```

migration meta JSON도 함께 작성 필요 (`src/store/migrations/meta/`).

**`_journal.json`에 추가할 엔트리:**

```json
{
  "idx": 4,
  "version": "6",
  "when": <timestamp>,
  "tag": "0004_relations_dst_project",
  "breakpoints": true
}
```

**`0004_snapshot.json`**: `drizzle-kit generate`로 자동 생성 후 검증. 수동 작성 금지 — drizzle 내부 형식이 버전별로 다름.

#### `src/store/repositories/relation.repository.ts`

```diff
 export interface RelationRecord {
   project: string;
   type: string;
   srcFilePath: string;
   srcSymbolName: string | null;
+  dstProject: string;
   dstFilePath: string;
   dstSymbolName: string | null;
   metaJson: string | null;
 }
```

**모든 SELECT/INSERT/UPDATE 메서드에 `dstProject` 반영:**

- `replaceFileRelations`: INSERT에 `dstProject` 추가. **fallback: `rel.dstProject ?? project`** (Partial 타입에서 undefined 방어). **DELETE+INSERT를 내부 트랜잭션으로 감싸 원자성 보장** (증분 인덱싱 시 외부 트랜잭션 없이 호출될 수 있으므로)

```ts
replaceFileRelations(project: string, srcFilePath: string, rels: ReadonlyArray<Partial<RelationRecord>>): void {
  const exec = () => {
    this.db.drizzleDb
      .delete(relationsTable)
      .where(and(eq(relationsTable.project, project), eq(relationsTable.srcFilePath, srcFilePath)))
      .run();
    if (!rels.length) return;
    for (const rel of rels) {
      this.db.drizzleDb.insert(relationsTable).values({
        project,
        type: rel.type ?? 'unknown',
        srcFilePath: rel.srcFilePath ?? srcFilePath,
        srcSymbolName: rel.srcSymbolName ?? null,
        dstProject: rel.dstProject ?? project,  // fallback: 동일 프로젝트
        dstFilePath: rel.dstFilePath ?? '',
        dstSymbolName: rel.dstSymbolName ?? null,
        metaJson: rel.metaJson ?? null,
      }).run();
    }
  };
  this.db.transaction(exec);  // DbConnection.txDepth로 중첩 안전
}
```

- `getOutgoing`: SELECT에 `dstProject: relationsTable.dstProject` 추가 (두 개의 SELECT 쿼리 모두)
- `getIncoming`: WHERE 조건 `dstProject` 기준으로 변경 (project + dstFilePath → **dstProject + dstFilePath**). SELECT에 `dstProject` 추가. **named parameter 패턴**으로 전환하여 사일런트 시그니처 변경 방지:

```ts
getIncoming(opts: { dstProject: string; dstFilePath: string }): RelationRecord[] {
  const { dstProject, dstFilePath } = opts;
  return this.db.drizzleDb.select({ ... , dstProject: relationsTable.dstProject, ... })
    .from(relationsTable)
    .where(and(eq(relationsTable.dstProject, dstProject), eq(relationsTable.dstFilePath, dstFilePath)))
    .all();
}
```

**`getIncoming` 호출처 전파 필요:**

| 파일 | 위치 | 수정 내용 |
|------|------|----------|
| `test/store.test.ts` | L429, L434, L461, L474 | `getIncoming({ dstProject: 'test-project', dstFilePath: '...' })` 형태로 변경 |
| `test/indexer.test.ts` | L130 | `getIncoming({ dstProject: 'test-project', dstFilePath: 'src/new.ts' })` |
| `src/gildash.spec.ts` | L68 | mock 시그니처 `(opts: { dstProject: string; dstFilePath: string })` |

- `getByType`: SELECT에 `dstProject` 추가
- `searchRelations`: `dstProject` 필터 옵션 추가. WHERE에 `opts.dstProject !== undefined ? eq(relationsTable.dstProject, opts.dstProject) : undefined` 추가. SELECT에 `dstProject` 추가
- `retargetRelations`: WHERE/SET에 `dstProject` 반영. **named parameter 패턴**으로 전환 — 6개 positional 파라미터는 가독성·안전성 모두 부족:

```ts
retargetRelations(opts: {
  dstProject: string;
  oldFile: string;
  oldSymbol: string | null;
  newFile: string;
  newSymbol: string | null;
  newDstProject?: string;
}): void {
  const { dstProject, oldFile, oldSymbol, newFile, newSymbol, newDstProject } = opts;
  const condition = oldSymbol === null
    ? and(
        eq(relationsTable.dstProject, dstProject),
        eq(relationsTable.dstFilePath, oldFile),
        isNull(relationsTable.dstSymbolName),
      )
    : and(
        eq(relationsTable.dstProject, dstProject),
        eq(relationsTable.dstFilePath, oldFile),
        eq(relationsTable.dstSymbolName, oldSymbol),
      );

  const setValues: Record<string, unknown> = {
    dstFilePath: newFile,
    dstSymbolName: newSymbol,
  };
  if (newDstProject !== undefined) {
    setValues.dstProject = newDstProject;
  }

  this.db.drizzleDb.update(relationsTable).set(setValues).where(condition).run();
}
```

**`retargetRelations` 호출처 (index-coordinator.ts) 업데이트:**

```diff
-relationRepo.retargetRelations(oldProject, oldFile, sym.name, newSym.filePath, newSym.name);
+const dstProject = resolveFileProject(oldFile, this.opts.boundaries);
+relationRepo.retargetRelations({ dstProject, oldFile, oldSymbol: sym.name, newFile: newSym.filePath, newSymbol: newSym.name });
```

**`IndexCoordinatorOptions.relationRepo` 인터페이스 업데이트:**

```diff
 relationRepo: {
   replaceFileRelations(project: string, filePath: string, relations: ReadonlyArray<Partial<RelationRecord>>): void;
-  retargetRelations(project: string, oldFile: string, oldSymbol: string | null, newFile: string, newSymbol: string | null): void;
+  retargetRelations(opts: { dstProject: string; oldFile: string; oldSymbol: string | null; newFile: string; newSymbol: string | null; newDstProject?: string }): void;
   deleteFileRelations(project: string, filePath: string): void;
 };
```

named parameter 패턴으로 파라미터 순서 실수가 컴파일 에러로 잡힌다. 인터페이스와 구현체 시그니처를 동시에 변경해야 함.

- `deleteFileRelations`: 변경 없음 (srcFilePath 기준)

---

### 레이어 2: 경로 해석

#### `src/extractor/extractor-utils.ts`

**변경 1: `resolveImport` — `.d.ts` 후보 추가**

확장자 없는 import 시 후보 배열에 `.d.ts`/`/index.d.ts` 추가:

```diff
 if (extension === '') {
   return [
     resolved + '.ts',
+    resolved + '.d.ts',
     resolved + '/index.ts',
+    resolved + '/index.d.ts',
     resolved + '.mts',
     resolved + '/index.mts',
     resolved + '.cts',
     resolved + '/index.cts',
   ];
 }
```

해석 우선순위: `.ts` > `.d.ts` > `/index.ts` > `/index.d.ts` > `.mts` > ...

knownFiles 검증이 있으므로 후보가 많아도 정확도에 영향 없음. 후보 순서가 TypeScript 해석 우선순위를 준수하는 것이 중요.

**변경 2: `resolveBareSpecifier` 함수 추가**

```ts
/**
 * Resolve a bare specifier (e.g. 'lodash', '@scope/pkg') to node_modules candidates.
 * Returns candidate .d.ts / .ts paths. Does NOT check file existence (pure, sync).
 */
export function resolveBareSpecifier(
  projectRoot: string,
  importPath: string,
): string[] {
  // bare specifier 판별: 상대경로(.)도 절대경로(/)도 아닌 것
  if (importPath.startsWith('.') || importPath.startsWith('/')) return [];

  const nmDir = resolve(projectRoot, 'node_modules');
  const candidates: string[] = [];

  // 1. 직접 패키지 경로
  const pkgDir = resolve(nmDir, importPath);
  candidates.push(
    resolve(pkgDir, 'index.d.ts'),
    resolve(pkgDir, 'index.ts'),
    resolve(pkgDir, 'index.d.mts'),
  );

  // 2. 서브패스: @scope/pkg/sub → node_modules/@scope/pkg/sub
  if (importPath.includes('/')) {
    const subPath = resolve(nmDir, importPath);
    candidates.push(
      subPath + '.d.ts',
      subPath + '.ts',
      subPath + '/index.d.ts',
      subPath + '/index.ts',
    );
  }

  // 3. @types 패키지 (scoped 패키지: @scope/pkg → @types/scope__pkg)
  const typesName = importPath.startsWith('@')
    ? importPath.replace('@', '').replace('/', '__')
    : importPath;
  candidates.push(resolve(nmDir, '@types', typesName, 'index.d.ts'));

  return candidates;
}
```

knownFiles 이중 방어로 잘못된 후보는 자동 필터링. 후보는 넓을수록 안전.

**`resolveBareSpecifier` 현실적 한계**: 현재 인덱싱 범위에서 `node_modules`는 `ignorePatterns`로 제외되므로 `files` 테이블에 없음 → `knownFiles`에도 없음 → bare specifier 후보가 knownFiles 검증을 **통과하지 못함**. 즉, 이 PLAN 범위에서 `resolveBareSpecifier`는 **미래 `indexExternalPackages()` 구현 후 활성화되는 기반 코드**. monorepo 내부 패키지 간 참조는 보통 tsconfig paths로 해석되므로 `resolveImport`이 처리.

- `resolveImport`의 시그니처는 변경 없음 (후보 배열만 확장)
- `resolveBareSpecifier`는 별도 export (현재는 knownFiles 검증에 의해 비활성 상태)

#### `src/extractor/relation-extractor.ts`

**변경: `extractRelations`에 `resolveImportFn` 선택 파라미터 추가**

```diff
+import { resolveImport } from './extractor-utils';
+
+type ResolveImportFn = (
+  currentFilePath: string,
+  importPath: string,
+  tsconfigPaths?: TsconfigPaths,
+) => string[];

 export function extractRelations(
   ast: Program,
   filePath: string,
   tsconfigPaths?: TsconfigPaths,
+  resolveImportFn: ResolveImportFn = resolveImport,
 ): CodeRelation[] {
-  const importMap = buildImportMap(ast, filePath, tsconfigPaths);
-  const imports = extractImports(ast, filePath, tsconfigPaths);
+  const importMap = buildImportMap(ast, filePath, tsconfigPaths, resolveImportFn);
+  const imports = extractImports(ast, filePath, tsconfigPaths, resolveImportFn);
   const calls = extractCalls(ast, filePath, importMap);
   const heritage = extractHeritage(ast, filePath, importMap);

   return [...imports, ...calls, ...heritage];
 }
```

- 기본값 `resolveImport` → 기존 호출 전부 호환
- 공개 API (`Gildash.extractRelations()`)는 기본값 사용 → 영향 없음
- `imports-extractor.extractImports` (4번째 파라미터, L11-15)와 `extractor-utils.buildImportMap` (3번째 파라미터, L76)은 이미 `resolveImportFn` 파라미터를 가지고 있음 — 현재 `extractRelations`에서 이들을 호출할 때 전달하지 않아 기본값(`resolveImport`)이 사용됨. DI 파라미터 추가 후 `extractRelations` 내부에서 `resolveImportFn`을 이 두 함수에 전달하는 것이 핵심

---

### 레이어 3: 인덱싱

#### `src/indexer/relation-indexer.ts`

**변경사항:**

```diff
+import { resolveImport, resolveBareSpecifier } from '../extractor/extractor-utils';
+import { resolveFileProject } from '../common/project-discovery';
+import type { ProjectBoundary } from '../common/project-discovery';

 export interface RelationDbRow {
   project: string;
   type: string;
   srcFilePath: string;
   srcSymbolName: string | null;
+  dstProject: string;
   dstFilePath: string;
   dstSymbolName: string | null;
   metaJson: string | null;
 }

 export interface IndexFileRelationsOptions {
   ast: Program;
   project: string;
   filePath: string;
   relationRepo: RelationRepoPart;
   projectRoot: string;
   tsconfigPaths?: TsconfigPaths;
+  /** 인덱싱된 파일 경로 Set. `${project}::${filePath}` 형식. */
+  knownFiles?: Set<string>;
+  /** 프로젝트 경계 목록 (dstProject 결정용) */
+  boundaries?: ProjectBoundary[];
 }

 export function indexFileRelations(opts: IndexFileRelationsOptions): number {
-  const { ast, project, filePath, relationRepo, projectRoot, tsconfigPaths } = opts;
+  const { ast, project, filePath, relationRepo, projectRoot, tsconfigPaths, knownFiles, boundaries } = opts;

   const absFilePath = toAbsolutePath(projectRoot, filePath);

+  // knownFiles가 주어지면, 후보 중 knownFiles에 있는 경로를 선택하는 커스텀 resolver 조립
+  const customResolver = knownFiles
+    ? (currentFile: string, importPath: string, paths?: TsconfigPaths) => {
+        // 1. 기본 해석 (상대경로 + tsconfig paths)
+        let candidates = resolveImport(currentFile, importPath, paths);
+
+        // 2. bare specifier fallback
+        if (candidates.length === 0) {
+          candidates = resolveBareSpecifier(projectRoot, importPath);
+        }
+
+        // 3. 후보 중 knownFiles에 있는 첫 번째 선택
+        for (const c of candidates) {
+          const rel = toRelativePath(projectRoot, c);
+          // 모든 project에서 검색
+          if (boundaries) {
+            const p = resolveFileProject(rel, boundaries);
+            if (knownFiles.has(`${p}::${rel}`)) return [c];
+          } else {
+            if (knownFiles.has(`${project}::${rel}`)) return [c];
+          }
+        }
+        return []; // knownFiles에 없으면 빈 배열 → relation 미생성
+      }
+    : undefined;

-  const rawRelations = extractRelations(ast, absFilePath, tsconfigPaths);
+  const rawRelations = extractRelations(ast, absFilePath, tsconfigPaths, customResolver);

   const rows: RelationDbRow[] = [];

   for (const rel of rawRelations) {
     const relDst = toRelativePath(projectRoot, rel.dstFilePath);
     if (relDst.startsWith('..')) continue;
     const relSrc = toRelativePath(projectRoot, rel.srcFilePath);

+    // dstProject 결정: boundaries가 있으면 dstFilePath 기준으로 project 해석
+    const dstProject = boundaries
+      ? resolveFileProject(relDst, boundaries)
+      : project;

     rows.push({
       project,
       type: rel.type,
       srcFilePath: relSrc,
       srcSymbolName: rel.srcSymbolName ?? null,
+      dstProject,
       dstFilePath: relDst,
       dstSymbolName: rel.dstSymbolName ?? null,
       metaJson: rel.metaJson ?? null,
     });
   }

   relationRepo.replaceFileRelations(project, filePath, rows);
   return rows.length;
 }
```

#### `src/indexer/index-coordinator.ts`

> **구조 참고**: `doIndex` 내부에 `useTransaction` 분기가 존재한다.
> - `useTransaction=true` (fullIndex / 초기 인덱싱): 이미 preread + `dbConnection.transaction()` 내부에 2-pass 구조 존재 (Pass 1: upsertFile, Pass 2: parse+index). **여기에 knownFiles 주입 필요.**
> - `useTransaction=false` (증분 인덱싱): `processChanged` → `processFile` 단일 파일 순차. **2-pass 구조로 전면 교체 필요.**
>
> **양쪽 모두** `knownFiles` + `boundaries`를 `indexFileRelations`에 전달해야 한다.

**변경 1: `useTransaction=true` 경로 — knownFiles 주입**

기존 트랜잭션 내부 Pass 1 (upsertFile 루프) 직후, Pass 2 (파싱+인덱싱 루프) 직전에 knownFiles를 구축:

```diff
 // 기존 트랜잭션 내부 (dbConnection.transaction 콜백 내)
 // ... Pass 1: upsertFile 루프 완료 후 ...

+// knownFiles Set 구축: Pass 1에서 upsert한 파일 + 기존 파일 모두 포함 (read-your-own-writes)
+const knownFiles = new Set<string>();
+for (const boundary of boundaries) {
+  for (const [fp] of fileRepo.getFilesMap(boundary.project)) {
+    knownFiles.add(`${boundary.project}::${fp}`);
+  }
+}

 // Pass 2: Parse sources and index symbols + relations.
 const parseFn = this.opts.parseSourceFn ?? parseSource;
```

Pass 2의 `indexFileRelations` 호출에 knownFiles + boundaries 추가:

```diff
 totalRelations += indexFileRelations({
   ast: parsed.program,
   project,
   filePath: fd.filePath,
   relationRepo,
   projectRoot,
   tsconfigPaths,
+  knownFiles,
+  boundaries,
 });
```

**삽입 위치**: [index-coordinator.ts L377](src/indexer/index-coordinator.ts#L377) (upsertFile 루프 종료) 와 [L380](src/indexer/index-coordinator.ts#L380) (`const parseFn = ...`) 사이.

**변경 2: `useTransaction=false` 경로 (processChanged) — 2-pass 구조로 전면 교체**

기존 `processChanged` → `processFile` 단일 파일 순차 처리 → **2-pass 구조**로 변경.
**이유**: 파일 A(신규)→B(신규) 시 A가 먼저 처리되면 B가 knownFiles에 없어 A→B relation 소실.

`processFile` 메서드는 **삭제 가능** — 2-pass 구조로 대체되며 더 이상 호출되지 않음.

```ts
const processChanged = async (): Promise<{ symbols: number; relations: number; failedFiles: string[] }> => {
  let symbols = 0;
  let relations = 0;
  const failedFiles: string[] = [];

  // ── Pass 1: 모든 변경 파일 read + parse + upsertFile ──
  type Prepared = {
    filePath: string; text: string; contentHash: string;
    parsed: ReturnType<typeof parseSource>; project: string;
  };
  const prepared: Prepared[] = [];

  for (const file of changed) {
    try {
      const absPath = toAbsolutePath(projectRoot, file.filePath);
      const bunFile = Bun.file(absPath);
      const text = await bunFile.text();
      const contentHash = file.contentHash || hashString(text);
      const project = resolveFileProject(file.filePath, boundaries);

      fileRepo.upsertFile({
        project, filePath: file.filePath,
        mtimeMs: bunFile.lastModified, size: bunFile.size,
        contentHash, updatedAt: new Date().toISOString(),
        lineCount: text.split('\n').length,
      });

      const parseFn = this.opts.parseSourceFn ?? parseSource;
      const parseResult = parseFn(absPath, text);
      if (isErr(parseResult)) throw parseResult.data;
      prepared.push({ filePath: file.filePath, text, contentHash, parsed: parseResult, project });
    } catch (err) {
      this.logger.error(`[IndexCoordinator] Failed to prepare ${file.filePath}:`, err);
      failedFiles.push(file.filePath);
    }
  }

  // ── knownFiles 구축 (1회) — Pass 1 완료 후 모든 신규 파일 포함 ──
  const knownFiles = new Set<string>();
  for (const boundary of boundaries) {
    for (const [fp] of fileRepo.getFilesMap(boundary.project)) {
      knownFiles.add(`${boundary.project}::${fp}`);
    }
  }

  // ── Pass 2: index symbols + relations ──
  for (const fd of prepared) {
    indexFileSymbols({
      parsed: fd.parsed, project: fd.project,
      filePath: fd.filePath, contentHash: fd.contentHash, symbolRepo,
    });
    relations += indexFileRelations({
      ast: fd.parsed.program, project: fd.project, filePath: fd.filePath,
      relationRepo, projectRoot, tsconfigPaths,
      knownFiles, boundaries,
    });
    parseCache.set(fd.filePath, fd.parsed);
    symbols += symbolRepo.getFileSymbols(fd.project, fd.filePath).length;
  }

  return { symbols, relations, failedFiles };
};
```

**핵심**: Pass 1에서 모든 파일 `upsertFile` 완료 → `knownFiles`에 모든 신규 파일 포함 → Pass 2에서 정확한 relation 생성. `knownFiles` 구축 1회.

기존 `processFile` 메서드는 삭제 가능 — `processChanged` 2-pass로 완전 대체.

**원자성 주의**: 증분(incremental) 경로는 fullIndex와 달리 외부 트랜잭션으로 감싸져 있지 않음. Pass 1 (upsertFile) 완료 후 Pass 2 도중 crash 시 파일만 upsert되고 relation 없는 불완전 상태 가능. 이는 기존 `processFile` 방식과 동일한 한계이나, 2-pass로 실패 윈도우가 N배 확대됨.

**대응**: `bun:sqlite`의 `transaction()`은 동기 전용이므로, async I/O가 포함된 Pass 1을 통째로 감쌀 수 없다. **Pass 2(순수 동기 DB 연산)만 동기 트랜잭션으로 보호:**

```ts
const processChanged = async (): Promise<{ symbols: number; relations: number; failedFiles: string[] }> => {
  // ── Pass 1: 파일 read + parse + upsertFile (async I/O → 트랜잭션 밖) ──
  for (const file of changed) {
    const text = await Bun.file(absPath).text();  // async
    fileRepo.upsertFile({ ... });
    // ... parse ...
    prepared.push({ ... });
  }

  // ── knownFiles 구축 (동기, 1회) ──
  const knownFiles = new Set<string>();
  for (const boundary of boundaries) { ... }

  // ── Pass 2: index symbols + relations (순수 동기 DB → 트랜잭션으로 보호) ──
  dbConnection.transaction(() => {
    for (const fd of prepared) {
      indexFileSymbols({ ... });
      indexFileRelations({ ..., knownFiles, boundaries });
    }
  });

  return { symbols, relations, failedFiles };
};
```

Pass 1의 upsert는 트랜잭션 밖이지만, crash 시 contentHash 불일치로 다음 증분에서 재처리된다. Pass 2는 동기 트랜잭션으로 전체 롤백 보장 — symbols/relations의 원자성 확보.

---

### 레이어 4: 검색

#### `src/search/relation-search.ts`

```diff
 export interface RelationSearchQuery {
   srcFilePath?: string;
   srcSymbolName?: string;
   dstFilePath?: string;
   dstSymbolName?: string;
+  dstProject?: string;
   type?: CodeRelation['type'];
   project?: string;
   limit?: number;
 }

 export interface IRelationRepo {
   searchRelations(opts: {
     srcFilePath?: string;
     srcSymbolName?: string;
     dstFilePath?: string;
     dstSymbolName?: string;
+    dstProject?: string;
     type?: string;
     project?: string;
     limit: number;
   }): RelationRecord[];
 }
```

`relationSearch` 함수 내부:

```diff
 const records = relationRepo.searchRelations({
   srcFilePath: query.srcFilePath,
   srcSymbolName: query.srcSymbolName,
   dstFilePath: query.dstFilePath,
   dstSymbolName: query.dstSymbolName,
+  dstProject: query.dstProject,
   type: query.type,
   project: effectiveProject,
   limit,
 });
```

#### `src/search/dependency-graph.ts`

**변경 필요.** 크로스 프로젝트 전이적 의존성/사이클 검출 지원:

```diff
 export class DependencyGraph {
   constructor(
     private readonly options: {
       relationRepo: IDependencyGraphRepo;
       project: string;
+      /** 추가 프로젝트도 그래프에 포함 (크로스 프로젝트 분석) */
+      additionalProjects?: string[];
     },
   ) {}

   build(): void {
     this.adjacencyList = new Map();
     this.reverseAdjacencyList = new Map();

+    const projects = [this.options.project, ...(this.options.additionalProjects ?? [])];
+    const types = ['imports', 'type-references', 're-exports'] as const;
+
-    const relations = [
-      ...this.options.relationRepo.getByType(this.options.project, 'imports'),
-      ...this.options.relationRepo.getByType(this.options.project, 'type-references'),
-      ...this.options.relationRepo.getByType(this.options.project, 're-exports'),
-    ];
+    const relations: RelationRecord[] = [];
+    for (const p of projects) {
+      for (const t of types) {
+        relations.push(...this.options.relationRepo.getByType(p, t));
+      }
+    }

     // ... 기존 adjacency 구축 로직
```

#### `src/gildash/graph-api.ts`

`getOrBuildGraph`에서 project=undefined(cross) 시 boundaries 전달:

```diff
 export function getOrBuildGraph(ctx: GildashContext, project?: string): DependencyGraph {
   const key = project ?? '__cross__';
   if (ctx.graphCache && ctx.graphCacheKey === key) return ctx.graphCache;

   const g = new DependencyGraph({
     relationRepo: ctx.relationRepo,
     project: project ?? ctx.defaultProject,
+    additionalProjects: project ? undefined : ctx.boundaries.map(b => b.project),
   });
   g.build();
```

#### `src/extractor/types.ts`

**`CodeRelation` 타입은 변경하지 않음** — extractor(순수 AST 분석) 출력에는 `dstProject`가 없으므로 원본 타입 유지.

#### `src/search/relation-search.ts`

**`StoredCodeRelation` 타입 분리 (공개 API):**

DB에서 조회된 relation은 `dstProject`가 반드시 존재한다. optional 하나로 퉁치면 extractor 출력(dstProject 없음)과 store 조회 결과(dstProject 있음)가 타입 레벨에서 구분 불가하므로, 별도 타입으로 분리:

```ts
import type { CodeRelation } from '../extractor/types';

/** DB에서 조회된 relation. dstProject가 반드시 존재. */
export interface StoredCodeRelation extends CodeRelation {
  dstProject: string;
}
```

`relationSearch` 반환 타입 변경:

```diff
-export function relationSearch(...): CodeRelation[] {
+export function relationSearch(...): StoredCodeRelation[] {
   return records.map(r => ({
     type: r.type as CodeRelation['type'],
     srcFilePath: r.srcFilePath,
     srcSymbolName: r.srcSymbolName,
+    dstProject: r.dstProject,
     dstFilePath: r.dstFilePath,
     dstSymbolName: r.dstSymbolName,
     metaJson: r.metaJson ?? undefined,
     meta,
   }));
 }
```

**공개 API 반환 타입 전파:**

| 메서드 | 기존 반환 | 변경 후 |
|--------|----------|--------|
| `searchRelations()` | `Result<CodeRelation[]>` | `Result<StoredCodeRelation[]>` |
| `searchAllRelations()` | `Result<CodeRelation[]>` | `Result<StoredCodeRelation[]>` |
| `getInternalRelations()` | `Result<CodeRelation[]>` | `Result<StoredCodeRelation[]>` |

`StoredCodeRelation extends CodeRelation`이므로 기존 소비자 코드에서 `CodeRelation`으로 받던 것이 그대로 호환된다 (liskov substitution).

**`StoredCodeRelation`을 공개 export에 추가:**

```diff
 // src/index.ts 또는 src/search/index.ts
+export type { StoredCodeRelation } from './search/relation-search';
```

---

## 마이그레이션 전략

### 절차 (반드시 순서대로)

1. `schema.ts`에 `dstProject` 컴럼 + FK 변경 적용
2. `bunx drizzle-kit generate` 실행 → 자동 생성된 SQL + snapshot + journal 확인
3. 자동 생성 결과 검증:
   - drizzle-kit이 `ALTER TABLE` 변경만 내려주고 테이블 재생성을 안 하는 경우: **수동 SQL로 교체** (SQLite는 ALTER TABLE로 FK 변경 불가, 테이블 재생성 필수)
   - 자동 생성된 SQL이 PLAN의 테이블 재생성 패턴과 일치하는 경우: 그대로 사용
   - 두 경우 모두 `AUTOINCREMENT 시퀀스 복원` 및 `데이터 마이그레이션 (dstProject = project)` 구문이 포함되어 있는지 확인
4. `0004_snapshot.json`은 `drizzle-kit generate`가 자동 생성. **수동 작성 금지** — drizzle 내부 형식이 버전별로 다름
5. 수동 SQL 교체 시 `_journal.json`의 tag/idx가 자동 생성된 파일명과 일치하는지 확인
6. 기존 데이터: `INSERT INTO relations_new ... SELECT ... project AS dst_project ...` 로 `dstProject = project` 마이그레이션

### 수동 SQL 필요 시 (drizzle-kit이 테이블 재생성을 생성하지 않을 경우)

migration SQL을 수동으로 `src/store/migrations/0004_relations_dst_project.sql`에 작성하고, `0004_snapshot.json`은 `drizzle-kit generate`가 생성한 것을 유지. SQL만 교체.

### FK 토글 안전 장치

`connection.ts`의 `open()`에서 `PRAGMA foreign_keys = ON` 후 `migrate()` 실행됨.
테이블 재생성 migration 중 FK 검증 충돌 방지를 위해 **migrate 전후 FK 토글**:

```diff
 // connection.ts open() 수정
 this.client.run('PRAGMA journal_mode = WAL');
-this.client.run('PRAGMA foreign_keys = ON');
+this.client.run('PRAGMA foreign_keys = OFF');   // migration 중 FK 비활성화
 this.client.run('PRAGMA busy_timeout = 5000');
 this.drizzle = drizzle(this.client, { schema });
 migrate(this.drizzle, { migrationsFolder: ... });
+this.client.run('PRAGMA foreign_keys = ON');    // migration 후 FK 활성화
```

**이유**: SQLite PRAGMA foreign_keys는 트랜잭션 내에서 변경 불가. drizzle migrator가 트랜잭션 사용 시 SQL 내 PRAGMA 무효. connection 레벨에서 토글해야 안전.

**FK 정합성 검증 (safety net)**: FK ON 직전에 `PRAGMA foreign_key_check` 실행하여 migration 결과 검증:

```ts
migrate(this.drizzle, { migrationsFolder: ... });

// migration 결과 FK 정합성 검증
const violations = this.client.prepare('PRAGMA foreign_key_check').all();
if (violations.length > 0) {
  throw new Error(
    `FK integrity violation after migration: ${JSON.stringify(violations.slice(0, 5))}`
  );
}

this.client.run('PRAGMA foreign_keys = ON');
```

FK 위반이 발견되면 migration SQL에 오류가 있다는 의미이므로 즉시 에러. 정상 상황에서는 항상 빈 배열.

---

## 테스트 계획

### 기존 테스트 수정 (스키마 변경 반영)

| 파일 | 수정 내용 |
|------|----------|
| `src/store/schema.spec.ts` | `dstProject` 컬럼 존재 확인 테스트 |
| `src/store/repositories/relation.repository.spec.ts` | 모든 CRUD에 `dstProject` 포함. 크로스 프로젝트 INSERT/SELECT 테스트 추가. `replaceFileRelations` 원자성 테스트. `getIncoming`/`retargetRelations` named parameter 시그니처 테스트 |
| `src/indexer/relation-indexer.spec.ts` | `knownFiles` 필터링 테스트, `dstProject` 독립 결정 테스트, bare specifier 커스텀 resolver 테스트 |
| `src/indexer/index-coordinator.spec.ts` | `knownFiles` 구축 + 전달 테스트, 디렉터리 임포트 정확도 테스트, **processChanged 2-pass 구조** 테스트 |
| `src/search/relation-search.spec.ts` | `dstProject` 필터 테스트. `StoredCodeRelation` 반환 타입 + `dstProject` 매핑 테스트 |
| `src/extractor/extractor-utils.spec.ts` | `resolveBareSpecifier` 테스트. `resolveImport` `.d.ts` 후보 테스트 |
| `src/extractor/relation-extractor.spec.ts` | `resolveImportFn` DI 테스트 |
| `src/search/dependency-graph.spec.ts` | `additionalProjects` 크로스 프로젝트 테스트 |
| `src/gildash.spec.ts` | mock 데이터에 `dstProject` 추가 (L66-68) |
| `src/gildash/graph-api.spec.ts` | `getOrBuildGraph` boundaries 전달 테스트 |

### 새 테스트 시나리오

| 시나리오 | 테스트 파일 |
|----------|-----------|
| 디렉터리 임포트 (`./store` → `store/index.ts`) 정확 해석 | `relation-indexer.spec.ts` |
| bare specifier (`lodash`) → `node_modules/lodash/index.d.ts` 후보 | `extractor-utils.spec.ts` |
| bare specifier 서브패스 (`@scope/pkg/sub`) 후보 | `extractor-utils.spec.ts` |
| `resolveImport` `.d.ts` 후보 생성 확인 | `extractor-utils.spec.ts` |
| 크로스 프로젝트 relation (`default` → `@external/lodash`) INSERT 성공 | `relation.repository.spec.ts` |
| knownFiles에 없는 dstFilePath → relation 미생성 (FK 위반 방지) | `relation-indexer.spec.ts` |
| fullIndex 트랜잭션 내 FK 위반 없음 확인 | `index-coordinator.spec.ts` |
| 증분 2-pass: 동시 추가된 신규 파일 간 상호 참조 relation 생성 | `index-coordinator.spec.ts` |
| `replaceFileRelations` 원자성: 중간 실패 시 데이터 일관성 | `relation.repository.spec.ts` |
| `retargetRelations` dstProject 기반 WHERE/SET | `relation.repository.spec.ts` |
| 기존 데이터 마이그레이션 (`dstProject = project`) | `test/store.test.ts` |
| `DependencyGraph` 크로스 프로젝트 (`additionalProjects`) | `dependency-graph.spec.ts` |
| `StoredCodeRelation.dstProject` 매핑 + 타입 검증 | `relation-search.spec.ts` |

### 통합 테스트

| 파일 | 시나리오 |
|------|---------|
| `test/indexer.test.ts` | 실제 TS 파일들로 fullIndex 실행 → FK 위반 없음 확인 |
| `test/store.test.ts` | 마이그레이션 후 기존 데이터 정합성 확인 |

---

## 실행 순서 (의존 관계 기반)

### 모델 배정 기준

| 모델 | 배정 기준 | Step 수 |
|------|----------|--------|
| **Sonnet** | diff가 명확하고 기계적 반복 패턴. 필드 추가, 시그니처 변경, mock 업데이트, 타입 정의 등 | 9 |
| **Opus** | 다중 함수 조합, 제어 흐름 전면 교체, 트랜잭션 분리 등 구조적 판단이 필요한 변경 | 2 |

```
Step 1 [Sonnet] — 스키마 + 마이그레이션 + connection.ts FK 토글
├─ schema.ts: dstProject 컬럼 + dst FK 변경
├─ migration 0004 SQL (AUTOINCREMENT 시퀀스 복원 포함)
├─ migration meta JSON (_journal.json + 0004_snapshot.json via drizzle-kit)
├─ connection.ts: migrate 전후 FK OFF/ON 토글
└─ schema.spec.ts 수정

Step 2 [Sonnet] — relation.repository
├─ RelationRecord에 dstProject 추가
├─ 모든 CRUD 메서드 dstProject 반영 (모든 SELECT + INSERT)
├─ replaceFileRelations: dstProject fallback + 내부 트랜잭션 원자성
├─ getIncoming: named parameter 패턴 + WHERE dstProject
├─ retargetRelations: named parameter 패턴 + dstProject 기반 WHERE/SET
└─ relation.repository.spec.ts 수정

Step 3 [Sonnet] — extractor-utils
├─ resolveImport: .d.ts / /index.d.ts 후보 추가
├─ resolveBareSpecifier 함수 추가 (서브패스 포함)
└─ extractor-utils.spec.ts 수정

Step 4 [Sonnet] — relation-extractor
├─ extractRelations에 resolveImportFn DI
└─ relation-extractor.spec.ts 수정

Step 5 [Opus] — relation-indexer
├─ RelationDbRow에 dstProject 추가
├─ knownFiles 기반 커스텀 resolver 조립 (resolveImport + resolveBareSpecifier + knownFiles 필터 조합)
├─ dstProject 독립 결정 로직 (boundaries 기반)
└─ relation-indexer.spec.ts 수정

Step 6 [Opus] — index-coordinator
├─ useTransaction=true 경로: knownFiles Set 구축 + Pass 1/2 사이 삽입
├─ useTransaction=false 경로: processChanged 2-pass 구조로 전면 교체
├─ processChanged: Pass 2만 dbConnection.transaction()으로 보호
├─ processFile 메서드 삭제 (2-pass로 완전 대체)
├─ IndexCoordinatorOptions.relationRepo: getIncoming/retargetRelations named parameter 시그니처
├─ retargetRelations 호출처: named parameter 형태로 dstProject 전달
└─ index-coordinator.spec.ts 수정

Step 7 [Sonnet] — 공개 API 타입
├─ src/extractor/types.ts: 변경 없음 (CodeRelation 원본 유지)
├─ src/search/relation-search.ts: StoredCodeRelation 타입 정의 + dstProject 매핑 + 반환 타입 변경
└─ src/index.ts: StoredCodeRelation export 추가

Step 8 [Sonnet] — relation-search
├─ RelationSearchQuery에 dstProject 추가
├─ IRelationRepo 인터페이스 dstProject 추가
└─ relation-search.spec.ts 수정

Step 9 [Sonnet] — dependency-graph + graph-api
├─ DependencyGraph: additionalProjects 지원
├─ graph-api.ts: getOrBuildGraph에 boundaries 전달
├─ dependency-graph.spec.ts 수정
└─ graph-api.spec.ts 수정

Step 10 [Sonnet] — 호출처 전파 + mock 업데이트
├─ src/gildash.spec.ts: mock에 dstProject 추가
├─ test/store.test.ts: getIncoming/retargetRelations 테스트 업데이트
└─ test/indexer.test.ts: retargetRelations 테스트 업데이트

Step 11 [Sonnet] — 전체 GREEN 확인
├─ bun test (전체)
├─ bun test:coverage
├─ 통합 테스트 확인
└─ 실패 시 Opus로 에스컬레이션
```

각 Step은 Test-First Flow (OVERFLOW → PRUNE → RED → GREEN) 적용.
Step 간 의존: 1 → 2 → (3,4 병렬) → 5 → 6 → 7 → 8 → (9,10 병렬) → 11.

**실행 흐름**: Sonnet(1→2→3,4) → Opus(5→6) → Sonnet(7→8→9,10→11)

---

## 영향 범위 요약

| 구분 | 파일 수 | 목록 |
|------|---------|------|
| 소스 변경 | 12 | schema.ts, connection.ts, relation.repository.ts, extractor-utils.ts, relation-extractor.ts, relation-indexer.ts, index-coordinator.ts, relation-search.ts, types.ts (CodeRelation), dependency-graph.ts, graph-api.ts, (migration SQL) |
| 타입레벨 자동 반영 (code 변경 불필요) | 2 | context.ts — `ExtractRelationsFn` 4번째 파라미터 옵셔널+기본값이므로 타입 변경 불필요. query-api.ts — `RelationSearchQuery.dstProject` 추가로 타입 레벨 자동 확장, 코드 변경 없음 |
| 공개 타입 추가 | 1 | `StoredCodeRelation` (relation-search.ts에서 정의, src/index.ts에서 export) |
| 테스트 수정 | 12 | schema.spec.ts, relation.repository.spec.ts, extractor-utils.spec.ts, relation-extractor.spec.ts, relation-indexer.spec.ts, index-coordinator.spec.ts, relation-search.spec.ts, dependency-graph.spec.ts, graph-api.spec.ts, gildash.spec.ts, test/store.test.ts, test/indexer.test.ts |
| 통합 테스트 | 2 | test/store.test.ts, test/indexer.test.ts |
| 마이그레이션 | 1+meta | 0004_relations_dst_project.sql + _journal.json + 0004_snapshot.json |

---

## 리스크

| 항목 | 심각도 | 대응 |
|------|--------|------|
| SQLite 테이블 재생성 마이그레이션 | 중간 | 트랜잭션 내 실행. connection.ts에서 FK OFF/ON 토글 + `PRAGMA foreign_key_check`로 안전 보장 |
| `dstProject` 추가로 INSERT 로직 전체 수정 | 중간 | RelationRecord 타입이 강제 + fallback으로 컴파일 타임 검출 |
| knownFiles Set 구축 성능 (대규모 프로젝트) | 낮음 | Map → Set 변환 O(n). fullIndex/증분 모두 1회 구축으로 성능 영향 무시가능 |
| bare specifier 후보가 실제 파일과 불일치 | 낮음 | knownFiles 검증으로 이중 방어 |
| `resolveBareSpecifier` 현실적 무용 | 낮음 | 현재 node_modules 미인덱싱으로 knownFiles에 없음. 미래 `indexExternalPackages()` 구현 후 활성화되는 기반 코드 |
| 기존 테스트 대량 수정 | 중간 | RelationRecord mock 데이터에 dstProject 추가 필요 |
| AUTOINCREMENT 시퀀스 초기화 | 낮음 | migration SQL에 sqlite_sequence 복원 구문 포함 |
| `replaceFileRelations` 원자성 (증분) | 중간 | 내부 트랜잭션으로 DELETE+INSERT 감싸기 |
| `getIncoming`/`retargetRelations` 시그니처 변경 | 낮음 | named parameter 패턴으로 전환 — 파라미터 순서 실수가 컴파일 에러로 잡힘. 호출처 전파 리스트로 대응 |
| 증분 2-pass 구조 변경 | 중간 | processChanged 내부만 변경. 외부 API 영향 없음 |
| 증분 2-pass 원자성 분리 | 낮음 | Pass 2만 동기 트랜잭션으로 보호. Pass 1 crash 시 contentHash 불일치로 다음 증분에서 재처리 |
| `IndexCoordinatorOptions.relationRepo` 인터페이스 시그니처 | 낮음 | `getIncoming`/`retargetRelations` named parameter로 변경. 인터페이스와 구현체 동시 변경 필수. 잘못된 파라미터가 컴파일 에러로 감지됨 |
