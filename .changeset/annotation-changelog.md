---
"@zipbul/gildash": minor
---

Add annotation extraction system and symbol changelog tracking

- Generic comment annotation extraction (`@tag value`) from JSDoc, line, and block comments with automatic symbol linking
- Annotation search via FTS5 (`searchAnnotations`)
- Symbol changelog tracking with rename/move detection (`getSymbolChanges`, `pruneChangelog`)
- Structural fingerprinting for rename detection across index runs
- New migrations: `0006_annotations` and `0007_symbol_changelog`
