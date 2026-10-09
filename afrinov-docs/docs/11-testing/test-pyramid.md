# Test Pyramid

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

```
        /  E2E (few)  \        target: issue stock, receive against PO, low-stock alert
       /----------------\      actual: 1 file, 2 tests (login only)
      / API / Contract    \    actual: integration suites call the real HTTP API;
     /----------------------\          OpenAPI test checks documented = registered routes
    /  Integration           \  actual: 11 files, about 55 tests, real PostgreSQL
   /----------------------------\
  /  Unit (many)                 \ actual: backend 37 files / 492 tests;
 /--------------------------------\        frontend 35 files / 389 tests
```
Most tests at the bottom (fast, numerous), fewest at the top. Counts are
from a local run on 2026-10-09 at commit 4e6d76f (`npm test` in
`afrinov-platform/`); the integration count is from the test files, as the
suite needs a database and was not run.

## Evidence
- `afrinov-platform/apps/backend/integration/` — 11 `*.real-http.test.ts` files
- `afrinov-platform/apps/frontend/e2e/login.spec.ts`
- `afrinov-platform/apps/backend/src/openapi/openapi.test.ts:37-39`
