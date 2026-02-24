# gildash 0.6.0 — Public API: Result→Throw Migration

> **Breaking change.** 모든 공개 메서드의 반환 타입이 `Result<T, GildashError>` → `T` (또는 `T | null`)로 변경됨.

---

## 설계 원칙

### Public API

| 반환 패턴 | 사용 시점 | 에러 처리 |
|---|---|---|
| `T` | 단일 값 반환, 실패=불가능한 상태 | throw `GildashError` |
| `T \| null` | 단일 엔티티 조회, "없음"이 정상 | null=없음, 시스템에러=throw |
| `T[]` | 컬렉션 검색/질의 | []=결과없음, 시스템에러=throw |
| `boolean` | 존재 여부/상태 질의 | 직접 반환, 시스템에러=throw |
| `void` | 사이드이펙트 (닫기, 인덱싱) | 성공=void, 실패=throw |
| `Map<K,V>` | 그래프/매핑 질의 | 빈맵=결과없음, 시스템에러=throw |

### 내부 코드

| 위치 | 규칙 |
|---|---|
| 서브모듈 내부 (parser, extractor 등) | `Result<T, GildashError>` 자유롭게 사용 가능 |
| 서브모듈 간 통신 | `Result` 또는 throw, 상황에 맞게 |
| `Gildash` 클래스 (public API 경계) | 내부 Result를 unwrap → 값 반환 or throw 변환 |

### throw 해야 하는 상황

| 상황 | 에러 타입 |
|---|---|
| 닫힌 인스턴스에 메서드 호출 | `closed` |
| 존재하지 않는 프로젝트명 지정 | `validation` |
| 잘못된 인자 (빈 문자열, 음수 등) | `validation` |
| DB 읽기/쓰기 실패 | `store` |
| 파싱 실패 (문법 에러, 파일 읽기 실패) | `parse` |
| 초기화 실패 (open) | `store` / `watcher` |
| 시맨틱 레이어 장애 | `semantic` |

### null 반환 (= "없음"이 정상적인 결과)

| 메서드 | 이유 |
|---|---|
| `getFileInfo(filePath)` → `FileRecord \| null` | 인덱싱 안 된 파일 조회 |
| `getResolvedType(filePath, line, col)` → `ResolvedType \| null` | 해당 위치에 타입 없음 |
| `getFullSymbol(symbolId)` → `FullSymbol \| null` | 해당 심볼 없음 |
| `resolveSymbol(name, filePath)` → `ResolvedSymbol \| null` | 심볼 resolve 실패 |

---

## Phase 0 — `GildashError` 클래스화

> 현재: plain object `{ type, message, cause }`. throw 기반으로 전환하려면 `Error` 클래스 필요.

### 변경 내용

**Before:**
```typescript
export interface GildashError {
  type: GildashErrorType;
  message: string;
  cause?: unknown;
}

export function gildashError(type: GildashErrorType, message: string, cause?: unknown): GildashError {
  return cause !== undefined ? { type, message, cause } : { type, message };
}
```

**After:**
```typescript
export class GildashError extends Error {
  constructor(
    public readonly type: GildashErrorType,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'GildashError';
  }
}
```

### 파일
- `src/errors.ts` — interface → class, factory 함수 → constructor
- `src/errors.spec.ts` — 테스트 업데이트

### 호환성
- `gildashError()` factory 함수는 유지하되 `new GildashError()`를 반환하도록 변경 (내부 코드 일괄 수정 최소화)
- `GildashError`가 `Error`를 상속하므로 `instanceof Error` = true, stack trace 포함

---

## Phase 1 — `Gildash` 클래스 Public API 시그니처 변경

> 37개 메서드의 반환 타입 변경. 내부 로직에서 Result를 unwrap하여 값 반환 or throw.

### 변환 목록

```
// Lifecycle
static open(options)              : Gildash                    (was Result<Gildash, ...>)
close(opts?)                      : void                       (was Result<void, ...>)

// Parsing (low-level)
parseSource(filePath, src)        : ParsedFile                 (was Result<ParsedFile, ...>)
extractSymbols(parsed)            : ExtractedSymbol[]           (was Result<...>)
extractRelations(parsed)          : CodeRelation[]              (was Result<...>)

// Indexing
reindex()                         : IndexResult                (was Result<...>)
batchIndexFiles(paths)            : IndexResult[]              (was Result<...>)

// Query - Stats
getStats(project?)                : SymbolStats                (was Result<...>)
getFileStats(filePath)            : FileStats                  (was Result<...>)
getFanMetrics(filePath)           : FanMetrics                 (was Result<...>)

// Query - Symbol Search
searchSymbols(query)              : SymbolSearchResult[]       (was Result<...>)
searchAllSymbols(query)           : SymbolSearchResult[]       (was Result<...>)
getFullSymbol(symbolId)           : FullSymbol | null          (was Result<FullSymbol, ...>)
getSymbolsByFile(filePath)        : SymbolSearchResult[]       (was Result<...>)
resolveSymbol(name, filePath)     : ResolvedSymbol | null      (was Result<...>)

// Query - Relations
searchRelations(query)            : CodeRelation[]             (was Result<...>)
searchAllRelations(query)         : CodeRelation[]             (was Result<...>)
getInternalRelations(filePath)    : CodeRelation[]             (was Result<...>)

// Query - Dependency Graph
getDependencies(filePath)         : string[]                   (was Result<...>)
getDependents(filePath)           : string[]                   (was Result<...>)
getAffected(changedFiles)         : string[]                   (was Result<...>)
hasCycle(project?)                : boolean                    (was Result<boolean, ...>)
getImportGraph(project?)          : Map<string, string[]>      (was Result<...>)
getTransitiveDependencies(fp)     : string[]                   (was Result<...>)
getCyclePaths(project?)           : string[][]                 (was Result<...>)

// Query - File
listIndexedFiles(project?)        : FileRecord[]               (was Result<...>)
getFileInfo(filePath)             : FileRecord | null           (was Result<FileRecord | null, ...>)

// Query - Module
getModuleInterface(filePath)      : ModuleInterface            (was Result<...>)
getHeritageTree(name, filePath)   : HeritageNode               (was Result<...>)

// Pattern
searchPattern(pattern)            : PatternMatch[]             (was Result<...>)
batchParse(filePaths)             : Map<string, ParsedFile>    (was Result<...>)

// Semantic
getResolvedType(fp, line, col)    : ResolvedType | null        (was Result<ResolvedType | null, ...>)
getSemanticReferences(fp,l,c)     : SemanticReference[]        (was Result<...>)
getImplementations(fp,l,c)        : Implementation[]           (was Result<...>)
getSemanticModuleInterface(fp)    : SemanticModuleInterface     (was Result<...>)
```

### 구현 패턴

각 메서드 내부에서:
```typescript
// Before
searchSymbols(query: SymbolSearchQuery): Result<SymbolSearchResult[], GildashError> {
  if (this.closed) return err(gildashError('closed', '...'));
  const result = this.symbolSearch.search(query);
  if (isErr(result)) return result;
  return result;
}

// After
searchSymbols(query: SymbolSearchQuery): SymbolSearchResult[] {
  if (this.closed) throw new GildashError('closed', '...');
  const result = this.symbolSearch.search(query);
  if (isErr(result)) throw result.error;  // 내부 Result unwrap → throw
  return result.value;
}
```

### 파일
- `src/gildash.ts` — 37개 메서드 시그니처 + 내부 unwrap 로직
- `src/index.ts` — `Result` re-export 제거 (더 이상 공개 API아님)

---

## Phase 2 — `@zipbul/result` 의존성 정리

### 변경 내용
- `@zipbul/result` → peerDependencies에서 **제거**
- `@zipbul/result` → dependencies에 **추가** (내부 사용 유지)
- `oxc-parser` → peerDependencies에서 **제거** (이미 dependencies에 있음)
- `typescript` → peerDependencies에 **추가** (optional, semantic용)

**After:**
```json
"dependencies": {
  "@ast-grep/napi": "^0.41.0",
  "@parcel/watcher": "^2.5.6",
  "@zipbul/result": "^0.0.3",
  "comment-parser": "1.4.5",
  "drizzle-orm": "^0.45.1",
  "oxc-parser": "0.115.0"
},
"peerDependencies": {
  "typescript": ">=5.0.0"
},
"peerDependenciesMeta": {
  "typescript": {
    "optional": true
  }
}
```

### 파일
- `package.json`

---

## Phase 3 — 테스트 업데이트

### 범위
- `test/gildash.test.ts` — `isErr()` 호출 → try-catch 또는 직접 값 사용
- `test/semantic.test.ts` — 동일
- `test/foundation.test.ts` — 동일
- `test/store.test.ts` — 동일
- `test/indexer.test.ts` — 동일

### 패턴

```typescript
// Before
const result = gildash.searchSymbols({ name: 'foo', project: '...' });
expect(isErr(result)).toBe(false);
if (!isErr(result)) {
  expect(result.value).toHaveLength(1);
}

// After
const symbols = gildash.searchSymbols({ name: 'foo', project: '...' });
expect(symbols).toHaveLength(1);

// Error case — Before
const result = closedGildash.searchSymbols({ ... });
expect(isErr(result)).toBe(true);

// Error case — After
expect(() => closedGildash.searchSymbols({ ... })).toThrow(GildashError);
```

---

## Phase 4 — README / 문서 업데이트

### 변경 내용
- `README.md` — 사용 예제에서 `isErr()` 제거, try-catch 패턴으로 교체
- `README.ko.md` — 동일
- 에러 처리 섹션 재작성: `GildashError` 클래스 소개, `type` 필드로 분기하는 패턴

### 예제

```typescript
// Before (0.5.x)
import { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

const result = await Gildash.open({ root: './src' });
if (isErr(result)) { console.error(result.error); process.exit(1); }
const gildash = result.value;

// After (0.6.0)
import { Gildash, GildashError } from '@zipbul/gildash';

const gildash = await Gildash.open({ root: './src' });
try {
  const symbols = gildash.searchSymbols({ name: 'UserService', project: 'my-app' });
  console.log(symbols);
} catch (e) {
  if (e instanceof GildashError) {
    console.error(`[${e.type}] ${e.message}`);
  }
}
```

---

## Phase 5 — Changeset & 배포

- `npx changeset` — major changeset 생성 (breaking change)
- version bump: 0.5.x → 0.6.0
- `@zipbul/result`를 공개 API에서 제거했으므로 breaking

---

## 실행 순서

```
Phase 0 (GildashError 클래스화)
  → Phase 1 (Public API 시그니처 변경)
    → Phase 2 (package.json 의존성 정리)
      → Phase 3 (테스트 업데이트)
        → Phase 4 (문서 업데이트)
          → Phase 5 (Changeset)
```

각 Phase는 순차 실행. Phase 0이 완료되어야 Phase 1 진행 가능.

---

## 영향 범위 요약

| 카테고리 | 파일 수 (추정) |
|---|---|
| `src/errors.ts` | 1 |
| `src/gildash.ts` | 1 |
| `src/index.ts` | 1 |
| `package.json` | 1 |
| Integration tests (`test/`) | 5 |
| README (EN + KO) | 2 |
| Changeset | 1 |
| **합계** | **~12 files** |

> 내부 서브모듈 (`src/parser/`, `src/extractor/`, `src/search/`, `src/semantic/` 등)은 변경 불필요.
> 내부적으로 `Result`를 계속 사용하며, `Gildash` 클래스 경계에서만 unwrap.
