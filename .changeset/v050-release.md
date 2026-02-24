---
"@zipbul/gildash": minor
---

### Breaking Changes

- **Remove `getDeadExports` API** — This feature embedded project-specific policies (entry point definitions, build configuration, test file inclusion) that vary per consumer. Use `searchSymbols({ isExported: true })` + `searchRelations({ type: 'imports' })` to build custom dead-export detection in your own code.

### New Features

- **Replace `getCyclePaths` algorithm with Tarjan SCC + Johnson's circuits** — The previous DFS-based implementation could miss cycles sharing common nodes. The new algorithm exhaustively detects every elementary circuit in the import graph. Use the `maxCycles` option to cap the number of returned cycles.
- **Add `ParserOptions` passthrough to `parseSource` / `batchParse`** — Forward oxc-parser's `ParserOptions` (e.g. `sourceType`, `lang`) directly, allowing explicit control over parser behavior regardless of file extension.

### Chores

- Upgrade `oxc-parser` from 0.114.0 to 0.115.0
