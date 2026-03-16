# @zipbul/gildash

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/gildash)](https://www.npmjs.com/package/@zipbul/gildash)
[![CI](https://github.com/zipbul/gildash/actions/workflows/ci.yml/badge.svg)](https://github.com/zipbul/gildash/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A **Bun-native** TypeScript code intelligence engine.

gildash indexes your TypeScript codebase into a local SQLite database, then lets you search symbols, trace cross-file relationships, analyze dependency graphs, and match structural patterns — all with incremental, file-watcher-driven updates.

## 💡 Why gildash?

| Problem | How gildash solves it |
|---------|----------------------|
| "Which files break if I change this module?" | Directed import graph with transitive impact analysis |
| "Are there any circular dependencies?" | Cycle detection across the full import graph |
| "Where is this symbol actually defined?" | Re-export chain resolution to the original source |
| "Find every `console.log(...)` call" | AST-level structural pattern search via [ast-grep](https://ast-grep.github.io/) |

<br>

## ✨ Features

- **Symbol extraction** — Functions, classes, variables, types, interfaces, enums, and properties extracted via [oxc-parser](https://oxc.rs) AST
- **Relation tracking** — `import`, `re-exports`, `type-references`, `calls`, `extends`, `implements` relationships across files
- **Full-text search** — SQLite FTS5-powered symbol name search with exact match, regex, and decorator filtering
- **Dependency graph** — Directed import graph with cycle detection, transitive impact analysis, and internal caching
- **Structural pattern matching** — AST-level code search via [@ast-grep/napi](https://ast-grep.github.io/)
- **Incremental indexing** — `@parcel/watcher`-based file change detection; only re-indexes modified files
- **Symbol-level diff** — `changedSymbols` in `IndexResult` tracks added/modified/removed symbols per index cycle
- **Annotation extraction** — Generic `@tag value` extraction from JSDoc, line, and block comments with automatic symbol linking and FTS5 search
- **Symbol changelog** — Tracks added/modified/removed/renamed/moved symbols across index runs, with structural fingerprint-based rename detection
- **Multi-process safe** — Owner/reader role separation guarantees a single writer per database
- **Scan-only mode** — `watchMode: false` for one-shot indexing without file watcher overhead
- **tsconfig.json JSONC** — Path alias resolution parses comments and trailing commas in `tsconfig.json`
- **Semantic layer (opt-in)** — tsc TypeChecker integration for resolved types, references, implementations, and module interface analysis

<br>

## 📋 Requirements

- **Bun** v1.3 or higher
- TypeScript source files: `.ts`, `.mts`, `.cts`

<br>

## 📦 Installation

```bash
bun add @zipbul/gildash
```

> **Optional peer** — `typescript` (>=5.0.0) is needed only when using `semantic: true`.

<br>

## 🚀 Quick Start

```ts
import { Gildash } from '@zipbul/gildash';

// 1. Open — indexes every .ts file on first run, then watches for changes
const ledger = await Gildash.open({
  projectRoot: '/absolute/path/to/project',
});

// 2. Search — find symbols by name
const symbols = ledger.searchSymbols({ text: 'UserService', kind: 'class' });
symbols.forEach(s => console.log(`${s.name} → ${s.filePath}`));

// 3. Close — release resources
await ledger.close();
```

That's it. Project discovery (monorepo-aware), incremental re-indexing, and multi-process safety are handled automatically.

<br>

## 📖 Usage Guide

### Symbol Search

Search indexed symbols with FTS5 full-text, exact match, regex, or decorator filters.

```ts
// Full-text search (FTS5 prefix matching)
const hits = ledger.searchSymbols({ text: 'handle' });

// Exact name match
const exact = ledger.searchSymbols({ text: 'UserService', exact: true });

// Regex pattern
const handlers = ledger.searchSymbols({ regex: '^handle.*Click$' });

// Decorator filter
const injectables = ledger.searchSymbols({ decorator: 'Injectable' });

// Combine filters
const exportedClasses = ledger.searchSymbols({
  kind: 'class',
  isExported: true,
  limit: 50,
});
```

Use `searchRelations()` to find cross-file relationships:

```ts
const imports = ledger.searchRelations({ srcFilePath: 'src/app.ts', type: 'imports' });
const callers = ledger.searchRelations({ dstSymbolName: 'processOrder', type: 'calls' });
```

For monorepo projects, `searchAllSymbols()` and `searchAllRelations()` search across every discovered project.

---

### Dependency Analysis

Analyze import graphs, detect cycles, and compute change impact.

```ts
// Direct imports / importers
const deps = ledger.getDependencies('src/app.ts');
const importers = ledger.getDependents('src/utils.ts');

// Transitive impact — which files are affected by a change?
const affected = await ledger.getAffected(['src/utils.ts']);

// Full import graph (adjacency list)
const graph = await ledger.getImportGraph();

// Transitive dependencies (forward BFS)
const transitive = await ledger.getTransitiveDependencies('src/app.ts');

// Circular dependency detection
const hasCycles = await ledger.hasCycle();
const cyclePaths = await ledger.getCyclePaths();          // all elementary circuits
const limited   = await ledger.getCyclePaths(undefined, { maxCycles: 100 }); // undefined = use default project
```

---

### Annotations

Search `@tag value` patterns extracted from JSDoc, line (`//`), and block (`/* */`) comments.

```ts
// Find all @deprecated annotations
const deprecated = ledger.searchAnnotations({ tag: 'deprecated' });
deprecated.forEach(a => console.log(`${a.symbolName}: ${a.value}`));

// Full-text search across annotation values
const caching = ledger.searchAnnotations({ text: 'caching' });

// Filter by source type and file
const todos = ledger.searchAnnotations({ tag: 'todo', source: 'line', filePath: 'src/app.ts' });
```

---

### Symbol Changelog

Track symbol-level changes across index runs. Rename and move detection uses structural fingerprinting.

```ts
// Get all incremental changes since a given date
const changes = ledger.getSymbolChanges(new Date('2024-01-01'));

// Include full-index entries and filter by change type
const renames = ledger.getSymbolChanges(new Date(0), {
  includeFullIndex: true,
  changeTypes: ['renamed', 'moved'],
});
renames.forEach(c => console.log(`${c.oldName} → ${c.symbolName} (${c.changeType})`));

// Prune old entries (returns deleted count)
const pruned = ledger.pruneChangelog(new Date('2024-01-01'));
```

---

### Code Quality Analysis

Inspect module interfaces and measure coupling.

```ts
// File statistics — line count, symbol count, size
const stats = ledger.getFileStats('src/app.ts');

// Fan-in / fan-out coupling metrics
const fan = await ledger.getFanMetrics('src/app.ts');

// Module public interface — all exported symbols with metadata
const iface = ledger.getModuleInterface('src/services/user.ts');

// Full symbol detail — members, jsDoc, decorators, type info
const full = ledger.getFullSymbol('UserService', 'src/services/user.ts');
```

---

### Pattern Matching & Tracing

Search code by AST structure and trace symbol origins through re-export chains.

```ts
// Structural pattern search (ast-grep syntax)
const logs = await ledger.findPattern('console.log($$$)');
const hooks = await ledger.findPattern('useState($A)', {
  filePaths: ['src/components/App.tsx'],
});

// Resolve re-export chains — find where a symbol is actually defined
const resolved = ledger.resolveSymbol('MyComponent', 'src/index.ts');

// Heritage chain — extends/implements tree traversal
const tree = await ledger.getHeritageChain('UserService', 'src/services/user.ts');
```

<br>

## 🔧 Scan-only Mode

For CI pipelines or one-shot analysis, disable the file watcher:

```ts
const ledger = await Gildash.open({
  projectRoot: '/path/to/project',
  watchMode: false,        // no watcher, no heartbeat
});

// ... run your queries ...

await ledger.close({ cleanup: true });   // delete DB files after use
```

<br>

## ❌ Error Handling

Public methods return values directly and throw `GildashError` on failure. Use `instanceof` to branch:

```ts
import { Gildash, GildashError } from '@zipbul/gildash';

try {
  const symbols = ledger.searchSymbols({ text: 'foo' });
  console.log(`Found ${symbols.length} symbols`);
} catch (e) {
  if (e instanceof GildashError) {
    console.error(`[${e.type}] ${e.message}`);
  }
}
```

<br>

## ⚙️ Configuration

### `Gildash.open(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectRoot` | `string` | — | Absolute path to project root **(required)** |
| `extensions` | `string[]` | `['.ts', '.mts', '.cts']` | File extensions to index |
| `ignorePatterns` | `string[]` | `[]` | Glob patterns to exclude |
| `parseCacheCapacity` | `number` | `500` | LRU parse-cache capacity |
| `logger` | `Logger` | `console` | Custom logger (`{ error(...args): void }`) |
| `watchMode` | `boolean` | `true` | `false` disables the file watcher (scan-only mode) |
| `semantic` | `boolean` | `false` | Enable tsc TypeChecker-backed semantic analysis |

Returns `Promise<Gildash>`. Throws `GildashError` on failure.

> **Note:** `semantic: true` requires a `tsconfig.json` in the project root. If not found, `Gildash.open()` throws a `GildashError`.

<br>

## 🔍 API Reference

### Search

| Method | Returns | Description |
|--------|---------|-------------|
| `searchSymbols(query)` | `SymbolSearchResult[]` | FTS5 full-text + exact / regex / decorator filters |
| `searchRelations(query)` | `StoredCodeRelation[]` | Filter by file, symbol, or relation type |
| `searchAllSymbols(query)` | `SymbolSearchResult[]` | Cross-project symbol search |
| `searchAllRelations(query)` | `StoredCodeRelation[]` | Cross-project relation search |
| `listIndexedFiles(project?)` | `FileRecord[]` | All indexed files for a project |
| `getSymbolsByFile(filePath)` | `SymbolSearchResult[]` | All symbols in a single file |

### Dependency Graph

| Method | Returns | Description |
|--------|---------|-------------|
| `getDependencies(filePath)` | `string[]` | Files imported by `filePath` |
| `getDependents(filePath)` | `string[]` | Files that import `filePath` |
| `getAffected(changedFiles)` | `Promise<string[]>` | Transitive impact set |
| `hasCycle(project?)` | `Promise<boolean>` | Circular dependency check |
| `getCyclePaths(project?, opts?)` | `Promise<string[][]>` | All cycle paths (Tarjan SCC + Johnson's). `opts.maxCycles` limits results. |
| `getImportGraph(project?)` | `Promise<Map>` | Full adjacency list |
| `getTransitiveDependencies(filePath)` | `Promise<string[]>` | Forward transitive BFS |

### Analysis

| Method | Returns | Description |
|--------|---------|-------------|
| `getFullSymbol(name, filePath)` | `FullSymbol \| null` | Members, jsDoc, decorators, type info |
| `getFileStats(filePath)` | `FileStats` | Line count, symbol count, size |
| `getFanMetrics(filePath)` | `Promise<FanMetrics>` | Fan-in / fan-out coupling |
| `getModuleInterface(filePath)` | `ModuleInterface` | Public exports with metadata |
| `getInternalRelations(filePath)` | `StoredCodeRelation[]` | Intra-file relations |
| `diffSymbols(before, after)` | `SymbolDiff` | Snapshot diff (added / removed / modified) |

### Annotations

| Method | Returns | Description |
|--------|---------|-------------|
| `searchAnnotations(query)` | `AnnotationSearchResult[]` | Search `@tag value` annotations in JSDoc, line, and block comments |

### Symbol Changelog

| Method | Returns | Description |
|--------|---------|-------------|
| `getSymbolChanges(since, opts?)` | `SymbolChange[]` | Symbol-level change history (added/modified/removed/renamed/moved) |
| `pruneChangelog(before)` | `number` | Delete changelog entries older than the given date |

### Semantic (opt-in)

Requires `semantic: true` at open time.

| Method | Returns | Description |
|--------|---------|-------------|
| `getResolvedType(name, filePath)` | `ResolvedType \| null` | Resolved type via tsc TypeChecker |
| `getSemanticReferences(name, filePath)` | `SemanticReference[]` | All references to a symbol |
| `getImplementations(name, filePath)` | `Implementation[]` | Interface / abstract class implementations |
| `getSemanticModuleInterface(filePath)` | `SemanticModuleInterface` | Module exports with resolved types |

`getFullSymbol()` automatically enriches the result with a `resolvedType` field when semantic is enabled.
`searchSymbols({ resolvedType })` filters symbols by their resolved type string.

### Advanced

| Method | Returns | Description |
|--------|---------|-------------|
| `findPattern(pattern, opts?)` | `Promise<PatternMatch[]>` | AST structural search (ast-grep) |
| `resolveSymbol(name, filePath)` | `ResolvedSymbol` | Follow re-export chain to original |
| `getHeritageChain(name, filePath)` | `Promise<HeritageNode>` | extends / implements tree |
| `batchParse(filePaths, opts?)` | `Promise<BatchParseResult>` | Concurrent multi-file parsing. Returns `{ parsed, failures }`. `opts`: oxc-parser `ParserOptions`. |

### Lifecycle & Low-level

| Method | Returns | Description |
|--------|---------|-------------|
| `reindex()` | `Promise<IndexResult>` | Force full re-index (owner only) |
| `onIndexed(callback)` | `() => void` | Subscribe to index-complete events |
| `onFileChanged(callback)` | `() => void` | Subscribe to file-change events |
| `onError(callback)` | `() => void` | Subscribe to error events |
| `onRoleChanged(callback)` | `() => void` | Subscribe to owner/reader role-change events |
| `parseSource(filePath, src, opts?)` | `ParsedFile` | Parse & cache a single file. `opts`: oxc-parser `ParserOptions`. |
| `extractSymbols(parsed)` | `ExtractedSymbol[]` | Extract symbols from parsed AST |
| `extractRelations(parsed)` | `CodeRelation[]` | Extract relations from parsed AST |
| `getParsedAst(filePath)` | `ParsedFile \| undefined` | Cached AST lookup (read-only) |
| `getFileInfo(filePath)` | `FileRecord \| null` | File metadata (hash, mtime, size) |
| `getStats(project?)` | `SymbolStats` | Symbol / file count statistics |
| `projects` | `ProjectBoundary[]` | Discovered project boundaries |
| `close(opts?)` | `Promise<void>` | Shutdown (pass `{ cleanup: true }` to delete DB) |

<br>

<details>
<summary><strong>Type Definitions</strong></summary>

```ts
// ── Search ──────────────────────────────────────────────────────────────

interface SymbolSearchQuery {
  text?: string;        // FTS5 full-text query
  exact?: boolean;      // exact name match (not prefix)
  kind?: SymbolKind;    // 'function' | 'method' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'property'
  filePath?: string;
  isExported?: boolean;
  project?: string;
  limit?: number;       // default: 100
  decorator?: string;   // e.g. 'Injectable'
  regex?: string;       // regex applied to symbol name
}

interface SymbolSearchResult {
  id: number;
  filePath: string;
  kind: SymbolKind;
  name: string;
  span: { start: { line: number; column: number }; end: { line: number; column: number } };
  isExported: boolean;
  signature: string | null;
  fingerprint: string | null;
  detail: Record<string, unknown>;
}

interface RelationSearchQuery {
  srcFilePath?: string;
  srcSymbolName?: string;
  dstFilePath?: string;
  dstSymbolName?: string;
  dstProject?: string;  // filter by destination project
  type?: 'imports' | 'type-references' | 're-exports' | 'calls' | 'extends' | 'implements';
  project?: string;
  limit?: number;       // default: 500
}

interface CodeRelation {
  type: 'imports' | 'type-references' | 're-exports' | 'calls' | 'extends' | 'implements';
  srcFilePath: string;
  srcSymbolName: string | null;
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson?: string;
  meta?: Record<string, unknown>;   // auto-parsed from metaJson
}

/** CodeRelation enriched with the destination project identifier. */
interface StoredCodeRelation extends CodeRelation {
  dstProject: string;
}

// ── Analysis ────────────────────────────────────────────────────────────

interface FullSymbol extends SymbolSearchResult {
  members?: Array<{
    name: string;
    kind: string;
    type?: string;
    visibility?: string;
    isStatic?: boolean;
    isReadonly?: boolean;
  }>;
  jsDoc?: string;
  parameters?: string;
  returnType?: string;
  heritage?: string[];
  decorators?: Array<{ name: string; arguments?: string }>;
  typeParameters?: string;
}

interface FileStats {
  filePath: string;
  lineCount: number;
  symbolCount: number;
  relationCount: number;
  size: number;
  exportedSymbolCount: number;
}

interface FanMetrics {
  filePath: string;
  fanIn: number;    // files importing this file
  fanOut: number;   // files this file imports
}

interface ModuleInterface {
  filePath: string;
  exports: Array<{
    name: string;
    kind: SymbolKind;
    parameters?: string;
    returnType?: string;
    jsDoc?: string;
  }>;
}

interface SymbolDiff {
  added: SymbolSearchResult[];
  removed: SymbolSearchResult[];
  modified: Array<{ before: SymbolSearchResult; after: SymbolSearchResult }>;
}

// ── Advanced ────────────────────────────────────────────────────────────

interface PatternMatch {
  filePath: string;
  startLine: number;
  endLine: number;
  matchedText: string;
}

interface ResolvedSymbol {
  originalName: string;
  originalFilePath: string;
  reExportChain: Array<{ filePath: string; exportedAs: string }>;
  circular: boolean;    // true when re-export chain contains a cycle
}

interface HeritageNode {
  symbolName: string;
  filePath: string;
  kind?: 'extends' | 'implements';
  children: HeritageNode[];
}

// ── Indexing ────────────────────────────────────────────────────────────

interface IndexResult {
  indexedFiles: number;
  removedFiles: number;
  totalSymbols: number;
  totalRelations: number;
  totalAnnotations: number;
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

interface FileRecord {
  project: string;
  filePath: string;
  mtimeMs: number;
  size: number;
  contentHash: string;
  updatedAt: string;
  lineCount?: number | null;
}

// ── Annotations ─────────────────────────────────────────────────────────

interface AnnotationSearchQuery {
  text?: string;       // FTS5 full-text query
  tag?: string;        // exact tag name (e.g. 'deprecated', 'todo')
  filePath?: string;
  symbolName?: string;
  source?: 'jsdoc' | 'line' | 'block';
  project?: string;
  limit?: number;      // default: 100
}

interface AnnotationSearchResult {
  tag: string;
  value: string;
  source: 'jsdoc' | 'line' | 'block';
  filePath: string;
  symbolName: string | null;
  span: { start: { line: number; column: number }; end: { line: number; column: number } };
}

// ── Symbol Changelog ────────────────────────────────────────────────────

type SymbolChangeType = 'added' | 'modified' | 'removed' | 'renamed' | 'moved';

interface SymbolChange {
  changeType: SymbolChangeType;
  symbolName: string;
  symbolKind: string;
  filePath: string;
  oldName: string | null;       // set for 'renamed'
  oldFilePath: string | null;   // set for 'moved'
  fingerprint: string | null;
  changedAt: string;
  isFullIndex: boolean;
  indexRunId: string;
}

interface SymbolChangeQueryOptions {
  symbolName?: string;
  changeTypes?: SymbolChangeType[];
  filePath?: string;
  includeFullIndex?: boolean;   // default: false
  indexRunId?: string;
  afterId?: number;             // pagination cursor
  limit?: number;               // default: 1000
  project?: string;
}

// ── Errors ──────────────────────────────────────────────────────────────

class GildashError extends Error {
  readonly type: GildashErrorType;   // see Error Types table below
  readonly message: string;
  readonly cause?: unknown;          // inherited from Error
}
```

</details>

<br>

## ⚠️ Error Types

| Type | When |
|------|------|
| `watcher` | File watcher start / stop failure |
| `parse` | AST parsing failure |
| `extract` | Symbol / relation extraction failure |
| `index` | Indexing pipeline failure |
| `store` | Database operation failure |
| `search` | Search query failure |
| `closed` | Operation on a closed instance |
| `semantic` | Semantic layer not enabled or tsc error |
| `validation` | Invalid input (e.g. missing `node_modules` package) |
| `close` | Error during shutdown |

<br>

## 🏗 Architecture

```
Gildash (Facade)
├── Parser      — oxc-parser-based TypeScript AST parsing
├── Extractor   — Symbol & relation extraction (imports, re-exports, type-refs, calls, heritage)
├── Store       — bun:sqlite + drizzle-orm (files · symbols · relations · FTS5) at `.gildash/gildash.db`
├── Indexer     — File change → parse → extract → store pipeline, symbol-level diff
├── Search      — FTS + regex + decorator search, relation queries, dependency graph, ast-grep
├── Semantic    — tsc TypeChecker integration (opt-in): types, references, implementations
└── Watcher     — @parcel/watcher + owner/reader role management
```

### Owner / Reader Pattern

When multiple processes share the same SQLite database, gildash enforces a single-writer guarantee:

- **Owner** — Runs the file watcher, performs indexing, sends a heartbeat every 30 s
- **Reader** — Read-only access; polls owner health every 15 s and self-promotes if the owner goes stale (60 s threshold)

<br>

## ⬆️ Upgrading

### From 0.9.0 to 0.9.1

**Bug fixes and performance improvements.** No breaking API changes.

- **Fix:** `getParsedAst()` now throws `GildashError('closed')` when the instance is closed, consistent with all other public APIs (previously returned `undefined`)
- **Fix:** `searchSymbols({ regex })` with an invalid regex now throws `GildashError('validation')` instead of silently returning `[]`
- **Fix:** `ctx.role` is now correctly updated to `'owner'` when a reader is promoted
- **Fix:** Full-index path now properly tracks failed file reads in `IndexResult.failedFiles`
- **Fix:** Reader→Owner promotion rollback now cleans up heartbeat timer and releases watcher role
- **Perf:** Batch INSERT for symbol, annotation, and changelog repositories (replaces N+1 individual inserts)
- **Perf:** Binary search for JSDoc comment association (~40x faster on large files)
- **Perf:** Progressive regex fetch strategy (replaces fixed 5000-row over-fetch)
- **Perf:** `getQualifiedName()` uses push+reverse instead of O(n²) unshift

### From 0.8.x to 0.9.0

**New:** Annotation extraction and symbol changelog tracking.

- `searchAnnotations(query)` — Search `@tag value` from JSDoc, line, and block comments
- `getSymbolChanges(since, opts?)` — Symbol-level change history with rename/move detection
- `pruneChangelog(before)` — Prune old changelog entries
- `IndexResult` now includes `totalAnnotations`
- New migrations `0006_annotations` and `0007_symbol_changelog` are applied automatically on open

**No breaking changes.** Existing databases are migrated automatically.

### From 0.7.x to 0.8.0

**Breaking:** `batchParse()` now returns `BatchParseResult` (with `parsed` and `failures` fields) instead of `Map<string, ParsedFile>`.

```diff
- const parsed = await ledger.batchParse(filePaths);
- const ast = parsed.get('src/app.ts');
+ const { parsed, failures } = await ledger.batchParse(filePaths);
+ const ast = parsed.get('src/app.ts');
+ if (failures.length > 0) console.warn('Failed:', failures);
```

**New event methods:** `onFileChanged()`, `onError()`, `onRoleChanged()` added alongside `onIndexed()`.

### From 0.6.x to 0.7.0

**Breaking:** `@zipbul/result` is no longer part of the public API. All methods now return values directly and throw `GildashError` on failure.

```diff
- import { isErr } from '@zipbul/result';
- const result = ledger.searchSymbols({ text: 'foo' });
- if (isErr(result)) { console.error(result.data.message); }
- else { console.log(result); }
+ const symbols = ledger.searchSymbols({ text: 'foo' }); // throws GildashError
```

- Remove `@zipbul/result` from your dependencies (no longer a peer dependency)
- Replace `isErr()` checks with `try/catch` using `instanceof GildashError`
- `getFullSymbol()`, `getFileInfo()`, `getResolvedType()` return `null` instead of an error when not found
- `resolveSymbol()` returns `{ circular: true }` for circular re-exports instead of throwing

### From 0.4.x to 0.5.0

The database directory was renamed from `.zipbul/` to `.gildash/`. The database is now stored at `<projectRoot>/.gildash/gildash.db`.

Existing `.zipbul/` data is **not** migrated automatically. On first run, a fresh database is created at `.gildash/gildash.db`. Delete `.zipbul/` manually after upgrading.

<br>

## 📄 License

[MIT](./LICENSE) © [zipbul](https://github.com/zipbul)
