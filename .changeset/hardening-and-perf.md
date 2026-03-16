---
"@zipbul/gildash": patch
---

fix: hardening and performance improvements

- fix(lifecycle): update ctx.role on reader-to-owner promotion and clean up heartbeat timer + release watcher role on rollback
- fix(indexer): track file read failures in fullIndex path via allFailedFiles
- fix(parse-api): getParsedAst now throws GildashError('closed') when instance is closed
- fix(store): searchByQuery with invalid regex throws GildashError('validation') instead of returning []
- fix(gildash): standardize closed error messages across annotation-api and changelog-api
- perf(store): batch INSERT for symbol, annotation, and changelog repositories
- perf(extractor): binary search for JSDoc comment association in extractSymbols
- perf(store): progressive regex fetch strategy replacing fixed 5000-row over-fetch
- perf(parser): push+reverse instead of O(n^2) unshift in getQualifiedName
- refactor(store): extract registerRegexpUdf helper, remove dead query() method
- refactor(search): remove unnecessary async/await in dependency-graph.spec.ts
- refactor(semantic): use Set for rootFileNames in TscLanguageServiceHost
