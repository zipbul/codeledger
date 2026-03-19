# IndexResult 완전성 확보 및 Semantic/Search API 확장 계획

> IndexResult의 심볼·관계 변경 보고 완전성 확보, 관계 검색 패턴 매칭 지원,
> 타입 호환성 검사 API 노출.
> 촉발: Zipbul 팀 feature request (2026-03). 설계는 범용 코드 인텔리전스 관점에서 수행.

---

## 배경

외부 feature request를 계기로 IndexResult의 변경 보고가 불완전한 영역을 식별했다.
심볼 변경에 export 상태와 변경 범위가 누락되어 있고, 관계 변경은 아예 추적되지 않으며,
rename/move가 IndexResult에서 소실된다. 이 계획은 이러한 정보 불완전성을 해소하고,
관계 검색과 타입 호환성 검사 API를 확장한다.

### 요약

| # | 항목 | Gildash 관점의 핵심 | 출처 | 우선순위 |
|---|------|-------------------|------|---------|
| 1 | `changedSymbols`에 `isExported` 추가 + modified 판정 확장 | 심볼 변경 보고에 export 상태 누락 해소, 감지 범위 확대 | 외부 요청 | 높음 |
| 2 | `IndexResult`에 `changedRelations` 추가 | 관계 변경이 추적되지 않는 정보 불완전성 해소 | 외부 요청 | 높음 |
| 2-a | `IndexResult`에 `renamedSymbols` / `movedSymbols` 추가 | changedSymbols에서 소실되는 변경 유형 복원 | 내부 발견 | 높음 |
| 3 | `RelationSearchQuery`에 패턴 매칭 지원 | 관계 검색의 파일 경로 필터링 강화 | 외부 요청 | 중간 |
| 4 | `isTypeAssignableTo()` 노출 | tsc 타입 호환성 검사를 public API로 노출 | 외부 요청 | 중간 |
| 5 | `collectFileTypes` / position 기반 semantic API 노출 | 내부 구현체의 facade 노출 확대 | 내부 발견 | 중간 |

---

## Feature 1: `changedSymbols.isExported`

### 현재 상태

```
IndexResult.changedSymbols.added/modified/removed
  → Array<{ name, filePath, kind }>
```

- `SymbolRecord.isExported: number` — DB에 이미 저장됨
- `SymbolSearchResult.isExported: boolean` — 검색 API에 이미 노출됨
- `changedSymbols`에만 누락

### 발견된 문제: fingerprint가 isExported를 포함하지 않음

`changedSymbols.modified`는 fingerprint 비교로 판정된다:

```typescript
// symbol-indexer.ts:119
const fingerprint = hashString(`${name}|${sym.kind}|${signature ?? ''}`);
```

`isExported`가 fingerprint에 **없다**. 따라서:

- 함수에 `export` 키워드만 추가/삭제 → fingerprint 동일 → `modified`에 안 잡힘
- `isExported` 필드를 추가해도 **export 상태 변경 자체를 감지할 수 없음**
- 심볼의 공개 범위가 변경되었는데 `modified`에 보고되지 않는 **정보 누락** 발생

### 설계 결정

**fingerprint에 isExported를 포함시키지 않는다.**

이유:
- fingerprint는 rename/move detection의 identity key
- export 유무만 다른 심볼이 "다른 심볼"로 인식되면 move detection이 깨짐
- structuralFingerprint도 마찬가지 — 구조적 동일성 판단용이므로 export 여부와 무관

**대신 diff 로직에서 isExported 변경을 별도로 감지한다:**

1. `SymbolSnap`에 `isExported: number` 필드 추가
2. `snapFromRecord`에서 `sym.isExported` 매핑
3. diff 루프에서 `fingerprint 동일 && isExported 변경` → `modified`에 포함

### 변경 대상 코드

| 파일 | 변경 내용 |
|------|----------|
| `src/indexer/rename-detector.ts` | `SymbolSnap`에 `isExported: number` 추가 |
| `src/indexer/index-coordinator.ts:292-295` | `snapFromRecord`에 `isExported` 매핑 |
| `src/indexer/index-coordinator.ts:33-61` | `IndexResult` 타입에 `isExported: boolean` 추가 |
| `src/indexer/index-coordinator.ts:526-540` | diff 루프: isExported 변경 감지 + 필드 포함 |

### 목표 타입

```typescript
changedSymbols: {
  added:    Array<{ name: string; filePath: string; kind: string; isExported: boolean }>;
  modified: Array<{ name: string; filePath: string; kind: string; isExported: boolean }>;
  removed:  Array<{ name: string; filePath: string; kind: string; isExported: boolean }>;
}
```

`isExported`는 `SymbolSearchResult`에 이미 존재하는 속성이다.
`changedSymbols`에 누락되어 있었을 뿐이므로 속성 완성에 해당한다.
`added`/`removed`의 `isExported`는 추가/삭제 시점의 값.
`modified`의 `isExported`는 변경 후(현재) 값.

### modified 판정 기준 확장

기존: `fingerprint 변경` 시에만 `modified`에 포함.
변경: `fingerprint 변경 OR isExported 변경 OR structuralFingerprint 변경` 시 `modified`에 포함.
이유: 세 가지 모두 심볼의 관찰 가능한 속성이며, 기존 방식은 일부 변경을 누락한다
(return type 변경, decorator 추가, export 상태 변경 등).

**변경 범위 플래그는 추가하지 않는다.**

`changedSymbols`는 인덱싱 이벤트의 **경량 식별자 목록**이다.
기존 패턴: `{ name, filePath, kind }` — 무엇이 변경되었는지만 보고.
"어떻게 변경되었는지"의 상세는 `diffSymbols(before, after)`가 담당한다.
(`SymbolDiff.modified`는 `{ before: SymbolSearchResult, after: SymbolSearchResult }`를
제공하여 소비자가 직접 비교.)

변경 범위 플래그를 `changedSymbols`에 넣으면:
- 경량 요약과 상세 분석의 역할 경계가 무너짐
- fingerprint/structuralFingerprint 같은 내부 구현 개념이 public API에 노출됨
- Gildash의 기존 패턴(데이터 제공, 분석은 소비자)과 불일치

소비자가 modified 심볼의 변경 상세를 알고 싶으면:
1. `diffSymbols(before, after)`로 before/after `SymbolSearchResult` 비교
2. `getSymbolChanges()`로 changelog에서 fingerprint 변경 이력 조회
3. 자체 상태 추적으로 `isExported` 변경 감지

**structuralFingerprint null 처리** (DB 마이그레이션 과도기):
이전 버전에서 인덱싱된 심볼은 `structuralFingerprint`가 null일 수 있다.
before 또는 after가 null이면 structuralFingerprint 변경으로 판정하지 않는다.

### 파급 영향

- Changelog INSERT (`index-coordinator.ts:605-675`): 현재 changedSymbols를 순회하여 changelog 생성. isExported 추가 시 changelog에도 포함 가능하나, 별도 작업으로 분리.
- rename/move detection: fingerprint 미변경이므로 영향 없음.
- 기존 onIndexed 콜백 소비자: 타입 변경이므로 breaking change. minor 릴리스.

---

## Feature 2-a: `renamedSymbols` / `movedSymbols` in IndexResult

### 문제

현재 rename과 move는 `changedSymbols`에서 **제거된다** (`index-coordinator.ts:546-603`).
changelog에만 기록되고 `IndexResult`에는 포함되지 않는다.

IndexResult는 인덱싱 결과의 완전한 diff를 보고해야 한다. rename/move는 심볼 변경의
한 유형인데 IndexResult에서 소실되면 정보 불완전성이 발생한다:

- `createLogger` → `buildLogger` rename: `changedSymbols`에 안 나타남 → 변경 정보 소실
- 심볼이 다른 파일로 move: `changedSymbols`에 안 나타남 → 이동 정보 소실

### 현재 상태

`renameResult.renamed`과 `movedEntries`는 **이미 계산되어 있다** (`index-coordinator.ts:543, 552`).
`IndexResult`에 넣기만 하면 된다.

### 목표 타입

```typescript
interface IndexResult {
  // ... 기존 필드 유지 ...
  changedSymbols: { /* Feature 1의 확장 타입 */ };
  changedRelations: { /* Feature 2 */ };

  renamedSymbols: Array<{
    oldName: string;
    newName: string;
    filePath: string;
    kind: string;
    isExported: boolean;
  }>;

  movedSymbols: Array<{
    name: string;
    oldFilePath: string;
    newFilePath: string;
    kind: string;
    isExported: boolean;
  }>;
}
```

### 변경 대상 코드

| 파일 | 변경 내용 |
|------|----------|
| `src/indexer/index-coordinator.ts:33-61` | `IndexResult`에 `renamedSymbols`, `movedSymbols` 추가 |
| `src/indexer/index-coordinator.ts:693-704` | 반환 객체에 `renameResult.renamed`, `movedEntries` 포함 |

### isExported 데이터 소스 (리뷰에서 발견)

**renamed symbols**: `afterSnapshot.get(`${rn.filePath}::${rn.newName}`)?.isExported`
(Feature 1에서 SymbolSnap에 isExported를 추가하므로 사용 가능)

**moved symbols**: `afterSnapshot`은 `changed` 파일만 포함한다. 삭제 파일에서
미변경 파일로 move된 심볼은 afterSnapshot에 없다.
→ `symbolRepo.getByFingerprint()`가 반환하는 `SymbolRecord.isExported`를 직접 사용.
(`index-coordinator.ts:560-561`의 `matches[0]!.isExported`)

### 구현 비용

S (소). 데이터가 이미 계산되어 있으므로 타입 정의 + 매핑만 필요.
Feature 1의 `isExported` 필드를 여기서도 포함하므로 Feature 1과 함께 구현.

---

## Feature 2: `changedRelations`

### 현재 상태

- relation 인덱싱은 **wholesale replacement**: `replaceFileRelations()` → DELETE all + INSERT all (per file)
- before/after 비교 없음, diff 추적 없음
- `IndexResult`에 `changedRelations` 필드 없음

### 설계

#### 2-1. relation identity key

relation에는 fingerprint가 없다. identity를 다음 튜플로 정의:

```
(type, srcFilePath, dstFilePath, srcSymbolName, dstSymbolName, metaJsonHash)
```

**metaJsonHash를 포함하는 이유** (리뷰에서 발견된 치명적 문제):

named re-export(`export { A, B } from './lib'`)는 **단일 relation**으로 생성된다:
- `srcSymbolName: null`, `dstSymbolName: null`
- 개별 specifier(`A`, `B`)는 `metaJson`에만 저장

metaJson을 무시하면:
- `export { A } from './lib'` → `export { A, B } from './lib'`로 변경 시 identity key 동일
- `changedRelations`에 **안 잡힘** — 관계 변경 감지 불능

반면 `ImportDeclaration`은 specifier별로 별도 relation을 생성하므로 이 문제 없음.

**해결**: identity key에 `hashString(metaJson ?? '')`를 포함한다.
metaJson 변경 시 old relation은 `removed`, new relation은 `added`로 보고.
이는 re-export specifier 변경뿐 아니라 모든 메타데이터 변경을 감지한다.

**중복 relation 처리**: DB에 UNIQUE 제약이 없으므로 동일 identity key의 relation이
복수 존재할 수 있다 (e.g., 같은 함수를 2번 호출). Set diff는 **존재 여부**만 추적하며,
호출 횟수 변경(2회→1회)은 보고하지 않는다. 이를 문서에 명시.

`modified` 카테고리 없이 `added`/`removed`만 제공.

#### 2-2. diff 알고리즘

```
1. 인덱싱 전: 변경/삭제 대상 파일의 기존 relation을 getOutgoing()으로 수집 → beforeRelations Map
2. 인덱싱 후: 같은 파일의 relation을 다시 수집 → afterRelations Map
3. Set diff:
   - afterRelations에만 있으면 → added
   - beforeRelations에만 있으면 → removed
```

#### 2-3. snapshot 타이밍

**incremental 경로** (`useTransaction=false`):
- before: `processChanged()` 진입 직전 (line 333 부근), 심볼 beforeSnapshot과 같은 시점
- after: `processChanged()` 완료 후, retargetRelations 전

**full index 경로** (`useTransaction=true`):
- before: transaction 시작 전 (line 441 이전), `fileRepo.deleteFile()` CASCADE 전에 수집 필수
- after: 모든 파일 인덱싱 완료 후

#### 2-4. 삭제 파일 처리

파일 삭제 시 해당 파일의 모든 outgoing relation이 사라진다.
`deletedSymbols` 패턴(`index-coordinator.ts:280-284`)을 따라 삭제 전 relation snapshot 수집:

```typescript
const deletedRelations = new Map<string, RelationRecord[]>();
for (const filePath of deleted) {
  const project = resolveFileProject(filePath, this.opts.boundaries);
  deletedRelations.set(filePath, relationRepo.getOutgoing(project, filePath));
}
```

삭제 파일의 relation은 모두 `changedRelations.removed`에 포함.

#### 2-5. retargetRelations와의 관계

move detection(`index-coordinator.ts:551-595`)에서 `retargetRelations()`가 다른 파일의 relation dst를 수정한다.

**1차 구현에서는 retarget에 의한 변경을 changedRelations에 포함하지 않는다.**

이유:
- retarget은 심볼 move 시에만 발생하며, 변경 파일의 outgoing relation diff와는 별개의 메커니즘
- retarget 변경을 추적하려면 전체 relation snapshot 비교가 필요해 성능 부담 증가
- retargetRelations 자체가 `movedEntries`에 이미 보고되므로, 소비자는 move 정보에서 유추 가능

문서에 명시: "changedRelations는 변경/삭제된 파일의 outgoing relation diff만 포함. 심볼 이동에 의한 incoming relation 변경은 미포함."

#### 2-6. 성능 영향

| 항목 | 추가 비용 |
|------|----------|
| before snapshot | 변경 파일당 1회 SELECT (idx_relations_src 인덱스 활용) |
| after snapshot | 동일 |
| diff 계산 | JS Set diff, 파일당 relation 2~8개 → 무시 가능 |
| 메모리 | 변경 파일 수 x 평균 relation 수 x RelationRecord 크기 |

일반적인 incremental 인덱싱(1~5개 파일 변경)에서는 성능 영향 무시 가능.
full index(수백~수천 파일)에서도 relation은 심볼 대비 밀도가 낮아 부담 적음.

### 변경 대상 코드

| 파일 | 변경 내용 |
|------|----------|
| `src/indexer/index-coordinator.ts:33-61` | `IndexResult`에 `changedRelations` 타입 추가 |
| `src/indexer/index-coordinator.ts:86-90` | `relationRepo` 인터페이스에 `getOutgoing` 추가 **(리뷰 발견)** |
| `src/indexer/index-coordinator.ts:280-317` | before relation snapshot 수집 로직 추가 |
| `src/indexer/index-coordinator.ts:519-540` | after relation snapshot 수집 + diff 계산 |
| `src/store/repositories/relation.repository.ts` | `getOutgoing()` 이미 존재 — 추가 메서드 불필요 |

### 목표 타입

```typescript
interface IndexResult {
  // ... 기존 필드 유지 ...
  changedRelations: {
    added: Array<{
      type: CodeRelation['type'];
      srcFilePath: string;
      dstFilePath: string;
      srcSymbolName: string | null;
      dstSymbolName: string | null;
      dstProject: string;
      metaJson: string | null;
    }>;
    removed: Array<{
      type: CodeRelation['type'];
      srcFilePath: string;
      dstFilePath: string;
      srcSymbolName: string | null;
      dstSymbolName: string | null;
      dstProject: string;
      metaJson: string | null;
    }>;
  };
}
```

`dstProject` 포함 이유: `StoredCodeRelation`이 `dstProject`로 확장하는 기존 패턴.
cross-project relation에서 목적지 프로젝트 식별에 필요.

`metaJson` 포함 이유: identity key에 metaJsonHash를 포함하므로, 같은
`(type, src, dst, srcSym, dstSym)` 튜플에서 metaJson만 다른 관계가
removed+added로 보고될 수 있다. metaJson 없이는 consumer가 두 항목을
구별할 수 없다. `CodeRelation`이 `metaJson`을 포함하는 것이 기존 패턴.

### 알려진 한계 (API 문서에 명시 필수)

1. **wildcard re-export (`export * from './lib'`)**: lib에 새 심볼이 추가되면 re-export 파일의 public API가 변경되지만, re-export 파일 자체는 미변경이므로 인덱싱 대상이 아님. `changedRelations`에 반영되지 않는다.

2. **type-only re-export 전환**: `export type { Foo } from './lib'`는 relation type이 `'type-references'`이고, `export { Foo } from './lib'`는 `'re-exports'`이다. type 필드가 다르므로 identity key가 다르다 → `changedRelations`에서 old(`type-references`) removed + new(`re-exports`) added로 정확히 감지된다.

3. **retarget에 의한 incoming relation 변경**: 심볼 move 시 `retargetRelations()`가 다른 파일의 incoming relation을 수정하지만, `changedRelations`는 변경/삭제 대상 파일의 **outgoing** relation diff만 포함.

4. **중복 relation 호출 횟수**: 같은 함수를 2번 호출하면 동일 identity key의 relation이 2개 생긴다. Set diff는 **존재 여부**만 추적하며, 호출 횟수 변경(2회→1회)은 보고하지 않는다.

소비자는 이 한계를 인지하고, `changedRelations`가 빈 상태라도 `movedSymbols`가 있으면 추가 검사를 수행해야 한다.

---

## Feature 3: `RelationSearchQuery` 패턴 매칭

### 현재 상태

```typescript
interface RelationSearchQuery {
  srcFilePath?: string;    // exact match only
  dstFilePath?: string;    // exact match only
  // ...
}
```

모든 필터가 exact equality. `searchRelations` 내부에서 drizzle-orm `eq()` 사용.

### 설계

#### 3-1. API 설계

```typescript
interface RelationSearchQuery {
  srcFilePath?: string;
  srcFilePathPattern?: string;    // glob 패턴
  dstFilePath?: string;
  dstFilePathPattern?: string;    // glob 패턴
  // ... 기존 필드 유지
}
```

- `srcFilePath`와 `srcFilePathPattern` 동시 지정 시 `GildashError(type: 'validation')` throw
- `dstFilePath`와 `dstFilePathPattern` 동일

#### 3-2. 구현 전략: 2단계 필터

**SQLite GLOB을 사용하지 않는다.**

이유:
- `**/packages/*/src/**` 같은 패턴은 prefix 없어 full table scan
- drizzle-orm에 raw SQL 삽입 필요 → 코드 일관성 저하
- relation 테이블 규모가 수만 건 이하에서는 앱 레벨 필터링이 충분

**구현**:
1. DB 레벨: `type`, `project` 등 인덱스 활용 가능한 필터로 1차 축소
2. 앱 레벨: `Bun.Glob`으로 pattern match

```typescript
// relation-search.ts 내부
if (query.srcFilePathPattern || query.dstFilePathPattern) {
  const srcGlob = query.srcFilePathPattern ? new Bun.Glob(query.srcFilePathPattern) : null;
  const dstGlob = query.dstFilePathPattern ? new Bun.Glob(query.dstFilePathPattern) : null;

  results = results.filter(r =>
    (!srcGlob || srcGlob.match(r.srcFilePath)) &&
    (!dstGlob || dstGlob.match(r.dstFilePath))
  );
}
```

#### 3-3. limit과의 상호작용 + 메모리 보호 (리뷰에서 발견)

현재 `limit`은 DB 쿼리에 적용된다. 패턴 필터링이 앱 레벨이면:
- DB에서 limit 적용 후 앱에서 필터링 → 결과가 limit보다 적어질 수 있음

**문제**: 패턴 사용 시 DB limit을 제거하면, 필터 없는 쿼리에서 전체 테이블이
메모리에 로드될 수 있다.

**해결**: 패턴 필터 사용 시 소비자의 `limit`을 DB가 아닌 앱 레벨에서 적용한다.
DB 쿼리에서는 `limit`을 제거하여 패턴 필터링 전 충분한 데이터를 확보한다.
임의의 hard limit은 두지 않는다 — Gildash는 데이터 엔진이며 소비자의 쿼리를
정책적으로 제한하지 않는다. 기존 `searchRelations`도 소비자가 `limit: 999999`를
설정하면 그만큼 반환한다.

성능 문제가 우려되면 소비자가 `type`, `project` 등 인덱스 활용 가능한 필터를
함께 지정하도록 API 문서에서 안내한다.

### 변경 대상 코드

| 파일 | 변경 내용 |
|------|----------|
| `src/search/relation-search.ts:17-34` | `RelationSearchQuery`에 pattern 필드 추가 |
| `src/search/relation-search.ts:55-95` | `relationSearch` 함수에 패턴 필터링 + validation 추가 |
| `src/gildash/query-api.ts` | 변경 없음 (query 객체를 그대로 전달) |

---

## Feature 4: `isTypeAssignableTo()` 노출

### 현재 상태

- `SemanticLayer`가 tsc `TypeChecker`를 내부에 보유 (`TscProgram.getChecker()`)
- `TypeCollector.collectAt()`이 `checker.getTypeAtLocation()`으로 `ts.Type`을 이미 얻는 패턴 존재
- `ts.TypeChecker.isTypeAssignableTo(source, target): boolean` — TS 5.9.3 public API 확인
- `implementation-finder.ts` 주석(line 2, 6)에서 `isTypeAssignableTo` 활용을 이미 언급
- `resolveSymbolPosition()` (`semantic-api.ts:11-34`)에서 심볼 이름 → byte position 변환 이미 구현
- 현재 노출된 API 없음

### 설계

#### 4-1. 레이어 분리 (기존 패턴 준수)

기존 semantic API 패턴:

| 레이어 | 메서드 | 입력 |
|--------|--------|------|
| `TypeCollector` | `collectAt(filePath, position)` | position 기반 |
| `SemanticLayer` | `collectTypeAt(filePath, position)` | position 기반 |
| `semantic-api.ts` | `getResolvedType(ctx, symbolName, filePath, project?)` | 심볼 이름 기반 |
| `Gildash` facade | `getResolvedType(symbolName, filePath, project?)` | 심볼 이름 기반 |

동일 패턴을 따른다:

| 레이어 | 메서드 | 입력 |
|--------|--------|------|
| `TypeCollector` | `isAssignableTo(filePath, sourcePos, targetFilePath, targetPos)` | position 기반 |
| `SemanticLayer` | `isTypeAssignableTo(srcFile, srcPos, dstFile, dstPos)` | position 기반 |
| `semantic-api.ts` | `isTypeAssignableTo(ctx, srcSymbol, srcFile, dstSymbol, dstFile, project?)` | 심볼 이름 기반 |
| `Gildash` facade | `isTypeAssignableTo(srcSymbol, srcFile, dstSymbol, dstFile, project?)` | 심볼 이름 기반 |

#### 4-2. TypeCollector 구현

```typescript
// type-collector.ts에 추가
isAssignableTo(
  sourceFilePath: string,
  sourcePosition: number,
  targetFilePath: string,
  targetPosition: number,
): boolean | null {
  const checker = this.program.getChecker();
  const tsProgram = this.program.getProgram();

  // source 타입 해석
  const srcFile = tsProgram.getSourceFile(sourceFilePath);
  if (!srcFile) return null;
  const srcNode = findNodeAtPosition(srcFile, sourcePosition);
  if (!srcNode || !ts.isIdentifier(srcNode)) return null;

  // target 타입 해석
  const dstFile = tsProgram.getSourceFile(targetFilePath);
  if (!dstFile) return null;
  const dstNode = findNodeAtPosition(dstFile, targetPosition);
  if (!dstNode || !ts.isIdentifier(dstNode)) return null;

  try {
    const sourceType = checker.getTypeAtLocation(srcNode);
    const targetType = checker.getTypeAtLocation(dstNode);
    return checker.isTypeAssignableTo(sourceType, targetType);
  } catch {
    return null;
  }
}
```

#### 4-3. 반환 타입: `boolean | null` + 에러

외부 요청은 `boolean` 반환이지만, 3가지 상태를 구분해야 한다:

| 상황 | 동작 | 의미 |
|------|------|------|
| 타입 호환 | `true` 반환 | source가 target에 할당 가능 |
| 타입 불호환 | `false` 반환 | source가 target에 할당 불가 |
| 심볼 미발견 | `GildashError('search')` throw | 잘못된 입력 |
| tsc 타입 해석 실패 | `null` 반환 | 판단 불가 (파일이 program에 없음, position에 identifier 없음) |

**throw vs null 구분 기준** (리뷰에서 확정):
- 심볼이 DB에 없음 → **throw** (기존 `getSemanticReferences`/`getImplementations` 패턴)
- tsc 레벨 해석 실패 → **null** (기존 `TypeCollector.collectAt` 패턴)

`null` 반환 조건:
- 파일이 tsc program에 포함되지 않았을 때
- 해당 position에 identifier가 아닌 노드가 있을 때

#### 4-4. 같은 tsconfig 제약

SemanticLayer는 단일 tsconfig.json으로 초기화된다.
source와 target이 **같은 compilation unit**에 있어야 한다.

- 같은 프로젝트 내 심볼 비교: 정상 동작
- 다른 프로젝트 심볼 비교 (다른 tsconfig): `null` 반환 (파일이 program에 없으므로)

일반적인 DI 시나리오(inject 토큰 vs factory 파라미터)는 같은 프로젝트 내이므로 문제없다.
API 문서에 "두 심볼이 같은 tsconfig의 compilation unit에 포함되어야 한다"를 명시.

#### 4-5. 방향성 (directionality)

`isTypeAssignableTo(source, target)`의 의미:

```typescript
// "source가 target에 할당 가능한가?"
// 즉, `const x: Target = sourceValue;`가 유효한가?
ledger.isTypeAssignableTo('LoggerService', loggerPath, 'ILogger', loggerPath);
// true → LoggerService는 ILogger에 할당 가능 (ILogger를 구현하므로)

ledger.isTypeAssignableTo('ILogger', loggerPath, 'LoggerService', loggerPath);
// false → ILogger는 LoggerService에 할당 불가 (interface는 class에 할당 안 됨)
```

TypeScript 내부 `checker.isTypeAssignableTo(source, target)`과 동일한 방향.
문서에 "source is assignable to target" 명시.

#### 4-6. 심볼 해상도의 의미론

`getTypeAtLocation`은 identifier 노드의 위치에 따라 다른 타입을 반환:

| 심볼 종류 | `getTypeAtLocation` 반환 |
|-----------|------------------------|
| 클래스 이름 | 인스턴스 타입 |
| 인터페이스 이름 | 인터페이스 타입 |
| 변수 이름 | 변수의 타입 |
| 함수 이름 | 함수 시그니처 타입 |
| 타입 별칭 이름 | 별칭이 가리키는 타입 |

DI 시나리오에서는:
- `LoggerService` (class) → 인스턴스 타입 → 이것이 inject 토큰의 실제 타입
- `DatabaseConfig` (interface/type) → 인터페이스 타입

이 동작이 DI 와이어링 검증에 맞다. **추가 API 확장 없이 기본 동작으로 커버 가능.**

#### 4-7. 멤버/파라미터 레벨 비교 한계

사용 사례로 "factory 파라미터 타입과 inject 토큰 타입 비교"가 언급되었다.
현재 API는 **심볼 레벨** 비교만 지원한다:

```typescript
// 가능: 심볼 대 심볼
isTypeAssignableTo('LoggerService', path, 'ILogger', path);

// 불가능: "Factory 함수의 2번째 파라미터 타입" 대 "LoggerService"
```

이를 위해서는 position 기반 API를 직접 사용하거나, 별도의 parameter-aware API가 필요하다.
그러나 기본적인 타입 호환성 검사는 심볼 레벨로 충분하므로,
**1차 구현에서는 심볼 레벨만 제공하고, 멤버 레벨은 향후 요구에 따라 확장.**

#### 4-8. 성능 고려

DI 컨테이너는 수십~수백 개의 injection point를 가질 수 있다.
각 `isTypeAssignableTo` 호출은:

1. 심볼 DB 조회 x2 (source, target)
2. position 변환 x2
3. `checker.getTypeAtLocation()` x2
4. `checker.isTypeAssignableTo()` x1

tsc TypeChecker는 내부적으로 타입을 캐시하므로, 같은 심볼에 대한 반복 호출은 빠르다.
100개 injection 기준 ~50-200ms 예상 (프로젝트 규모에 따라 다름).

벌크 API는 1차 구현에서 제공하지 않는다. 필요 시:
```typescript
// 향후 확장 가능
checkTypeAssignability(pairs: Array<{ source, target }>): Array<boolean | null>
```

#### 4-9. 에러 처리 정책 (리뷰에서 발견)

기존 semantic-api.ts 메서드의 "심볼 미발견" 처리가 불일관:
- `getResolvedType`: `null` 반환
- `getSemanticReferences` / `getImplementations`: `GildashError('search')` throw

**결정**: `isTypeAssignableTo`는 심볼 미발견 시 **throw** 한다.
이유: "A가 B에 할당 가능한가?"라는 질문에서 A 또는 B가 없으면 잘못된 입력이다.
`null`은 tsc 레벨 해석 실패(파일이 program에 없음, position에 identifier 없음)에만 사용.

```typescript
// 심볼 미발견 → throw (getSemanticReferences 패턴)
// tsc 해석 실패 → null 반환 (기존 TypeCollector 패턴)
```

#### 4-10. SemanticLayer 메서드에 assertNotDisposed 필수 (리뷰에서 발견)

`SemanticLayer.isTypeAssignableTo()`는 기존 모든 public 메서드와 동일하게
`this.#assertNotDisposed()`를 호출해야 한다. TypeCollector 레벨에서는 불필요
(getProgram/getChecker가 대신 throw — 기존 패턴).

### 변경 대상 코드

| 파일 | 변경 내용 |
|------|----------|
| `src/semantic/type-collector.ts` | `isAssignableTo(srcFile, srcPos, dstFile, dstPos)` 메서드 추가 |
| `src/semantic/index.ts` | `SemanticLayer.isTypeAssignableTo()` 추가 (`#assertNotDisposed()` 포함) |
| `src/gildash/context.ts` | `SemanticLayerLike`에 `isTypeAssignableTo` 추가 |
| `src/gildash/semantic-api.ts` | `isTypeAssignableTo()` wrapper 추가 (심볼 미발견 시 throw) |
| `src/gildash/index.ts` | `Gildash.isTypeAssignableTo()` facade 메서드 추가 |

**SemanticLayerLike 확장 결정** (리뷰에서 발견된 모순 해소):
`SemanticLayerLike`에 `isTypeAssignableTo`를 **추가한다**.
이유: `semantic-api.ts`에서 `ctx.semanticLayer!.isTypeAssignableTo(...)`로 호출해야 하므로
타입에 포함 필수. 테스트 mock 5곳 업데이트 필요 (수용 가능한 비용).

### 목표 타입

```typescript
// Gildash facade
isTypeAssignableTo(
  sourceSymbol: string,
  sourceFilePath: string,
  targetSymbol: string,
  targetFilePath: string,
  project?: string,
): boolean | null;
```

---

## Feature 5: `collectFileTypes` / position 기반 semantic API 노출

### 문제

현재 semantic API는 모두 **심볼 이름 기반**이다. 호출마다:
1. 심볼 이름으로 DB 조회 (`symbolSearchFn`)
2. DB의 (line, column)을 byte position으로 변환 (`lineColumnToPosition`)
3. tsc에서 타입 수집 (`collectTypeAt`)

Zipbul처럼 이미 AST를 가지고 있는 소비자는 position을 이미 알고 있다.
DB 조회 왕복이 불필요한 오버헤드.

또한, 한 파일의 모든 심볼 타입을 수집하려면 `getFullSymbol()`을 심볼마다 호출해야 한다.
`SemanticLayer.collectFileTypes(filePath)`는 이미 구현되어 있지만 facade에 노출되지 않았다.

### 설계

#### 5-1. collectFileTypes 노출

```typescript
// Gildash facade
getFileTypes(filePath: string): Map<number, ResolvedType> | null;
```

- `SemanticLayer.collectFileTypes()`를 직접 위임
- semantic layer 미활성 시 `GildashError(type: 'semantic')` throw
- 파일이 tsc program에 없으면 빈 Map 반환 (기존 동작)

#### 5-2. position 기반 타입 조회

```typescript
// Gildash facade
getResolvedTypeAt(filePath: string, line: number, column: number): ResolvedType | null;
```

- `lineColumnToPosition` + `collectTypeAt` 직접 호출
- DB 심볼 조회를 건너뜀
- `findNamePosition` 불필요 (소비자가 이미 정확한 위치를 알고 있으므로)

#### 5-3. position 기반 isTypeAssignableTo (리뷰 반영: 객체 파라미터)

```typescript
// Gildash facade — 6개 positional 파라미터 대신 객체 사용 (리뷰에서 발견)
isTypeAssignableToAt(opts: {
  source: { filePath: string; line: number; column: number };
  target: { filePath: string; line: number; column: number };
}): boolean | null;
```

기존 facade 메서드 최대 파라미터 수는 3개. 6개 positional은 파라미터 순서 혼동 위험.
객체 파라미터로 source/target을 명확히 구분.

- Feature 4의 position 기반 variant
- DB 조회 없이 직접 tsc TypeChecker 호출
- 벌크 DI 검증 시 성능 이점: DB 조회 x2 x N → 0

#### 5-4. path resolution 필수 (리뷰에서 발견)

`SemanticLayer.lineColumnToPosition(filePath)` 및 `collectTypeAt(filePath)`는
`tsc.getSourceFile(filePath)`를 호출하며, **절대 경로**가 필요하다.
상대 경로가 전달되면 `getSourceFile`이 `undefined`를 반환하여 silent null이 된다.

기존 `resolveSymbolPosition()` (`semantic-api.ts:25`)은 `path.isAbsolute` 체크를 한다.
Feature 5의 모든 래퍼에서도 동일한 경로 해석을 수행해야 한다:

```typescript
const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
```

#### 5-5. collectFileTypes 한계 (리뷰에서 확인)

`TypeCollector.collectFile()`은 `NamedDeclaration` 노드만 방문한다.
`ExportDeclaration`/`ExportSpecifier`는 포함하지 않으므로,
re-export된 심볼(`export { Foo } from './other'`)은 반환되지 않는다.

**API 문서에 명시**: `getFileTypes`는 **locally declared** 심볼의 타입만 반환.
re-export 타입이 필요하면 `getSemanticModuleInterface`를 사용.

### 변경 대상 코드

| 파일 | 변경 내용 |
|------|----------|
| `src/gildash/semantic-api.ts` | `getFileTypes`, `getResolvedTypeAt`, `isTypeAssignableToAt` 래퍼 추가 (경로 해석 포함) |
| `src/gildash/index.ts` | facade 메서드 3개 추가 |
| `src/gildash/context.ts` | `SemanticLayerLike`에 해당 없음 (기존 메서드로 충분) |

### 구현 비용

S (소). SemanticLayer 자체 변경 없음. facade 래퍼만 추가.

---

## 구현 순서

```
Phase 1 (minor release) — IndexResult 확장
├─ Feature 1: changedSymbols.isExported + modified 판정 확장
│  ├─ SymbolSnap에 isExported 추가
│  ├─ modified 판정 확장: fingerprint OR isExported OR structuralFingerprint 변경
│  ├─ changedSymbols 항목에 isExported 속성 추가
│  ├─ IndexResult 타입 변경
│  └─ 테스트: export 변경 감지, structuralFingerprint 변경 감지, 속성 정확성
│
├─ Feature 2: changedRelations
│  ├─ before/after relation snapshot 수집
│  ├─ diff 계산 (identity key: type|src|dst|srcSym|dstSym|metaJsonHash)
│  ├─ 삭제 파일 relation 처리
│  ├─ IndexResult 타입 확장
│  ├─ 알려진 한계 문서화 (wildcard re-export, type-only 전환, retarget)
│  └─ 테스트: relation 추가/삭제 감지, 삭제 파일 케이스
│
├─ Feature 2-a: renamedSymbols / movedSymbols in IndexResult
│  ├─ 이미 계산된 renameResult.renamed, movedEntries를 IndexResult에 매핑
│  ├─ isExported 필드 포함 (Feature 1 의존)
│  └─ 테스트: rename/move가 IndexResult에 정확히 포함되는지 검증
│
└─ changeset: minor (IndexResult 타입 확장 = API 변경)

Phase 2 (별도 minor release) — Search + Semantic 확장
├─ Feature 3: RelationSearchQuery 패턴 매칭
│  ├─ query 타입 확장
│  ├─ validation (exact + pattern 동시 지정 방지)
│  ├─ 앱 레벨 Bun.Glob 필터링
│  ├─ limit 처리 (패턴 사용 시 DB limit 제거 → 앱 레벨 limit)
│  └─ 테스트: glob 매칭, validation 에러, limit 정합성
│
├─ Feature 4: isTypeAssignableTo
│  ├─ TypeCollector.isAssignableTo 구현
│  ├─ SemanticLayer / facade 레이어 추가
│  ├─ SemanticLayerLike 확장
│  └─ 테스트: 호환/불호환/null 케이스, 방향성 검증
│
├─ Feature 5: collectFileTypes / position 기반 semantic API
│  ├─ getFileTypes, getResolvedTypeAt, isTypeAssignableToAt 래퍼
│  └─ 테스트: 벌크 타입 수집, position 직접 조회
│
└─ changeset: minor
```

---

## Breaking Change 분석

| 항목 | breaking? | 사유 |
|------|-----------|------|
| `changedSymbols` 항목에 `isExported` 추가 | No | 기존 필드 유지, 속성 완성 |
| `modified` 판정 기준 확장 (isExported/structuralFingerprint 변경 포함) | **동작 변경** | 기존에 `modified`에 안 나타나던 심볼이 나타날 수 있음. 정보 완전성 향상이며 기존 항목이 사라지는 것은 아님 (additive). minor 릴리스 release note에 명시 |
| `IndexResult`에 `changedRelations` 추가 | No | 신규 필드 추가 |
| `IndexResult`에 `renamedSymbols`, `movedSymbols` 추가 | No | 신규 필드 추가 |
| `RelationSearchQuery`에 pattern 필드 추가 | No | optional 필드 추가 |
| `Gildash.isTypeAssignableTo()` 추가 | No | 신규 메서드 추가 |
| `Gildash.getFileTypes()` 등 추가 | No | 신규 메서드 추가 |
| `SemanticLayerLike`에 `isTypeAssignableTo` 추가 | **Yes (internal)** | 이 타입을 구현하는 외부 코드가 있다면 breaking. 내부 타입이므로 실질적 영향 없음 |

모두 additive change. semver minor 릴리스 적합.
`SemanticLayerLike` 확장은 내부 타입(`GildashContext`용)이므로 external breaking이 아님.

---

## 테스트 계획

### Feature 1 테스트 케이스

- export 키워드 추가 → `modified`에 포함 (isExported 변경으로 판정), `isExported: true`
- export 키워드 제거 → `modified`에 포함, `isExported: false`
- 함수 파라미터 수 변경 → `modified`에 포함 (fingerprint 변경)
- return type 변경 → `modified`에 포함 (structuralFingerprint 변경)
- decorator 추가 → `modified`에 포함 (structuralFingerprint 변경)
- 함수 body만 변경 (구조 변경 없음) → `modified`에 미포함 (세 hash 모두 동일). `changedFiles`에는 포함.
- structuralFingerprint null (레거시 DB) → structuralFingerprint 변경으로 판정하지 않음
- 새 심볼 추가 → `added`, `isExported` 정확
- 심볼 삭제 → `removed`, `isExported` 정확 (삭제 시점 값)
- rename → `changedSymbols`에서 제외 (기존 동작 유지)

### Feature 2 테스트 케이스

- import 추가 → `changedRelations.added`
- import 삭제 → `changedRelations.removed`
- re-export 문 추가/삭제 → 정확히 감지
- **re-export specifier 추가** (`export { A }` → `export { A, B }`) → old removed + new added (metaJsonHash 변경)
- **re-export specifier 삭제** → 동일 원리
- 파일 삭제 → 해당 파일의 모든 outgoing relation이 `removed`
- 코드 변경 없이 재인덱싱 → `changedRelations` 비어있음
- full index (빈 DB) → 모든 relation이 `added`
- full index (기존 데이터 있는 DB) → 기존 relation이 `removed`, 새 relation이 `added` (before snapshot이 CASCADE 전에 수집됨)
- **중복 relation (같은 함수 2회 호출)** → Set diff이므로 1회→2회 변경 미감지 (문서화된 한계)

### Feature 3 테스트 케이스

- `dstFilePathPattern: 'packages/*/src/**'` → deep import만 반환
- `srcFilePathPattern`과 `srcFilePath` 동시 지정 → validation error
- 패턴 매칭 + limit → 정확한 limit 적용
- 매칭 결과 없음 → 빈 배열

### Feature 2-a 테스트 케이스

- 심볼 rename → `renamedSymbols`에 포함, `changedSymbols.added/removed`에서 제외
- 심볼 move (다른 파일로 이동) → `movedSymbols`에 포함
- rename + move 동시 → 각각 정확히 분류
- rename된 심볼의 `isExported` 값이 정확한지
- full index에서는 `movedSymbols` 비어있음 (move detection은 incremental only)

### Feature 4 테스트 케이스

- 클래스가 인터페이스 구현 → `true`
- 구조적으로 호환되는 타입 → `true` (duck typing)
- 호환되지 않는 타입 → `false`
- 방향성 검증: `isTypeAssignableTo(A, B)` !== `isTypeAssignableTo(B, A)`
- 존재하지 않는 심볼 → `GildashError('search')` throw
- tsc program에 없는 파일 → `null`
- source와 target이 다른 tsconfig에 속할 때 → `null` (단일 compilation unit 제약)
- union 타입 호환성: `string` assignable to `string | number` → `true`
- generic 타입 호환성: `Array<string>` assignable to `Array<unknown>` → `true`
- semantic layer 미활성 → `GildashError(type: 'semantic')` throw

### Feature 5 테스트 케이스

- `getFileTypes(filePath)` → Map에 파일 내 모든 선언 타입 포함
- `getResolvedTypeAt(filePath, line, column)` → DB 조회 없이 직접 타입 반환
- `isTypeAssignableToAt(...)` → position 기반으로 Feature 4와 동일 결과
- **상대 경로 전달** → 내부에서 절대 경로로 해석 후 정상 동작
- semantic layer 미활성 시 모두 `GildashError(type: 'semantic')` throw
- tsc program에 없는 파일 → null / 빈 Map

---

## 심층 리뷰 결과 (3-agent cross-check)

리뷰어 3명이 독립적으로 코드를 읽고 계획을 검토. 교차 확인된 결과만 반영.

### 교차 확인된 발견 (2개 이상 에이전트가 동의)

| # | 발견 | 심각도 | 확인 에이전트 | 처리 |
|---|------|--------|-------------|------|
| R1 | changeHint 우선순위 미정의 (동시 변경 시) | Important | Agent 1, 3 | **수정 완료** — 변경 범위 플래그 자체를 삭제. `changedSymbols`는 경량 식별자 목록이며 변경 상세 분석은 `diffSymbols()`의 역할. modified 판정 기준만 확장 (fingerprint OR isExported OR structuralFingerprint) |
| R2 | `getOutgoing()` missing from IndexCoordinatorOptions | Important | Agent 1, 3 | **수정 완료** — 변경 대상 코드에 추가 |
| R3 | relation identity key 중복 가능 (UNIQUE 없음) | Important | Agent 1, 3 | **수정 완료** — Set diff 의미론 + 문서화 |
| R4 | SemanticLayerLike 모순 (추가한다/안한다) | Important | Agent 2, 3 | **수정 완료** — 추가하기로 결정, 모순 해소 |

### 단일 에이전트 발견 (검증 후 수용)

| # | 발견 | 심각도 | 에이전트 | 처리 |
|---|------|--------|---------|------|
| R5 | re-export specifier 변경이 invisible (metaJson에만 저장) | **Critical** | Agent 3 | **수정 완료** — identity key에 metaJsonHash 포함 |
| R6 | renamed/moved isExported 데이터 소스 미명시 | Important | Agent 1 | **수정 완료** — Feature 2-a에 명시 |
| R7 | isTypeAssignableToAt 6개 positional 파라미터 | Important | Agent 2 | **수정 완료** — 객체 파라미터로 변경 |
| R8 | Feature 5 path resolution 누락 | Important | Agent 2 | **수정 완료** — 경로 해석 필수 명시 |
| R9 | 에러 처리 null vs throw 불일관 | Important | Agent 2 | **수정 완료** — 심볼 미발견=throw, tsc 실패=null |
| R10 | 패턴 쿼리 시 unbounded result set | Important | Agent 3 | **수정 완료** — hard limit 대신 소비자 limit을 앱 레벨에서 적용. 임의의 hard limit은 두지 않음 (Gildash는 소비자 쿼리를 정책적으로 제한하지 않음) |
| R11 | structuralFingerprint null 시 오판 | Minor | Agent 1 | **수정 완료** — null이면 structuralFingerprint 변경으로 판정하지 않음 |
| R12 | collectFileTypes는 re-export 미포함 | Minor | Agent 2 | **수정 완료** — 문서에 명시 |
| R13 | assertNotDisposed in SemanticLayer wrapper | Minor | Agent 2 | **수정 완료** — 명시 |

### 긍정적 확인 (계획이 정확함을 검증)

| 확인 사항 | 에이전트 |
|-----------|---------|
| 동시성 안전 (single-writer guarantee) | Agent 1 |
| full index before-snapshot 타이밍 정확 | Agent 1 |
| incremental after-snapshot 타이밍 정확 | Agent 1 |
| getTypeAtLocation: class → instance type (DI use case 정합) | Agent 2 |
| ts.TypeChecker.isTypeAssignableTo 시그니처 + 방향성 정확 | Agent 2 |
| Bun.Glob.match() API 사용법 정확 | Agent 3 |
| 메모리 압력 수용 가능 (1000파일 full index ~2-3MB) | Agent 3 |
