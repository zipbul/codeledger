---
"@zipbul/gildash": minor
---

Replace `Result<T, GildashError>` return types with direct returns and `GildashError` throws across all 34 public API methods.

**Breaking changes:**

- All public methods now return values directly and throw `GildashError` on failure (previously returned `Result<T, GildashError>`)
- `@zipbul/result` is no longer a peer dependency (moved to internal dependency)
- `GildashError` is now a class extending `Error` (previously a plain interface)
- `getFullSymbol()`, `getFileInfo()`, `getResolvedType()` return `null` for "not found" (previously returned an error)
- `resolveSymbol()` returns `{ circular: true }` for circular re-exports (previously returned an error)
- `ResolvedSymbol` type has a new `circular: boolean` field
