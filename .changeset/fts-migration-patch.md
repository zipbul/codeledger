---
"@zipbul/gildash": patch
---

FTS5 setup을 런타임 코드에서 Drizzle migration으로 이동

### Refactor

- `FTS_SETUP_SQL` 상수를 `schema.ts`/`connection.ts`에서 제거하고 Drizzle SQL migration(`0002_fts_setup.sql`)으로 이동
- FTS5 virtual table + INSERT/DELETE/UPDATE sync trigger를 migration에서 `IF NOT EXISTS`로 idempotent하게 생성

### Chore

- `.npmignore` 제거 — `README.ko.md`를 npm 패키지에 포함
