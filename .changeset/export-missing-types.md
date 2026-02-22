---
"@zipbul/gildash": minor
---

Export missing public API types and expose `role` getter

- Re-export `IndexResult`, `ProjectBoundary`, `CodeRelation`, `SymbolStats`, `SymbolKind`, `WatcherRole` from the package entry point
- Make `Gildash.role` property public (was `private readonly`, now `readonly`)
