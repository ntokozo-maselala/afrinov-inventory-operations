# Backend understanding and readiness audit

**Audit date:** 2026-10-23  
**Scope:** Source-based audit of `afrinov-platform/apps/backend`, its workspace,
CI workflow, container recipe, database schema/migrations, tests, and current
documentation. The findings and verification below began as a pre-change
baseline. The current follow-up status is recorded here because several source
findings were corrected after that baseline; historical descriptions are not
the current configuration where this section says otherwise.

## Follow-up status after authentication reliability work

| Baseline finding | Current source status | Remaining verification |
| --- | --- | --- |
| BKA-03/04: Docker build order and dependency pruning | Corrected: Node 24 multi-stage build installs from the workspace lockfile, copies source/schema before build, and prunes at the workspace root. Root `.dockerignore` excludes local `.env*` and build artifacts. | Docker engine was unavailable; image build/startup remains unverified. |
| BKA-05: backend CI used unsupported Node 20 | Corrected: both backend jobs select Node 24. | Workflow was inspected but no GitHub Actions run was available. |
| BKA-06: integration tests loaded `.env` without a target guard | Corrected: integration and E2E use `.env.test` only and require a local `_test` DB; guarded migrate/seed commands and a separate Compose test DB were added. | URL-guard unit tests pass, but no isolated Postgres integration cycle ran. |
| Authentication algorithm was implicit | Corrected: application signs and verifies HS256 explicitly; regressions reject unsupported/expired/tampered tokens. | Tokens in an actual deployment were not inspected; confirm they are HS256 before rollout. This is independent of the reported login 401. |
| Reported authentication incident | The current source explains the POST-only GET 404 and possible POST 401 branches. No login lookup/password behavior was changed. | Production root cause remains unresolved pending deployed revision, sanitized request logs, caller evidence, and authoritative account/database state. See [incident report](../security/authentication-incident-report.md). |

Current local verification on Node 24.21.0: backend 813 tests across 57 files;
frontend 799 tests across 76 files; backend/frontend lint and typechecks pass;
frontend production build passes with warnings. `npm ci` could not complete on
this Windows workspace because native files were locked (`EPERM`); the
recovery install did not change the lockfile. Integration, E2E, Docker image,
and CI execution remain unverified. Full results are in the
[verification strategy](../testing/verification-and-test-strategy.md).

## Executive summary

The backend is a single Node.js/Fastify 5 TypeScript modular monolith. Feature
route modules call services and shared helpers; most services access
PostgreSQL directly through a singleton Prisma 5 client. The system owns local
identity, role-based permissions, inventory ledger and balances, suppliers and
procurement, projects/recipients, reports/exports, settings, audit records,
and health checks. It has no discovered external identity provider, queue,
background worker, scheduler, or other remote backend integration.

`src/index.ts` validates required configuration and starts the Fastify
application in `src/server.ts`. The server installs CORS, Helmet, JWT,
rate-limiting, Pino request logging, error translation, health checks, and
feature routes. It probes PostgreSQL without blocking startup. `/health` is
liveness; `/health/ready` is the database readiness check. SIGINT/SIGTERM
close Fastify and Prisma.

PostgreSQL is the durable store. Inventory movements are signed decimal rows
in `inventory_transactions`; `inventory_balances` is recomputed from the
ledger inside mutation transactions. The no-negative-stock rule is enforced
in application logic, not by a database check constraint. Concurrency safety
for two simultaneous deductions was not verified.

In the original baseline pass, local checks passed on Node 24.21.0 and the
unit suite reported 823 tests in 57 files. That count predates the follow-up
authentication and test-isolation regressions; the current suite has 813 tests
in 57 files. Integration and Docker were not run in either pass. Current test
target protections are summarized above.

Production readiness is **not established**. Docker build order and CI Node
version findings were corrected in source but have not been executed in an
image or remote workflow. Production JWT
configuration accepts short secrets, arbitrary `NODE_ENV` values can bypass
production-only checks, and CORS allows any origin when explicitly enabled in
any environment. There is no repository-backed deploy/release process,
external secret manager, backup/restore plan, or metrics/alerting setup.

## Architecture and runtime brief

1. **Entry:** npm `dev` runs `tsx watch --env-file=.env src/index.ts`;
   `start` runs `node dist/index.js` and expects injected environment values.
2. **Initialization:** `index.ts` registers fatal handlers and validates
   config; `server.ts` builds Fastify, registers plugins and routes, runs a
   best-effort DB probe, installs signal handlers, and binds `HOST:PORT`.
3. **Request path:** request ID/logging and rate limits apply globally. Public
   health/login routes are unauthenticated. Protected routes verify bearer
   JWT and current active-account state. Route permissions are loaded from DB
   where required; Zod and service rules validate inputs; Prisma queries or
   transactions access PostgreSQL; a central handler formats errors.
4. **Environment:** development loads `.env`; unit tests use mocks and a dummy
   URL fallback; integration/E2E now read `.env.test` and require a local
   `_test` DB; CI provisions an ephemeral PostgreSQL 16 service; Compose
   injects runtime values, applies migrations and runs demo seed. There is no
   staging-specific model.
5. **Principal dependencies:** Node.js, Fastify, Prisma, PostgreSQL, bcrypt,
   Zod, Pino, ExcelJS and PDFKit. No runtime queue or remote service client was
   found.

The authoritative details are in the [system inventory](../architecture/system-inventory.md),
[architecture](../architecture/backend-architecture.md),
[runtime lifecycle](../operations/runtime-lifecycle.md), and
[configuration matrix](../configuration/environment-configuration.md).

## Prioritized findings register

The BKA findings below preserve the original pre-change evidence and
recommended changes. For current status of BKA-03 through BKA-06, use the
follow-up table above; do not treat their baseline descriptions as the current
source state.

Severity uses the requested Critical/High/Medium/Low scale. Confidence
distinguishes direct runtime reproduction from static inference. Remediation
was not applied because this task is an audit and understanding exercise;
implementation requires a separate authorized change.

### BKA-01 — Production accepts very short JWT secrets

- **Affected component:** `src/shared/config.ts` / startup configuration.
- **Evidence:** `loadConfig()` rejects empty and exact known placeholder
  strings in production but contains no minimum length or strength rule. A
  compiled config reproduction accepted a one-character value with
  `NODE_ENV=production` and a non-empty DB URL.
- **Current behavior:** a guessable signing key can pass boot validation.
- **Expected behavior:** production rejects keys that do not meet an explicit
  strength policy and receives the key from a managed secret source.
- **Impact:** if a weak key is deployed, token forgery can undermine
  authentication. Permission enforcement still reads the subject's DB roles,
  but forged tokens for a known active subject remain a risk.
- **Severity / rationale:** **Medium** — direct authentication risk depends on
  an operator supplying a weak value; the code does not prevent it.
- **Confidence:** **High** — source inspection and direct reproduction.
- **Reproduction:** run the compiled `loadConfig()` with production mode and a
  one-character JWT value; it returns config rather than throwing.
- **Recommended remediation:** define and enforce an explicit key strength
  policy; use a secret manager and a rotation procedure. Add tests for weak
  and strong keys.
- **Dependencies / risks:** coordinate with existing deployments because key
  rotation invalidates outstanding tokens.
- **Approval required:** **Yes** — application/security behavior change is
  outside the audit-only scope.

### BKA-02 — Unrecognized `NODE_ENV` values bypass production checks

- **Affected component:** `src/shared/config.ts`, `server.ts`, seed behavior.
- **Evidence:** `loadConfig()` casts the raw value to a TypeScript union without
  runtime validation. Production-only secret rejection checks exact equality
  with `production`; API docs default to enabled unless exact production.
  A direct reproduction accepted `NODE_ENV=staging` with a known placeholder.
- **Current behavior:** arbitrary values such as `staging` start; they do not
  receive all exact-production behavior.
- **Expected behavior:** reject unsupported values or explicitly define and
  enforce staging policy.
- **Impact:** environment-name typos can silently weaken config policy and
  enable API docs by default.
- **Severity / rationale:** **Medium** — requires an unsupported mode value,
  but common staging labels can trigger the gap.
- **Confidence:** **High** — code inspection and direct reproduction.
- **Reproduction:** call compiled `loadConfig()` with a dummy non-empty DB URL,
  `NODE_ENV=staging`, and a known placeholder; no error is thrown.
- **Recommended remediation:** validate against an explicit runtime enum and
  decide whether staging follows production security defaults. Add regression
  tests for arbitrary strings.
- **Dependencies / risks:** inventory deployment environment names first.
- **Approval required:** **Yes** — application configuration behavior change.

### BKA-03 — Docker build stage omits application source and Prisma schema

- **Affected component:** `apps/backend/Dockerfile` build stage.
- **Evidence:** it copies root `package.json`/lockfile and
  `apps/backend/package.json`, installs packages, then runs `npm run build`;
  no `COPY` brings in `apps/backend/src/` or `apps/backend/prisma/` before
  that command. The package's `prebuild` invokes Prisma generation with
  `prisma/schema.prisma`, and TypeScript needs `src/`.
- **Current behavior:** the declared Docker image build has no schema/source
  available at the point it invokes build.
- **Expected behavior:** image build copies required source, schema, and
  migrations before Prisma generation and compilation.
- **Impact:** the documented Compose image path is likely unable to build and
  therefore is not a usable verified release artifact.
- **Severity / rationale:** **High** — blocks the repository's only container
  packaging path if the static sequence behaves as written.
- **Confidence:** **High static / execution unverified** — Docker was not
  installed; the missing `COPY` instructions are directly confirmed.
- **Reproduction:** inspect Dockerfile copy/build order; when Docker is
  available, run `docker compose build backend` from `apps/backend`.
- **Recommended remediation:** copy the exact source/schema/migration files
  into the build stage and validate the image in CI.
- **Dependencies / risks:** ensure build context remains the monorepo root and
  the final image contains generated Prisma client/migrations it needs.
- **Approval required:** **Yes** — Dockerfile/CI implementation change.

### BKA-04 — Runtime image prunes dependencies from `/app`, not backend package

- **Affected component:** second stage of `apps/backend/Dockerfile`.
- **Evidence:** runtime stage copies only `/app/apps/backend` from the build
  stage, sets `WORKDIR /app`, and executes `npm prune --omit=dev`. It does not
  copy a root `package.json` into this stage. The package manifest is nested at
  `/app/apps/backend/package.json`.
- **Current behavior:** prune is invoked outside the copied package root and
  cannot be relied on to remove backend dev dependencies; it may fail because
  the current directory has no package manifest.
- **Expected behavior:** production dependencies are pruned from the actual
  package root or copied from a production-only install stage.
- **Impact:** can independently prevent image completion or ship unintended
  dev tooling if the command happens to succeed.
- **Severity / rationale:** **High** — affects the only image packaging path.
- **Confidence:** **High static / execution unverified** — Docker not available.
- **Reproduction:** inspect final-stage `COPY`, `WORKDIR`, and `npm prune`; run
  a Docker build after BKA-03 is fixed.
- **Recommended remediation:** execute pruning at the backend package root or
  build a clean production dependency stage; verify final image contents.
- **Dependencies / risks:** coordinate with workspace install layout and
  Prisma runtime dependency.
- **Approval required:** **Yes** — Docker packaging change.

### BKA-05 — CI executes Vitest 5 on unsupported Node 20

- **Affected component:** `.github/workflows/backend-ci.yml` and Docker/runtime
  version policy.
- **Evidence:** both CI jobs select Node 20 and invoke `npm test` or
  `npm run test:integration`. The installed lockfile version is Vitest 5.0.0;
  its package declares Node `^22.12.0 || ^24.0.0 || >=26.0.0`. The backend
  README also says local development/test tools require Node 22+.
- **Current behavior:** CI runs tests on a runtime outside the declared engine
  range. This audit host had Node 24.21.0; no Node 20 execution was available.
- **Expected behavior:** every CI job uses a runtime supported by test tooling,
  or the tool versions are pinned to support Node 20.
- **Impact:** CI results may fail or be unsupported, reducing confidence in
  pull-request checks.
- **Severity / rationale:** **Medium** — a release gate is configured on an
  unsupported runtime; actual failure has not been observed.
- **Confidence:** **High for mismatch; Medium for runtime failure** — manifest,
  workflow, and package engine inspected; no Node 20 run.
- **Reproduction:** run CI's `npm test` under Node 20 or update setup-node and
  compare the job result.
- **Recommended remediation:** align CI and Docker/toolchain version policy,
  then execute every CI job on the selected version.
- **Dependencies / risks:** use the same supported major in CI and release
  image to avoid environment drift.
- **Approval required:** **Yes** — workflow/runtime change.

### BKA-06 — Local integration tests do not protect the database target

- **Affected component:** `vitest.integration.config.ts`, `integration/`.
- **Evidence:** config loads `.env` (not `.env.test`) and forces development
  mode. `integration/helpers.ts` documents that tests create unique rows and
  leave them behind. CI uses a throwaway PostgreSQL service; local runner has
  no database-name or production-mode guard.
- **Current behavior:** an integration run writes to whichever database is in
  `.env`/`DATABASE_URL`; default local `.env.example` and test example target
  different database names.
- **Expected behavior:** integration tests use an explicitly disposable test
  DB and refuse a production or unknown target.
- **Impact:** accidental writes can pollute a developer database or damage
  valuable data if an unsafe URL is supplied.
- **Severity / rationale:** **Medium** — requires operator misconfiguration,
  but the runner is intentionally stateful and does not guard it.
- **Confidence:** **High** — direct config and test-helper inspection.
- **Reproduction:** configure `.env` to any DB and run the suite; config uses
  it and test helpers persist rows. This was not run during the audit.
- **Recommended remediation:** load a dedicated test config, validate allowed
  database naming/host, add an explicit opt-in for non-disposable targets, and
  prefer per-run DB provisioning.
- **Dependencies / risks:** align local onboarding, CI secrets, and test DB
  lifecycle; do not silently delete existing test data.
- **Approval required:** **Yes** — changes test behavior and DB safety policy.

### BKA-07 — `CORS_ALLOW_ANY` remains available in production

- **Affected component:** `src/shared/config.ts` and CORS registration.
- **Evidence:** `resolveCorsOrigin()` returns `true` whenever the variable is
  exactly `true`, before checking environment. `server.ts` registers CORS with
  `credentials: true`. Direct config reproduction confirmed production
  resolves to any-origin.
- **Current behavior:** explicit setting permits all request origins with
  credentialed CORS in every mode, despite comments warning against production.
- **Expected behavior:** the demo escape hatch is disabled or requires a
  deliberate safe policy in production.
- **Impact:** broad browser cross-origin access can expose credentialed API
  behavior if other client credentials/cookies are introduced or if browser
  token handling permits it.
- **Severity / rationale:** **Medium** — it requires an explicit operator
  setting; impact depends on frontend credential model and deployment.
- **Confidence:** **High** — code inspection and direct reproduction.
- **Reproduction:** call `resolveCorsOrigin('production', undefined, 'true')`;
  result is `true`.
- **Recommended remediation:** reject the option in production or enforce a
  separately reviewed allow-list; document approved use.
- **Dependencies / risks:** confirm any demo deployment needing wildcard
  behavior before removing the escape hatch.
- **Approval required:** **Yes** — security configuration behavior change.

### BKA-08 — Compose startup seeds demo business records

- **Affected component:** `docker-compose.yml`, `src/db/seed.ts`.
- **Evidence:** Compose command runs `prisma migrate deploy`, then
  `node dist/db/seed.js`, then the server. Seed declares demo suppliers,
  materials, locations, projects, recipients, purchase orders/receipts and
  sample ledger transactions.
- **Current behavior:** a fresh Compose database is populated with demo data;
  seed runs again on backend container restarts and upserts bootstrap/catalog
  records.
- **Expected behavior:** production deployments should make demo-data loading
  an explicit, separate choice from schema migration and service startup.
- **Impact:** if Compose is used for a real production database, demo records
  can be mixed into operational data; repeated seed may update seeded catalog
  fields.
- **Severity / rationale:** **Medium** — only applies if the demo-oriented
  Compose recipe is used for a real environment; actual use is unknown.
- **Confidence:** **High for code behavior; Low for deployment use**.
- **Reproduction:** inspect Compose command and seed data/upsert functions; no
  database was seeded in this audit.
- **Recommended remediation:** separate schema migration, bootstrap admin, and
  demo seed commands; require an explicit demo-seed flag for demo records.
- **Dependencies / risks:** preserve the required admin bootstrap workflow.
- **Approval required:** **Yes** — changes deployment/bootstrap behavior.

### BKA-09 — Production seed requires admin password on every invocation

- **Affected component:** `src/db/seed.ts`, Compose startup command and
  production environment configuration.
- **Evidence:** `ensureAdminUser()` checks `NODE_ENV === 'production'` and a
  nonblank `SEED_ADMIN_PASSWORD` before it queries for the existing admin.
  Compose runs the seed on every backend startup and defaults that variable
  to empty. Compose comments say it is consumed only the first time, which
  disagrees with the check order in code.
- **Current behavior:** a production-mode seed invocation without the password
  fails even if the admin account already exists. A restarted Compose service
  therefore requires the bootstrap password to remain injected.
- **Expected behavior:** either require the credential only when creating the
  bootstrap account, or document and enforce secure retention for every
  invocation.
- **Impact:** a production container restart can fail before the API starts if
  operators remove the one-time bootstrap password after initial seeding.
- **Severity / rationale:** **Medium** — conditional startup availability
  issue; impact depends on how the deployment retains the secret.
- **Confidence:** **High static** — function ordering and Compose command are
  directly confirmed; a database-backed restart was not run.
- **Reproduction:** inspect the production password check before the existing
  user lookup in `ensureAdminUser()`; no DB seed was run in this audit.
- **Recommended remediation:** align the guard with the intended first-create
  semantics or persist the secret in the protected runtime environment; update
  Compose comments and add a production-mode seed regression test.
- **Dependencies / risks:** preserve secure first-admin creation and password
  rotation behavior.
- **Approval required:** **Yes** — seed/startup behavior change.

### BKA-10 — Production recovery and release controls are not evidenced

- **Affected component:** repository operations and infrastructure.
- **Evidence:** tracked backend artifacts include a Dockerfile, Compose file,
  and CI checks. No deploy/release workflow, IaC, rollback procedure, backup
  schedule/restore runbook, metrics/tracing/alerting integration, or recovery
  test was found. The Compose named volume is persistence, not backup.
- **Current behavior:** this repository does not document or automate a full
  production promotion and recovery path.
- **Expected behavior:** operators can release, observe, roll back, and
  recover production service/data using a tested procedure.
- **Impact:** production deployment state, incident detection, and data
  recoverability cannot be established from this codebase.
- **Severity / rationale:** **Medium** — these are meaningful operational
  readiness gaps; external systems may exist but were not supplied or verified.
- **Confidence:** **High for repository contents; Unknown for external systems**.
- **Reproduction:** inspect tracked workflows/files; ask deployment owner for
  external runbooks and evidence.
- **Recommended remediation:** identify the actual hosting platform and owners;
  document deploy/rollback, backups/restores, TLS/secrets boundary, logs,
  metrics, alerting and incident response; test them in a non-production
  environment.
- **Dependencies / risks:** external infrastructure and organizational
  decisions are required; no production changes were made.
- **Approval required:** **Yes** — operations design and external system work.

### BKA-11 — Concurrent stock deductions have no explicit row lock/isolation

- **Affected component:** inventory mutation services and balance helper.
- **Evidence:** `getCurrentBalance()` reads the `InventoryBalance` row in a
  Prisma transaction; issue/transfer logic checks available quantity and then
  inserts ledger rows/recomputes balance. No explicit lock or isolation level
  override was found. No DB check constraint rejects negative balances.
- **Current behavior:** single requests enforce no-negative-stock; the
  concurrency invariant under simultaneous deductions is unverified.
- **Expected behavior:** simultaneous valid requests must not overspend stock
  or leave ledger/balance inconsistent.
- **Impact:** under concurrent writes, stale balance reads may allow both
  deductions to pass. This is a risk analysis, not a confirmed exploit or
  reproduced failure.
- **Severity / rationale:** **Medium** — potential inventory/data integrity
  issue; workload likelihood and actual transaction interleaving are unknown.
- **Confidence:** **Medium** — code path is confirmed; runtime race is not.
- **Reproduction:** on a disposable PostgreSQL database, seed a small known
  balance and issue two concurrent requests whose combined quantity exceeds
  it; compare the ledger sum, balance row, and responses.
- **Recommended remediation:** add a deterministic concurrency strategy
  (locking/isolation or another atomic conditional write), a DB invariant where
  appropriate, and a real-Postgres concurrency regression test.
- **Dependencies / risks:** transaction throughput and PostgreSQL behavior
  need review; do not alter ledger schema in this audit.
- **Approval required:** **Yes** — business/data-integrity implementation.

### BKA-12 — Production CORS origin is documented as required but not validated

- **Affected component:** `shared/config.ts`, `.env.example`, backend README.
- **Evidence:** docs call `CORS_ORIGIN` required for production browser access;
  `resolveCorsOrigin()` returns false for production when it is absent; startup
  does not reject the configuration.
- **Current behavior:** service can start successfully while browser clients
  from the deployed SPA are blocked by CORS.
- **Expected behavior:** production configuration makes the intended browser
  origin policy explicit or documents that browser access is not used.
- **Impact:** browser-facing service may appear offline to users despite
  process liveness and DB readiness.
- **Severity / rationale:** **Low** — only affects cross-origin browser
  clients when no origin is supplied; server-to-server calls are unaffected.
- **Confidence:** **High** — source and template behavior are explicit.
- **Reproduction:** use production mode without `CORS_ORIGIN`; CORS resolver
  returns false while `loadConfig()` succeeds.
- **Recommended remediation:** validate when a browser UI is deployed, or
  state the intended no-browser-access configuration in deployment docs.
- **Dependencies / risks:** confirm production UI origin first.
- **Approval required:** **Yes** — startup/config policy or docs change.

## Verification summary

| Check | Result | Meaning |
| --- | --- | --- |
| Prisma generation + typecheck | Passed, exit 0 | Source/tests/scripts type-check with generated Prisma Client on Node 24.21. |
| ESLint | Passed, exit 0 | No lint errors in the checked backend paths. |
| Unit suite | 57 files, 823 tests passed, exit 0 | Mock-backed logic and route contracts pass locally; no DB proof. |
| TypeScript build | Passed, exit 0 | Local compile works; Docker build is a separate path. |
| Compiled runtime probe | Liveness 200; readiness 503 against unreachable dummy DB | Listener starts without DB and exposes readiness correctly. |
| Config reproduction | Weak prod secret, `staging` placeholder, any-origin CORS accepted | Reproduces BKA-01, BKA-02, BKA-07. |
| Integration suite / Docker image / live migrations | Not run | No Docker/database available; integration writes to a configured DB. |

Exact commands, setup, and limitations are in
[verification-and-test-strategy.md](../testing/verification-and-test-strategy.md).

## Unresolved questions and verification gaps

1. Is there an external production hosting platform, secret manager, TLS
   ingress/reverse proxy, log sink, metrics/alerting system, backup process,
   and incident runbook? None is configured in this repository.
2. Is Docker Compose intended only for local/demo use or for production?
   Compose selects production mode and automatically runs demo seed.
3. Which Node version is the actual supported release runtime? README, CI,
   Docker, and Vitest's package engine requirement disagree.
4. What are the current GitHub Actions results, branch protection rules, and
   release promotion gates? Workflow source was inspected but not executed.
5. Can the Docker image be built after the copy/prune issues are addressed,
   and does it start with the expected production-only dependencies?
6. Does a disposable PostgreSQL 16 integration run pass on the intended Node
   version, and are migrations compatible with the actual target schema?
7. Can a clean local test DB complete migrations, seed, integration, and E2E
   after the `.env.test` guard changes? This remains unverified without Docker
   engine access.
8. What is the real proxy/client-IP topology? `trustProxy` is not configured;
   rate limits may see proxy addresses if a reverse proxy is used.
9. What concurrency guarantees are required for stock deductions, and is the
   current default transaction isolation sufficient for expected load?
10. Is demo seed appropriate for first production boot, and which records may
    be seeded safely outside a demo environment?

## Recommended remediation sequence

1. **Verify the corrected release path:** run CI and build/start the image
   against a disposable Postgres service.
2. **Close configuration security gaps:** enforce allowed `NODE_ENV`, define
   JWT key strength and management/rotation, and guard wildcard credentialed
   CORS in production. Decide and validate production CORS origins.
3. **Verify test data protection:** run a fresh disposable DB
   migration/seed/integration cycle and the guarded browser E2E suite.
4. **Verify inventory integrity:** run concurrent-write tests against real
   PostgreSQL, then agree on a concurrency guarantee and enforcement strategy
   before changing transaction behavior.
5. **Separate demo/bootstrap from release operations:** keep admin bootstrap
   available while making demo catalog/ledger seed opt-in outside demos; align
   the production password guard with its documented first-create behavior.
6. **Complete operational readiness:** document and test deployment/TLS/secrets,
   rollback, backup/restore, centralized logs, metrics, alerts, and incident
   handling with the actual hosting/database owners.
7. **Refresh connected documentation:** after runtime and deployment decisions,
   update the backend README, root system docs, and this audit's verification
   date/results.

## Backend Understanding Brief

The backend is one Fastify 5 API process written in TypeScript. Run it locally
with `npm run dev` from `apps/backend`; that command loads `.env` and restarts
on source changes. `npm start` runs compiled output and expects environment
variables to be injected. `src/index.ts` validates config; `src/server.ts`
creates Fastify, installs security/logging/error plugins, mounts feature routes,
probes the DB, then listens. Startup can succeed without PostgreSQL; check
`/health/ready`, not only `/health`.

Feature routes are grouped by identity, inventory, procurement, operations,
reporting, settings, audit, and health. Services and some route handlers use a
shared Prisma client directly. PostgreSQL is the only configured runtime
integration. JWT login is local email/password; protected routes verify the
token, re-check account activity in the DB, and load permissions from DB when
needed. Inventory mutations use transactions to append signed ledger rows and
recompute balances.

Development `.env`, unit-test mocks, real-HTTP integration DB, CI Postgres, and
Compose production-mode settings are distinct. Integration tests now write
only to an explicitly guarded local `_test` target, though a real DB run is
still pending. Current local checks include 813 backend tests and 799 frontend
tests on Node 24.21. Docker and CI execution remain unverified. Production
secret strength, `NODE_ENV`
validation, database test isolation, backups, monitoring, and deployment
recovery remain the main risks to resolve.
