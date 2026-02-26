# @zipbul/gildash 심층 분석 보고서

> 분석 일자: 2026-02-26 | 분석 대상 버전: v0.7.0

## 1. 프로젝트 목적 및 목표

**TypeScript 코드 인텔리전스 엔진** — TypeScript 코드베이스를 로컬 SQLite DB에 인덱싱하여 심볼 검색, 파일 간 관계 추적, 의존성 그래프 분석, AST 패턴 매칭을 제공하는 Bun-native 라이브러리.

핵심 목표:

- **코드 인덱싱**: 파일 변경 감지 → 파싱 → 심볼/관계 추출 → DB 저장 파이프라인
- **검색**: FTS5 기반 심볼 검색, 정규식, 관계 쿼리, ast-grep 패턴 매칭
- **의존성 분석**: import 그래프, 순환 참조 탐지 (Tarjan SCC + Johnson's), 영향 범위 분석
- **시맨틱 분석**: tsc TypeChecker 연동으로 타입 해석, 참조 검색, 구현체 탐색
- **멀티프로세스 안전성**: Owner/Reader 패턴으로 단일 쓰기 보장

---

## 2. 현재 완성도

| 지표 | 수치 |
|------|------|
| 버전 | v0.7.0 (8번째 릴리즈) |
| 소스 파일 | 63개 (비테스트 .ts) |
| 소스 LOC | ~7,800줄 |
| 테스트 파일 | 52개 (spec + test) |
| 테스트 LOC | ~22,800줄 (코드 대비 ~292%) |
| 테스트 수 | **1,568개 전체 통과** |
| 함수 커버리지 | **99.82%** |
| 라인 커버리지 | **99.84%** |
| 타입체크 | 에러 0건 |
| 빌드 | 정상 (51 모듈 → 79KB) |
| TODO/FIXME | **0건** |
| 공개 API | 37개 메서드, 전부 구현 완료 |

**판정: 기능적으로 완성된 상태.** 스텁이나 미구현 API가 없고, 코드에 TODO/FIXME가 단 하나도 없다.

---

## 3. 아키텍처

```
Gildash (Facade — src/gildash/)
├── Parser      — oxc-parser AST 파싱 + LRU 캐시 (src/parser/)
├── Extractor   — 심볼 & 관계 추출 (src/extractor/)
├── Store       — bun:sqlite + drizzle-orm, FTS5 검색 (src/store/)
├── Indexer     — 파일 변경 → 파싱 → 추출 → 저장 파이프라인 (src/indexer/)
├── Search      — 심볼 FTS, 관계 쿼리, 의존성 그래프, ast-grep (src/search/)
├── Semantic    — tsc TypeChecker 연동, 옵트인 (src/semantic/)
├── Watcher     — @parcel/watcher + Owner/Reader 역할 분리 (src/watcher/)
└── Common      — 프로젝트 탐색, tsconfig 리졸버, 해셔, LRU 캐시 (src/common/)
```

### 모듈별 규모 (테스트 포함)

| 모듈 | 파일 수 | LOC | 주요 구성 |
|------|---------|-----|----------|
| parser | 12 | 1,185 | 파서 캐시, JSDoc 추출, 소스 위치 추적 |
| extractor | 14 | 3,340 | 심볼 추출, import/관계 추적, 상속 체인 |
| store | 13 | 2,103 | DB 스키마, 3개 리포지토리 (file/symbol/relation), FTS 유틸리티 |
| indexer | 9 | 3,509 | 파일 코디네이터, 심볼/관계 인덱서, 변경 감지 |
| search | 9 | 2,364 | 심볼 FTS 검색, 관계 쿼리, 의존성 그래프, 패턴 매칭 |
| semantic | 14 | 5,087 | tsc 통합 (6개 컴포넌트), 심볼 그래프 + LRU 캐시 |
| watcher | 6 | 918 | 프로젝트 와처, Owner/Reader 하트비트, 역할 분리 |
| common | 11 | 1,062 | 해셔, LRU 캐시, 경로 유틸, 프로젝트 탐색, tsconfig 리졸버 |
| gildash (facade) | 17 | 4,854 | 메인 클래스 + 6개 API 모듈 |

---

## 4. 구조적 강점

### 아키텍처 설계

8개 모듈이 명확한 책임 분리로 구성되어 있고, `Gildash` 파사드 클래스가 단일 진입점 역할을 한다. 각 모듈은 `index.ts`로 공개 API만 노출하는 캡슐화 원칙을 따른다.

### 에러 처리 일관성

모든 공개 메서드가 동일한 패턴을 따른다:

1. `ctx.closed` 체크 → `GildashError('closed')` throw
2. try-catch로 감싸서 `GildashError`는 재throw, 나머지는 래핑 throw
3. 반환 타입 컨벤션 일관: `T | null` (not found), `T[]` (빈 컬렉션), `void` (부작용)

### 테스트 전략

- 유닛/통합 테스트 분리 (`.spec.ts` vs `.test.ts`)
- DI 기반 목킹 우선, `mock.module()` 차선
- 90% 커버리지 임계치를 **99.8%로 초과 달성**
- pre-commit 훅으로 typecheck + test 강제

### 멀티프로세스 안전성

Owner/Reader 패턴이 완전 구현: 하트비트(30초), 헬스체크(60초), 자동 승격, 시그널 핸들러 정리까지.

---

## 5. 부족한 점 및 잠재적 문제

### 5-1. 문서/생태계 측면

| 항목 | 상세 |
|------|------|
| **사용 예제 부족** | README에 기본 사용법은 있으나, 실제 프로젝트에서 활용하는 심층 예제(CLI 도구 구축, IDE 플러그인 연동 등)가 없다 |
| **API 레퍼런스 문서 없음** | 37개 메서드의 JSDoc은 있으나, 별도 API 문서 사이트가 없다 |
| **벤치마크/성능 데이터 없음** | 대규모 코드베이스(10만줄+ 프로젝트)에서의 인덱싱 시간, 메모리 사용량 등 성능 지표가 공개되지 않았다 |

### 5-2. 기능적 한계

| 항목 | 상세 |
|------|------|
| **JavaScript/TSX 기본 미포함** | 기본 확장자가 `['.ts', '.mts', '.cts']`로 설정됨. `extensions` 옵션으로 `.tsx`, `.js` 등을 추가할 수 있으나, 기본 설정에서는 제외 |
| **시맨틱 레이어 옵트인** | tsc 연동이 선택적(`semantic: true`)이라 기본 모드에서는 타입 정보 없이 AST 수준 분석만 가능. 시맨틱 없이는 정확한 참조 해석 불가 |
| **이름 기반 위치 탐색의 한계** | `semantic/index.ts`에서 심볼 위치를 찾을 때 단순 텍스트 검색 + 단어 경계 검증을 사용. 동일 이름 심볼이 같은 파일에 여러 번 나오면 첫 번째 매치만 반환될 수 있음 |
| **외부 패키지 인덱싱 제거** | v0.6.0에서 `indexExternalPackages()`가 삭제됨. node_modules 내부 타입 추적이 불가 |

### 5-3. 기술적 제약

| 항목 | 상세 |
|------|------|
| **SQLite 단일 작성자** | WAL 모드이지만 쓰기는 Owner 프로세스 하나만 가능. 대규모 모노레포에서 병렬 인덱싱 불가 |
| **파서 캐시 고정 크기** | LRU 캐시 기본 500개. TTL 없이 크기 기반 퇴거만 함. 대규모 프로젝트에서 메모리 사용 예측 어려움 |
| **그래프 캐시 무효화** | 인덱스 실행마다 전체 캐시 무효화. 점진적(incremental) 그래프 업데이트가 아님 |
| **Bun 종속성** | `bun:sqlite`, `bun:test` 등 Bun 전용 API에 강하게 결합. Node.js 환경에서 사용 불가 |

### 5-4. 커버리지 사각지대 (미미하지만 존재)

| 파일 | 미커버 | 비고 |
|------|--------|------|
| `gildash/index.ts` | 65-67줄 (96.7%) | 파사드 초기화 경로 일부 |
| `gildash/graph-api.ts` | 128-129줄 (98.4%) | 그래프 API 에러 경로 |
| `semantic/tsc-program.ts` | 함수 93.55% | 일부 tsc 래퍼 함수 미커버 |

이 부분은 실질적 위험은 매우 낮으나, 99%+ 커버리지 목표라면 보완 가능.

---

## 6. 공개 API 목록 (37개 메서드)

### Parse (3)

- `parseSource(filePath, sourceText, options?)` → ParsedFile
- `batchParse(filePaths, options?)` → Map<string, ParsedFile>
- `getParsedAst(filePath)` → ParsedFile | undefined

### Extract (2)

- `extractSymbols(parsed)` → ExtractedSymbol[]
- `extractRelations(parsed)` → CodeRelation[]

### Query/Search (9)

- `getStats(project?)` → SymbolStats
- `searchSymbols(query)` → SymbolSearchResult[]
- `searchRelations(query)` → CodeRelation[]
- `searchAllSymbols(query)` → SymbolSearchResult[]
- `searchAllRelations(query)` → CodeRelation[]
- `listIndexedFiles(project?)` → FileRecord[]
- `getInternalRelations(filePath, project?)` → CodeRelation[]
- `getFullSymbol(name, filePath, project?)` → FullSymbol | null
- `getFileStats(filePath, project?)` → FileStats

### Query/Metadata (3)

- `getFileInfo(filePath, project?)` → FileRecord | null
- `getSymbolsByFile(filePath, project?)` → SymbolSearchResult[]
- `getModuleInterface(filePath, project?)` → ModuleInterface

### Graph (8)

- `getDependencies(filePath, project?, limit?)` → string[]
- `getDependents(filePath, project?, limit?)` → string[]
- `getAffected(changedFiles, project?)` → string[]
- `hasCycle(project?)` → boolean
- `getImportGraph(project?)` → Map<string, string[]>
- `getTransitiveDependencies(filePath, project?)` → string[]
- `getCyclePaths(project?, options?)` → string[][]
- `getFanMetrics(filePath, project?)` → FanMetrics

### Semantic (4)

- `getResolvedType(name, filePath, project?)` → ResolvedType | null
- `getSemanticReferences(name, filePath, project?)` → SemanticReference[]
- `getImplementations(name, filePath, project?)` → Implementation[]
- `getSemanticModuleInterface(filePath)` → SemanticModuleInterface

### Utility (6)

- `diffSymbols(before, after)` → SymbolDiff
- `onIndexed(callback)` → () => void
- `reindex()` → IndexResult
- `resolveSymbol(name, filePath, project?)` → ResolvedSymbol
- `findPattern(pattern, opts?)` → PatternMatch[]
- `getHeritageChain(name, filePath, project?)` → HeritageNode

### Lifecycle (2)

- `Gildash.open(options)` → Gildash (static factory)
- `close(opts?)` → void

---

## 7. 종합 평가

| 평가 항목 | 등급 | 근거 |
|-----------|------|------|
| 코드 품질 | A+ | strict TS, 일관된 패턴, TODO 0건 |
| 테스트 품질 | A+ | 1,568 테스트, 99.8% 커버리지 |
| 아키텍처 | A | 모듈 분리 우수, 파사드 패턴 적용 |
| 에러 처리 | A+ | 전 메서드 일관된 throw 패턴 |
| 기능 완성도 | A | 37 API 전부 구현, 핵심 기능 완비 |
| 문서화 | B+ | README/CHANGELOG 있으나 API 문서 미흡 |
| 확장성 | B | SQLite 단일 작성자, Bun 전용 |
| 생태계/채택 | C+ | 사용 예제/벤치마크/플러그인 부재 |

**결론**: 엔지니어링 품질은 **프로덕션 레디 수준**으로 매우 높다. 코드 자체의 결함은 발견되지 않았다. 향후 과제는 코드 품질이 아닌 **생태계 확장**(문서, 벤치마크, 사용 사례, 플러그인)과 **스케일링**(대규모 프로젝트 대응, 병렬 인덱싱)에 있다.

---

## 8. 패키지 개선 권장

### 8-1. 코드 품질

| 항목 | 상세 |
|------|------|
| **Owner/Reader 하트비트 타이밍 갭** | Owner 30초 하트비트 / Reader 60초 체크 / 90초 스테일 → 최악 120초 미감지. Reader 체크 간격 단축 또는 스테일 임계치 하향 권장 |
| **Reader 그래프 캐시 stale** | Reader가 Owner 인덱싱 결과를 즉시 미반영. Reader는 `onIndexed` 콜백을 받지 않아 캐시가 무기한 유지됨. 타임스탬프 기반 캐시 만료 또는 DB 인덱스 버전 폴링 권장 |
| **그래프 캐시 전체 무효화** | 인덱스 실행마다 전체 캐시 무효화. 대부분 프로젝트에서 rebuild 비용은 미미하나, 10,000+ 파일 규모에서는 변경 영향 범위만 무효화하는 incremental 전략 검토 가치 있음 |
| **Watcher→Semantic 무음 에러** | `lifecycle.ts:78-81`에서 `.catch(() => {})`. 파일 읽기 실패 시 시맨틱 레이어가 변경을 감지 못함. 삭제된 파일도 `notifyFileDeleted` 대신 무시됨 |
| **PID 재활용 경합** | `ownership.ts`에서 Owner 생존을 `process.kill(pid, 0)`으로 확인. OS가 PID 재활용 시 무관한 프로세스를 Owner로 오인하여 Reader 승격 교착 가능. PID + UUID 조합 권장 |
| **batchParse 무음 실패** | `parse-api.ts:37-39`에서 파싱 실패 파일이 결과에서 조용히 제외됨. 호출자가 어떤 파일이 실패했는지 알 수 없음 |

### 8-2. 성능 / 확장성

| 항목 | 상세 |
|------|------|
| **Relations 테이블 커버링 인덱스** | 2열 복합 인덱스 `(project, srcFilePath)`, `(dstProject, dstFilePath)`, `(project, type)`이 존재하며 주요 쿼리(`getOutgoing`/`getIncoming`/`getByType`)를 커버. 다만 범용 `searchRelations()`에서 타입+경로 동시 필터 시 3열 커버링 인덱스 부재로 추가 스캔 발생 가능 |
| **대규모 배치 처리** | 전체 인덱싱 시 `Promise.allSettled()`로 모든 파일을 동시 로드. 10,000+ 파일에서 OOM 위험 및 `EMFILE`(기본 ulimit 1024 초과) 위험 → 청크 단위 처리 권장 |

### 8-3. 기능 확장

| 항목 | 상세 |
|------|------|
| **이벤트 시스템 강화** | `onIndexed()` 하나뿐. `onFileChanged()`, `onError()`, `onRoleChanged()` 등 세분화 권장 |

### 8-4. 테스트 보강

| 항목 | 상세 |
|------|------|
| **스트레스 테스트** | 10,000+ 파일 프로젝트 시뮬레이션으로 메모리/성능 한계 검증 |
| **Chaos 테스트** | Owner 강제 종료 → Reader 자동 승격, 다중 Reader 경합 시나리오 |
| **Property-Based 테스트** | Tarjan SCC, Johnson's cycles 등 그래프 알고리즘에 fast-check 적용 |
| **벤치마크 스위트** | 실제 오픈소스 프로젝트 대상 인덱싱 시간, 메모리, 검색 응답 시간 측정 |

monorepo 지원안됨