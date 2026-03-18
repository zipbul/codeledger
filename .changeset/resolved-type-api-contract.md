---
"@zipbul/gildash": patch
---

docs: document ResolvedType tree structure guarantee in JSDoc

- Add tree structure guarantee JSDoc to `ResolvedType` interface and `Gildash.getResolvedType()` — returned value is always a bounded, finite, acyclic tree
- Extract magic number depth limit into `MAX_TYPE_DEPTH` named constant in `type-collector.ts`
