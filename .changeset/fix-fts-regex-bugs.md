---
"@zipbul/gildash": patch
---

Fix FTS query crashes and regex search result loss

- Fix `searchByQuery` with `regex` option returning empty array when regex matches fewer results than `limit` but total records exceed `limit * 100`
- Fix `searchAnnotations` crashing with SQLite FTS5 syntax error when `text` is whitespace-only
- Fix `toFtsPrefixQuery` passing null bytes to SQLite, causing "unterminated string" error on both symbol and annotation search
