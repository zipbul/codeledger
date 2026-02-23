# gildash 차기 구현 로드맵

## 개요

고객(firebat) 요청 21건 + 기존 계획 항목을 통합한 전체 로드맵.
gildash의 정체성을 **"TypeScript code intelligence engine"** 으로 확장한다.

핵심 엔진(파싱 → 추출 → 저장 → 검색)은 유지하면서, 그 위에 분석·매칭 기능을 쌓는 방향이다.

## 전체 작업 목록

### 인프라 전제조건 (Phase 0)

| ID | 항목 | 유형 | 의존 FR |
|----|------|------|---------|
| IMP-A | import relation에 `dstSymbolName` 기록 | 데이터 정밀화 | FR-07, FR-14 |
| IMP-B | re-export relation에 named specifier 기록 | 데이터 정밀화 | FR-06, FR-14 |
| IMP-C | 심볼 members 전체 정보 저장 (타입, kind, visibility) | 데이터 정밀화 | FR-09 |
| IMP-D | files 테이블에 `lineCount` 컬럼 추가 | 스키마 확장 | FR-10 |
| IMP-E | `type-references` 별도 relation type 분리 | 데이터 정밀화 | FR-06 |
| META | `CodeRelation.meta` 파싱 필드 추가 | 타입 확장 | — |

### Feature Requests (FR-01 ~ FR-21)

| FR | 기능 | 유형 | 전제조건 | Phase |
|----|------|------|----------|-------|
| FR-01 | scan-only 모드 (`watchMode: false`) + `close({ cleanup })` | 신규 옵션 | — | 1 |
| FR-02 | `batchParse(filePaths)` | 신규 API | — | 1 |
| FR-03 | `getImportGraph(project?)` | 신규 API | — | 1 |
| FR-04 | `getCyclePaths(project?)` | 신규 API | — | 1 |
| FR-05 | `listIndexedFiles(project?)` | 신규 API | — | 1 |
| FR-06 | relation type 확장 (re-exports + type-references) | 데이터 확장 | IMP-B, IMP-E | 2 |
| FR-07 | `getDeadExports(project?)` | 신규 API (분석) | IMP-A | 2 |
| FR-08 | `onIndexed` changedSymbols 포함 | 이벤트 확장 | Phase 0 안정화 | 2 |
| FR-09 | `getFullSymbol(symbolName, filePath)` | 신규 API | IMP-C | 2 |
| FR-10 | `getFileStats(filePath)` | 신규 API | IMP-D | 2 |
| FR-11 | `getModuleInterface(filePath)` | 신규 API (분석) | — | 1 |
| FR-12 | `getFanMetrics(filePath)` | 신규 API (분석) | FR-03 | 2 |
| FR-13 | `getTransitiveDependencies(filePath)` | 신규 API | — | 1 |
| FR-14 | `resolveSymbol(symbolName, filePath)` | 신규 API (분석) | IMP-A, IMP-B | 2 |
| FR-15 | `findPattern(pattern, opts?)` | 신규 API (매칭) | ast-grep 도입 | 3 |
| FR-16 | `indexExternalPackages(packages)` | 신규 API | 아키텍처 설계 | 3 |
| FR-17 | Cross-project search | 검색 확장 | — | 1 |
| FR-18 | `diffSymbols(before, after)` | 신규 API | — | 1 |
| FR-19 | `searchSymbols` regex 모드 | 검색 확장 | — | 1 |
| FR-20 | `getInternalRelations(filePath)` | 신규 API | — | 1 |
| FR-21 | `getHeritageChain(symbolName)` | 신규 API | — | 1 |

### 기존 계획 항목 (유지)

| ID | 항목 | 유형 | Phase |
|----|------|------|-------|
| LEG-1 | `SymbolSearchQuery.decorator` 필터 | 검색 확장 | 1 |
| LEG-2 | DependencyGraph 내부 캐싱 | 성능 최적화 | 4 |

## 의존관계

```
IMP-A (dstSymbolName) ──→ FR-07 (deadExports)
         │                  FR-14 (resolveSymbol)
         │
IMP-B (re-export specifier) ──→ FR-06 (relation 확장)
         │                        FR-14 (resolveSymbol)
         │
IMP-C (members full) ──→ FR-09 (getFullSymbol)
IMP-D (lineCount) ──→ FR-10 (getFileStats)
IMP-E (type-references) ──→ FR-06 (relation 확장)
META (CodeRelation.meta) ──→ FR-06에서 meta.specifiers 접근

FR-03 (getImportGraph) ──→ FR-12 (getFanMetrics)
Phase 0 안정화 ──→ FR-08 (changedSymbols — 심볼 단위 diff 로직 필요)

FR-01~05, 11, 13, 17~21, LEG-1 ──→ 독립 (전제조건 없음)
LEG-2 (graph 캐싱) ──→ FR-04 완료 후 적용 (getCyclePaths도 캐시 대상)
```

## Phase 0: 인프라 전제조건 (IMP-A, IMP-B, IMP-C, IMP-D, IMP-E, META)

Phase 1~2의 FR들이 의존하는 데이터 기반을 확보한다.

---

### IMP-A: import relation에 `dstSymbolName` 기록

**목적**: `import { Foo } from './bar'`에서 `Foo`를 relation의 `dstSymbolName`에 기록.
현재 모든 import relation의 `dstSymbolName`이 `null`이다.

**변경 파일**:
- `src/extractor/imports-extractor.ts`
- `src/extractor/imports-extractor.spec.ts`

**구현**:

`ImportDeclaration` 처리 시 각 specifier의 imported name을 `dstSymbolName`에 기록.
named import는 specifier별로 별도 relation을 생성한다.

```typescript
// 현재 (단일 relation, dstSymbolName: null)
relations.push({
  type: 'imports',
  srcFilePath: filePath,
  srcSymbolName: null,
  dstFilePath: resolvedPath,
  dstSymbolName: null,        // ← 여기가 문제
  metaJson: null,
});

// 변경 후 (named import: specifier별 relation 생성)
// import { Foo, Bar as Baz } from './bar'
// → relation 1: dstSymbolName = 'Foo'
// → relation 2: dstSymbolName = 'Bar'
for (const specifier of node.specifiers) {
  relations.push({
    type: 'imports',
    srcFilePath: filePath,
    srcSymbolName: specifier.local.name,
    dstFilePath: resolvedPath,
    dstSymbolName: specifier.imported?.name ?? specifier.local.name,
    metaJson: JSON.stringify({
      importKind: specifier.type, // ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier
    }),
  });
}
```

- `import Foo from './bar'` → `dstSymbolName: 'default'`
- `import * as Foo from './bar'` → `dstSymbolName: '*'` + `metaJson: { importKind: 'namespace' }`
- `import { Foo } from './bar'` → `dstSymbolName: 'Foo'`
- `import { Foo as Bar } from './bar'` → `srcSymbolName: 'Bar'`, `dstSymbolName: 'Foo'`

**테스트**:
- named import → 각 specifier마다 개별 relation, dstSymbolName 기록
- default import → dstSymbolName = 'default'
- namespace import → dstSymbolName = '*'
- alias import → srcSymbolName = alias, dstSymbolName = original
- side-effect import (`import './foo'`) → dstSymbolName = null 유지
- 기존 테스트 호환성 확인

**참고**: `src/extractor/extractor-utils.ts`의 `buildImportMap()`이 이미 specifiers를 파싱하여
`ImportSpecifier`, `ImportDefaultSpecifier`, `ImportNamespaceSpecifier`를 처리 중.
IMP-A 구현 시 이 로직을 `imports-extractor.ts`에서 재사용(공유 헬퍼 추출)하여 중복을 방지한다.

**dynamic import 처리**: `import()` 표현식(`ImportExpression`)은 specifier를 정적으로 추출할 수 없으므로
현행 단일 relation (`dstSymbolName: null`, `metaJson: { isDynamic: true }`) 동작을 유지한다.

**호환성**: 기존에 dstSymbolName이 항상 null이었으므로, null을 기대하는 소비자는 없을 것으로 판단.
단, named import의 relation 개수가 늘어남 (named import가 단일 relation → specifier별 N개로 분할).
side-effect import와 dynamic import는 기존과 동일하게 단일 relation.
하위 호환 확인 필요.

---

### IMP-B: re-export relation에 named specifier 기록

**목적**: `export { A, B as C } from './foo'`에서 어떤 이름이 re-export되는지 기록.

**변경 파일**:
- `src/extractor/imports-extractor.ts`
- `src/extractor/imports-extractor.spec.ts`

**구현**:

`ExportNamedDeclaration` 처리 시 specifiers 배열에서 local/exported 이름을 추출하여 metaJson에 포함.

```typescript
// 현재
metaJson: JSON.stringify({ isReExport: true })

// 변경 후
metaJson: JSON.stringify({
  isReExport: true,
  specifiers: [
    { local: 'A', exported: 'A' },
    { local: 'B', exported: 'C' },
  ],
})
```

`ExportAllDeclaration`은 개별 이름이 없으므로 변경하지 않는다 (`{ isReExport: true }` 유지).

**테스트**:
- `export { A } from './foo'` → metaJson에 `specifiers: [{ local: 'A', exported: 'A' }]`
- `export { A as B } from './foo'` → `specifiers: [{ local: 'A', exported: 'B' }]`
- `export { A, B, C } from './foo'` → specifiers 3개
- `export * from './foo'` → specifiers 없음 (기존 동작 유지)
- `export type { T } from './foo'` → isType + specifiers 둘 다 포함

**참고**: `export type { T } from './foo'`에서 `node.exportKind === 'type'`으로 타입 re-export 감지.
IMP-E에서 type 분리 시 이 `exportKind` 체크도 함께 적용.

---

### IMP-C: 심볼 members 전체 정보 저장

**목적**: 클래스/인터페이스 멤버의 이름뿐 아니라 타입, kind, visibility도 저장.
현재 `buildDetailJson`에서 `members.map(m => m.name)` — 이름만 저장 중.

**변경 파일**:
- `src/indexer/symbol-indexer.ts` — `buildDetailJson` 수정
- `src/indexer/symbol-indexer.spec.ts`

**구현**:

```typescript
// 현재
members: symbol.members?.map(m => m.name),

// 변경 후
// ExtractedSymbol의 실제 필드 매핑:
//   m.kind → SymbolKind ('method' | 'property')
//   m.methodKind → 'method' | 'getter' | 'setter' | 'constructor' | undefined
//   m.returnType → 타입 annotation 문자열 (property/method 공통)
//   m.modifiers[] → visibility('private'|'protected'|'public'), 'static', 'readonly', etc.
//   m.parameters → Parameter[] (method일 때)
members: symbol.members?.map(m => {
  const visibility = m.modifiers.find(mod =>
    mod === 'private' || mod === 'protected' || mod === 'public',
  );
  return {
    name: m.name,
    kind: m.methodKind ?? m.kind,  // 'getter'|'setter'|'constructor'|'method'|'property'
    type: m.returnType,             // 타입 annotation 문자열
    visibility,                     // 'public' | 'private' | 'protected' | undefined
    isStatic: m.modifiers.includes('static') || undefined,
    isReadonly: m.modifiers.includes('readonly') || undefined,
  };
}),
```

**호환성**: detailJson의 members 형태가 `string[]` → `object[]`로 변경됨.
기존에 members를 소비하는 코드가 있다면 영향. 확인 필요.

**테스트**:
- 클래스 멤버 (MethodDefinition) → name, kind='method', type(returnType), visibility 저장 확인
- 클래스 getter → kind='getter' (methodKind에서 추출)
- 클래스 property (PropertyDefinition) → name, kind='property', type(returnType) 저장 확인
- 인터페이스 멤버 (TSPropertySignature) → name, kind='property', type, isReadonly 저장 확인
- 인터페이스 메서드 (TSMethodSignature) → name, kind='method', parameters 저장 확인
- 멤버가 없는 심볼 → members: undefined 유지
- static 멤버 → isStatic: true, private 멤버 → visibility: 'private'

---

### IMP-D: files 테이블에 `lineCount` 컬럼 추가

**목적**: 파일의 라인 수를 인덱싱 시 함께 저장.

**변경 파일**:
- `src/store/schema.ts` — files 테이블에 `line_count` 컬럼
- `src/store/migrations/` — 새 마이그레이션 파일
- `src/indexer/file-indexer.ts` — 인덱싱 시 라인 수 계산
- `src/store/repositories/file.repository.ts` — FileRecord에 lineCount 포함
- 관련 spec 파일들

**구현**:

```typescript
// schema.ts
lineCount: integer('line_count'),
```

```typescript
// file-indexer.ts — 인덱싱 시
const lineCount = content.split('\n').length;
```

**마이그레이션**: `ALTER TABLE files ADD COLUMN line_count INTEGER;`

**테스트**:
- 인덱싱 후 파일의 lineCount 조회 가능
- 빈 파일 → lineCount = 1
- 여러 줄 파일 → 정확한 라인 수
- 기존 DB에서 마이그레이션 → line_count = null (기존 레코드)

---

### IMP-E: `type-references` 별도 relation type 분리

**목적**: `import type`과 `import`를 relation type 수준에서 구분.
현재 둘 다 `type: 'imports'`로 기록되며, type-only는 `metaJson: { isType: true }`로만 구분 가능.
이를 별도 relation type `'type-references'`로 분리한다.

**변경 파일**:
- `src/extractor/imports-extractor.ts` — type-only import/re-export의 relation type 변경
- `src/extractor/types.ts` — `CodeRelation.type`에 `'type-references'` 추가
- `src/extractor/imports-extractor.spec.ts`

**구현**:

```typescript
// 현재
const isType = node.importKind === 'type';
relations.push({
  type: 'imports',
  ...(isType ? { metaJson: JSON.stringify({ isType: true }) } : {}),
});

// 변경 후 — statement-level + specifier-level 모두 처리
// Case 1: statement-level (import type { Foo } from './bar')
const isType = node.importKind === 'type';

// Case 2: specifier-level (import { type Foo, Bar } from './baz')
// → IMP-A에서 specifier loop 도입 후, 각 specifier의 importKind도 체크
for (const specifier of node.specifiers) {
  // specifier.importKind === 'type' (inline type modifier)
  const specIsType = isType || specifier.importKind === 'type';
  relations.push({
    type: specIsType ? 'type-references' : 'imports',
    ...(specIsType ? { metaJson: JSON.stringify({ isType: true }) } : {}),
  });
}
```

**주의**: `import { type Foo, Bar } from './baz'` — `Foo`는 `type-references`, `Bar`는 `imports`.
statement-level(`node.importKind`)과 specifier-level(`specifier.importKind`) **모두** 처리해야 한다.

- `import type { Foo } from './bar'` → `type: 'type-references'` (statement-level)
- `import { Foo } from './bar'` → `type: 'imports'`
- `import { type Foo, Bar } from './bar'` → Foo: `'type-references'`, Bar: `'imports'` (specifier-level)
- `export type { T } from './foo'` → `type: 'type-references'` + `meta.isReExport: true`
- ExportNamedDeclaration의 `exportKind === 'type'`도 동일 패턴으로 처리

`meta.isType`은 하위 호환을 위해 함께 유지한다.

**테스트**:
- `import type { Foo }` → type: 'type-references' (statement-level)
- `import { Foo }` → type: 'imports' (변경 없음)
- `import { type Foo, Bar }` → Foo: 'type-references', Bar: 'imports' (specifier-level)
- `export type { T } from './foo'` → type: 'type-references' + isReExport
- `export { A } from './foo'` → type: 이전과 동일 (Phase 0에서는 'imports', FR-06 적용 후 're-exports')
- relation 검색 시 type 필터로 type-references만 조회

---

### META: CodeRelation.meta 파싱 필드 추가

**목적**: `metaJson` (string)을 매번 JSON.parse하지 않고 `meta` 객체로 직접 접근.

**변경 파일**:
- `src/extractor/types.ts` — `CodeRelation`에 `meta` 필드 추가
- `src/search/relation-search.ts` — 반환 시 자동 파싱
- `src/search/relation-search.spec.ts`

**구현**:

```typescript
// extractor/types.ts — CodeRelation 변경
// 주의: 're-exports'는 Phase 2(FR-06)에서 도입. Phase 0에서는 type union에 선언만 해두고 실제 사용은 FR-06에서.
export interface CodeRelation {
  type: 'imports' | 'type-references' | 're-exports' | 'calls' | 'extends' | 'implements';
  srcFilePath: string;
  srcSymbolName: string | null;
  dstFilePath: string;
  dstSymbolName: string | null;
  /** @deprecated Use `meta` instead. Kept for backward compatibility. */
  metaJson?: string;
  /** Parsed metadata object. */
  meta?: Record<string, unknown>;
}
```

```typescript
// relation-search.ts — 반환 시 파싱 (try-catch로 malformed JSON 방어)
return records.map(r => {
  let meta: Record<string, unknown> | undefined;
  if (r.metaJson) {
    try { meta = JSON.parse(r.metaJson); }
    catch { logger.error('[relationSearch] malformed metaJson:', r.metaJson); }
  }
  return {
    type: r.type as CodeRelation['type'],
    srcFilePath: r.srcFilePath,
    srcSymbolName: r.srcSymbolName,
    dstFilePath: r.dstFilePath,
    dstSymbolName: r.dstSymbolName,
    metaJson: r.metaJson ?? undefined,
    meta,
  };
});
```

**참고 — DependencyGraph 수정 필요**:
IMP-E와 FR-06 도입 후 `type-references`와 `re-exports` relation이 `'imports'`에서 분리됨.
`DependencyGraph.build()`는 현재 `getByType(project, 'imports')`만 조회 중.

해결:
- `DependencyGraph.build()`를 3개 타입 모두 조회하도록 수정:
  `['imports', 'type-references', 're-exports'].flatMap(t => relationRepo.getByType(project, t))`
- 대안: `getByTypes(project, types[])` 메서드 추가와 옵션 파라미터 `includeTypeReferences?: boolean`

**영향 범위**: FR-03(getImportGraph), FR-04(getCyclePaths), FR-12(getFanMetrics),
FR-13(getTransitiveDependencies), `getAffected()`, `hasCycle()` 모두 DependencyGraph 사용.
Phase 0에서 IMP-E 적용 시 DependencyGraph.build() 동시 수정 필수.

**변경 파일 (추가)**:
- `src/search/dependency-graph.ts` — `build()`에서 `type-references`, `re-exports`도 포함
- `src/search/dependency-graph.spec.ts`

**호환성**: `metaJson`은 `@deprecated`로 유지. breaking change 아님.

**테스트**:
- metaJson이 있는 relation → meta에 파싱된 객체 존재
- metaJson이 null/undefined → meta도 undefined
- metaJson이 malformed JSON → undefined 반환 + 로깅

---

## Phase 1: 독립 Feature Requests

전제조건 없이 즉시 구현 가능한 항목. 병렬 진행 가능.

---

### FR-01: scan-only 모드

**목적**: watcher 없이 최초 인덱싱만 수행하고 쿼리 가능 상태로 유지하는 모드.
CI/CD, 일회성 분석 등에서 유용. `open → fullIndex → API 호출 → close` 흐름.

**변경 파일**:
- `src/gildash.ts` — `open()` 옵션에 `watchMode` 추가, `close()` 옵션에 `cleanup` 추가
- `src/watcher/project-watcher.ts` — watcher 생성 조건 분기
- `src/gildash.spec.ts`

**구현**:
`GildashOptions`에 `watchMode?: boolean` (기본값: `true`) 추가.
`false`일 경우:

1. **DB 생성 + 스키마 마이그레이션**: 포함 (role 분기 이전에 실행되므로 항상 수행)
2. **ownership 경합 (`acquireWatcherRole`)**: 생략
3. **heartbeat interval (30초)**: 생략
4. **signal handler (SIGTERM/SIGINT/beforeExit)**: 생략
5. **fullIndex**: 실행
6. **쿼리 가능 상태 유지**: `close()` 호출까지 모든 검색/분석 API 사용 가능

**role 값**: `watchMode: false`일 때 `role`은 `'owner'`로 설정.
ownership 경합은 생략하지만, coordinator/fullIndex를 실행하므로 `reindex()`도 사용 가능.
watcher만 생성하지 않으므로 파일 변경 자동 감지는 안 됨.

`close()` 시그니처 확장:
```typescript
close(opts?: { cleanup?: boolean }): Promise<Result<void, GildashError>>
```
- `cleanup: false` (기본값) → DB 유지 → 다음 scan 시 incremental indexing 가능
- `cleanup: true` → DB 파일(.db, -wal, -shm) 삭제 → 디스크 오염 없음

`reindex()`는 여전히 수동 호출 가능.

**테스트**:
- `watchMode: false` → watcher 미생성 확인
- `watchMode: false` → heartbeat, signal handler 미등록 확인
- `watchMode: false` → ownership 경합 건너뜀 확인
- 최초 인덱싱 정상 완료
- 인덱싱 후 검색 API 사용 가능
- 파일 변경 시 자동 재인덱싱 안 됨
- `reindex()` 수동 호출은 동작
- `close({ cleanup: true })` → DB 파일 삭제 확인
- `close({ cleanup: false })` → DB 파일 유지 확인
- closed → Err('closed')

---

### FR-02: batchParse

**목적**: 여러 파일의 AST를 한 번에 파싱하여 반환.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**구현**:
```typescript
batchParse(filePaths: string[]): Result<Map<string, ParsedFile>, GildashError>
```
내부적으로 기존 `parseSource()`를 각 파일에 대해 호출.
에러가 발생한 파일은 결과에서 제외하되 전체 실패하지 않음.

**테스트**:
- 여러 파일 → 각 파일의 ParsedFile 반환
- 일부 파일 파싱 실패 → 성공한 파일만 반환
- 빈 배열 → 빈 Map
- 존재하지 않는 파일 → 해당 파일만 제외

---

### FR-03: getImportGraph

**목적**: import 의존성 그래프를 adjacency list 형태로 반환.

**변경 파일**:
- `src/search/dependency-graph.ts` — `getAdjacencyList()` 메서드
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**구현**:
```typescript
getImportGraph(project?: string): Result<Map<string, string[]>, GildashError>
```
`DependencyGraph`의 내부 adjacency list를 복제하여 반환.
현재 `DependencyGraph`는 이미 adjacency list를 구축하므로 getter만 추가.

**테스트**:
- 인덱싱 후 → 파일 간 import 관계가 Map으로 반환
- 고립 파일(import 없음) → key는 존재하되 value는 빈 배열
- 빈 프로젝트 → 빈 Map
- closed → Err('closed')

---

### FR-04: getCyclePaths

**목적**: `hasCycle()` boolean 대신 실제 순환 경로를 배열로 반환.

**변경 파일**:
- `src/search/dependency-graph.ts` — `getCyclePaths()` 메서드
- `src/search/dependency-graph.spec.ts`
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**구현**:
DFS 탐색 시 pathStack을 유지하고, cycle 발견 시 경로를 추출.
중복 방지를 위해 canonical form(최소 노드부터 시작) 정규화.

```typescript
getCyclePaths(): string[][]
```

**테스트**:
- 순환 없음 → 빈 배열
- A→B→A → `[['A', 'B']]`
- A→B→C→A → `[['A', 'B', 'C']]`
- 독립 순환 2개 → 배열에 2개 cycle
- self-loop → `[['A']]`
- closed → Err('closed')

---

### FR-05: listIndexedFiles

**목적**: 인덱싱된 전체 파일 목록 반환. 심볼 0개 파일도 포함.

**변경 파일**:
- `src/gildash.ts` — fileRepo 타입 확장 + public method
- `src/gildash.spec.ts`

**구현**:
fileRepo 타입을 `Pick<FileRepository, 'getFile' | 'getAllFiles'>`로 확장.

```typescript
listIndexedFiles(project?: string): Result<FileRecord[], GildashError>
```

**테스트**:
- 인덱싱 후 → 파일 목록 반환
- 심볼 없는 파일도 포함
- closed → Err('closed')
- 빈 프로젝트 → 빈 배열

---

### FR-08: onIndexed changedSymbols 포함 (**Phase 2로 이동**)

> **난이도 재평가**: 기존에 "전달만 추가"로 평가했으나, firebat 리뷰에서 정확히 지적된 대로
> 현재 `IndexCoordinator.doIndex()`에 심볼 단위 diff 로직이 존재하지 않음.
> fullIndex는 전체 삭제→재삽입, incremental은 `replaceFileSymbols()` 직접 호출.
> Phase 0의 인프라 변경(IMP-A~E) 안정화 후 구현하는 것이 합리적.

**목적**: `onIndexed` 콜백에 변경된 심볼 목록(추가/수정/삭제)을 포함.

**변경 파일**:
- `src/indexer/index-coordinator.ts` — 심볼 스냅샷 비교 로직 + `IndexResult`에 changedSymbols 추가
- `src/gildash.ts` — 콜백 타입 업데이트
- `src/indexer/index-coordinator.spec.ts`

**의존**: Phase 0 안정화 (IMP-A~E로 심볼/relation 구조 변경 후 fingerprint 기준 확정)

**fingerprint 기준 정의**:
현재 fingerprint = `hash(name + '|' + kind + '|' + signature)`. signature는 함수일 때 `params:{count}|async:{0|1}`.
IMP-C 후에도 members는 fingerprint에 **포함하지 않는다** (detailJson에만 반영).
이유: members 변경(부수 정보)으로 부모 심볼 fingerprint이 변하면 diff가 과다.
chanedSymbols의 `modified`는 fingerprint 변경(시그니처 변경)만 감지.
멤버 변경 감지가 필요하면 detailJson의 members hash를 별도로 비교하는 확장을 향후 고려.

**구현**:
실질적 신규 로직이 필요:
1. **인덱싱 전** 기존 심볼의 fingerprint 스냅샷 저장 (`getFileSymbols()` → Map)
2. **인덱싱 후** 새 심볼의 fingerprint와 비교
3. name+filePath 기준 매칭 → fingerprint 불일치 = modified
4. fullIndex 시: transaction 전에 전체 심볼 스냅샷을 미리 확보

```typescript
// IndexResult 확장
interface IndexResult {
  // ... 기존 필드
  changedSymbols: {
    added: Array<{ name: string; filePath: string; kind: string }>;
    modified: Array<{ name: string; filePath: string; kind: string }>;
    removed: Array<{ name: string; filePath: string; kind: string }>;
  };
}
```

**주의**: Phase 0 직후 첫 fullIndex에서 기준 스냅샷이 없거나 구조가 변경된 경우,
모든 심볼이 `'added'`로 보고될 수 있음. 이는 정상 동작으로 문서화.

**테스트**:
- 파일 추가 → changedSymbols.added에 새 심볼
- 파일 수정 (심볼 시그니처 변경) → changedSymbols.modified
- 파일 삭제 → changedSymbols.removed에 제거된 심볼
- 변경 없음 → 모두 빈 배열
- fullIndex → 스냅샷 비교 동작 확인
- Phase 0 직후 첫 인덱싱 → 모든 심볼이 added로 보고

---

### FR-11: getModuleInterface

**목적**: 특정 파일의 exported 심볼 목록을 구조화하여 반환. "이 모듈의 공개 인터페이스"를 한 눈에.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**구현**:
```typescript
interface ModuleInterface {
  filePath: string;
  exports: Array<{
    name: string;
    kind: SymbolKind;
    parameters?: string;
    returnType?: string;
    jsDoc?: string;
  }>;
}

getModuleInterface(filePath: string, project?: string): Result<ModuleInterface, GildashError>
```
내부적으로 `searchSymbols({ filePath, isExported: true })` + detailJson 파싱의 조합.

**테스트**:
- exported 함수, 클래스, 타입 → 모두 포함
- internal(non-exported) → 제외
- 빈 파일 → exports: []
- 존재하지 않는 파일 → Err

---

### FR-13: getTransitiveDependencies

**목적**: 특정 파일이 직·간접적으로 의존하는 모든 파일 목록.
현재 `getTransitiveDependents()`(역방향)만 존재. 정방향 추가.

**변경 파일**:
- `src/search/dependency-graph.ts` — `getTransitiveDependencies()` 메서드
- `src/search/dependency-graph.spec.ts`
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**구현**:
`getTransitiveDependents()`와 동일한 BFS를 정방향(`getDependencies`)으로 수행.

```typescript
getTransitiveDependencies(filePath: string): string[]
```

**테스트**:
- A→B→C → A의 transitive deps = [B, C]
- 의존성 없음 → 빈 배열
- 순환 → 무한 루프 방지 (visited set)
- closed → Err('closed')

---

### FR-17: Cross-project search

**목적**: 프로젝트 경계를 넘어 전체 인덱스를 대상으로 심볼/관계 검색.

**변경 파일**:
- `src/gildash.ts` — public method 추가 (`searchSymbols`, `searchRelations`에 project=undefined 전달)
- `src/gildash.spec.ts`

**참고**: repository 레이어는 이미 `project === undefined` 시 WHERE 조건 생략을 지원 중.
`symbol.repository.ts`의 `searchByQuery()`와 `relation.repository.ts`의 `searchRelations()` 모두
`opts.project !== undefined ? eq(project) : undefined` 패턴으로 구현되어 있음.
Gildash 래퍼에서 `project` 파라미터를 적절히 전달하는 것만 필요.

**구현**:
기존 `SymbolSearchQuery.project`와 `RelationSearchOptions.project`가 `undefined`일 때
WHERE 조건에서 project 필터를 제거하여 전체 대상 검색.

**테스트**:
- project 지정 → 해당 프로젝트만
- project 생략 → 전체 프로젝트
- 여러 프로젝트에 동일 이름 심볼 → 모두 반환

---

### FR-18: diffSymbols

**목적**: 두 시점의 심볼 상태를 비교하여 추가/삭제/변경 목록 반환.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**구현**:
```typescript
interface SymbolDiff {
  added: SymbolSearchResult[];
  removed: SymbolSearchResult[];
  modified: Array<{ before: SymbolSearchResult; after: SymbolSearchResult }>;
}

diffSymbols(
  before: SymbolSearchResult[],
  after: SymbolSearchResult[],
): SymbolDiff
```
fingerprint 기반 비교로 변경 감지. 이름+파일 기준으로 매칭 후 fingerprint 불일치 → modified.

**테스트**:
- 새 심볼 추가 → added에 포함
- 심볼 삭제 → removed에 포함
- 심볼 변경 → modified에 before/after 쌍
- 동일 → 모두 빈 배열

---

### FR-19: searchSymbols regex 모드

**목적**: FTS 기반 검색 외에 정규식으로 심볼 이름 검색.

**변경 파일**:
- `src/search/symbol-search.ts` — `SymbolSearchQuery`에 `regex` 옵션
- `src/store/repositories/symbol.repository.ts` — regex 조건 처리
- 관련 spec 파일들

**구현**:
`SymbolSearchQuery`에 `regex?: string` 추가.
Bun의 `bun:sqlite`는 `Database.prototype.function(name, fn)` 메서드로 커스텀 함수 등록 지원.
`DbConnection`에 raw `Database` 인스턴스 접근을 추가하여 REGEXP 함수 등록.

```typescript
// connection.ts — open() 후 REGEXP 등록
this.rawDb.function('regexp', (pattern: string, value: string) => {
  return new RegExp(pattern).test(value) ? 1 : 0;
});
```

```sql
-- repository에서 활용
SELECT * FROM symbols WHERE name REGEXP ?
```

대안: DB에서 전체 조회 후 JS에서 `RegExp.test()` 후필터링 (성능은 낮지만 구현 단순).

**테스트**:
- `/^get.*/` → get으로 시작하는 심볼
- `/.*Service$/` → Service로 끝나는 심볼
- 잘못된 regex → Err
- regex + kind 조합

---

### FR-20: getInternalRelations

**목적**: 특정 파일 내부의 심볼 간 관계(함수 호출, 상속 등) 반환.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**구현**:
```typescript
getInternalRelations(filePath: string, project?: string): Result<CodeRelation[], GildashError>
```
기존 relation 검색에서 `srcFilePath === dstFilePath === filePath`인 것만 필터.
**데이터는 이미 존재** — calls-extractor와 heritage-extractor가 intra-file 관계를 기록 중.

**테스트**:
- 파일 내 함수 호출 → calls relation 반환
- 파일 내 상속 → extends/implements relation 반환
- 다른 파일 관계 → 제외
- 관계 없음 → 빈 배열

---

### FR-21: getHeritageChain

**목적**: extends/implements 관계를 재귀 추적하여 상속 체인 반환.

**변경 파일**:
- `src/search/relation-search.ts` — transitive heritage walk
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**구현**:
```typescript
interface HeritageNode {
  symbolName: string;
  filePath: string;
  kind: 'extends' | 'implements';
  children: HeritageNode[];
}

getHeritageChain(symbolName: string, filePath: string, project?: string): Result<HeritageNode, GildashError>
```
relation DB에서 extends/implements를 재귀적으로 따라가며 트리 구축.
순환 참조 방지를 위한 visited set.

**테스트**:
- A extends B extends C → A의 chain = { A → { B → { C } } }
- A implements I1, I2 → 두 가지 implements 분기
- 순환 → 무한 루프 방지
- 존재하지 않는 심볼 → 빈 트리

---

### LEG-1: SymbolSearchQuery.decorator 필터

**목적**: 데코레이터 이름으로 심볼 검색 필터링.

**변경 파일**:
- `src/search/symbol-search.ts` — `SymbolSearchQuery`에 `decorator` 필드 추가
- `src/store/repositories/symbol.repository.ts` — `searchByQuery`에 decorator 조건 추가
- 관련 spec 파일들

**구현**:
SQLite의 `json_each()` + `json_extract()`를 활용:

```sql
WHERE s.id IN (
  SELECT s2.id FROM symbols s2, json_each(s2.detail_json, '$.decorators') je
  WHERE json_extract(je.value, '$.name') = ?
)
```

**테스트**:
- `@Injectable` 클래스 검색 → 해당 클래스만 반환
- decorator 없는 심볼 → 제외
- 존재하지 않는 decorator → 빈 배열
- decorator + kind 조합 필터

---

## Phase 2: 의존 Feature Requests

Phase 0의 인프라 작업 완료 후 진행.

---

### FR-06: relation type 확장 (re-exports + type-references)

**목적**: re-export와 type-only import를 별도 relation type으로 구분하고, specifiers를 meta로 노출.

**변경 파일**:
- `src/extractor/types.ts` — CodeRelation.type에 `'re-exports'` + `'type-references'` 추가
- `src/extractor/imports-extractor.ts` — re-export 시 type을 `'re-exports'`로, type-only 시 `'type-references'`로
- `src/search/relation-search.ts` — 필터 지원
- 관련 spec 파일들

**의존**: IMP-B (re-export specifier 기록), IMP-E (type-references 분리)

**구현**:
IMP-B에서 specifiers가 기록되고, IMP-E에서 type-references가 분리된 상태에서:
- `export { A } from './foo'` → type: `'re-exports'`
- `export * from './foo'` → type: `'re-exports'` (현재 `'imports'` + `isReExport: true`에서 변경)
- `export type { T } from './foo'` → type: `'type-references'` + `meta.isReExport: true`
- `import { A } from './foo'` → type: `'imports'` (변경 없음)
- `import type { T } from './foo'` → type: `'type-references'`

**주의**: `ExportAllDeclaration` (`export * from`)도 `'re-exports'`로 전환.
현재 `type: 'imports'` + `{ isReExport: true }`인 동작을 `type: 're-exports'` + `{ isReExport: true }`로 변경.

`meta.specifiers`를 통해 re-export specifier에 접근 가능 (META 항목 의존).

**테스트**:
- `export { A } from './foo'` → type: 're-exports'
- `export * from './foo'` → type: 're-exports' (ExportAllDeclaration 전환 확인)
- `export type { T } from './foo'` → type: 'type-references' + isReExport
- `import { A } from './foo'` → type: 'imports' (변경 없음)
- `import type { T } from './foo'` → type: 'type-references'
- `import { type Foo, Bar } from './baz'` → Foo: 'type-references', Bar: 'imports'
- relation 검색 시 type 필터로 re-exports, type-references 각각 조회
- DependencyGraph.build()에서 're-exports', 'type-references' 포함 확인
- api-drift, modification-impact 분석에서 값 참조와 타입 참조 구분 가능

---

### FR-07: getDeadExports

**목적**: 프로젝트 내에서 어디서도 import되지 않는 exported 심볼 탐지.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**의존**: IMP-A (dstSymbolName 기록)

**구현**:
```typescript
getDeadExports(project?: string): Result<Array<{ symbolName: string; filePath: string }>, GildashError>
```
1. 모든 exported 심볼 목록 수집
2. 모든 import relation의 dstSymbolName 수집
3. 차집합 = dead exports

Entry point 파일의 exports는 제외 옵션.

```typescript
getDeadExports(
  project?: string,
  opts?: { entryPoints?: string[] },
): Result<Array<{ symbolName: string; filePath: string }>, GildashError>
```

`entryPoints`를 명시하면 해당 파일의 exports를 dead에서 제외.
생략 시 `['index.ts', 'index.mts', 'main.ts']`를 기본 entry point로 간주하고,
project root 기준 쉼로우 매칭으로 판별.

**테스트**:
- export되었지만 import 안 됨 → dead
- export되고 import됨 → 제외
- re-export된 심볼 → 제외
- entry point의 export → 옵션에 따라 제외

---

### FR-09: getFullSymbol

**목적**: 심볼의 전체 상세 정보(멤버 포함)를 반환.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**의존**: IMP-C (members 전체 저장)

**구현**:
내부적으로 기존 `searchByQuery({ exactName: symbolName, filePath })` 사용.
`getById()` 추가 불필요 — name+filePath 조합으로 식별 가능.

```typescript
interface FullSymbol extends SymbolSearchResult {
  members?: Array<{
    name: string;
    kind: string;           // 'method' | 'getter' | 'setter' | 'constructor' | 'property'
    type?: string;          // returnType / type annotation
    visibility?: string;    // 'public' | 'private' | 'protected'
    isStatic?: boolean;
    isReadonly?: boolean;
  }>;
  jsDoc?: string;
  parameters?: string;
  returnType?: string;
  heritage?: string[];
  decorators?: Array<{ name: string; arguments?: string }>;
  typeParameters?: string;
}

getFullSymbol(symbolName: string, filePath: string, project?: string): Result<FullSymbol, GildashError>
```

**테스트**:
- 클래스 → members 전체 정보 포함
- 함수 → parameters, returnType 포함
- 존재하지 않는 심볼 → Err
- closed → Err('closed')

---

### FR-10: getFileStats

**목적**: 파일의 라인 수, 심볼 수, relation 수 등 통계 반환.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**의존**: IMP-D (lineCount 스키마)

**구현**:
```typescript
interface FileStats {
  filePath: string;
  lineCount: number;
  symbolCount: number;
  relationCount: number;
  size: number;
  exportedSymbolCount: number;
}

getFileStats(filePath: string, project?: string): Result<FileStats, GildashError>
```
files 테이블의 lineCount + symbols/relations 테이블의 COUNT 집계.

**테스트**:
- 인덱싱된 파일 → 모든 통계 반환
- 존재하지 않는 파일 → Err
- 심볼 없는 파일 → symbolCount: 0

---

### FR-12: getFanMetrics

**목적**: 파일의 fan-in(이 파일을 import하는 수), fan-out(이 파일이 import하는 수) 계산.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**의존**: DependencyGraph (이미 존재 — `getDependents()`, `getDependencies()` 사용)

**참고**: FR-03(getImportGraph) 없이도 구현 가능. DependencyGraph를 직접 빌드하여
`getDependents().length`, `getDependencies().length`로 계산.
LEG-2(그래프 캐싱) 적용 후 성능 개선.

**구현**:
```typescript
interface FanMetrics {
  filePath: string;
  fanIn: number;   // 이 파일을 import하는 파일 수
  fanOut: number;  // 이 파일이 import하는 파일 수
}

getFanMetrics(filePath: string, project?: string): Result<FanMetrics, GildashError>
```
import graph에서 직접 계산. `getDependents().length`가 fan-in, `getDependencies().length`가 fan-out.

**테스트**:
- 많은 파일이 import → 높은 fan-in
- 많은 파일을 import → 높은 fan-out
- 고립 파일 → fan-in: 0, fan-out: 0

---

### FR-14: resolveSymbol

**목적**: re-export 체인을 따라 심볼의 원본 정의 위치를 찾음.

**변경 파일**:
- `src/search/relation-search.ts` — resolve 로직
- `src/gildash.ts` — public method
- `src/gildash.spec.ts`

**의존**: IMP-A + IMP-B (import dstSymbolName + re-export specifier)

**구현**:
```typescript
interface ResolvedSymbol {
  originalName: string;
  originalFilePath: string;
  reExportChain: Array<{ filePath: string; exportedAs: string }>;
}

resolveSymbol(symbolName: string, filePath: string, project?: string): Result<ResolvedSymbol, GildashError>
```
import relation → re-export relation을 재귀적으로 추적.
순환 방지를 위한 visited set.

**테스트**:
- 직접 import → chain 없음, 원본 직접 반환
- A re-exports Foo from B, B re-exports Foo from C → chain = [A, B], original = C
- alias re-export → exportedAs에 alias 반영
- 순환 re-export → 에러 또는 중단
- 존재하지 않는 심볼 → Err

---

## Phase 3: 외부 기술 도입

---

### FR-15: findPattern (AST 패턴 매칭)

**목적**: AST 패턴으로 코드베이스를 검색.

**외부 의존성**: `@ast-grep/napi` (Rust 네이티브, tree-sitter 기반)

**변경 파일**:
- `package.json` — `@ast-grep/napi` dependency
- `src/search/pattern-search.ts` — 새 모듈
- `src/search/pattern-search.spec.ts`
- `src/gildash.ts` — public method
- `src/search/index.ts` — re-export

**구현 방식: 하이브리드**

1. gildash 인덱스로 대상 파일을 사전 필터링 (파일 경로, 심볼 종류 등)
2. `@ast-grep/napi`의 `findInFiles()`로 실제 패턴 매칭

```typescript
interface PatternMatch {
  filePath: string;
  startLine: number;
  endLine: number;
  matchedText: string;
}

findPattern(
  pattern: string,
  opts?: { filePaths?: string[]; kind?: SymbolKind; project?: string },
): Result<PatternMatch[], GildashError>
```

ast-grep은 자체 tree-sitter 파서를 사용하므로 gildash의 oxc-parser AST를 직접 소비할 수 없음.
gildash의 역할은 파일 목록 축소를 통한 검색 범위 최적화.

**테스트**:
- 간단 패턴 → 매칭 결과 반환
- 파일 필터 + 패턴 → 해당 파일만 검색
- 매칭 없음 → 빈 배열
- 잘못된 패턴 → Err

---

### FR-16: indexExternalPackages

**목적**: `node_modules` 내 패키지의 타입 선언(.d.ts)을 인덱싱.

**변경 파일**:
- `src/gildash.ts` — public method
- `src/indexer/index-coordinator.ts` — external 인덱싱 모드
- `src/common/project-discovery.ts` — node_modules 경로 해석
- 관련 spec 파일들

**구현**:
```typescript
indexExternalPackages(
  packages: string[],
  opts?: { project?: string },
): Promise<Result<IndexResult, GildashError>>
```

별도 project로 관리 (예: `@external/react`).
기존 인덱싱 파이프라인 재사용. watcher는 생략.
.d.ts 파일만 대상. source map은 무시.

**설계 포인트**:
- 패키지 경로 해석 (`node_modules/react` → `.d.ts` 파일 탐색)
- project 네이밍 전략
- 버전 변경 감지 (package.json 해시?)
- 인덱스 크기 관리

**테스트**:
- 단일 패키지 인덱싱 → 타입 심볼 추출
- 여러 패키지 → 각각 별도 project
- 존재하지 않는 패키지 → Err
- .d.ts만 인덱싱 (JS 파일 제외)

---

## Phase 4: 성능 최적화

---

### LEG-2: DependencyGraph 내부 캐싱

**목적**: 그래프 빌드를 캐싱하여 반복 호출 시 성능 개선.

**변경 파일**:
- `src/gildash.ts`
- `src/gildash.spec.ts`

**구현**:

```typescript
private graphCache: DependencyGraph | null = null;
private graphCacheKey: string | null = null;  // project ?? '__cross__'

private getOrBuildGraph(project?: string): DependencyGraph {
  const key = project ?? '__cross__';
  if (this.graphCache && this.graphCacheKey === key) {
    return this.graphCache;
  }
  const g = new DependencyGraph({ relationRepo, project: project ?? this.defaultProject });
  g.build();
  this.graphCache = g;
  this.graphCacheKey = key;
  return g;
}
```

**참고**: FR-17(cross-project)에서 `project === undefined` 시 전체 프로젝트 그래프.
캐시 키는 `project ?? '__cross__'`로 구분.

그래프 사용 메서드: `hasCycle`, `getCyclePaths`, `getAffected`, `getImportGraph`,
`getTransitiveDependencies`, `getFanMetrics`.

캐시 무효화: `onIndexed` 콜백 발화 시, `reindex()` 완료 시.

**테스트**:
- 연속 호출 → 빌드 1회
- 인덱싱 후 → 캐시 무효화
- 다른 project → 캐시 미스
- reindex() 후 → 캐시 무효화

---

## 실행 순서

```
Phase 0 (인프라)      ──→ Phase 1 (독립 FR) ──→ Phase 2 (의존 FR)     ──→ Phase 3 (외부) ──→ Phase 4 (최적화)
IMP-A,B,C,D,E,META       FR-01~05, 11,        FR-06,07,08,09,10,        FR-15, 16          LEG-2
                         13, 17~21, LEG-1      12, 14
```

- Phase 0은 **순차** 진행 (공통 파일 변경이 겹침).
  - **권장 순서**: IMP-A → IMP-B → IMP-E → IMP-C → IMP-D → META
  - IMP-A와 IMP-E는 모두 `imports-extractor.ts` 수정. IMP-A(specifier별 relation) 도입 후 IMP-E(type 분리)를 적용해야 specifier loop 내에서 type 타입도 분리 가능.
  - IMP-E 후 DependencyGraph.build() 수정 필수 (같은 PR/커밋에 포함).
- Phase 1은 **병렬** 진행 가능 (독립 항목).
- Phase 2는 Phase 0 완료 후, 의존관계에 따라 순서 조정. **FR-08은 Phase 2로 이동** (심볼 diff 신규 로직 필요).
- Phase 3는 외부 라이브러리/아키텍처 검토 후 착수.
- Phase 4는 그래프 관련 FR들(FR-03, 04, 12, 13) 완료 후 적용.

각 항목마다 test-first (RED → GREEN) 플로우 적용.

## 호환성 노트

### Non-breaking changes (minor release)

- `CodeRelation.metaJson` — `@deprecated`로 유지. 기존 `{ isReExport: true }` 필드 유지.
- `CodeRelation.meta` — 신규 optional 필드.
- 모든 신규 API — 기존 메서드 시그니처 변경 없음.
- `SymbolSearchQuery` 확장 필드 — 모두 optional.

### Potentially breaking (주의)

- **IMP-A**: named import의 relation이 단일(dstSymbolName=null) → specifier별 N개로 분할. side-effect/dynamic import는 기존과 동일. relation 개수에 의존하는 로직 확인 필요.
- **IMP-C**: `detailJson.members`가 `string[]` → `object[]`로 변경. members를 직접 파싱하는 소비자 영향.
- **IMP-E**: type-only import의 relation type이 `'imports'` → `'type-references'`로 변경. `type === 'imports'`로 전체 import를 조회하는 소비자 영향. DependencyGraph는 3개 타입 모두 조회하도록 수정되므로 영향 없음.
- **FR-06**: re-export의 relation type이 `'imports'` + `isReExport` → `'re-exports'`로 변경. ExportAllDeclaration 포함.

## 릴리즈 전략

**현재 버전**: v0.3.1

**semver**: `0.x` 범위에서는 minor bump로 breaking change 허용 (semver spec).
Phase 0~2의 전체 변경을 **0.4.0** minor release로 릴리즈.

**배포 전략**:
Phase 0~2를 **0.4.0** 단일 minor release로 배포. Phase 내 부분 완성 시 0.4.0-beta.x prerelease로 조기 접근 제공.
Phase 0~2 전체가 stable되면 0.4.0 정식 릴리스.
- Phase 3 (ast-grep 도입 등) → 별도 `0.5.0` 판단
- firebat peerDependencies 권장: `"@zipbul/gildash": "^0.4.0"`

**자동 마이그레이션**: `DbConnection.open()`에서 drizzle `migrate()` 자동 실행.
IMP-D(`lineCount` 컬럼 추가)는 `ALTER TABLE` 마이그레이션으로 자동 적용.

**DB 재생성**: gildash DB는 소스 파일의 캐시. 최악의 경우 DB 삭제 후 `fullIndex()`로 완전 복구 가능.
DB corruption 감지 시 자동 삭제→재생성 로직이 기존 구현에 포함되어 있음.

**Phase 완료 시 어나운스**: 각 Phase 완료 시점에 firebat에 알림.
- Phase 0 완료 → 알림 (Phase 1 착수 확인)
- Phase 1 완료 → 알림 (독립 FR 사용 가능)
- Phase 2 완료 → 알림 (의존 FR 사용 가능)
