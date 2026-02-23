# @zipbul/gildash

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/gildash)](https://www.npmjs.com/package/@zipbul/gildash)
[![CI](https://github.com/zipbul/gildash/actions/workflows/ci.yml/badge.svg)](https://github.com/zipbul/gildash/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Bun 네이티브** TypeScript 코드 인덱서.
심볼 추출, 파일 간 관계 추적, 의존성 그래프 구축을 하나의 로컬 SQLite 데이터베이스로 제공합니다.

<br>

## ✨ 주요 기능

- **심볼 추출** — 함수, 클래스, 변수, 타입, 인터페이스, 열거형, 프로퍼티를 AST 수준에서 추출
- **관계 분석** — `import`, `calls`, `extends`, `implements` 관계를 파일 간에 추적
- **전문 검색** — SQLite FTS5 기반 심볼 이름 전문 검색
- **의존성 그래프** — 방향 import 그래프로 순환 감지 및 전이적(transitive) 영향도 분석
- **증분 인덱싱** — `@parcel/watcher` 기반 파일 변경 감지, 변경된 파일만 재인덱싱
- **멀티 프로세스 안전** — owner/reader 역할 분리로 단일 writer 보장

<br>

## 📋 요구사항

- **Bun** v1.3 이상
- 지원 확장자: `.ts`, `.mts`, `.cts`

<br>

## 📦 설치

```bash
bun add @zipbul/gildash
```

<br>

## 🚀 빠른 시작

```ts
import { Gildash } from '@zipbul/gildash';

// 인덱서 열기 — 최초 실행 시 전체 인덱싱 자동 수행, 이후 파일 변경을 감시
const ledger = await Gildash.open({
  projectRoot: '/absolute/path/to/project',
});

// 심볼 검색
const hits = ledger.searchSymbols({ text: 'UserService', kind: 'class' });

// 정확한 이름 매칭
const exact = ledger.searchSymbols({ text: 'UserService', exact: true });

// 의존성 그래프 조회
const deps     = ledger.getDependencies('src/app.ts');
const affected = await ledger.getAffected(['src/utils.ts']);
const cyclic   = await ledger.hasCycle();

// 파일 정보 및 심볼 조회
const fileInfo = ledger.getFileInfo('src/app.ts');
const symbols  = ledger.getSymbolsByFile('src/app.ts');

// 캐시된 AST 조회
const ast = ledger.getParsedAst('/absolute/path/to/src/app.ts');

await ledger.close();
```

<br>

## 🔍 API 개요

| 메서드 | 반환 타입 | 설명 |
|--------|-----------|------|
| `searchSymbols(query)` | `SymbolSearchResult[]` | FTS5 전문 검색 + 필터 조합. `exact` 옵션 지원 |
| `searchRelations(query)` | `CodeRelation[]` | 파일/심볼/관계 유형 필터 |
| `getDependencies(filePath, project?)` | `string[]` | 이 파일이 import하는 파일 목록 |
| `getDependents(filePath, project?)` | `string[]` | 이 파일을 import하는 파일 목록 |
| `getAffected(changedFiles, project?)` | `Promise<string[]>` | 변경 파일의 전이적 영향 범위 |
| `hasCycle(project?)` | `Promise<boolean>` | 순환 의존성 감지 |
| `reindex()` | `Promise<IndexResult>` | 강제 전체 재인덱싱 |
| `onIndexed(callback)` | `() => void` | 인덱싱 완료 이벤트 구독 |
| `parseSource(filePath, src)` | `ParsedFile` | 파일 파싱 후 AST 캐시 |
| `extractSymbols(parsed)` | `ExtractedSymbol[]` | 파싱된 파일에서 심볼 추출 |
| `extractRelations(parsed)` | `CodeRelation[]` | 파싱된 파일에서 관계 추출 |
| `getParsedAst(filePath)` | `ParsedFile \| undefined` | 캐시된 AST 조회 |
| `getFileInfo(filePath, project?)` | `FileRecord \| null` | 인덱싱된 파일 메타데이터 조회 |
| `getSymbolsByFile(filePath, project?)` | `SymbolSearchResult[]` | 특정 파일의 모든 심볼 조회 |
| `projects` | `ProjectBoundary[]` | 감지된 프로젝트 경계 (모노레포) |
| `getStats(project?)` | `SymbolStats` | 심볼 통계 |
| `close()` | `Promise<void>` | 인덱서 종료 |

<br>

## ⚙️ API 레퍼런스

### `Gildash.open(options)`

인덱서 인스턴스를 생성합니다. 최초 실행 시 전체 인덱싱을 수행하고, 이후 파일 변경을 감시합니다.

```ts
const ledger = await Gildash.open({
  projectRoot: '/absolute/path',       // 필수. 절대 경로
  extensions: ['.ts', '.mts', '.cts'], // 선택. 인덱싱 대상 확장자
  ignorePatterns: ['dist', 'vendor'],  // 선택. 무시할 디렉토리/패턴
  parseCacheCapacity: 500,             // 선택. 파싱 캐시 크기
});
```

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `projectRoot` | `string` | — | 프로젝트 루트 절대 경로 **(필수)** |
| `extensions` | `string[]` | `['.ts', '.mts', '.cts']` | 인덱싱 대상 파일 확장자 |
| `ignorePatterns` | `string[]` | `[]` | 무시할 경로 패턴 |
| `parseCacheCapacity` | `number` | `500` | LRU 파싱 캐시 최대 크기 |
| `logger` | `Logger` | `console` | 커스텀 로거 (`{ error(...args): void }`) |

**반환**: `Promise<Gildash>`

---

### `ledger.close()`

인덱서를 종료합니다. watcher 중지, DB 연결 해제, 시그널 핸들러 제거를 수행합니다.

```ts
await ledger.close();
```

**반환**: `Promise<void>`

---

### `ledger.searchSymbols(query)`

심볼을 검색합니다. FTS5 전문 검색과 필터를 조합할 수 있습니다.

```ts
// 이름으로 검색
const results = ledger.searchSymbols({ text: 'handleClick' });

// 정확한 이름 매칭 (FTS prefix가 아닌 완전 일치)
const exact = ledger.searchSymbols({ text: 'UserService', exact: true });

// 종류 + export 여부 필터
const classes = ledger.searchSymbols({
  kind: 'class',
  isExported: true,
  limit: 50,
});

// 파일 경로 필터
const inFile = ledger.searchSymbols({
  filePath: 'src/services/user.ts',
});
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `text` | `string?` | FTS5 전문 검색 쿼리 |
| `exact` | `boolean?` | `true`이면 `text`를 정확한 이름으로 매칭 (FTS prefix 아님) |
| `kind` | `SymbolKind?` | `'function'` \| `'method'` \| `'class'` \| `'variable'` \| `'type'` \| `'interface'` \| `'enum'` \| `'property'` |
| `filePath` | `string?` | 특정 파일 경로 필터 |
| `isExported` | `boolean?` | export 여부 필터 |
| `project` | `string?` | 프로젝트 이름 (모노레포 지원) |
| `limit` | `number?` | 최대 결과 수 |

**반환**: `SymbolSearchResult[]`

```ts
interface SymbolSearchResult {
  id: number;
  filePath: string;
  kind: SymbolKind;
  name: string;
  span: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  isExported: boolean;
  signature: string | null;
  fingerprint: string | null;
  detail: Record<string, unknown>;
}
```

---

### `ledger.searchRelations(query)`

파일/심볼 간 관계를 검색합니다.

```ts
// 특정 파일이 import하는 관계
const imports = ledger.searchRelations({
  srcFilePath: 'src/app.ts',
  type: 'imports',
});

// 특정 심볼을 호출하는 관계
const callers = ledger.searchRelations({
  dstSymbolName: 'processOrder',
  type: 'calls',
});
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `srcFilePath` | `string?` | 출발 파일 경로 |
| `srcSymbolName` | `string?` | 출발 심볼 이름 |
| `dstFilePath` | `string?` | 도착 파일 경로 |
| `dstSymbolName` | `string?` | 도착 심볼 이름 |
| `type` | `'imports'` \| `'calls'` \| `'extends'` \| `'implements'`? | 관계 유형 |
| `project` | `string?` | 프로젝트 이름 |
| `limit` | `number?` | 최대 결과 수 |

**반환**: `CodeRelation[]`

```ts
interface CodeRelation {
  type: 'imports' | 'calls' | 'extends' | 'implements';
  srcFilePath: string;
  srcSymbolName: string | null;  // null = 모듈 레벨
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson?: string;
}
```

---

### `ledger.getDependencies(filePath, project?)`

특정 파일이 import하는 파일 목록을 반환합니다.

```ts
const deps = ledger.getDependencies('src/app.ts');
// → ['src/utils.ts', 'src/config.ts', ...]
```

**반환**: `string[]`

---

### `ledger.getDependents(filePath, project?)`

특정 파일을 import하는 파일 목록을 반환합니다.

```ts
const dependents = ledger.getDependents('src/utils.ts');
// → ['src/app.ts', 'src/services/user.ts', ...]
```

**반환**: `string[]`

---

### `ledger.getAffected(changedFiles, project?)`

변경된 파일들의 영향을 받는 모든 파일을 전이적(transitive)으로 계산합니다.

```ts
const affected = await ledger.getAffected(['src/utils.ts']);
// → ['src/app.ts', 'src/services/user.ts', 'src/main.ts', ...]
```

**반환**: `Promise<string[]>`

---

### `ledger.hasCycle(project?)`

프로젝트의 import 그래프에 순환 의존성이 있는지 검사합니다.

```ts
const cyclic = await ledger.hasCycle();
if (cyclic) {
  console.warn('순환 의존성이 감지되었습니다');
}
```

**반환**: `Promise<boolean>`

---

### `ledger.reindex()`

수동으로 전체 재인덱싱을 수행합니다. owner 역할에서만 사용 가능합니다.

```ts
const result = await ledger.reindex();
```

**반환**: `Promise<IndexResult>`

---

### `ledger.onIndexed(callback)`

인덱싱 완료 이벤트를 구독합니다.

```ts
const unsubscribe = ledger.onIndexed((result) => {
  console.log(`인덱싱 완료: ${result.indexedFiles}개 파일`);
});

// 구독 해제
unsubscribe();
```

**반환**: `() => void` (구독 해제 함수)

---

### `ledger.projects`

감지된 프로젝트 경계 목록을 반환합니다 (모노레포에서 여러 프로젝트 감지).

```ts
const boundaries = ledger.projects;
// → [{ project: 'my-app', root: '/path/to/project' }, ...]
```

**타입**: `ProjectBoundary[]`

---

### `ledger.getStats(project?)`

심볼 통계를 반환합니다.

```ts
const stats = ledger.getStats();
```

**반환**: `SymbolStats`

---

### `ledger.parseSource(filePath, sourceText)`

파일을 파싱하여 AST를 반환합니다. 결과는 내부 캐시에 저장됩니다.

```ts
const parsed = ledger.parseSource('/path/to/file.ts', sourceCode);
```

**반환**: `ParsedFile`

---

### `ledger.extractSymbols(parsed)`

파싱된 파일에서 심볼을 추출합니다.

```ts
const symbols = ledger.extractSymbols(parsed);
```

**반환**: `ExtractedSymbol[]`

---

### `ledger.extractRelations(parsed)`

파싱된 파일에서 관계를 추출합니다.

```ts
const relations = ledger.extractRelations(parsed);
```

**반환**: `CodeRelation[]`

---

### `ledger.getParsedAst(filePath)`

내부 LRU 캐시에서 이전에 파싱된 AST를 조회합니다.

파일이 아직 파싱되지 않았거나 캐시에서 제거된 경우 `undefined`를 반환합니다.
반환된 객체는 내부 캐시와 공유됩니다 — **읽기 전용**으로 취급하세요.

```ts
const ast = ledger.getParsedAst('/absolute/path/to/src/app.ts');
if (ast) {
  console.log(ast.program.body.length, '개의 AST 노드');
}
```

**반환**: `ParsedFile | undefined`

---

### `ledger.getFileInfo(filePath, project?)`

인덱싱된 파일의 메타데이터를 조회합니다.

content hash, mtime, size 등이 포함된 `FileRecord`를 반환합니다.
파일이 아직 인덱싱되지 않은 경우 `null`을 반환합니다.

```ts
const info = ledger.getFileInfo('src/app.ts');
if (!isErr(info) && info !== null) {
  console.log(`해시: ${info.contentHash}, 크기: ${info.size}`);
}
```

**반환**: `Result<FileRecord | null, GildashError>`

---

### `ledger.getSymbolsByFile(filePath, project?)`

특정 파일에 선언된 모든 심볼을 조회합니다. `searchSymbols`에 `filePath` 필터를 적용한 편의 래퍼입니다.

```ts
const symbols = ledger.getSymbolsByFile('src/app.ts');
if (!isErr(symbols)) {
  for (const sym of symbols) {
    console.log(`${sym.kind}: ${sym.name}`);
  }
}
```

**반환**: `Result<SymbolSearchResult[], GildashError>`

<br>

## 🏗 아키텍처

```
Gildash (파사드)
├── Parser      — oxc-parser 기반 TypeScript AST 파싱
├── Extractor   — 심볼/관계 추출 (imports, calls, heritage)
├── Store       — bun:sqlite + drizzle-orm (files, symbols, relations, FTS5)
├── Indexer     — 변경 감지 → 파싱 → 추출 → 저장 파이프라인
├── Search      — 심볼 검색, 관계 검색, 의존성 그래프
└── Watcher     — @parcel/watcher + owner/reader 역할 관리
```

### Owner/Reader 패턴

동일 SQLite DB를 여러 프로세스가 공유할 때, 단일 writer를 보장합니다.

- **Owner** — watcher 실행, 인덱싱 수행, heartbeat 전송 (30초 간격)
- **Reader** — 읽기 전용 접근, 60초 간격으로 owner 상태 확인; owner가 stale 상태가 되면 reader 중 하나가 owner로 승격

<br>

## 📄 라이선스

[MIT](./LICENSE) © [zipbul](https://github.com/zipbul)
