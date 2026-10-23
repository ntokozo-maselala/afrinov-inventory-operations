# Verification and test strategy

## Test layers and isolation

| Layer | Location / runner | Coverage | Isolation and limits |
| --- | --- | --- | --- |
| Backend unit and service tests | `apps/backend/src/**/*.test.ts`, Vitest | Config, services, business rules, route contracts, authorization, error shape, migration/seed source checks | Unit paths use mocks/fakes; no live PostgreSQL proof. |
| Backend HTTP contract tests | Fastify `app.inject()` in route/server tests | Registered path/method, login response contract, invalid/expired/tampered JWT rejection, unsupported algorithms | In-process; database paths are mocked unless separately marked integration. |
| Backend integration tests | `apps/backend/integration/**/*.test.ts`, `vitest.integration.config.ts` | Real HTTP and PostgreSQL behavior | Writes persistent rows. Loads `.env.test` only and rejects non-local DB hosts or names without `_test`; requires an isolated migrated/seeded DB. |
| Browser E2E | `apps/frontend/e2e/`, Playwright | Real browser, Vite proxy, backend login and dashboard/rejection behavior | Uses the same isolated `.env.test` URL, injected seed password, test-only runtime and local CORS origin. Requires running PostgreSQL and browser installation. |
| Static schema/migration regression | `apps/backend/src/db/migrations.test.ts` | Required migration SQL structures | Checks migration source; does not apply migrations. |
| Type checking and lint | TypeScript, ESLint | Backend tools/source/tests and frontend source/E2E/config | Static checks only. |
| Production builds | Backend TypeScript build and Vite frontend build | Emitted artifacts and production bundling | Does not prove container startup or live database behavior. |

### Isolated database workflow

The tracked `.env.test.example` is a safe template, not an active database
configuration. Copy it to the ignored `apps/backend/.env.test`; use a local
PostgreSQL database named with the `_test` suffix. A separate Compose profile
provides `afrinov_test` on loopback port 5433 with its own volume:

```powershell
cd afrinov-platform/apps/backend
# Set POSTGRES_TEST_PASSWORD and SEED_ADMIN_PASSWORD in the local process or
# ignored .env.test; do not commit them or print their values.
Copy-Item .env.test.example .env.test
docker compose --profile test up -d test-db
npm.cmd run db:test:migrate
npm.cmd run db:test:seed
npm.cmd run test:integration
```

`vitest.integration.config.ts` and the guarded migration/seed scripts read
only `.env.test` plus existing process variables. They force `NODE_ENV=test`
and require a local PostgreSQL URL whose database name ends in `_test`.
Integration tests persist rows; discard the isolated database through its
own lifecycle after use. Never point it at the ordinary `.env` database.

From `afrinov-platform/apps/frontend`, after the same test DB has been
migrated and seeded, run:

```powershell
npm.cmd exec playwright test
```

Playwright starts the actual backend and Vite frontend; the test admin
password is supplied with `SEED_ADMIN_PASSWORD`, not embedded in test code.

## Commands and observed results

Executed on 2026-10-23 with Node 24.21.0 and npm 11.19.0 unless stated.
PowerShell used `npm.cmd` because `npm.ps1` is blocked by execution policy.
The PostgreSQL and final Playwright runs used the local working tree based on
`aaff02e` on `main`; those auth/test changes were later committed as `d78c3ec`
(`fix(auth): harden test isolation and runtime config`) on
`fix/auth-environment-isolation`. The Dockerfile manifest fix was built later
that day and committed as `fdbdd1d`.

| Command/check | Result | Interpretation |
| --- | --- | --- |
| `$env:LOG_LEVEL='silent'; npx.cmd vitest run --silent --reporter=dot` in backend | Passed: 57 files, 813 tests. | Includes test-database URL guard and auth method/JWT regressions. Needed execution outside sandbox after esbuild could not access the workspace parent. |
| `npm.cmd run lint` in backend | Passed. | Linted `src`, `integration`, and `scripts`. |
| `npx.cmd tsc -p tsconfig.tools.json --noEmit` | Passed. | Type checked backend tool/source/test TS against existing generated Prisma client. |
| `npx.cmd tsc -p tsconfig.build.json --noEmit` | Passed. | Type checked backend build source. |
| Package typecheck/full backend build with Prisma generation | Later attempts failed with Windows `EPERM` renaming the locked `query_engine-windows.dll.node`. | Current-source TypeScript checks above passed; package lifecycle commands that regenerate Prisma were not verified after the file lock appeared. |
| Focused backend auth route test | Passed: 1 file, 15 tests. | Includes GET 404/POST contract and HS256-only, expired, and tampered token cases. |
| Focused test-database guard test: `npx.cmd vitest run src/shared/test-environment.test.ts --silent --reporter=dot` | Passed: 1 file, 6 tests. | Includes rejecting remote hosts, production-like DB names, malformed URLs, and URL host overrides without echoing the URL. |
| `npx.cmd vitest run --silent --reporter=dot` in frontend | Passed: 76 files, 799 tests. | Unit suite excludes Playwright E2E. |
| `npm.cmd run lint` in frontend | Passed. | Includes `src`, `e2e`, and Playwright config. |
| `npm.cmd run typecheck` in frontend | Passed. | Includes E2E and Playwright config TS. |
| `npm.cmd run build` in frontend | Passed. | Vite 8.2.4 build completed; emitted config-loader/esbuild deprecation, ExcelJS direct-eval, and >500 kB chunk warnings. |
| `npx.cmd playwright test --list` with synthetic local `_test` URL and fixture password | Passed: found 2 tests in 1 file. | Discovery only; did not start browser, backend, frontend, or database. |
| `docker compose --profile test config --quiet` with only `POSTGRES_TEST_PASSWORD` set | Passed. | Confirms the dedicated test credential satisfies Compose interpolation. Compose emits a nonfatal warning for the inactive backend service's `DATABASE_URL`, which references unset `POSTGRES_PASSWORD`. |
| Same Compose check with both password variables unset | Failed with the required-password error. | Confirms Compose still fails closed when neither credential is supplied. |
| `npx.cmd prisma validate --schema prisma/schema.prisma` | Passed. | Schema is syntactically valid; no applied migration state was queried. |
| `npm.cmd ci` from `afrinov-platform/` | Failed twice with Windows `EPERM` unlink errors on locked native Rolldown/Rollup files. | No lockfile change. Recovery `npm.cmd install --no-audit --no-fund` exited 0 but warned about cleanup; this does not count as a clean lockfile install. |
| `npm audit --audit-level=moderate` | Exit 1: 7 findings (2 moderate, 5 high), in transitive `braces` and `postcss-selector-parser` dependency paths. | npm suggested `npm audit fix --force`, which upgrades Tailwind CSS across a major version. No forced upgrade was applied. |
| `npm.cmd run db:test:migrate` without `.env.test` | Did not reach test guard: Node `tsx` failed in `os.userInfo()` with `uv_os_get_passwd` / `ENOMEM`. | No Prisma command, DB connection, or write occurred. URL rejection cases ran within the backend unit suite. |
| `npm.cmd run db:test:migrate` in backend, with `.env.test` | Passed: connected to `afrinov_test` on `localhost:5433`; no pending migrations. | Later successful run; supersedes the earlier attempt without `.env.test`. |
| `npm.cmd run db:test:seed` in backend | Passed: created `admin@afrinov.local`; `Seed complete.` | `SEED_ADMIN_PASSWORD` was supplied through the PowerShell process environment and was not logged. |
| `npm.cmd run test:integration` in backend | Passed: 15 files, 99 tests. | Real HTTP and PostgreSQL integration suite. |
| `npm.cmd exec -- playwright test` in frontend | Passed: 2 tests. | Final rerun passed authenticated and invalid-credential login flows after correcting the URL assertion matcher. |
| `docker compose build backend` in backend | Passed: `backend-backend:latest` built; `npm ci`, Prisma generation, and backend TypeScript build completed. | Used a temporary Compose interpolation value; no DB service was started. Prisma warned that it could not detect OpenSSL and defaulted to `openssl-1.1.x`; container runtime was not exercised. |

The `npm ci` failure is specific to this Windows workspace's locked files; it
does not establish a general lockfile defect. Resolve local process/file locks
and retry the documented clean install on a clean environment. Do not delete
the workspace or change the lockfile to work around the observed failure.

## Not run and why

- **Container startup and runtime database smoke test:** the image built, but
  it was not launched as a container. Prisma emitted an OpenSSL detection
  warning during build, so runtime engine compatibility remains unverified.
- **GitHub Actions:** workflow changes were inspected, but no remote CI run or
  branch-protection state was available.
- **Production auth/database validation:** deployed artifact, active
  configuration, request source, production account state, migration state,
  and sanitized logs for `req-2m` were not supplied. No root cause can be
  closed from local tests.

## CI and interpretation

`.github/workflows/backend-ci.yml` now selects Node 24 for both backend jobs,
installs from the workspace root lockfile, and uses an ephemeral PostgreSQL
16 service for integration. It creates throwaway JWT and seed passwords for
the job. This was verified by workflow inspection, not a GitHub Actions run.

The frontend production build and passing unit tests do not establish a live
login, production token compatibility, database migration state, image
startup, TLS, or deployment correctness. A passing test on one machine is not
cross-environment proof.

## Safe validation checklist

- For local unit checks, use Node 24, install with the workspace lockfile,
  then run backend lint/typecheck/tests/build and frontend lint/typecheck/tests/build.
- Before integration writes, confirm the separate local DB is named `_test`,
  run guarded `db:test:migrate` and `db:test:seed`, then run the integration
  suite. Never use `.env` or a production database.
- Run Playwright only after the same isolated DB is migrated and seeded.
- Review migration, seed, import, and password-rotation scripts as stateful
  operations. Do not treat them as ordinary read-only verification.
- Record failed or unavailable checks accurately. Do not claim integration,
  E2E, container, or production validation passed unless it actually ran.
