# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@zipbul/gildash` is a **Bun-native** TypeScript code intelligence engine. It indexes TypeScript codebases into a local SQLite database for symbol search, cross-file relation tracking, dependency graph analysis, and AST pattern matching — with incremental file-watcher-driven updates.

## Commands

```bash
bun test                              # Run all tests (bun:test)
bun test src/parser/parse-source.spec.ts  # Run a single test file
bun test --grep "pattern"             # Filter tests by name
bun test --coverage                   # Run with coverage (90% threshold enforced)
bun run build                         # Build (bun bundler + tsc declarations + copy migrations)
bun run typecheck                     # Type-check only (tsc --noEmit)
```

No ESLint or Prettier configured. Pre-commit hooks run `typecheck` + `test`; pre-push runs coverage check. Commit messages use conventional commits (enforced by commitlint).

## Architecture

```
Gildash (Facade — src/gildash/)
├── Parser      — oxc-parser AST parsing + LRU cache (src/parser/)
├── Extractor   — Symbol & relation extraction from AST (src/extractor/)
├── Store       — bun:sqlite + drizzle-orm, FTS5 search (src/store/)
├── Indexer     — File change → parse → extract → store pipeline (src/indexer/)
├── Search      — Symbol FTS, relation queries, dependency graph, ast-grep (src/search/)
├── Semantic    — tsc TypeChecker integration, opt-in (src/semantic/)
├── Watcher     — @parcel/watcher + owner/reader role separation (src/watcher/)
└── Common      — Project discovery, tsconfig resolver, hasher, LRU cache (src/common/)
```

The `Gildash` class in `src/gildash/` is the public facade. All submodules are wired through it. Internal submodules may use `Result<T, GildashError>` freely; the `Gildash` class boundary unwraps Results and either returns values or throws `GildashError`.

**Owner/Reader pattern**: When multiple processes share the same SQLite database, a single-writer guarantee is enforced. The owner runs the watcher and heartbeats every 30s; readers poll health every 60s and self-promote if the owner goes stale.

**Database**: SQLite at `<projectRoot>/.gildash/gildash.db`, WAL mode, FK constraints enforced. Schema managed by drizzle-orm migrations in `src/store/migrations/`.

## Test Conventions

- **Unit tests**: `*.spec.ts` colocated with source files. SUT = single export. All external dependencies must be test-doubled.
- **Integration tests**: `*.test.ts` in `test/`. SUT = cross-module combination. Real implementations inside SUT boundary, test doubles outside.
- Test framework: `bun:test` exclusively. Use `describe`, `it`, `expect`, `mock`, `spyOn`, `beforeEach`, `afterEach`.
- Mock strategy priority: (1) DI injection, (2) `mock.module()`, (3) propose DI refactoring.
- No monkey-patching globals — always use `spyOn().mockImplementation()`.
- BDD-style `it` titles ("should ... when ..."), AAA structure (Arrange → Act → Assert).
- `test/setup.ts` is preloaded for global mock management.

## Coding Conventions

- **Bun-first**: Always prefer Bun built-in APIs over Node.js APIs or npm packages. Only use Node.js/npm when Bun has no equivalent.
- **Strict TypeScript**: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- **Files**: kebab-case (`symbol-search.ts`). **Types**: PascalCase, no `I` prefix. **Functions**: camelCase. **Constants**: UPPER_SNAKE_CASE.
- Each module exports public API via its `index.ts`. Internal implementation details stay unexported.
- Changesets required for releases (`.changeset/`). Use `minor` for features, `patch` for fixes.

## Current State (v0.6.0 branch)

Active migration from `Result<T, GildashError>` to throw-based error handling (see `PLAN.0.6.md`):

| Return pattern | Use case |
|---|---|
| `T` | Single value, failure = system error (throw) |
| `T \| null` | Single entity lookup, "not found" is normal |
| `T[]` | Collection search, `[]` = no results |
| `boolean` | Existence/state query |
| `void` | Side effects (close, index) |

`GildashError` is now a class extending `Error` with a `type` field (`'watcher' | 'parse' | 'extract' | 'index' | 'store' | 'search' | 'closed' | 'validation' | 'semantic'`).
