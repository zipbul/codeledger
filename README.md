# @zipbul/gildash

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/gildash)](https://www.npmjs.com/package/@zipbul/gildash)
[![CI](https://github.com/zipbul/gildash/actions/workflows/ci.yml/badge.svg)](https://github.com/zipbul/gildash/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A **Bun-native** TypeScript code indexer. Extracts symbols, tracks cross-file relationships, and builds a full dependency graph — all stored in a local SQLite database.

<br>

## Features

- **Symbol extraction** — Functions, classes, variables, types, interfaces, enums, and properties extracted via [oxc-parser](https://oxc.rs) AST
- **Relation tracking** — `import`, `calls`, `extends`, `implements` relationships across files
- **Full-text search** — SQLite FTS5-powered symbol name search
- **Dependency graph** — Directed import graph with cycle detection and transitive impact analysis
- **Incremental indexing** — `@parcel/watcher`-based file change detection; only re-indexes modified files
- **Multi-process safe** — Owner/reader role separation guarantees a single writer per database

<br>

## Requirements

- **Bun** v1.3 or higher
- TypeScript source files: `.ts`, `.mts`, `.cts`

<br>

## Installation

```bash
bun add @zipbul/gildash
```

<br>

## Quick Start

```ts
import { Gildash } from '@zipbul/gildash';

const ledger = await Gildash.open({
  projectRoot: '/absolute/path/to/project',
});

// Search for exported classes by name
const hits = ledger.searchSymbols({
  text: 'UserService',
  kind: 'class',
  isExported: true,
});

// Exact name match (not FTS prefix)
const exact = ledger.searchSymbols({ text: 'UserService', exact: true });

// Find what a file imports
const deps = ledger.getDependencies('src/app.ts');

// Find everything affected by a change
const affected = await ledger.getAffected(['src/utils.ts']);

// Detect circular dependencies
if (await ledger.hasCycle()) {
  console.warn('Circular dependency detected');
}

// File metadata & symbols
const fileInfo = ledger.getFileInfo('src/app.ts');
const symbols  = ledger.getSymbolsByFile('src/app.ts');

// Cached AST lookup
const ast = ledger.getParsedAst('/absolute/path/to/src/app.ts');

// Subscribe to index-complete events
const unsubscribe = ledger.onIndexed((result) => {
  console.log(`Indexed ${result.indexedFiles} files in ${result.durationMs}ms`);
});

await ledger.close();
```

### Error handling

All errors extend `GildashError`:

```ts
import { Gildash, GildashError, ParseError } from '@zipbul/gildash';

try {
  const ledger = await Gildash.open({ projectRoot: '/path' });
} catch (err) {
  if (err instanceof ParseError) {
    // AST parsing failure
  } else if (err instanceof GildashError) {
    // Any gildash error
  }
}
```

<br>

## API

### `Gildash.open(options)`

Creates and returns a `Gildash` instance. Performs a full index on first run, then watches for file changes.

```ts
const ledger = await Gildash.open({
  projectRoot: '/absolute/path',
  extensions: ['.ts', '.mts', '.cts'],
  ignorePatterns: ['dist', 'vendor'],
  parseCacheCapacity: 500,
  logger: console,
});
```

#### options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectRoot` | `string` | — | Absolute path to project root **(required)** |
| `extensions` | `string[]` | `['.ts', '.mts', '.cts']` | File extensions to index |
| `ignorePatterns` | `string[]` | `[]` | Glob patterns to exclude |
| `parseCacheCapacity` | `number` | `500` | LRU parse-cache capacity |
| `logger` | `Logger` | `console` | Custom logger (`{ error(...args): void }`) |

Returns `Promise<Gildash>`

---

### `ledger.searchSymbols(query)`

Search symbols by name (FTS5 full-text), kind, file path, and/or export status.

```ts
// Full-text search
const results = ledger.searchSymbols({ text: 'handleClick' });

// Exact name match (not FTS prefix)
const exact = ledger.searchSymbols({ text: 'UserService', exact: true });

// Filter by kind + export status
const classes = ledger.searchSymbols({
  kind: 'class',
  isExported: true,
  limit: 50,
});

// Scope to a specific file
const inFile = ledger.searchSymbols({
  filePath: 'src/services/user.ts',
});
```

#### SymbolSearchQuery

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string?` | FTS5 full-text search query |
| `exact` | `boolean?` | When `true`, `text` is treated as an exact name match (not FTS prefix) |
| `kind` | `SymbolKind?` | `'function'` \| `'method'` \| `'class'` \| `'variable'` \| `'type'` \| `'interface'` \| `'enum'` \| `'property'` |
| `filePath` | `string?` | Filter by file path |
| `isExported` | `boolean?` | Filter by export status |
| `project` | `string?` | Project name (monorepo) |
| `limit` | `number?` | Max results (default: `100`) |

Returns `SymbolSearchResult[]`

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

Search cross-file relationships by source/destination file, symbol name, or relation type.

```ts
// All imports from a file
const imports = ledger.searchRelations({
  srcFilePath: 'src/app.ts',
  type: 'imports',
});

// Find callers of a specific function
const callers = ledger.searchRelations({
  dstSymbolName: 'processOrder',
  type: 'calls',
});
```

#### RelationSearchQuery

| Field | Type | Description |
|-------|------|-------------|
| `srcFilePath` | `string?` | Source file path |
| `srcSymbolName` | `string?` | Source symbol name |
| `dstFilePath` | `string?` | Destination file path |
| `dstSymbolName` | `string?` | Destination symbol name |
| `type` | `'imports'` \| `'calls'` \| `'extends'` \| `'implements'`? | Relation type |
| `project` | `string?` | Project name |
| `limit` | `number?` | Max results (default: `500`) |

Returns `CodeRelation[]`

```ts
interface CodeRelation {
  type: 'imports' | 'calls' | 'extends' | 'implements';
  srcFilePath: string;
  srcSymbolName: string | null;  // null = module-level
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson?: string;
}
```

---

### `ledger.getDependencies(filePath, project?)`

Returns files that the given file imports.

```ts
const deps = ledger.getDependencies('src/app.ts');
// → ['src/utils.ts', 'src/config.ts', ...]
```

Returns `string[]`

---

### `ledger.getDependents(filePath, project?)`

Returns files that import the given file.

```ts
const dependents = ledger.getDependents('src/utils.ts');
// → ['src/app.ts', 'src/services/user.ts', ...]
```

Returns `string[]`

---

### `ledger.getAffected(changedFiles, project?)`

Computes the full transitive set of files affected by file changes.

```ts
const affected = await ledger.getAffected(['src/utils.ts']);
// → ['src/app.ts', 'src/services/user.ts', 'src/main.ts', ...]
```

Returns `Promise<string[]>`

---

### `ledger.hasCycle(project?)`

Detects circular dependencies in the import graph.

```ts
if (await ledger.hasCycle()) {
  console.warn('Circular dependency detected');
}
```

Returns `Promise<boolean>`

---

### `ledger.reindex()`

Forces a full re-index. Only available when the instance holds the owner role.

```ts
const result = await ledger.reindex();
console.log(`Indexed ${result.indexedFiles} files in ${result.durationMs}ms`);
```

Returns `Promise<IndexResult>`

```ts
interface IndexResult {
  indexedFiles: number;
  removedFiles: number;
  totalSymbols: number;
  totalRelations: number;
  durationMs: number;
  changedFiles: string[];
  deletedFiles: string[];
  failedFiles: string[];
}
```

---

### `ledger.onIndexed(callback)`

Subscribes to index-complete events. Returns an unsubscribe function.

```ts
const unsubscribe = ledger.onIndexed((result) => {
  console.log(`Indexed ${result.indexedFiles} files`);
});

// Later
unsubscribe();
```

Returns `() => void`

---

### `ledger.projects`

Detected project boundaries. In a monorepo, multiple projects are discovered automatically from `package.json` files.

```ts
const boundaries = ledger.projects;
// → [{ dir: '.', project: 'my-app' }, { dir: 'packages/core', project: '@my/core' }]
```

Type: `ProjectBoundary[]`

```ts
interface ProjectBoundary {
  dir: string;
  project: string;
}
```

---

### `ledger.getStats(project?)`

Returns symbol count statistics.

```ts
const stats = ledger.getStats();
// → { symbolCount: 1234, fileCount: 56 }
```

Returns `SymbolStats`

```ts
interface SymbolStats {
  symbolCount: number;
  fileCount: number;
}
```

---

### `ledger.parseSource(filePath, sourceText)`

Parses a TypeScript file and caches the AST internally.

```ts
const parsed = ledger.parseSource('src/foo.ts', sourceCode);
```

Returns `ParsedFile`

---

### `ledger.extractSymbols(parsed)`

Extracts symbols from a parsed file.

```ts
const symbols = ledger.extractSymbols(parsed);
```

Returns `ExtractedSymbol[]`

---

### `ledger.extractRelations(parsed)`

Extracts cross-file relations from a parsed file.

```ts
const relations = ledger.extractRelations(parsed);
```

Returns `CodeRelation[]`

---

### `ledger.getParsedAst(filePath)`

Retrieves a previously-parsed AST from the internal LRU cache.

Returns `undefined` if the file has not been parsed or was evicted from the cache.
The returned object is shared with the internal cache — treat it as **read-only**.

```ts
const ast = ledger.getParsedAst('/absolute/path/to/src/app.ts');
if (ast) {
  console.log(ast.program.body.length, 'AST nodes');
}
```

Returns `ParsedFile | undefined`

---

### `ledger.getFileInfo(filePath, project?)`

Retrieves metadata for an indexed file, including content hash, mtime, and size.
Returns `null` if the file has not been indexed yet.

```ts
const info = ledger.getFileInfo('src/app.ts');
if (!isErr(info) && info !== null) {
  console.log(`Hash: ${info.contentHash}, Size: ${info.size}`);
}
```

Returns `Result<FileRecord | null, GildashError>`

---

### `ledger.getSymbolsByFile(filePath, project?)`

Lists all symbols declared in a specific file. Convenience wrapper around `searchSymbols` with a `filePath` filter.

```ts
const symbols = ledger.getSymbolsByFile('src/app.ts');
if (!isErr(symbols)) {
  for (const sym of symbols) {
    console.log(`${sym.kind}: ${sym.name}`);
  }
}
```

Returns `Result<SymbolSearchResult[], GildashError>`

---

### `ledger.close()`

Graceful shutdown. Stops the watcher, releases the database, and removes signal handlers.

```ts
await ledger.close();
```

Returns `Promise<void>`

<br>

## Errors

All errors extend `GildashError`, which extends `Error`.

| Class | When |
|-------|------|
| `GildashError` | Base class for all errors |
| `WatcherError` | File watcher start/stop failure |
| `ParseError` | AST parsing failure |
| `ExtractError` | Symbol/relation extraction failure |
| `IndexError` | Indexing pipeline failure |
| `StoreError` | Database operation failure |
| `SearchError` | Search query failure |

<br>

## Architecture

```
Gildash (Facade)
├── Parser      — oxc-parser-based TypeScript AST parser
├── Extractor   — Symbol & relation extraction (imports, calls, heritage)
├── Store       — bun:sqlite + drizzle-orm (files, symbols, relations, FTS5)
├── Indexer     — Change detection → parse → extract → store pipeline
├── Search      — Symbol search, relation search, dependency graph
└── Watcher     — @parcel/watcher + owner/reader role management
```

### Owner / Reader Pattern

When multiple processes share the same SQLite database, a single-writer guarantee is enforced.

- **Owner** — Runs the file watcher, performs indexing, sends a heartbeat every 30 s
- **Reader** — Read-only access; polls owner status every 60 s and self-promotes if the owner goes stale

<br>

## License

[MIT](./LICENSE) © [zipbul](https://github.com/zipbul)
