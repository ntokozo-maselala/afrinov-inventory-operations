<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-11-009</b></td>
<td align="center"><b><i>Testing Strategy</i></b><br><i>Testing</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-11-009 updated=2026-11-27 by="Ntokozo Maselala" body=c71c0d636550 -->

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

CI runs backend unit + integration and frontend unit tests, and the Playwright
browser suite as "Frontend: browser tests (Playwright, real backend)" in
`frontend-ci.yml` (`e2e-testing.md`). Both workflows run on every pull request;
a pull request that changes none of their paths gets the checks skipped, which
counts as a pass (`docs/engineering/CI_CD_ARCHITECTURE.md`).

## Evidence
- `afrinov-platform/apps/backend/integration/helpers.ts:74-88`
- `afrinov-platform/apps/backend/vitest.config.ts`, `afrinov-platform/apps/backend/vitest.integration.config.ts`
- `afrinov-platform/apps/frontend/vitest.config.ts`, `afrinov-platform/apps/frontend/playwright.config.ts`
- `.github/workflows/backend-ci.yml` (jobs `changes`, `checks`, `integration`), `.github/workflows/frontend-ci.yml` (jobs `changes`, `checks`, `e2e`)
