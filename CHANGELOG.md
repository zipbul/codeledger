# @zipbul/gildash

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
