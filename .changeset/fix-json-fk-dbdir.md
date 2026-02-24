---
"@zipbul/gildash": patch
---

### Bug Fixes

- **tsconfig.json JSONC parsing** — `SyntaxError: Failed to parse JSON` no longer occurs when `tsconfig.json` contains line comments (`//`), block comments (`/* */`), or trailing commas. Parsing now uses `Bun.JSONC.parse()`.

- **`fullIndex()` FK constraint violation** — `SQLiteError: FOREIGN KEY constraint failed` no longer occurs on repeated calls to `fullIndex()`. Previously, all file records were deleted before re-inserting only the changed files, causing relations that referenced unchanged files to violate the foreign key constraint. Now only changed and deleted files are removed from the index; unchanged file records are preserved.

### Breaking Changes

- **Data directory renamed from `.zipbul` to `.gildash`** — The SQLite database is now stored at `<projectRoot>/.gildash/gildash.db`. Any existing `.zipbul/` directory is **not** migrated automatically. On first run, a fresh database will be created at `.gildash/gildash.db`. If your application stored anything in `.zipbul/`, move or delete it manually.
