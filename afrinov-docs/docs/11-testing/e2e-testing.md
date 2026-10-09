# End-to-End Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Target: automate the critical journeys from `01-product/user-journeys.md`
(technician issues material against a project; store controller receives
goods against a PO; low stock noticed and ordered; tool check-out and
back), against a staging-like environment with seeded reference data.

Implemented: Playwright (`apps/frontend/playwright.config.ts`, Chromium)
with one spec, `e2e/login.spec.ts`: signing in as the seeded admin through
the real backend reaches the dashboard, and wrong credentials are refused.
It expects the backend and database to be running and the dev server on
port 5173. It is not run in CI, and it hard-codes the admin password it
expects the seed to have used (TD-017).

The journey tests above are **Planned**; the tool journey depends on the
tool feature, which is itself **Planned**.

## Evidence
- `afrinov-platform/apps/frontend/playwright.config.ts`
- `afrinov-platform/apps/frontend/e2e/login.spec.ts`
- `.github/workflows/frontend-ci.yml:49-54` — no Playwright step
