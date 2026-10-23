# Verification and test strategy

## Test layers present

| Layer | Location / runner | What it exercises | Isolation / limits |
| --- | --- | --- | --- |
| Unit and service tests | `src/**/*.test.ts`, Vitest | Decimal/date/permissions/config/errors, services, business rules, route contracts, OpenAPI coverage, migration and seed source checks | DB access is mocked or replaced with fakes; does not prove live PostgreSQL behavior. |
| Fastify in-process smoke tests | `src/server*.test.ts`, Vitest `app.inject()` | Route registration, health, auth failures, error shape and conditional routes | No socket or real DB for the mocked paths. |
| Security regressions | `src/security.regression.test.ts` | Known-placeholder rejection, rate limiting, CORS behavior, auth state, error responses and source guardrails | Tests a defined list of cases; it does not check weak-secret entropy or arbitrary `NODE_ENV` validation. |
| Real-HTTP integration | `integration/**/*.test.ts`, separate Vitest config | Starts Fastify on `127.0.0.1`/ephemeral port and exercises auth, inventory, procurement, reports and related flows against Postgres | Writes rows and leaves them behind; requires migrated/seeded DB. Local config reads `.env`; no production-target guard. |
| Static schema/migration regression | `src/db/migrations.test.ts` | Checks required DDL strings/tables/enums/FKs/indexes exist in migration SQL | Does not apply migrations. CI applies them to Postgres separately. |
| Type checking | `tsc -p tsconfig.tools.json` | Type-checks tools, source and test TypeScript | Not a runtime correctness check. |
| Lint | ESLint | Source, scripts, integration tests | No behavioral validation. |
| Build | `tsc -p tsconfig.build.json` after Prisma generation | Emits compiled backend excluding `*.test.ts` | Does not test Docker image or migrations. |

Unit Vitest config sets a dummy `DATABASE_URL` if it is absent and selects
`src/**/*.test.ts`. Integration config has a custom `.env` loader, sets
`NODE_ENV=development`, and runs only `integration/**/*.test.ts`. The checked-in
`.env.test.example` is not loaded by that config. CI uses a throwaway Postgres
16 service, applies migrations and seed, and then runs integration.

## Commands and observed results

Executed on 2026-10-23 in `afrinov-platform/apps/backend` with Node 24.21.0,
npm 11.19.0, a dummy `DATABASE_URL` targeting a local port with no database,
and no local `.env` file. In PowerShell, `npm.ps1` was blocked by execution
policy, so the same npm commands were invoked with `npm.cmd`.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm.cmd run typecheck` | 0 | Prisma Client generated; `tsc -p tsconfig.tools.json` passed. |
| `npm.cmd run lint` | 0 | ESLint completed without errors or warnings in output. |
| `npm.cmd test` | 0 | 57 test files passed; 823 tests passed. Vitest emitted request logs from route tests, including expected error branches. |
| `npm.cmd run build` | 0 | Prisma Client generated; `tsc -p tsconfig.build.json` passed. |
| Compiled runtime probe (`node dist/index.js`, dummy unreachable DB) | Started and served | `/health` returned 200; `/health/ready` returned 503. The listener was stopped after the probe with SIGINT. This confirms the documented liveness/readiness distinction only, not a successful DB connection. |
| Config behavior reproduction against compiled `config.js` | Completed | `NODE_ENV=staging` accepted a known placeholder; production accepted a one-character JWT secret; production `CORS_ALLOW_ANY=true` resolved to any-origin. No secret was printed. |

The build/typecheck/lint/test commands run Prisma code generation as a package
pre-script. They did not connect to PostgreSQL. No migration or data-writing
script was run.

## Not run and why

- `npm run test:integration` was not run. It loads the real `.env` target,
  writes persistent records, and the config has no database-name safety
  assertion. Docker is not installed in this environment and there is no
  local `.env`; therefore no disposable PostgreSQL service was available.
- Docker image build/Compose startup was not run because the Docker CLI is
  unavailable. Static inspection shows the build stage does not copy `src/`
  or `prisma/` before `npm run build` invokes Prisma generation and TypeScript.
- No Node 20 runtime was available. The CI workflow selects Node 20 while the
  installed Vitest 5 package declares Node `^22.12.0 || ^24.0.0 || >=26.0.0`.
  CI execution on Node 20 remains unverified and should be corrected before
  relying on those checks.
- No real database, production configuration, deployed service, backup, or
  restore path was tested.

## CI and interpretation

`.github/workflows/backend-ci.yml` defines two jobs:

1. A check job runs `npm ci`, Prisma generation, typecheck, lint, unit tests,
   and build on Node 20.
2. An integration job starts PostgreSQL 16, uses generated secrets and a
   disposable DB URL, generates Prisma, migrates, seeds, and runs real-HTTP
   tests, also on Node 20.

This audit confirmed the workflow file and commands by inspection, not by
observing a GitHub Actions run. Branch protection and deployment promotion are
unknown. A passing local typecheck or unit suite cannot establish database,
image, TLS, or production correctness.

## Safe developer procedure

- For local unit checks, use the documented Node 22+ toolchain and `npm test`;
  no PostgreSQL is required for the unit suite.
- For integration checks, provision a disposable Postgres database, explicitly
  set `DATABASE_URL` to that database and `SEED_ADMIN_PASSWORD`, then migrate
  and seed that same target. Confirm the target before every write step. Use a
  fresh DB rather than relying on old test rows.
- Do not run the integration suite against a production database. Its tests
  persist rows by design.
- Review `npm run db:migrate`, seed, imports and rotation scripts separately;
  these are stateful operations, not ordinary verification commands.
