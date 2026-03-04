# @zipbul/gildash

## 0.8.2

### Patch Changes

- [`5f7a441`](https://github.com/zipbul/gildash/commit/5f7a441d40ee183da5ab5f69bdaaa08166e1d6eb) Thanks [@parkrevil](https://github.com/parkrevil)! - chore: remove sourcemap generation from build

## 0.8.1

### Patch Changes

- [`4ce58c5`](https://github.com/zipbul/gildash/commit/4ce58c595921bb563d7bea972efa6b36b36b271e) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: ensure ResolvedType and SemanticReference types are included in published dist

## 0.8.0

### Minor Changes

- [#34](https://github.com/zipbul/gildash/pull/34) [`20d1ceb`](https://github.com/zipbul/gildash/commit/20d1ceb1a383cd4fb88ea67084858a043fb61f91) Thanks [@parkrevil](https://github.com/parkrevil)! - Implement all 13 recommendations from REPORT.md Section 8.

  ### Code Quality

  - Fix heartbeat timing gap: reduce healthcheck interval to 15s, stale threshold to 60s
  - Add TTL-based graph cache expiry for readers (15s)
  - Add incremental graph cache invalidation via `patchFiles()`
  - Fix silent `.catch(() => {})` in watcher→semantic file read errors
  - Prevent PID recycling race condition with UUID-based instance identification
  - **BREAKING**: `batchParse()` now returns `BatchParseResult` (with `parsed` + `failures`) instead of `Map<string, ParsedFile>`

  ### Performance

  - Add covering index on `relations(project, type, src_file_path)`
  - Chunk large batch file reads into groups of 50 to prevent EMFILE/OOM

  ### Features

  - Add event system: `onFileChanged()`, `onError()`, `onRoleChanged()`
  - Add `patchFiles()` method to `DependencyGraph` for incremental updates

  ### Testing

  - Add stress test suite (10,000 files)
  - Add chaos test suite (ownership contention, PID recycling)
  - Add property-based tests for graph algorithms (fast-check)
  - Add benchmark suite (indexing, search, graph operations)

## 0.7.0

### Minor Changes

- [#31](https://github.com/zipbul/gildash/pull/31) [`b4f50aa`](https://github.com/zipbul/gildash/commit/b4f50aa8ccb44243f4404078a436947556ce2464) Thanks [@parkrevil](https://github.com/parkrevil)! - Replace `Result<T, GildashError>` return types with direct returns and `GildashError` throws across all 34 public API methods.

  **Breaking changes:**

  - All public methods now return values directly and throw `GildashError` on failure (previously returned `Result<T, GildashError>`)
  - `@zipbul/result` is no longer a peer dependency (moved to internal dependency)
  - `GildashError` is now a class extending `Error` (previously a plain interface)
  - `getFullSymbol()`, `getFileInfo()`, `getResolvedType()` return `null` for "not found" (previously returned an error)
  - `resolveSymbol()` returns `{ circular: true }` for circular re-exports (previously returned an error)
  - `ResolvedSymbol` type has a new `circular: boolean` field

## 0.6.0

### Minor Changes

- [#29](https://github.com/zipbul/gildash/pull/29) [`f3a53f7`](https://github.com/zipbul/gildash/commit/f3a53f77c77510e06120c6b91e10cd724fb1cbd7) Thanks [@parkrevil](https://github.com/parkrevil)! - ### Semantic Layer (tsc TypeChecker integration)

  Enable tsc TypeChecker-based semantic analysis via `Gildash.open({ semantic: true })`.

  #### New APIs

  - `getResolvedType(symbolName, filePath)` — resolve the type of a symbol
  - `getSemanticReferences(symbolName, filePath)` — find all references to a symbol
  - `getImplementations(symbolName, filePath)` — find interface / abstract class implementations
  - `getSemanticModuleInterface(filePath)` — list module exports with resolved types
  - `getFullSymbol()` — automatically enriches result with `resolvedType` when semantic is enabled
  - `searchSymbols({ resolvedType })` — filter symbols by resolved type string

  #### Internal modules

  - `SemanticLayer` facade (manages tsc Program / TypeChecker / LanguageService)
  - `TscProgram` — tsconfig parsing + incremental update
  - `TypeCollector` — position / file-based type collection
  - `ReferenceResolver` — wraps tsc `findReferences`
  - `ImplementationFinder` — wraps tsc `findImplementations`
  - `SymbolGraph` — symbol node graph with LRU cache

  #### Characteristics

  - `semantic: false` (default): tsc is never loaded; existing behavior is 100% unchanged
  - `semantic: true` without a `tsconfig.json`: returns `GildashError`
  - Watcher mode: incremental updates are applied automatically on file changes

  ### Relation FK & cross-project support

  - `StoredCodeRelation` type: a `CodeRelation` enriched with `dstProject` (destination project identifier), returned by `searchRelations`, `searchAllRelations`, and `getInternalRelations`.
  - `RelationSearchQuery.dstProject` filter: narrow relation searches by destination project.
  - `DependencyGraph` accepts `additionalProjects` to build a cross-project import graph.

  ### Indexing stability

  - Two-pass indexing: `knownFiles` set populated before extraction prevents false "unresolved" markers on circular or forward references.
  - `node_modules` paths are now unconditionally excluded from indexing. The hard-coded filter in `detectChanges` cannot be overridden by `ignorePatterns`, and the default `ignorePatterns` includes `**/node_modules/**`.

  ### Removed

  - `indexExternalPackages()` API and `MakeExternalCoordinatorFn` type — external package indexing is no longer supported.
  - `resolveBareSpecifier()` utility — bare specifier resolution against `node_modules` is removed.

  ### Internal structure

  - `gildash.ts` façade decomposed into focused API modules (`extract-api`, `graph-api`, `lifecycle`, `misc-api`, `parse-api`, `query-api`, `semantic-api`) for maintainability.

## 0.5.1

### Patch Changes

- [#26](https://github.com/zipbul/gildash/pull/26) [`2df68d2`](https://github.com/zipbul/gildash/commit/2df68d2f608f60e675d3cbdedd7538465a8d03bd) Thanks [@parkrevil](https://github.com/parkrevil)! - ### Bug Fixes

  - **tsconfig.json JSONC parsing** — `SyntaxError: Failed to parse JSON` no longer occurs when `tsconfig.json` contains line comments (`//`), block comments (`/* */`), or trailing commas. Parsing now uses `Bun.JSONC.parse()`.

  - **`fullIndex()` FK constraint violation** — `SQLiteError: FOREIGN KEY constraint failed` no longer occurs on repeated calls to `fullIndex()`. Previously, all file records were deleted before re-inserting only the changed files, causing relations that referenced unchanged files to violate the foreign key constraint. Now only changed and deleted files are removed from the index; unchanged file records are preserved.

  ### Breaking Changes

  - **Data directory renamed from `.zipbul` to `.gildash`** — The SQLite database is now stored at `<projectRoot>/.gildash/gildash.db`. Any existing `.zipbul/` directory is **not** migrated automatically. On first run, a fresh database will be created at `.gildash/gildash.db`. If your application stored anything in `.zipbul/`, move or delete it manually.

## 0.5.0

### Minor Changes

- [#24](https://github.com/zipbul/gildash/pull/24) [`5b532ad`](https://github.com/zipbul/gildash/commit/5b532adee1f4cf29be7171485f9ea9ce65706e48) Thanks [@parkrevil](https://github.com/parkrevil)! - ### Breaking Changes

  - **Remove `getDeadExports` API** — This feature embedded project-specific policies (entry point definitions, build configuration, test file inclusion) that vary per consumer. Use `searchSymbols({ isExported: true })` + `searchRelations({ type: 'imports' })` to build custom dead-export detection in your own code.

  ### New Features

  - **Replace `getCyclePaths` algorithm with Tarjan SCC + Johnson's circuits** — The previous DFS-based implementation could miss cycles sharing common nodes. The new algorithm exhaustively detects every elementary circuit in the import graph. Use the `maxCycles` option to cap the number of returned cycles.
  - **Add `ParserOptions` passthrough to `parseSource` / `batchParse`** — Forward oxc-parser's `ParserOptions` (e.g. `sourceType`, `lang`) directly, allowing explicit control over parser behavior regardless of file extension.

  ### Chores

  - Upgrade `oxc-parser` from 0.114.0 to 0.115.0

## 0.5.0

### Breaking Changes

- **`getDeadExports` 제거** — `Gildash.getDeadExports(project?, opts?)` API가 삭제되었습니다. 이 기능은 진입점(entry point) 정의, 빌드 설정, 테스트 파일 포함 여부 등 프로젝트 정책에 따라 결과가 근본적으로 달라지므로 라이브러리 레벨의 단일 구현으로 제공하기 어렵습니다. 대신 `getImportGraph()` + `getDependents()`를 조합하여 프로젝트 정책에 맞는 dead export 탐지 로직을 직접 구현하세요.

### New Features

- **`getCyclePaths` — 완전한 순환 탐지 알고리즘 교체 (Tarjan SCC + Johnson's circuits)** — 이전 구현은 DFS 기반으로 대표 경로만 반환했습니다. 이번 버전부터 Tarjan SCC로 강연결 컴포넌트를 먼저 식별한 뒤, Johnson's algorithm으로 각 SCC 내의 모든 elementary circuit을 열거합니다. 중복 없는 정규화된 경로(사전순 최솟값 노드 기준 rotation) 전체를 반환하며, `maxCycles` 옵션으로 반환 개수를 제한할 수 있습니다.

- **`parseSource` / `batchParse` — `ParserOptions` passthrough** — `parseSource(filePath, source, options?)` 및 `batchParse(filePaths, options?)`에 `oxc-parser`의 `ParserOptions`를 직접 전달할 수 있습니다. `lang` 필드로 파서 언어(ts / tsx / js 등)를 명시적으로 지정할 수 있어, 파일 확장자와 실제 언어가 다른 경우나 JSX 지원이 필요한 파일 처리에 유용합니다.

### Chores

- `oxc-parser` 0.114.0 → 0.115.0

---

## 0.4.1

### Patch Changes

- [#22](https://github.com/zipbul/gildash/pull/22) [`764cff9`](https://github.com/zipbul/gildash/commit/764cff906ce8bd3eac4050722bb3c3f9a6f920de) Thanks [@parkrevil](https://github.com/parkrevil)! - FTS5 setup을 런타임 코드에서 Drizzle migration으로 이동

  ### Refactor

  - `FTS_SETUP_SQL` 상수를 `schema.ts`/`connection.ts`에서 제거하고 Drizzle SQL migration(`0002_fts_setup.sql`)으로 이동
  - FTS5 virtual table + INSERT/DELETE/UPDATE sync trigger를 migration에서 `IF NOT EXISTS`로 idempotent하게 생성

  ### Chore

  - `.npmignore` 제거 — `README.ko.md`를 npm 패키지에 포함

## 0.4.0

### Minor Changes

- [#20](https://github.com/zipbul/gildash/pull/20) [`fa7c001`](https://github.com/zipbul/gildash/commit/fa7c001d0145d062049e41b650754ab1566088a2) Thanks [@parkrevil](https://github.com/parkrevil)! - Firebat roadmap — new public APIs, structural pattern search, and infra improvements

  ### New Public APIs

  - `getDeadExports(project?, opts?)` — detect exported symbols never imported anywhere in the project
  - `getFullSymbol(name, filePath)` — retrieve full symbol detail including members, JSDoc, decorators, type parameters
  - `getFileStats(filePath)` — file-level statistics (line count, symbol count, relation count, size)
  - `getFanMetrics(filePath)` — import-graph fan-in / fan-out coupling metrics via `DependencyGraph`
  - `resolveSymbol(name, filePath)` — follow re-export chains to the original symbol definition
  - `findPattern(pattern, opts?)` — AST structural pattern search via `@ast-grep/napi`
  - `indexExternalPackages(packages)` — index `.d.ts` type declarations from `node_modules`
  - `getModuleInterface(filePath)` — public interface of a module (all exported symbols with metadata)
  - `getHeritageChain(name, filePath)` — recursive `extends`/`implements` tree traversal
  - `diffSymbols(before, after)` — snapshot diff of symbol search results (added/removed/modified)
  - `batchParse(filePaths)` — concurrent multi-file parsing
  - `getInternalRelations(filePath)` — intra-file relations query
  - `searchAllSymbols(query)` / `searchAllRelations(query)` — cross-project search (no project filter)
  - `searchSymbols({ regex })` — regex filter on symbol names
  - `searchSymbols({ decorator })` — decorator name filter via `json_each()`

  ### New Types & Exports

  - Export new interfaces: `SymbolDiff`, `ModuleInterface`, `HeritageNode`, `FullSymbol`, `FileStats`, `FanMetrics`, `ResolvedSymbol`
  - Export `patternSearch`, `PatternMatch`, `PatternSearchOptions` from `search/pattern-search`
  - Export `ParsedFile` from `parser/types`, `FileRecord` from `store/repositories/file.repository`
  - `IndexResult.changedSymbols` — symbol-level diff (added/modified/removed) per index cycle

  ### Infra & Extractor Improvements

  - `CodeRelation.type` union extended with `'type-references'` and `'re-exports'`
  - Import relations now emit one relation per specifier with `dstSymbolName` (enables dead-export detection and re-export resolution)
  - Re-export relations record named specifiers in `metaJson` (`{ local, exported }` per `ExportSpecifier`)
  - `metaJson` auto-parsed into `meta` field on `CodeRelation`
  - Full member detail objects stored in `detailJson` (visibility, kind, type, static, readonly)
  - New `lineCount` column on `files` table with SQL migration (`0001_add_line_count.sql`)

  ### Scan-only Mode

  - `watchMode: false` option — disables file watcher for CI/one-shot analysis
  - `close({ cleanup: true })` — delete database files after scan

  ### Performance

  - `DependencyGraph` internal caching — graph is built once per project key, invalidated on each index run

  ### Dependencies

  - Added `@ast-grep/napi` `^0.41.0` as runtime dependency
  - Added `oxc-parser` `>=0.114.0` as peer dependency

  ### Bug Fixes

  - Fix FK constraint violation in `fullIndex()` — split single-loop transaction into 2-pass (Pass 1: upsert all files, Pass 2: parse + index symbols/relations)
  - Fix `getFullSymbol()` query using incorrect field name (`exactName` → `{ text, exact: true }`)
  - Fix 5 TypeScript type errors across `gildash.ts`

## 0.3.1

### Patch Changes

- [#18](https://github.com/zipbul/gildash/pull/18) [`1d76d79`](https://github.com/zipbul/gildash/commit/1d76d794862f6780e00868409483f7d2965a8403) Thanks [@parkrevil](https://github.com/parkrevil)! - Update README with new API docs and exclude README.ko.md from npm package

## 0.3.0

### Minor Changes

- [#14](https://github.com/zipbul/gildash/pull/14) [`a93aecb`](https://github.com/zipbul/gildash/commit/a93aecbe60770f2b38a05e110ada59203effd7bf) Thanks [@parkrevil](https://github.com/parkrevil)! - Add public API extensions for AST cache sharing, file metadata, exact symbol search, and file-scoped symbol listing

  - `getParsedAst(filePath)`: retrieve cached oxc-parser AST from internal LRU cache
  - `getFileInfo(filePath, project?)`: query indexed file metadata (hash, mtime, size)
  - `searchSymbols({ text, exact: true })`: exact name match (in addition to existing FTS prefix)
  - `getSymbolsByFile(filePath, project?)`: convenience wrapper for file-scoped symbol listing
  - Re-export `ParsedFile` and `FileRecord` types
  - Add `oxc-parser` to peerDependencies

## 0.2.0

### Minor Changes

- [#12](https://github.com/zipbul/gildash/pull/12) [`57e961b`](https://github.com/zipbul/gildash/commit/57e961bdb719d5d30542418ed2494531e6251021) Thanks [@parkrevil](https://github.com/parkrevil)! - Export missing public API types and expose `role` getter

  - Re-export `IndexResult`, `ProjectBoundary`, `CodeRelation`, `SymbolStats`, `SymbolKind`, `WatcherRole` from the package entry point
  - Make `Gildash.role` property public (was `private readonly`, now `readonly`)

## 0.1.2

### Patch Changes

- [#10](https://github.com/zipbul/gildash/pull/10) [`b6c93c0`](https://github.com/zipbul/gildash/commit/b6c93c062f88e4c562eb110dba5ef8afade99f59) Thanks [@parkrevil](https://github.com/parkrevil)! - Re-publish as 0.1.2: versions 0.1.0 and 0.1.1 permanently blocked by npm after unpublish

## 0.1.1

### Patch Changes

- [#8](https://github.com/zipbul/gildash/pull/8) [`ae82ae0`](https://github.com/zipbul/gildash/commit/ae82ae0b9c28708dbe6678dfef18ad236bc0d2a1) Thanks [@parkrevil](https://github.com/parkrevil)! - Re-publish as 0.1.1: previous 0.1.0 publish attempt blocked by npm 24h re-publish restriction

## 0.1.0

### Minor Changes

- [#6](https://github.com/zipbul/gildash/pull/6) [`108b29c`](https://github.com/zipbul/gildash/commit/108b29c278c3080a6129eefe4e3fc53117b62510) Thanks [@parkrevil](https://github.com/parkrevil)! - Replace class-based error hierarchy with Result-based error handling

  ### Breaking Changes

  - All public API methods now return `Result<T, GildashError>` instead of throwing exceptions
  - `GildashError`, `StoreError`, `ParseError`, `WatcherError` classes removed
  - New `GildashError` interface + `gildashError()` factory + `GildashErrorType` union
  - `@zipbul/result` moved from `dependencies` to `peerDependencies`
  - Consumers must use `isErr()` from `@zipbul/result` to check for errors

  ### Changes

  - Add try-catch wrappers to all 8 Gildash public methods for SQLite throw conversion
  - Update all JSDoc with `@example` blocks showing `isErr()` usage
  - Fix tsc type errors: proper Result narrowing in all spec files
