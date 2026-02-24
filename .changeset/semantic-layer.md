---
"@zipbul/gildash": minor
---

### Semantic Layer (tsc TypeChecker 통합)

`Gildash.open({ semantic: true })` 옵션으로 tsc TypeChecker 기반 시맨틱 분석 계층 활성화 가능.

#### 새 API

- `getResolvedType(symbolName, filePath)` — 심볼의 타입 정보 조회
- `getSemanticReferences(symbolName, filePath)` — 심볼 참조 위치 검색
- `getImplementations(symbolName, filePath)` — 인터페이스/추상 클래스 구현체 검색
- `getSemanticModuleInterface(filePath)` — 모듈의 export 목록 + 타입 정보
- `getFullSymbol()` — `resolvedType` 필드 자동 보강 (semantic 활성 시)
- `searchSymbols({ resolvedType })` — 타입 기반 필터링

#### 내부 모듈

- `SemanticLayer` facade (tsc Program/TypeChecker/LanguageService 관리)
- `TscProgram` — tsconfig 파싱 + incremental update
- `TypeCollector` — 위치/파일 기반 타입 수집
- `ReferenceResolver` — tsc findReferences 래핑
- `ImplementationFinder` — tsc findImplementations 래핑
- `SymbolGraph` — 심볼 노드 그래프

#### 특성

- `semantic: false` (기본값) 시 tsc 미로드, 기존 동작 100% 동일
- `semantic: true`인데 tsconfig.json 없으면 `GildashError` 반환
- watcher 모드에서 파일 변경 시 incremental update 자동 반영
