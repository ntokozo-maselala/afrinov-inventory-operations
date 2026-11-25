# Test Pyramid

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 1b6cec1, 2026-11-24

```
        /  E2E (few)  \        target: issue stock, receive against PO, low-stock alert
       /----------------\      actual: 3 files, 8 tests (sign-in, sign-out, failures); run in CI
      / API / Contract    \    actual: integration suites call the real HTTP API;
     /----------------------\          OpenAPI test checks documented = registered routes
    /  Integration           \  actual: 41 files, 400 tests, real PostgreSQL
   /----------------------------\
  /  Unit (many)                 \ actual: backend 89 files / 1426 tests;
 /--------------------------------\        frontend 144 files / 1664 tests
```
Most tests at the bottom (fast, numerous), fewest at the top. Counts are
from local runs on 2026-11-24 at commit 1b6cec1, after a clean `npm ci`:
`npm test` in `afrinov-platform/`, the integration suite on a fresh
migrated and seeded database, and `npx playwright test`. Counts move with
every feature; run the suites rather than trusting these.

## Evidence
- `afrinov-platform/apps/backend/integration/` — 41 `*.real-http.test.ts` files
- `afrinov-platform/apps/frontend/e2e/*.spec.ts` (`login`, `sign-out`, `error-handling`)
- `afrinov-platform/apps/backend/src/openapi/openapi.test.ts:37-39`
