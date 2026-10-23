# Backend system inventory

**Evidence date:** 2026-10-23. This inventory describes the code in
[`afrinov-platform/apps/backend`](../../../afrinov-platform/apps/backend/).

## Boundary and runtime

| Item | Actual implementation |
| --- | --- |
| Repository / package root | Monorepo `afrinov-platform/`; npm workspace package `@afrinov/backend` at `apps/backend/` |
| Language / module format | TypeScript 5, strict compiler options, emitted JavaScript, Node ESM (`"type": "module"`) |
| Runtime | Node.js 24 in backend CI and Docker; local tooling requires Node 22.12 or later. |
| HTTP framework | Fastify 5 with CORS, Helmet, JWT, rate-limit, Swagger, Swagger UI |
| Persistence | PostgreSQL 16 through Prisma ORM / Prisma Client 5 |
| Validation | Zod at route boundaries; shared domain checks in services |
| Entry point | `src/index.ts`; compiled process entry `dist/index.js` |
| Package metadata entry | `main` is `dist/server.js`; npm's `start` script explicitly starts `dist/index.js` |
| Listener | Fastify `app.listen`, default `0.0.0.0:4000`; host and port are configurable |
| Workspace lockfile | `afrinov-platform/package-lock.json`; no backend-local lockfile is used by the documented workspace install |

See [runtime lifecycle](../operations/runtime-lifecycle.md) for exact
initialization order and [configuration](../configuration/environment-configuration.md)
for environment behavior.

## Source tree and ownership

| Path | Responsibility and dependencies |
| --- | --- |
| `src/index.ts` | Process entry. Installs fatal-error handlers, validates config, invokes `start()`; imports `server.ts` before its body executes. |
| `src/server.ts` | Builds Fastify, installs cross-cutting plugins/hooks/error handling, mounts routes, probes PostgreSQL, listens, and handles signals. Imports shared config and the singleton Prisma client. |
| `src/shared/config.ts` | Reads and validates core process configuration; resolves CORS, procurement, and API-doc flags. |
| `src/shared/db.ts` | Creates the process-wide `PrismaClient`; caches it on `globalThis` outside production to avoid duplicate clients during watch reloads. |
| `src/shared/authorization.ts`, `permissions.ts` | Loads the current user's active state and permission set from PostgreSQL; maps role permission codes. |
| `src/shared/errors.ts` | `ApiError` types and constructors, translated by the central Fastify error handler. |
| `src/shared/events.ts` | Synchronous in-process event dispatcher. No production handler registration was found, so emitted domain events currently have no configured external or asynchronous consumer. |
| `src/shared/inventory/` | Decimal, balance, stock-status, and tool-loan helpers shared by feature services. |
| `src/modules/identity/` | Login, user administration, account/role management; uses bcrypt, JWT at the server, Prisma, and shared authorization. |
| `src/modules/inventory/` | Materials, locations, stock items, tool loans, counts, receipts, returns, transfers, adjustment, ledger history and export. Services use Prisma directly. |
| `src/modules/procurement/` | Suppliers, purchase orders, approvals, and goods receipts. Purchase-order and goods-receipt routes are conditional on `PROCUREMENT_ENABLED`; supplier routes are always mounted. |
| `src/modules/operations/` | Projects and issue recipients. |
| `src/modules/reporting/` | Stock and movement reports, consumption and month-end calculations, CSV/XLSX/PDF-oriented exports. Uses data from Prisma and inventory helpers. |
| `src/modules/settings/` | Typed key/value settings and a process-local cache. |
| `src/modules/audit/` | Audit-log and activity reads; audit records are written by feature services. |
| `src/modules/health/` | API-prefixed liveness/readiness endpoints; root equivalents live in `server.ts`. |
| `src/modules/migration/` | Workbook parsing, reconciliation, and opening-balance/import helpers. These are not registered as HTTP routes; executable import utilities live in `scripts/`. |
| `src/db/migrate.ts`, `seed.ts` | Prisma migration wrapper and demo-data/bootstrap seed. |
| `src/openapi/document.ts` | Static OpenAPI document assembled from route schemas/operations and conditionally served by Swagger plugins. |
| `scripts/` | Admin password rotation, diagnostics, workbook/supplier imports, and rack/location conversion. Several scripts write to the `DATABASE_URL` database. |
| `integration/` | Real-socket API tests against a real PostgreSQL database; rows are left behind and are isolated by random suffixes, not rolled back. |
| `prisma/schema.prisma`, `prisma/migrations/` | PostgreSQL schema definition and 23 ordered SQL migrations. |

The module folders organize a **modular monolith**, not separately deployable
services. There is no queue, scheduler, remote service client, blob store,
external authentication provider, or metrics/tracing client in this backend's
runtime dependency graph. Excel and PDF libraries produce files in-process.

## Package scripts

Run workspace commands from `afrinov-platform/`, or package commands from
`apps/backend/`. Workspace-level `build`, `lint`, `typecheck`, and `test` fan
out to packages that define the matching script.

| Script | Command / effect |
| --- | --- |
| `dev` | `tsx watch --env-file=.env src/index.ts`; local watch process loads the backend `.env` file. |
| `build` | `prebuild` runs Prisma Client generation, then TypeScript emits production files using `tsconfig.build.json`. |
| `start` | `node dist/index.js`; no Node `--env-file` flag, so environment must already be injected/exported. |
| `db:generate` | `prisma generate --schema prisma/schema.prisma`; code generation only. |
| `db:migrate` | `tsx src/db/migrate.ts`; the script delegates to `npx prisma migrate deploy` against `DATABASE_URL`. |
| `db:seed` | `tsx src/db/seed.ts`; bootstraps roles/admin and demo catalog/transactions. |
| `typecheck` | `pretypecheck` generates Prisma Client; `tsc -p tsconfig.tools.json` includes source, tests, integration, and scripts. |
| `lint` | ESLint on `src`, `integration`, and `scripts`. |
| `test` | `pretest` generates Prisma Client; Vitest discovers `src/**/*.test.ts` only. |
| `test:integration` | `pretest:integration` generates Prisma Client; Vitest uses integration config and a real DB. It reads `.env.test` only, requires local host plus `_test` database suffix, sets `NODE_ENV=test`, and leaves persisted test rows in that isolated DB. |
| `db:test:migrate`, `db:test:seed` | Guarded test-only migration and seed wrappers; refuse remote or non-`_test` URLs. |
| `test:watch` | Vitest interactive/watch mode for unit tests. |
| `db:rotate-admin`, `import:*`, `racks:to-locations` | Database-mutating operator scripts; verify target and inspect each script before use. |
| `diag:*` | Read-oriented login/admin diagnostics that refuse `NODE_ENV=production`; require configured credentials/database. |

The exact command list is in [`package.json`](../../../afrinov-platform/apps/backend/package.json)
and the workspace manifest in
[`afrinov-platform/package.json`](../../../afrinov-platform/package.json).

## Dependencies and infrastructure

Runtime dependencies include Fastify 5, Prisma/Prisma Client 5, Zod, bcryptjs,
Fastify JWT/CORS/Helmet/rate-limit/Swagger plugins, ExcelJS, and PDFKit.
Development dependencies include TypeScript, tsx, ESLint, Vitest 5, and
`pino-pretty`. Versions are ranges in the package manifest and resolved in the
workspace lockfile.

Infrastructure files found:

- [`Dockerfile`](../../../afrinov-platform/apps/backend/Dockerfile): Node 24
  multi-stage image, workspace lockfile install, source/schema copied before
  build, production dependency prune, non-root runtime user, and
  `node dist/index.js`. Root `.dockerignore` excludes local environment files.
  Docker execution was unavailable, so build/startup remain unverified.
- [`docker-compose.yml`](../../../afrinov-platform/apps/backend/docker-compose.yml):
  PostgreSQL 16 with a named volume and `pg_isready` health check; backend waits
  for healthy DB, then runs `prisma migrate deploy`, compiled demo seed, and API.
  It requires injected DB/JWT settings and defaults `NODE_ENV` to production.
- [`.github/workflows/backend-ci.yml`](../../../.github/workflows/backend-ci.yml):
  typecheck, lint, unit tests, build, and a separate real-Postgres integration
  job. Both jobs select Node 24. The workflow was inspected but no remote run
  was available.
- No backend deployment workflow, Kubernetes/IaC files, or backup job was
  found in the inspected repository.

## Existing documentation

The backend README is a useful onboarding guide, but its runtime and Docker
claims have not all been verified here. Product/domain intent and ADRs are in
`afrinov-docs/docs/`; older point-in-time backend and system audits are under
`docs/audits/` and `docs/archive/`. The docs index under `docs/` now links this
current backend reference. This audit does not replace those domain specs.
