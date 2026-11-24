# End-to-End Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 1b6cec1, 2026-11-24

Target: automate the critical journeys from `01-product/user-journeys.md`
(technician issues material against a project; store controller receives
goods against a PO; low stock noticed and ordered; tool check-out and
back), against a staging-like environment with seeded reference data.

Implemented: Playwright (`apps/frontend/playwright.config.ts`, Chromium),
run in CI as "Browser tests (Playwright, real backend)" in
`frontend-ci.yml`. Three specs: signing in and being refused
(`login.spec.ts`), signing out (`sign-out.spec.ts`), and how failures look
over the live stack (`error-handling.spec.ts`). The seeded admin's password
comes from `SEED_ADMIN_PASSWORD`; the database must be a local `*_test` one.

`e2e/global-setup.ts` starts the real backend on 4000 and Vite on 5173 for
the run, and stops them after, through `e2e/servers.ts`:

- It refuses to start if anything already answers on 4000 or 5173 (a dev
  server, or one left by an earlier run), since the readiness check would
  take that server's answer for its own and the suite would test it, and
  whatever database it uses. Stop it and run again.
- Each server is stopped with everything it started (it runs through a
  shell, and the server listening is a grandchild): `taskkill /T` on
  Windows, its process group elsewhere. Teardown waits until they have
  gone, and a setup that fails half way stops what it started.

Browser specs are `e2e/*.spec.ts`; `e2e/*.test.ts` are Vitest tests of these
helpers, run with the frontend's unit tests (project `e2e-helpers`, Node).

The journey tests above are **Planned**. The tool feature exists; its
check-out and check-in are covered over real HTTP by
`integration/tool-loans.real-http.test.ts`.

## Evidence
- `afrinov-platform/apps/frontend/playwright.config.ts`
- `afrinov-platform/apps/frontend/e2e/global-setup.ts`, `e2e/servers.ts`, `e2e/servers.test.ts`
- `afrinov-platform/apps/frontend/e2e/login.spec.ts`, `sign-out.spec.ts`, `error-handling.spec.ts`
- `.github/workflows/frontend-ci.yml` — the "Browser tests (Playwright, real backend)" job
