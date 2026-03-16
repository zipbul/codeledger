# @zipbul/gildash

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/gildash)](https://www.npmjs.com/package/@zipbul/gildash)
[![CI](https://github.com/zipbul/gildash/actions/workflows/ci.yml/badge.svg)](https://github.com/zipbul/gildash/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Bun 네이티브** TypeScript 코드 인텔리전스 엔진.

gildash는 TypeScript 코드베이스를 로컬 SQLite 데이터베이스에 인덱싱하여, 심볼 검색 · 파일 간 관계 추적 · 의존성 그래프 분석 · 구조적 패턴 매칭을 제공합니다. 파일 변경을 감시하며 증분(incremental) 재인덱싱을 자동으로 수행합니다.

## 💡 왜 gildash인가?

| 문제 | gildash의 해결 방식 |
|------|---------------------|
| "이 모듈을 바꾸면 어디가 깨지지?" | 방향 import 그래프 + 전이적(transitive) 영향도 분석 |
| "순환 의존성이 있나?" | 전체 import 그래프에서 순환 감지 |
| "이 심볼이 실제로 어디서 정의된 거지?" | re-export 체인을 따라가 원본 소스까지 추적 |
| "모든 `console.log(...)` 호출을 찾아줘" | [ast-grep](https://ast-grep.github.io/) 기반 AST 레벨 구조적 패턴 검색 |

<br>

## ✨ 주요 기능

- **심볼 추출** — 함수, 클래스, 변수, 타입, 인터페이스, 열거형, 프로퍼티를 [oxc-parser](https://oxc.rs) AST 수준에서 추출
- **관계 분석** — `import`, `re-exports`, `type-references`, `calls`, `extends`, `implements` 관계를 파일 간에 추적
- **전문 검색** — SQLite FTS5 기반 심볼 이름 전문 검색 + 정확 일치(exact), 정규식(regex), 데코레이터(decorator) 필터
- **의존성 그래프** — 방향 import 그래프로 순환 감지, 전이적(transitive) 영향도 분석, 내부 캐싱
- **구조적 패턴 매칭** — [@ast-grep/napi](https://ast-grep.github.io/) 기반 AST 레벨 코드 검색
- **증분 인덱싱** — `@parcel/watcher` 기반 파일 변경 감지, 변경된 파일만 재인덱싱
- **심볼 레벨 diff** — `IndexResult`의 `changedSymbols`로 인덱싱 사이클 당 추가/수정/삭제된 심볼 추적
- **어노테이션 추출** — JSDoc, 라인(`//`), 블록(`/* */`) 주석에서 `@tag value` 패턴을 추출하고 심볼에 자동 연결, FTS5 검색 지원
- **심볼 변경 이력** — 인덱싱 사이클 간 심볼의 추가/수정/삭제/이름변경/이동을 추적, 구조적 지문 기반 rename 감지
- **멀티 프로세스 안전** — owner/reader 역할 분리로 단일 writer 보장
- **스캔 전용 모드** — `watchMode: false`로 파일 워처 없이 1회성 인덱싱
- **tsconfig.json JSONC** — `tsconfig.json`의 주석(`//`, `/* */`)과 트레일링 콤마를 지원하는 경로 별칭 파싱
- **시맨틱 레이어 (opt-in)** — tsc TypeChecker 통합으로 resolved type, 참조, 구현체, 모듈 인터페이스 분석
<br>

## 📋 요구사항

- **Bun** v1.3 이상
- 지원 확장자: `.ts`, `.mts`, `.cts`

<br>

## 📦 설치

```bash
bun add @zipbul/gildash
```

> **선택적 피어 의존성** — `typescript` (>=5.0.0)는 `semantic: true` 사용 시에만 필요합니다.

<br>

## 🚀 빠른 시작

```ts
import { Gildash } from '@zipbul/gildash';

// 1. 열기 — 최초 실행 시 전체 .ts 파일 인덱싱, 이후 파일 변경 감시
const ledger = await Gildash.open({
  projectRoot: '/absolute/path/to/project',
});

// 2. 검색 — 이름으로 심볼 찾기
const symbols = ledger.searchSymbols({ text: 'UserService', kind: 'class' });
symbols.forEach(s => console.log(`${s.name} → ${s.filePath}`));

// 3. 종료 — 리소스 해제
await ledger.close();
```

프로젝트 탐색(모노레포 지원), 증분 재인덱싱, 멀티 프로세스 안전 모두 자동으로 처리됩니다.

<br>

## 📖 사용 가이드

### 심볼 검색

인덱싱된 심볼을 FTS5 전문 검색, 정확 일치, 정규식, 데코레이터 필터로 검색합니다.

```ts
// 전문 검색 (FTS5 접두사 매칭)
const hits = ledger.searchSymbols({ text: 'handle' });

// 정확한 이름 매칭
const exact = ledger.searchSymbols({ text: 'UserService', exact: true });

// 정규식 패턴
const handlers = ledger.searchSymbols({ regex: '^handle.*Click$' });

// 데코레이터 필터
const injectables = ledger.searchSymbols({ decorator: 'Injectable' });

// 필터 조합
const exportedClasses = ledger.searchSymbols({
  kind: 'class',
  isExported: true,
  limit: 50,
});
```

`searchRelations()`로 파일 간 관계를 검색할 수 있습니다:

```ts
const imports = ledger.searchRelations({ srcFilePath: 'src/app.ts', type: 'imports' });
const callers = ledger.searchRelations({ dstSymbolName: 'processOrder', type: 'calls' });
```

모노레포 프로젝트에서는 `searchAllSymbols()`와 `searchAllRelations()`로 전체 프로젝트를 검색합니다.

---

### 의존성 분석

import 그래프 분석, 순환 감지, 변경 영향 범위 계산을 수행합니다.

```ts
// 직접 import / importer 목록
const deps = ledger.getDependencies('src/app.ts');
const importers = ledger.getDependents('src/utils.ts');

// 전이적 영향 — 파일 변경 시 어떤 파일이 영향을 받는가?
const affected = await ledger.getAffected(['src/utils.ts']);

// 전체 import 그래프 (인접 리스트)
const graph = await ledger.getImportGraph();

// 전이적 의존성 (전방 BFS)
const transitive = await ledger.getTransitiveDependencies('src/app.ts');

// 순환 의존성 감지
const hasCycles = await ledger.hasCycle();
const cyclePaths = await ledger.getCyclePaths();                           // 모든 elementary circuit
const limited   = await ledger.getCyclePaths(undefined, { maxCycles: 100 }); // undefined = 기본 프로젝트 사용
```

---

### 코드 품질 분석

모듈 인터페이스 조회, 결합도 측정을 수행합니다.

```ts
// 파일 통계 — 라인 수, 심볼 수, 파일 크기
const stats = ledger.getFileStats('src/app.ts');

// Fan-in / Fan-out 결합도 메트릭
const fan = await ledger.getFanMetrics('src/app.ts');

// 모듈 공개 인터페이스 — 모든 exported 심볼과 메타데이터
const iface = ledger.getModuleInterface('src/services/user.ts');

// 상세 심볼 정보 — 멤버, jsDoc, 데코레이터, 타입 정보
const full = ledger.getFullSymbol('UserService', 'src/services/user.ts');
```

---

### 패턴 매칭 & 추적

AST 구조로 코드를 검색하고, re-export 체인을 통해 심볼 원본을 추적합니다.

```ts
// 구조적 패턴 검색 (ast-grep 문법)
const logs = await ledger.findPattern('console.log($$$)');
const hooks = await ledger.findPattern('useState($A)', {
  filePaths: ['src/components/App.tsx'],
});

// re-export 체인 추적 — 심볼이 실제로 정의된 위치 찾기
const resolved = ledger.resolveSymbol('MyComponent', 'src/index.ts');

// 상속 체인 — extends/implements 트리 순회
const tree = await ledger.getHeritageChain('UserService', 'src/services/user.ts');
```

<br>

## 🔧 스캔 전용 모드

CI 파이프라인이나 1회성 분석에서는 파일 워처를 비활성화합니다:

```ts
const ledger = await Gildash.open({
  projectRoot: '/path/to/project',
  watchMode: false,        // 워처 없음, heartbeat 없음
});

// ... 쿼리 실행 ...

await ledger.close({ cleanup: true });   // DB 파일까지 삭제
```

<br>

## ❌ 에러 처리

public 메서드는 값을 직접 반환하고, 실패 시 `GildashError`를 throw합니다. `instanceof`로 분기합니다:

```ts
import { Gildash, GildashError } from '@zipbul/gildash';

try {
  const symbols = ledger.searchSymbols({ text: 'foo' });
  console.log(`${symbols.length}개 심볼 발견`);
} catch (e) {
  if (e instanceof GildashError) {
    console.error(`[${e.type}] ${e.message}`);
  }
}
```

<br>

## ⚙️ 설정

### `Gildash.open(options)`

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `projectRoot` | `string` | — | 프로젝트 루트 절대 경로 **(필수)** |
| `extensions` | `string[]` | `['.ts', '.mts', '.cts']` | 인덱싱 대상 파일 확장자 |
| `ignorePatterns` | `string[]` | `[]` | 무시할 글로브 패턴 |
| `parseCacheCapacity` | `number` | `500` | LRU 파싱 캐시 최대 크기 |
| `logger` | `Logger` | `console` | 커스텀 로거 (`{ error(...args): void }`) |
| `watchMode` | `boolean` | `true` | `false`이면 파일 워처 비활성화 (스캔 전용 모드) |
| `semantic` | `boolean` | `false` | tsc TypeChecker 기반 시맨틱 분석 활성화 |

**반환**: `Promise<Gildash>`. 실패 시 `GildashError`를 throw합니다.

> **참고:** `semantic: true`는 프로젝트 루트에 `tsconfig.json`이 필요합니다. 없으면 `Gildash.open()`이 `GildashError`를 throw합니다.

<br>

## 🔍 API 레퍼런스

### 검색

| 메서드 | 반환 타입 | 설명 |
|--------|-----------|------|
| `searchSymbols(query)` | `SymbolSearchResult[]` | FTS5 전문검색 + exact/regex/decorator 필터 |
| `searchRelations(query)` | `StoredCodeRelation[]` | 파일, 심볼, 관계 유형 필터 |
| `searchAllSymbols(query)` | `SymbolSearchResult[]` | 전체 프로젝트 심볼 검색 |
| `searchAllRelations(query)` | `StoredCodeRelation[]` | 전체 프로젝트 관계 검색 |
| `listIndexedFiles(project?)` | `FileRecord[]` | 인덱싱된 파일 목록 |
| `getSymbolsByFile(filePath)` | `SymbolSearchResult[]` | 단일 파일의 모든 심볼 |

### 의존성 그래프

| 메서드 | 반환 타입 | 설명 |
|--------|-----------|------|
| `getDependencies(filePath)` | `string[]` | `filePath`가 import하는 파일 목록 |
| `getDependents(filePath)` | `string[]` | `filePath`를 import하는 파일 목록 |
| `getAffected(changedFiles)` | `Promise<string[]>` | 전이적 영향 범위 |
| `hasCycle(project?)` | `Promise<boolean>` | 순환 의존성 감지 |
| `getCyclePaths(project?, opts?)` | `Promise<string[][]>` | 모든 순환 경로 (Tarjan SCC + Johnson's). `opts.maxCycles`로 개수 제한 가능. |
| `getImportGraph(project?)` | `Promise<Map>` | 전체 인접 리스트 |
| `getTransitiveDependencies(filePath)` | `Promise<string[]>` | 전방 전이적 BFS |

### 분석

| 메서드 | 반환 타입 | 설명 |
|--------|-----------|------|
| `getFullSymbol(name, filePath)` | `FullSymbol \| null` | 멤버, jsDoc, 데코레이터, 타입 정보 |
| `getFileStats(filePath)` | `FileStats` | 라인 수, 심볼 수, 파일 크기 |
| `getFanMetrics(filePath)` | `Promise<FanMetrics>` | fan-in/fan-out 결합도 |
| `getModuleInterface(filePath)` | `ModuleInterface` | 공개 export와 메타데이터 |
| `getInternalRelations(filePath)` | `StoredCodeRelation[]` | 파일 내부 관계 |
| `diffSymbols(before, after)` | `SymbolDiff` | 스냅샷 diff (추가/삭제/수정) |

### 시맨틱 (opt-in)

`semantic: true`로 열어야 사용 가능.

| 메서드 | 반환 타입 | 설명 |
|--------|-----------|------|
| `getResolvedType(name, filePath)` | `ResolvedType \| null` | tsc TypeChecker로 resolved type 조회 |
| `getSemanticReferences(name, filePath)` | `SemanticReference[]` | 심볼의 모든 참조 위치 |
| `getImplementations(name, filePath)` | `Implementation[]` | 인터페이스/추상 클래스 구현체 |
| `getSemanticModuleInterface(filePath)` | `SemanticModuleInterface` | 모듈 export 목록 + resolved type |

`getFullSymbol()`은 semantic 활성 시 자동으로 `resolvedType` 필드를 보강합니다.
`searchSymbols({ resolvedType })`로 resolved type 문자열 기반 필터링이 가능합니다.

### 고급

| 메서드 | 반환 타입 | 설명 |
|--------|-----------|------|
| `findPattern(pattern, opts?)` | `Promise<PatternMatch[]>` | AST 구조적 검색 (ast-grep) |
| `resolveSymbol(name, filePath)` | `ResolvedSymbol` | re-export 체인을 따라 원본 추적 |
| `getHeritageChain(name, filePath)` | `Promise<HeritageNode>` | extends/implements 트리 |
| `batchParse(filePaths, opts?)` | `Promise<BatchParseResult>` | 다중 파일 동시 파싱. `{ parsed, failures }` 반환. `opts`: oxc-parser `ParserOptions`. |

### 라이프사이클 & 저수준

| 메서드 | 반환 타입 | 설명 |
|--------|-----------|------|
| `reindex()` | `Promise<IndexResult>` | 강제 전체 재인덱싱 (owner만 가능) |
| `onIndexed(callback)` | `() => void` | 인덱싱 완료 이벤트 구독 |
| `onFileChanged(callback)` | `() => void` | 파일 변경 이벤트 구독 |
| `onError(callback)` | `() => void` | 에러 이벤트 구독 |
| `onRoleChanged(callback)` | `() => void` | owner/reader 역할 변경 이벤트 구독 |
| `parseSource(filePath, src, opts?)` | `ParsedFile` | 단일 파일 파싱 & 캐시. `opts`: oxc-parser `ParserOptions`. |
| `extractSymbols(parsed)` | `ExtractedSymbol[]` | 파싱된 AST에서 심볼 추출 |
| `extractRelations(parsed)` | `CodeRelation[]` | 파싱된 AST에서 관계 추출 |
| `getParsedAst(filePath)` | `ParsedFile \| undefined` | 캐시된 AST 조회 (읽기 전용) |
| `getFileInfo(filePath)` | `FileRecord \| null` | 파일 메타데이터 (해시, mtime, 크기) |
| `getStats(project?)` | `SymbolStats` | 심볼/파일 통계 |
| `projects` | `ProjectBoundary[]` | 탐지된 프로젝트 경계 |
| `close(opts?)` | `Promise<void>` | 종료 (`{ cleanup: true }`로 DB 삭제 가능) |

<br>

<details>
<summary><strong>타입 정의</strong></summary>

상세 TypeScript 타입 정의는 영문 README를 참고하세요 → [README.md — Type Definitions](./README.md#type-definitions)

주요 타입 요약:

```ts
interface SymbolSearchQuery {
  text?: string;        // FTS5 전문 검색
  exact?: boolean;      // 정확한 이름 일치
  kind?: SymbolKind;    // 심볼 종류 필터
  filePath?: string;    // 파일 경로 필터
  isExported?: boolean; // export 여부
  project?: string;     // 프로젝트 이름
  limit?: number;       // 최대 결과 수 (기본값: 100)
  decorator?: string;   // 데코레이터 이름 필터
  regex?: string;       // 정규식 패턴 필터
}

interface CodeRelation {
  type: 'imports' | 'type-references' | 're-exports' | 'calls' | 'extends' | 'implements';
  srcFilePath: string;
  srcSymbolName: string | null;
  dstFilePath: string;
  dstSymbolName: string | null;
  meta?: Record<string, unknown>;
}

/** 목적지 프로젝트 식별자가 추가된 CodeRelation */
interface StoredCodeRelation extends CodeRelation {
  dstProject: string;
}

interface IndexResult {
  indexedFiles: number;
  removedFiles: number;
  totalSymbols: number;
  totalRelations: number;
  durationMs: number;
  changedFiles: string[];
  deletedFiles: string[];
  failedFiles: string[];
  changedSymbols: {
    added: Array<{ name: string; filePath: string; kind: string }>;
    modified: Array<{ name: string; filePath: string; kind: string }>;
    removed: Array<{ name: string; filePath: string; kind: string }>;
  };
}

class GildashError extends Error {
  readonly type: GildashErrorType;
  readonly message: string;
  readonly cause?: unknown;          // Error에서 상속
}
```

</details>

<br>

## ⚠️ 에러 타입

| 타입 | 발생 시점 |
|------|----------|
| `watcher` | 파일 워처 시작/중지 실패 |
| `parse` | AST 파싱 실패 |
| `extract` | 심볼/관계 추출 실패 |
| `index` | 인덱싱 파이프라인 실패 |
| `store` | DB 연산 실패 |
| `search` | 검색 쿼리 실패 |
| `closed` | 종료된 인스턴스에서 연산 시도 |
| `semantic` | 시맨틱 레이어 미활성화 또는 tsc 에러 |
| `validation` | 잘못된 입력 (e.g. `node_modules`에 패키지 없음) |
| `close` | 종료 중 에러 |

<br>

## 🏗 아키텍처

```
Gildash (파사드)
├── Parser      — oxc-parser 기반 TypeScript AST 파싱
├── Extractor   — 심볼/관계 추출 (imports, re-exports, type-refs, calls, heritage)
├── Store       — bun:sqlite + drizzle-orm (files · symbols · relations · FTS5), `.gildash/gildash.db`에 저장
├── Indexer     — 파일 변경 → 파싱 → 추출 → 저장 파이프라인, 심볼 레벨 diff
├── Search      — FTS + regex + decorator 검색, 관계 쿼리, 의존성 그래프, ast-grep
├── Semantic    — tsc TypeChecker 통합 (opt-in): 타입, 참조, 구현체
└── Watcher     — @parcel/watcher + owner/reader 역할 관리
```

### Owner/Reader 패턴

동일 SQLite DB를 여러 프로세스가 공유할 때, 단일 writer를 보장합니다:

- **Owner** — 파일 워처 실행, 인덱싱 수행, 30초 간격으로 heartbeat 전송
- **Reader** — 읽기 전용 접근; 15초 간격으로 owner 상태 확인, owner가 60초 이상 stale 상태이면 reader 중 하나가 owner로 승격

<br>

## ⬆️ 업그레이드

### 0.7.x → 0.8.0

**Breaking:** `batchParse()`가 `Map<string, ParsedFile>` 대신 `BatchParseResult` (`parsed` + `failures` 필드)를 반환합니다.

```diff
- const parsed = await ledger.batchParse(filePaths);
- const ast = parsed.get('src/app.ts');
+ const { parsed, failures } = await ledger.batchParse(filePaths);
+ const ast = parsed.get('src/app.ts');
+ if (failures.length > 0) console.warn('실패:', failures);
```

**새 이벤트 메서드:** `onFileChanged()`, `onError()`, `onRoleChanged()`가 `onIndexed()`와 함께 추가되었습니다.

### 0.6.x → 0.7.0

**Breaking:** `@zipbul/result`가 더 이상 public API의 일부가 아닙니다. 모든 메서드가 값을 직접 반환하고, 실패 시 `GildashError`를 throw합니다.

```diff
- import { isErr } from '@zipbul/result';
- const result = ledger.searchSymbols({ text: 'foo' });
- if (isErr(result)) { console.error(result.data.message); }
- else { console.log(result); }
+ const symbols = ledger.searchSymbols({ text: 'foo' }); // 실패 시 GildashError throw
```

- `@zipbul/result`를 의존성에서 제거하세요 (더 이상 피어 의존성이 아닙니다)
- `isErr()` 체크를 `try/catch` + `instanceof GildashError`로 교체하세요
- `getFullSymbol()`, `getFileInfo()`, `getResolvedType()`은 찾지 못하면 에러 대신 `null`을 반환합니다
- `resolveSymbol()`은 순환 re-export 시 throw 대신 `{ circular: true }`를 반환합니다

### 0.4.x → 0.5.0

데이터베이스 디렉토리가 `.zipbul/`에서 `.gildash/`로 변경되었습니다. 데이터베이스는 `<projectRoot>/.gildash/gildash.db`에 저장됩니다.

기존 `.zipbul/` 데이터는 자동으로 이전되지 않습니다. 최초 실행 시 `.gildash/gildash.db`에 새 데이터베이스가 생성됩니다. 업그레이드 후 `.zipbul/`을 수동으로 삭제하세요.

<br>

## 📄 라이선스

[MIT](./LICENSE) © [zipbul](https://github.com/zipbul)
