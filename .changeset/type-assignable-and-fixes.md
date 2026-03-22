---
"@zipbul/gildash": minor
---

feat: isTypeAssignableToType API, primitive keyword resolve, absolute path fix

- Add `isTypeAssignableToType(filePath, position, targetTypeExpression)` — check assignability against type expression strings (e.g. `'PromiseLike<any>'`, `'Error'`)
- Fix `getResolvedTypeAtPosition` to resolve primitive type keywords (`string`, `number`, `boolean`, etc.)
- Fix `resolveSymbolPosition` to normalize absolute paths to relative before DB search
