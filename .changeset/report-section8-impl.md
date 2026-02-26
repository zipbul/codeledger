---
"@zipbul/gildash": minor
---

Implement all 13 recommendations from REPORT.md Section 8.

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
