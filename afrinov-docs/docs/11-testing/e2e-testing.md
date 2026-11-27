<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-11-004</b></td>
<td align="center"><b><i>End-to-End Testing</i></b><br><i>Testing</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-11-004 updated=2026-11-27 by="Ntokozo Maselala" body=aec2e9f9f4b7 -->

# End-to-End Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 6a122ff, 2026-11-24

Target: automate the critical journeys from `01-product/user-journeys.md`
(technician issues material against a project; store controller receives
goods against a PO; low stock noticed and ordered; tool check-out and
back), against a staging-like environment with seeded reference data.

Implemented: Playwright (`apps/frontend/playwright.config.ts`, Chromium),
run in CI as "Frontend: browser tests (Playwright, real backend)" in
`frontend-ci.yml`, on every pull request that changes the frontend or the
backend (skipped, as a success, otherwise). Three specs: signing in and being refused
(`login.spec.ts`), signing out (`sign-out.spec.ts`), and how failures look
over the live stack (`error-handling.spec.ts`). The seeded admin's password
comes from `SEED_ADMIN_PASSWORD`; the database must be a local `*_test` one.

`e2e/global-setup.ts` starts the real backend on 4000 and Vite on 5173 for
the run, and stops them after, through `e2e/servers.ts`:

- It refuses to start if anything already answers on 4000 or 5173 (a dev
  server, or one left by an earlier run), since the readiness check would
  take that server's answer for its own and the suite would test it, and
  whatever database it uses. Stop it and run again.
- The ports are checked once, before the start, so another process could
  still take one in the moments between. A server counts as ready only
  while it is still running, and the backend is checked again once Vite is
  up: a server of ours that couldn't listen has exited by then, and setup
  fails with how it ended instead of testing whatever answered.
- Each server is stopped with everything it started (it runs through a
  shell, and the server listening is a grandchild): `taskkill /T` on
  Windows; elsewhere each process below it, found through `/proc` (Linux)
  or `ps` (macOS). Teardown waits until they have gone, and a setup that
  fails half way stops what it started.
- The servers stay in the runner's process group, so the terminal's Ctrl+C
  reaches them as it reaches the runner, however the runner handles it. A
  runner that exits before its teardown (an error) stops them from an exit
  hook. Only a runner killed outright (SIGKILL, Task Manager) leaves them
  running.

Browser specs are `e2e/*.spec.ts`; `e2e/*.test.ts` are Vitest tests of these
helpers, run with the frontend's unit tests (project `e2e-helpers`, Node).

The journey tests above are **Planned**. The tool feature exists; its
check-out and check-in are covered over real HTTP by
`integration/tool-loans.real-http.test.ts`.

## Evidence
- `afrinov-platform/apps/frontend/playwright.config.ts`
- `afrinov-platform/apps/frontend/e2e/global-setup.ts`, `e2e/servers.ts`, `e2e/servers.test.ts`
- `afrinov-platform/apps/frontend/e2e/login.spec.ts`, `sign-out.spec.ts`, `error-handling.spec.ts`
- `.github/workflows/frontend-ci.yml` — the "Frontend: browser tests (Playwright, real backend)" job
