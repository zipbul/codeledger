---
"@zipbul/gildash": minor
---

Firebat roadmap — new public APIs, structural pattern search, and infra improvements

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
