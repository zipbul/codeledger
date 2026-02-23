# @zipbul/gildash

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
