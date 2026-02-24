# gildash 0.5.0 Release Plan

## 정체성

> **gildash** = TypeScript code indexing and dependency graph engine
> 파싱 · 추출 · 인덱싱 · 그래프 구축 · 정책 없는 기계적 가공
>
> **gildash는 정책을 내장하지 않는다.** 알고리즘은 제공하되, 판정은 고객 영역이다.

---

## Breaking Changes (0.x semver — minor에서 허용)

### BC-1. `getDeadExports()` 삭제

**사유**: entry point 기본 정책 내장 (`index.ts`, `main.ts` 제외) + "dead" 판정 = 정체성 이탈.

**삭제 대상 파일:**

| 파일 | 변경 |
|------|------|
| `src/gildash.ts` L1232–L1296 | `getDeadExports()` 메서드 전체 삭제 |
| `src/gildash.spec.ts` L2634–L2830+ | `Gildash.getDeadExports` describe 블록 전체 삭제 |
| `test/gildash.test.ts` L477–L500+ | integration test 내 `getDeadExports` 관련 `it` 블록 삭제 |
| `README.md` | API 테이블에서 `getDeadExports` 행 삭제, 코드 예시 삭제 |
| `README.ko.md` | 동일 |

**대체 경로 (고객용):**
```ts
// export 집합
const exports = ledger.searchSymbols({ isExported: true });
// import/re-export 집합
const imports = ledger.searchRelations({ type: 'imports' });
const reExports = ledger.searchRelations({ type: 're-exports' });
// 집합 연산 + 고객 정책 적용은 고객 코드에서
```

---

## Feature Changes

### F-1. oxc-parser 0.114.0 → 0.115.0 bump

**파일:** `package.json`

**변경:**
```diff
- "oxc-parser": "0.114.0"
+ "oxc-parser": "0.115.0"
```

`peerDependencies`의 `"oxc-parser": ">=0.114.0"`은 변경 없음 (0.115.0 호환).

**검증:** 기존 전체 테스트 통과.

---

### F-2. `parseSource` / `batchParse` ParserOptions passthrough

**목적:** oxc-parser의 `sourceType`, `lang` 등 파싱 옵션을 고객이 제어할 수 있도록 passthrough.

**영향 범위 (parseSource 호출 지점):**

| 파일 | 위치 | 설명 |
|------|------|------|
| `src/parser/parse-source.ts` L6–L17 | `parseSource()` 함수 정의 | 시그니처 변경 |
| `src/gildash.ts` L220 | `parseSourceFn` 타입 정의 | 타입 변경 |
| `src/gildash.ts` L280 | `parseSourceFn` private field | 타입 변경 |
| `src/gildash.ts` L318 | constructor 내부 타입 | 타입 변경 |
| `src/gildash.ts` L746 | `this.parseSourceFn(filePath, sourceText)` | options 전달 추가 |
| `src/gildash.ts` L1581 | `this.parseSourceFn(fp, text)` (batchParse) | options 전달 추가 |
| `src/gildash.ts` L744 | public `parseSource()` 메서드 | 시그니처 변경 |
| `src/gildash.ts` L1574 | public `batchParse()` 메서드 | 시그니처 변경 |

**변경 상세:**

`src/parser/parse-source.ts`:
```diff
+ import type { ParserOptions } from 'oxc-parser';
+
  export function parseSource(
    filePath: string,
    sourceText: string,
+   options?: ParserOptions,
    parseSyncFn: typeof defaultParseSync = defaultParseSync,
  ): Result<ParsedFile, GildashError> {
    try {
-     const { program, errors, comments } = parseSyncFn(filePath, sourceText);
+     const { program, errors, comments } = parseSyncFn(filePath, sourceText, options);
```

`src/gildash.ts` public API:
```diff
- parseSource(filePath: string, sourceText: string): Result<ParsedFile, GildashError>
+ parseSource(filePath: string, sourceText: string, options?: ParserOptions): Result<ParsedFile, GildashError>

- batchParse(filePaths: string[]): Promise<Result<Map<string, ParsedFile>, GildashError>>
+ batchParse(filePaths: string[], options?: ParserOptions): Promise<Result<Map<string, ParsedFile>, GildashError>>
```

**테스트 추가:**
- `src/parser/parse-source.spec.ts`: options 전달 검증 (sourceType, lang 등)
- `src/gildash.spec.ts`: parseSource/batchParse에 options 전달 검증

---

### F-3. `getCyclePaths` → Tarjan SCC + Johnson's circuits

**목적:** 현행 DFS + `globalVisited`는 모든 elementary circuit를 보장하지 않는다. Tarjan SCC preprocessing + Johnson's circuits로 교체하여 완전성 보장.

**채택 근거:**

| 기준 | Tarjan SCC + Johnson's | Johnson's alone |
|------|----------------------|-----------------|
| SCC 계산 | 한 번 O(V+E) | 매 반복마다 재계산 |
| 탐색 공간 | SCC 내 노드만 | 전체 그래프 |
| import graph 적합성 | 대부분 acyclic → 가지치기 효과 극대 | 비효율적 |

**영향 범위:**

| 파일 | 변경 |
|------|------|
| `src/search/dependency-graph.ts` L230–L269 | `getCyclePaths()` 내부 알고리즘 전면 교체 |
| `src/search/dependency-graph.ts` | Tarjan SCC + Johnson's helper 함수 추가 |
| `src/search/dependency-graph.spec.ts` L513–L601 | 기존 테스트 유지 + 공유 노드 사이클 테스트 추가 |
| `src/gildash.ts` L1221–L1230 | `getCyclePaths()` 시그니처에 options 추가 |
| `src/gildash.spec.ts` | getCyclePaths 관련 테스트에 maxCycles 테스트 추가 |

**`getCyclePaths` 새 시그니처:**
```ts
getCyclePaths(options?: { maxCycles?: number }): string[][]
```

**알고리즘 구조:**
```
1. adjacencyList에서 Tarjan SCC 실행 → SCC 목록
2. 크기 1인 SCC 중 self-loop 없는 것 → 스킵  
3. 크기 2+ SCC에 대해 Johnson's circuits 실행
4. 각 circuit를 canonical form으로 정규화 (lexicographic rotation)
5. maxCycles 도달 시 조기 종료
6. string[][] 반환
```

**선행조건:** firebat 레퍼런스 코드 수령 (Tarjan ~49줄 + Johnson's ~87줄 + 정규화 ~31줄). 수령 전 F-1, F-2, BC-1은 독립 진행 가능.

---

### F-4. 문서화

| 대상 | 내용 |
|------|------|
| `src/search/dependency-graph.ts` getCyclePaths JSDoc | "Tarjan SCC + Johnson's circuits. 모든 elementary circuit 보장." |
| `src/gildash.ts` getCyclePaths JSDoc | maxCycles 옵션 설명, 알고리즘 명시 |
| `README.md` / `README.ko.md` | getDeadExports 제거 반영, getCyclePaths 알고리즘 변경 반영, 정체성 원칙 섹션 추가 |
| `CHANGELOG.md` | 0.5.0 변경사항 기록 |

---

## 실행 순서

```
Phase 1 — 독립 작업 (블로커 없음)
├─ F-1. oxc-parser bump
├─ F-2. ParserOptions passthrough  
└─ BC-1. getDeadExports 삭제

Phase 2 — 레퍼런스 의존
└─ F-3. getCyclePaths Tarjan SCC + Johnson's + maxCycles

Phase 3 — 마무리
├─ F-4. 문서화
└─ 0.5.0 릴리스
```

각 항목은 Test-First Flow (OVERFLOW → PRUNE → RED → GREEN) 적용.

---

## 세부 실행 체크리스트

### F-1. oxc-parser bump
- [ ] `package.json` dependencies `oxc-parser` 0.114.0 → 0.115.0
- [ ] `bun install`
- [ ] 전체 테스트 실행 → 통과 확인
- [ ] commit: `chore: bump oxc-parser to 0.115.0`

### F-2. ParserOptions passthrough
- [ ] Impact-First: `parseSource` 호출 지점 전수 확인 (6곳)
- [ ] OVERFLOW → PRUNE: parse-source.spec.ts, gildash.spec.ts
- [ ] `src/parser/parse-source.ts` 시그니처 변경
- [ ] `src/gildash.ts` parseSourceFn 타입, parseSource(), batchParse() 시그니처 변경
- [ ] `src/gildash.ts` 내부 호출 2곳에 options 전달
- [ ] 테스트 추가 → RED 확인
- [ ] 구현 → GREEN 확인
- [ ] 전체 테스트 실행
- [ ] commit: `feat: add ParserOptions passthrough to parseSource and batchParse`

### BC-1. getDeadExports 삭제
- [ ] `src/gildash.ts` getDeadExports() 메서드 삭제
- [ ] `src/gildash.spec.ts` getDeadExports describe 블록 삭제
- [ ] `test/gildash.test.ts` getDeadExports 관련 it 블록 삭제
- [ ] `README.md` / `README.ko.md` 관련 내용 삭제
- [ ] 전체 테스트 실행
- [ ] commit: `feat!: remove getDeadExports (policy-embedded API)`

### F-3. getCyclePaths Tarjan SCC + Johnson's
- [ ] firebat 레퍼런스 코드 수령
- [ ] OVERFLOW → PRUNE: dependency-graph.spec.ts
- [ ] `src/search/dependency-graph.ts` — Tarjan SCC 함수 구현
- [ ] `src/search/dependency-graph.ts` — Johnson's circuits 함수 구현
- [ ] `src/search/dependency-graph.ts` — 정규화 함수 구현
- [ ] `src/search/dependency-graph.ts` — getCyclePaths() 교체 + maxCycles 옵션
- [ ] `src/gildash.ts` — getCyclePaths() 시그니처에 options 추가
- [ ] 테스트 추가: 공유 노드 사이클 탐지, maxCycles 경계값, self-loop, 빈 그래프
- [ ] RED → GREEN 확인
- [ ] 전체 테스트 실행
- [ ] commit: `feat: replace getCyclePaths with Tarjan SCC + Johnson's circuits`

### F-4. 문서화
- [ ] JSDoc 업데이트 (dependency-graph.ts, gildash.ts)
- [ ] README.md / README.ko.md 업데이트
- [ ] CHANGELOG.md 0.5.0 항목 작성
- [ ] commit: `docs: update for 0.5.0 changes`

### Release
- [ ] changeset 생성 (minor)
- [ ] 전체 테스트 최종 실행
- [ ] PR 생성 → main
- [ ] 머지 → 0.5.0 릴리스
