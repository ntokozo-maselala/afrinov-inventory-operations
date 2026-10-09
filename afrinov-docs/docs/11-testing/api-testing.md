# API Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Target: every endpoint in `08-api/resource-model.md` — happy path,
validation errors (400), auth failures (401/403), business-rule failures
(409/422) matching `08-api/error-model.md` exactly.

Implemented:
- Route tests with Fastify `inject` and mocked services:
  `src/modules/inventory/inventory.routes.test.ts` (validation, 401/403,
  201 for movements, returns and reversals; no `PATCH` on transactions),
  `src/modules/identity/auth.routes.test.ts`, `src/server*.test.ts`,
  `src/security.regression.test.ts`.
- The integration suites (`integration-testing.md`) call the real HTTP API
  and check status and error codes.

Not every endpoint has route-level tests; per-endpoint coverage is not
measured (no coverage report is configured).

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.test.ts`
- `afrinov-platform/apps/backend/src/modules/identity/auth.routes.test.ts`
- `afrinov-platform/apps/backend/vitest.config.ts` — no coverage settings
