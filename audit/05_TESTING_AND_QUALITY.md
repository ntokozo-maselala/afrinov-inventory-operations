# 05 — Testing and quality

## Verification matrix

Checks below ran on 2026-10-26 against application code at HEAD 607a642. The only later commit before report generation, c4a0504, deleted an unrelated Word document; application code and lockfiles are unchanged.

| Check | Execution method | Result | Limitations |
|---|---|---|---|
| Backend unit tests | From apps/backend: vitest.cmd run with NODE_ENV=test and an explicit dummy localhost DATABASE_URL | Exit 0; 57 test files, 819 tests passed | Unit suite uses mocks/fakes for most database cases; does not verify PostgreSQL concurrency |
| Frontend unit tests | From apps/frontend: vitest.cmd run | Exit 0; 76 files, 799 tests passed | Vitest reported 76 jsdom environment creations and approximately 201 seconds tracked time |
| Backend lint | npm.cmd run lint --workspace=@afrinov/backend from afrinov-platform | Exit 0 | Static lint only |
| Frontend lint | npm.cmd run lint --workspace=@afrinov/frontend from afrinov-platform | Exit 0 | Static lint only |
| Frontend typecheck | npm.cmd run typecheck --workspace=@afrinov/frontend | Exit 0 | Does not validate backend/database behavior |
| Backend package typecheck | npm.cmd run typecheck --workspace=@afrinov/backend | Failed before tsc: pretypecheck Prisma generate hit EPERM replacing query_engine-windows.dll.node | Windows generated-client file lock/permission error; no claim that the package command passed |
| Backend tools compile fallback | tsc.cmd -p tsconfig.tools.json --noEmit from apps/backend | Exit 0 | Bypasses the package pretypecheck Prisma generation step |
| Backend production compile | tsc.cmd -p tsconfig.build.json from apps/backend | Exit 0 | Not a Docker image build |
| Frontend production build | npm.cmd run build --workspace=@afrinov/frontend | Exit 0; 361 modules transformed | Build emitted warnings listed below |
| Dependency audit | npm audit --json from workspace lockfile; repeated with --omit=dev | Exit 1; full: 4 moderate, 3 high; prod-only: 1 moderate, 2 high | Registry access required an approved elevated retry; report contains package/advisory summaries, no npm logs or secret values |
| NODE_ENV probe | Focused local loadConfig probe with dummy DB URL and public test fixture | Reproduced acceptance of NODE_ENV=prod and bypass of exact-production placeholder rejection | No DB or server was started; probe is a configuration function check |
| Backend PostgreSQL integration | Not run | Not executed | Integration suite creates persistent rows. Although config guards target a separate localhost _test DB, its current state was not established and no Compose test DB was started |
| Browser E2E | Not run | Not executed | Browser suite uses .env.test and a backend/database; service state was not established |
| Coverage | Not run | No percentage claimed | No coverage output was generated during this audit |
| Docker build / migration rehearsal | Not run | Not executed | Requires image build and/or database effects; production deployment target is unknown |

The first in-sandbox Vitest attempt could not initialize esbuild because the sandbox denied access to a parent directory. It was retried with approved elevation and completed. This failure and retry are not counted as a test failure.

## Reproduction commands and environment

Working directories and command lines for the checks that completed:

| Working directory | Command | Environment/notes |
|---|---|---|
| afrinov-platform/apps/backend | vitest.cmd run | NODE_ENV=test; dummy DATABASE_URL targets localhost:5432/audit_test; no DB connection |
| afrinov-platform/apps/frontend | vitest.cmd run | Unit suite only |
| afrinov-platform | npm.cmd run lint --workspace=@afrinov/backend | Backend source/integration/scripts lint |
| afrinov-platform | npm.cmd run lint --workspace=@afrinov/frontend | Frontend source/E2E/config lint |
| afrinov-platform | npm.cmd run typecheck --workspace=@afrinov/frontend | Passed |
| afrinov-platform | npm.cmd run typecheck --workspace=@afrinov/backend | Prisma generate pre-hook failed with EPERM |
| afrinov-platform/apps/backend | tsc.cmd -p tsconfig.tools.json --noEmit | Passed |
| afrinov-platform/apps/backend | tsc.cmd -p tsconfig.build.json | Passed |
| afrinov-platform | npm.cmd run build --workspace=@afrinov/frontend | Passed |
| afrinov-platform | npm audit --json; npm audit --omit=dev --json | Registry access was retried with approved elevation; both returned findings (exit 1) |

The one-off config probe was not captured as a reusable shell command; its inspected function, safe dummy inputs and output are described above. No command that could mutate the real database is represented as executed.

## Build warnings

Frontend production build passed but emitted:

- Vite config uses an extensionless import of src/config/buildGuard, which triggers a native config loader compatibility warning.
- The React Babel plugin warns that esbuild optimizeDeps configuration is deprecated.
- Bundling reports direct eval usage in exceljs.min.js.
- The minified ExcelJS chunk is approximately 1,056 KB and jsPDF approximately 400 KB; Vite reports a large chunk warning. Pages are lazy-loaded, so this is a bundle maintenance/performance signal, not proof that the full chunk is on initial load.

## Test coverage and regression gaps

- Unit suites cover many authentication, validation, domain and report behaviors.
- Backend CI defines an isolated PostgreSQL integration job that starts PostgreSQL 16, applies migrations and runs the integration suite. This workflow was inspected, not executed locally.
- Frontend CI defines typecheck, lint, unit tests and build.
- CodeQL workflow is present. No run result or repository security alert state was queried.
- No coverage configuration/output was found or produced.
- Frontend E2E inventory includes a login spec; E2E was not run.
- No concurrent PostgreSQL regression test was found for issue/transfer/negative adjustment, returns, or two concurrent posts of one submitted goods receipt.
- Existing sequential duplicate goods receipt coverage does not exercise the race.
- No verified restore test, deployment smoke test or migration rehearsal evidence was available.

## Commands with side effects withheld

Integration/E2E tests, migrations, seeds, database reset/setup, imports, Compose up/down, Docker build and deployment were not run. Their scripts can create persistent rows, alter schemas/data or start services. No command targeted the real .env database.

## Phase 5 exit

Safe unit/static/build checks were run and exact pass/failure states were retained. Database integration, E2E, coverage and deployment verification remain incomplete. Phase 5 exit criteria are met for a repository audit, not for release certification.
