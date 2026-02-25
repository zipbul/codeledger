---
"@zipbul/gildash": minor
---

### Semantic Layer (tsc TypeChecker integration)

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
- `.d.ts` candidate discovery via `resolveBareSpecifier`: bare specifiers (e.g. `lodash`) are resolved against `node_modules` type declarations, allowing `indexExternalPackages` to index them.

### Internal structure

- `gildash.ts` façade decomposed into focused API modules (`extract-api`, `graph-api`, `lifecycle`, `misc-api`, `parse-api`, `query-api`, `semantic-api`) for maintainability.
