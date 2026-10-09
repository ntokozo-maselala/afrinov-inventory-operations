# Testing Strategy

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Test business invariants, not just CRUD. The most important invariant in
this system: **a material's balance always equals the sum of its posted
transactions.** It is asserted directly: the integration helper
`ledgerAndBalance()` reads both from the database, and the inventory,
procurement, returns, stock-count, stock-receipt and opening-balance
integration suites compare them after their movements.

Layers as implemented (see `test-pyramid.md` for counts):

| Layer | Tool | Where | Database |
|---|---|---|---|
| Backend unit | Vitest (node) | `apps/backend/src/**/*.test.ts` | Mocked Prisma (in-memory fakes) |
| Backend integration / API | Vitest + real HTTP server | `apps/backend/integration/*.test.ts` | Real PostgreSQL, migrated and seeded |
| Frontend unit/component | Vitest + jsdom + Testing Library | `apps/frontend/src/**/*.test.ts(x)` | None (mocked API) |
| End-to-end | Playwright | `apps/frontend/e2e/` | Real backend and database |
| Acceptance (plain-language business scenarios) | — | `acceptance-testing.md` | Mapped to integration tests |

CI runs backend unit + integration and frontend unit tests on every
relevant pull request; the Playwright test is not run in CI (TD-017).

## Evidence
- `afrinov-platform/apps/backend/integration/helpers.ts:74-88`
- `afrinov-platform/apps/backend/vitest.config.ts`, `afrinov-platform/apps/backend/vitest.integration.config.ts`
- `afrinov-platform/apps/frontend/vitest.config.ts`, `afrinov-platform/apps/frontend/playwright.config.ts`
- `.github/workflows/backend-ci.yml:51-54,110`, `.github/workflows/frontend-ci.yml:49-54`
