# Recovery Plan

**Status date:** 2026-10-12. P0 recovery is complete for static/local build gates. Remaining work is staged below.

## Completed recovery

| Stage | Action | Files/effects | Verification | Risk |
|---|---|---|---|---|
| P0 | Rebuilt the incomplete dependency tree with `npm.cmd ci` using the existing workspace lockfile. | Ignored `afrinov-platform/node_modules`; lockfile unchanged. | Dependencies resolved; subsequent scripts launched. | Replaced the ignored local dependency directory, which was already incomplete. |
| P0 | Recorded npm 11 allow-list entries for Prisma client/engines/CLI and esbuild setup scripts. | `afrinov-platform/package.json` only. | Prisma generation, typecheck, build and tests pass after engine download. | These packages execute expected install setup scripts; keep the approval list narrow. |
| P0 | Reproduced current Tailwind behavior and left v3/PostCSS configuration intact. | No CSS/config change. | Normal and demo frontend builds pass. | A future Tailwind upgrade must handle the major-version migration deliberately. |
| P0/P1 | Re-ran static checks, tests, and both production frontend build modes. | Generated output is ignored. | See verification report. | Live database behavior remains outside the local gate. |

## Remaining stages

### P0 — Make local install and command entry points repeatable

1. Run `npm.cmd ci` from `afrinov-platform/` on the standard developer machine and CI to confirm npm's install-script policy honors the recorded `allowScripts` entries. Keep `afrinov-platform/package-lock.json` authoritative; do not run install commands at repository root.
2. Add a short PowerShell-specific onboarding note that uses `npm.cmd`, or let developers choose a local policy for `npm.ps1`. No machine execution-policy change is required for project correctness.
3. Decide whether the root `package-lock.json` without a root manifest is intentionally retained. Do not delete it as part of this recovery.

### P1 — Demonstrate application execution

1. Developer creates `afrinov-platform/apps/backend/.env` from `.env.example` and generates a unique local JWT secret; do not commit the file or reuse the public placeholder in production.
2. Install/start PostgreSQL 16 (Docker is the documented local path), verify the database URL targets a disposable local database, generate Prisma client, apply local migrations, and seed only after confirming the target database.
3. Start `npm run dev:backend` and `npm run dev:frontend` from the platform root in separate terminals. Verify `/health/ready`, login, and one critical inventory read/write workflow.
4. Run backend integration tests only against a disposable migrated test DB. This environment lacks Docker/DB and no integration tests or migrations were run here.

### P2 — Resolve engineering risks in focused changes

1. **Dependency advisories:** inspect minimal updates for the vulnerable Tailwind v3 transitive dependencies or test a planned v4 migration on a separate change. Require CSS visual regression checks, clean install, typecheck, tests, and both builds. Do not use the current `npm audit fix --force` suggestion blindly.
2. **Vite peer compatibility:** align Vite and `@vitejs/plugin-react` to a supported pair. The current Vite 8 + React plugin 4 pairing works in tested dev/build paths but violates the plugin's declared Vite peer range.
3. Run CI with the supported Node runtime and align backend CI/Docker from the documented Node 20 runtime. Inspect latest CI results after the change.
4. Add/enable an explicit E2E script and CI job if browser coverage is a required gate; the current repository contains one Playwright test but does not wire it into package scripts/CI.

### P3 — Production readiness assessment

Use the existing technical-debt register as source of truth. Before production approval, prioritize schema/migration parity and `inventory_balances` foreign keys (TD-005), database-level ledger/audit immutability (TD-006), complete transactional audit coverage (TD-008), access policy for authenticated reads and unit costs (TD-014), remove the hard-coded E2E credential and make its setup deterministic (TD-017), and review missing idempotency/unbounded lists (TD-019). Add verified ownership and acceptance criteria in that existing register rather than duplicating product work here.

## Acceptance gates

| Gate | Current result | Remaining evidence |
|---|---|---|
| A — Repository integrity | PASS for workspace install and tracked diff; pre-existing untracked audit notes preserved | Resolve root lockfile ambiguity; verify clean install in CI |
| B — Development environment | PARTIAL: frontend-only starts; backend `.env`/PostgreSQL unavailable; root generic `dev` intentionally absent | Start backend and API/frontend integration with local DB |
| C — Static validation | PASS: typecheck and lint | None for current checks |
| D — Application behavior | PARTIAL: unit tests pass; no browser/live API/database session | Verify critical live API workflows and browser routes |
| E — Automated testing | PASS for unit suites (934 tests); BLOCKED for DB integration and Playwright E2E | Run integration with disposable DB; wire/run E2E as appropriate |
| F — Production build | PASS for both workspace builds and frontend-only build | Re-run after dependency compatibility/advisory work |
| G — Production readiness | NOT PASSED / NOT CLAIMED | Close/accept security, data integrity, operational, deployment, and observability risks |
