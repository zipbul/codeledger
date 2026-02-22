---
"@zipbul/gildash": minor
---

Replace class-based error hierarchy with Result-based error handling

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
