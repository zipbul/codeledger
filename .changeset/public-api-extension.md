---
"@zipbul/gildash": minor
---

feat: public API extension — position-based semantic API, utility exposure, diagnostics, graph method, type fixes

- Add position-based semantic API: `getResolvedTypeAtPosition`, `getSemanticReferencesAtPosition`, `getImplementationsAtPosition`, `isTypeAssignableToAtPosition`
- Expose internal utilities: `lineColumnToPosition`, `findNamePosition`, `getSymbolNode`
- Add `getSemanticDiagnostics` for tsc diagnostics on indexed files
- Add `getTransitiveDependents` to facade (was only on DependencyGraph)
- Narrow `searchRelations` / `searchAllRelations` / `getInternalRelations` return type to `StoredCodeRelation[]`
- Export `SymbolNode` and `SemanticDiagnostic` types
- Delete redundant `src/gildash.spec.ts` (251 tests migrated to module-level specs)
