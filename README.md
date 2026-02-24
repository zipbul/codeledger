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
- **Multi-process safe** — Owner/reader role separation guarantees a single writer per database
- **Scan-only mode** — `watchMode: false` for one-shot indexing without file watcher overhead
- **External package indexing** — Index `.d.ts` type declarations from `node_modules`
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

> **Peer dependency** — [`@zipbul/result`](https://www.npmjs.com/package/@zipbul/result) is required. All public methods return `Result<T, GildashError>`.

<br>

## 🚀 Quick Start

```ts
import { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

// 1. Open — indexes every .ts file on first run, then watches for changes
const ledger = await Gildash.open({
  projectRoot: '/absolute/path/to/project',
});

// 2. Search — find symbols by name
const result = ledger.searchSymbols({ text: 'UserService', kind: 'class' });
if (!isErr(result)) {
  result.forEach(s => console.log(`${s.name} → ${s.filePath}`));
}

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

Every public method returns `Result<T, GildashError>` from [`@zipbul/result`](https://www.npmjs.com/package/@zipbul/result). Use `isErr()` to branch:

```ts
import { isErr } from '@zipbul/result';

const result = ledger.searchSymbols({ text: 'foo' });
if (isErr(result)) {
  console.error(result.data.type, result.data.message);
} else {
  console.log(`Found ${result.length} symbols`);
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

Returns `Promise<Gildash>` (wrapped in `Result`).

> **Note:** `semantic: true` requires a `tsconfig.json` in the project root. If not found, `Gildash.open()` returns a `GildashError`.

<br>

## 🔍 API Reference

### Search

| Method | Returns | Description |
|--------|---------|-------------|
| `searchSymbols(query)` | `Result<SymbolSearchResult[]>` | FTS5 full-text + exact / regex / decorator filters |
| `searchRelations(query)` | `Result<CodeRelation[]>` | Filter by file, symbol, or relation type |
| `searchAllSymbols(query)` | `Result<SymbolSearchResult[]>` | Cross-project symbol search |
| `searchAllRelations(query)` | `Result<CodeRelation[]>` | Cross-project relation search |
| `listIndexedFiles(project?)` | `Result<FileRecord[]>` | All indexed files for a project |
| `getSymbolsByFile(filePath)` | `Result<SymbolSearchResult[]>` | All symbols in a single file |

### Dependency Graph

| Method | Returns | Description |
|--------|---------|-------------|
| `getDependencies(filePath)` | `Result<string[]>` | Files imported by `filePath` |
| `getDependents(filePath)` | `Result<string[]>` | Files that import `filePath` |
| `getAffected(changedFiles)` | `Promise<Result<string[]>>` | Transitive impact set |
| `hasCycle(project?)` | `Promise<Result<boolean>>` | Circular dependency check |
| `getCyclePaths(project?, opts?)` | `Promise<Result<string[][]>>` | All cycle paths (Tarjan SCC + Johnson's). `opts.maxCycles` limits results. |
| `getImportGraph(project?)` | `Promise<Result<Map>>` | Full adjacency list |
| `getTransitiveDependencies(filePath)` | `Promise<Result<string[]>>` | Forward transitive BFS |

### Analysis

| Method | Returns | Description |
|--------|---------|-------------|
| `getFullSymbol(name, filePath)` | `Result<FullSymbol>` | Members, jsDoc, decorators, type info |
| `getFileStats(filePath)` | `Result<FileStats>` | Line count, symbol count, size |
| `getFanMetrics(filePath)` | `Promise<Result<FanMetrics>>` | Fan-in / fan-out coupling |
| `getModuleInterface(filePath)` | `Result<ModuleInterface>` | Public exports with metadata |
| `getInternalRelations(filePath)` | `Result<CodeRelation[]>` | Intra-file relations |
| `diffSymbols(before, after)` | `SymbolDiff` | Snapshot diff (added / removed / modified) |

### Semantic (opt-in)

Requires `semantic: true` at open time.

| Method | Returns | Description |
|--------|---------|-------------|
| `getResolvedType(name, filePath)` | `Result<ResolvedType \| null>` | Resolved type via tsc TypeChecker |
| `getSemanticReferences(name, filePath)` | `Result<SemanticReference[]>` | All references to a symbol |
| `getImplementations(name, filePath)` | `Result<Implementation[]>` | Interface / abstract class implementations |
| `getSemanticModuleInterface(filePath)` | `Result<SemanticModuleInterface>` | Module exports with resolved types |

`getFullSymbol()` automatically enriches the result with a `resolvedType` field when semantic is enabled.
`searchSymbols({ resolvedType })` filters symbols by their resolved type string.

### Advanced

| Method | Returns | Description |
|--------|---------|-------------|
| `findPattern(pattern, opts?)` | `Promise<Result<PatternMatch[]>>` | AST structural search (ast-grep) |
| `resolveSymbol(name, filePath)` | `Result<ResolvedSymbol>` | Follow re-export chain to original |
| `getHeritageChain(name, filePath)` | `Promise<Result<HeritageNode>>` | extends / implements tree |
| `indexExternalPackages(packages)` | `Promise<Result<IndexResult[]>>` | Index `.d.ts` from `node_modules` |
| `batchParse(filePaths, opts?)` | `Promise<Result<Map>>` | Concurrent multi-file parsing. `opts`: oxc-parser `ParserOptions`. |

### Lifecycle & Low-level

| Method | Returns | Description |
|--------|---------|-------------|
| `reindex()` | `Promise<Result<IndexResult>>` | Force full re-index (owner only) |
| `onIndexed(callback)` | `() => void` | Subscribe to index-complete events |
| `parseSource(filePath, src, opts?)` | `Result<ParsedFile>` | Parse & cache a single file. `opts`: oxc-parser `ParserOptions`. |
| `extractSymbols(parsed)` | `Result<ExtractedSymbol[]>` | Extract symbols from parsed AST |
| `extractRelations(parsed)` | `Result<CodeRelation[]>` | Extract relations from parsed AST |
| `getParsedAst(filePath)` | `ParsedFile \| undefined` | Cached AST lookup (read-only) |
| `getFileInfo(filePath)` | `Result<FileRecord \| null>` | File metadata (hash, mtime, size) |
| `getStats(project?)` | `Result<SymbolStats>` | Symbol / file count statistics |
| `projects` | `ProjectBoundary[]` | Discovered project boundaries |
| `close(opts?)` | `Promise<Result<void>>` | Shutdown (pass `{ cleanup: true }` to delete DB) |

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

// ── Errors ──────────────────────────────────────────────────────────────

interface GildashError {
  type: GildashErrorType;   // see Error Types table below
  message: string;
  cause?: unknown;
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
├── Store       — bun:sqlite + drizzle-orm (files · symbols · relations · FTS5)
├── Indexer     — File change → parse → extract → store pipeline, symbol-level diff
├── Search      — FTS + regex + decorator search, relation queries, dependency graph, ast-grep
├── Semantic    — tsc TypeChecker integration (opt-in): types, references, implementations
└── Watcher     — @parcel/watcher + owner/reader role management
```

### Owner / Reader Pattern

When multiple processes share the same SQLite database, gildash enforces a single-writer guarantee:

- **Owner** — Runs the file watcher, performs indexing, sends a heartbeat every 30 s
- **Reader** — Read-only access; polls owner health every 60 s and self-promotes if the owner goes stale

<br>

## 📄 License

[MIT](./LICENSE) © [zipbul](https://github.com/zipbul)
