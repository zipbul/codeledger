---
"@zipbul/gildash": minor
---

Add public API extensions for AST cache sharing, file metadata, exact symbol search, and file-scoped symbol listing

- `getParsedAst(filePath)`: retrieve cached oxc-parser AST from internal LRU cache
- `getFileInfo(filePath, project?)`: query indexed file metadata (hash, mtime, size)
- `searchSymbols({ text, exact: true })`: exact name match (in addition to existing FTS prefix)
- `getSymbolsByFile(filePath, project?)`: convenience wrapper for file-scoped symbol listing
- Re-export `ParsedFile` and `FileRecord` types
- Add `oxc-parser` to peerDependencies
