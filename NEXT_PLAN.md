# NEXT_PLAN — gildash public API 확장

> 합의일: 2026-02-23  
> 대상 버전: 0.3.0 (minor)  
> 브랜치: `feat/public-api-extensions`  
> PR: 1건으로 통합  

---

## 배경

firebat (소비자) 실사용 기반 피드백에서 도출된 4건의 API 확장 요청.  
gildash 측 검토 후 양쪽 합의 완료.

---

## 구현 순서

### 1. `getParsedAst(filePath)` — Raw AST 캐시 공유

**목적**: gildash가 이미 파싱한 AST를 외부 소비자가 재사용. 동일 파일 이중 파싱 방지.

**변경 파일**:

| 파일 | 변경 내용 |
|------|----------|
| `src/gildash.ts` | `getParsedAst(filePath: string): ParsedFile \| undefined` public 메서드 추가 |
| `src/index.ts` | `ParsedFile` type re-export 추가 |
| `src/parser/types.ts` | 변경 없음 (이미 export됨) |
| `package.json` | `peerDependencies`에 `"oxc-parser": ">=0.114.0"` 추가 |

**구현 상세**:

```typescript
// src/gildash.ts
/**
 * Retrieve a previously-parsed AST from the internal LRU cache.
 *
 * Returns `undefined` if the file has not been parsed or was evicted from the cache.
 * The returned object is shared with the internal cache — treat it as **read-only**.
 *
 * @param filePath - Absolute path of the file.
 * @returns The cached {@link ParsedFile}, or `undefined` if not available.
 */
getParsedAst(filePath: string): ParsedFile | undefined {
  if (this.closed) return undefined;
  return this.parseCache.get(filePath);
}
```

**현재 내부 상태**:
- `parseCache`는 `private readonly` — `Pick<ParseCache, 'set' | 'get' | 'invalidate'>` 타입
- `ParseCache.get(filePath): ParsedFile | undefined` 이미 존재 (`src/parser/parse-cache.ts#L11`)
- LRU capacity 기본 500 (`src/parser/parse-cache.ts#L7`)

**주의사항**:
- LRU eviction으로 `undefined` 반환 가능 → JSDoc에 명시
- `ParsedFile.program`은 oxc-parser `Program` 타입 → 소비자가 oxc-parser 타입을 참조해야 함
- AST는 공유 객체 → "read-only" 경고 JSDoc에 명시
- `oxc-parser`는 현재 `dependencies`에 있음 (`"oxc-parser": "0.114.0"`) → `peerDependencies`에도 추가하여 소비자에게 peer dep 알림

**테스트**:
- `should return ParsedFile from cache when getParsedAst is called after parseSource`
- `should return undefined when getParsedAst is called for uncached file`
- `should return undefined when getParsedAst is called after close`

---

### 2. `getFileInfo(filePath, project?)` — 파일 메타데이터 조회

**목적**: gildash가 내부적으로 관리하는 파일의 contentHash, mtime, size 등을 외부에 노출.

**변경 파일**:

| 파일 | 변경 내용 |
|------|----------|
| `src/gildash.ts` | `fileRepo` private 멤버 추가 + `getFileInfo()` public 메서드 추가 |
| `src/gildash.ts` (constructor) | `fileRepo` 파라미터 추가 및 할당 |
| `src/gildash.ts` (open) | `fileRepo`를 인스턴스에 전달 |
| `src/index.ts` | `FileRecord` type re-export 추가 |
| `src/store/repositories/file.repository.ts` | `FileRecord`에 JSDoc 추가 |

**구현 상세**:

```typescript
// src/gildash.ts — 신규 멤버
private readonly fileRepo: Pick<FileRepository, 'getFile'>;

// src/gildash.ts — 신규 메서드
/**
 * Retrieve metadata for an indexed file.
 *
 * Returns the stored {@link FileRecord} including content hash, mtime, and size.
 * Returns `null` if the file has not been indexed yet.
 *
 * @param filePath - Relative path from project root (as stored in the index).
 * @param project - Project name. Defaults to the primary project.
 * @returns The {@link FileRecord}, or `null` if not found.
 */
getFileInfo(filePath: string, project?: string): Result<FileRecord | null, GildashError> {
  if (this.closed) return err(gildashError('closed', 'Gildash: instance is closed'));
  try {
    return this.fileRepo.getFile(project ?? this.defaultProject, filePath);
  } catch (e) {
    return err(gildashError('store', 'Gildash: getFileInfo failed', e));
  }
}
```

**현재 내부 상태**:
- `FileRepository.getFile(project, filePath): FileRecord | null` 존재 (`src/store/repositories/file.repository.ts#L17`)
- `FileRecord` 인터페이스: `{ project, filePath, mtimeMs, size, contentHash, updatedAt }`
- **현재 `Gildash` class에 `fileRepo` 멤버 없음** — `repositoryFactory`에서 생성되지만 coordinator에만 전달됨
- `open()` 메서드에서 `repos.fileRepo`를 constructor opts에 추가해야 함

**주의사항**:
- `Gildash` constructor의 opts 타입에 `fileRepo` 추가 필요
- `GildashInternalOptions.repositoryFactory` 반환 타입에 `fileRepo`에 `getFile` Pick 추가 필요
- 기존 테스트의 `makeOptions()`에서 `fileRepo` mock에 `getFile` 추가 필요 (이미 `makeFileRepoMock()`에 있음)

**테스트**:
- `should return FileRecord when getFileInfo is called for indexed file`
- `should return null when getFileInfo is called for non-indexed file`
- `should return closed error when getFileInfo is called after close`
- `should use defaultProject when getFileInfo is called without project`

---

### 3. `searchSymbols` exact match 옵션

**목적**: 현재 FTS prefix match만 지원. exact name match가 없어서 정확한 이름으로 심볼 검색 불가.

**변경 파일**:

| 파일 | 변경 내용 |
|------|----------|
| `src/search/symbol-search.ts` | `SymbolSearchQuery`에 `exact?: boolean` 필드 추가 + `symbolSearch()` 로직 분기 |
| `src/store/repositories/symbol.repository.ts` | `searchByQuery()`에 `exactName?: string` 옵션 추가 |

**구현 상세**:

```typescript
// src/search/symbol-search.ts — SymbolSearchQuery 확장
export interface SymbolSearchQuery {
  text?: string;
  /** Exact symbol name match. When `true`, `text` is treated as an exact name (not FTS prefix). */
  exact?: boolean;
  kind?: SymbolKind;
  filePath?: string;
  isExported?: boolean;
  project?: string;
  limit?: number;
}
```

```typescript
// src/search/symbol-search.ts — symbolSearch() 분기
if (query.text) {
  if (query.exact) {
    opts.exactName = query.text;  // exact match 경로
  } else {
    const ftsQuery = toFtsPrefixQuery(query.text);
    if (ftsQuery) opts.ftsQuery = ftsQuery;
  }
}
```

```typescript
// src/store/repositories/symbol.repository.ts — searchByQuery 확장
searchByQuery(opts: {
  ftsQuery?: string;
  exactName?: string;  // 신규
  kind?: string;
  filePath?: string;
  isExported?: boolean;
  project?: string;
  limit: number;
}): (SymbolRecord & { id: number })[] {
  return this.db.drizzleDb
    .select()
    .from(symbols)
    .where(
      and(
        opts.ftsQuery
          ? sql`${symbols.id} IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ${opts.ftsQuery})`
          : undefined,
        opts.exactName ? eq(symbols.name, opts.exactName) : undefined,
        // ... 기존 필터들
      ),
    )
    // ...
}
```

**현재 내부 상태**:
- `searchByQuery()`에 `ftsQuery` 옵션만 있음 — 정확한 이름 매칭 경로 없음
- `symbols.name` 컬럼은 indexed (eq 쿼리 가능)
- `ISymbolRepo` 인터페이스(`symbol-search.ts#L53`)도 업데이트 필요

**주의사항**:
- `ftsQuery`와 `exactName`이 동시에 설정되면 안 됨 → `exact: true`일 때 FTS 건너뜀
- 기존 `text` 없이 `exact: true`만 주면 no-op → 문서에 명시
- `ISymbolRepo` 인터페이스 업데이트 필요 (breaking for implementors, but internal)

**테스트 (symbol-search.spec.ts)**:
- `should pass exactName to searchByQuery when exact is true`
- `should not set ftsQuery when exact is true`
- `should ignore exact flag when text is not provided`

**테스트 (symbol.repository.spec.ts)**:
- `should return only exact name matches when exactName is provided`
- `should combine exactName with kind filter`
- `should combine exactName with filePath filter`

---

### 4. `getSymbolsByFile(filePath, project?)` — Sugar API

**목적**: `searchSymbols({ filePath })` 패턴의 편의 wrapper. 의도 표현 명확화.

**변경 파일**:

| 파일 | 변경 내용 |
|------|----------|
| `src/gildash.ts` | `getSymbolsByFile()` public 메서드 추가 |

**구현 상세**:

```typescript
// src/gildash.ts
/**
 * List all symbols declared in a specific file.
 *
 * Convenience wrapper around {@link searchSymbols} with a `filePath` filter.
 *
 * @param filePath - File path to query.
 * @param project - Project name. Defaults to the primary project.
 * @returns An array of {@link SymbolSearchResult} entries, or `Err<GildashError>`.
 */
getSymbolsByFile(filePath: string, project?: string): Result<SymbolSearchResult[], GildashError> {
  return this.searchSymbols({ filePath, project: project ?? undefined, limit: 10_000 });
}
```

**테스트**:
- `should delegate to searchSymbols with filePath filter when getSymbolsByFile is called`
- `should use defaultProject when getSymbolsByFile is called without project`

---

## 공통 작업

### type re-exports (`src/index.ts`)

```typescript
// 추가할 라인
export type { ParsedFile } from "./parser/types";
export type { FileRecord } from "./store/repositories/file.repository";
```

### peerDependencies (`package.json`)

```json
"peerDependencies": {
  "@zipbul/result": "^0.0.3",
  "oxc-parser": ">=0.114.0"
}
```

> `oxc-parser`는 현재 `dependencies`에도 있음 (`"oxc-parser": "0.114.0"`).
> `peerDependencies`에 추가하여 소비자에게 타입 호환을 보장.

### JSDoc 추가

| 타입 | 파일 | 현재 | 필요 |
|------|------|------|------|
| `FileRecord` | `src/store/repositories/file.repository.ts` | ❌ 없음 | ✅ 추가 |
| `ParsedFile` | `src/parser/types.ts` | ❌ 없음 | ✅ 추가 |

### changeset

```
---
"@zipbul/gildash": minor
---

Add public API extensions for AST cache sharing, file metadata, exact symbol search, and file-scoped symbol listing

- `getParsedAst(filePath)`: retrieve cached oxc-parser AST from internal LRU cache
- `getFileInfo(filePath, project?)`: query indexed file metadata (hash, mtime, size)
- `searchSymbols({ text, exact: true })`: exact name match (in addition to existing FTS prefix)
- `getSymbolsByFile(filePath, project?)`: convenience wrapper for file-scoped symbol listing
- Re-export `ParsedFile` and `FileRecord` types
- Add `oxc-parser` to peerDependencies
```

---

## 테스트 계획 요약

| SUT | 파일 | 신규 테스트 수 |
|-----|------|:---:|
| `Gildash.getParsedAst` | `src/gildash.spec.ts` | 3 |
| `Gildash.getFileInfo` | `src/gildash.spec.ts` | 4 |
| `Gildash.getSymbolsByFile` | `src/gildash.spec.ts` | 2 |
| `symbolSearch` (exact) | `src/search/symbol-search.spec.ts` | 3 |
| `SymbolRepository.searchByQuery` (exactName) | `src/store/repositories/symbol.repository.spec.ts` | 3 |
| **합계** | | **15** |

> OVERFLOW/PRUNE는 구현 착수 시 각 SUT별로 실행.  
> 위 숫자는 예상치. PRUNE 결과에 따라 증감 가능.

---

## 실행 체크리스트

- [ ] 브랜치 생성: `feat/public-api-extensions`
- [ ] OVERFLOW → PRUNE (전체)
- [ ] 테스트 작성 → RED 확인
- [ ] 구현 1: `getParsedAst` → 개별 GREEN 확인
- [ ] 구현 2: `getFileInfo` → 개별 GREEN 확인
- [ ] 구현 3: `searchSymbols` exact → 개별 GREEN 확인
- [ ] 구현 4: `getSymbolsByFile` → 개별 GREEN 확인
- [ ] 전체 테스트 GREEN 확인
- [ ] type re-exports + peerDep + JSDoc
- [ ] changeset 생성
- [ ] 커밋 + push + PR
- [ ] CI 통과 후 머지
- [ ] `changeset version` + `changeset publish`
