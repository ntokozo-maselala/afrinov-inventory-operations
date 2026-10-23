# Backend operational runbook

This runbook uses repository commands and treats database writes as stateful
operations. Confirm the target before migrations, seeds, imports, integration
tests, or password rotation. Never print connection URLs, passwords, JWT
secrets, or tokens.

## Prerequisites and installation

- Node 24 for the current Vitest 5 toolchain; npm 10+ per workspace
  documentation. Backend CI also selects Node 24.
- Docker/Compose only when using the included PostgreSQL service.
- Run from `afrinov-platform/` for workspace installation, or
  `afrinov-platform/apps/backend/` for backend scripts.

```powershell
cd afrinov-platform
npm.cmd ci
```

Use `npm` instead of `npm.cmd` in shells where its executable policy permits
it. In this audit's PowerShell environment, `npm.ps1` was blocked but
`npm.cmd` worked.

## Local environment and database setup

1. From `afrinov-platform/apps/backend`, copy `.env.example` to `.env`.
2. Replace the public JWT placeholder with a generated random secret. The
   repository suggests:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Put the result in the local `.env`; do not paste it into chat, logs, or
   documentation. `npm run dev` reads `.env`; `npm start` does not.
3. If using Compose PostgreSQL, supply `POSTGRES_PASSWORD` in the environment
   and start only the database service:

   ```powershell
   cd afrinov-platform/apps/backend
   docker compose up -d db
   ```

4. Before any DB write, verify that `DATABASE_URL` names the intended local
   database. The URL may contain a password; inspect it without echoing the
   whole value. `.env.example` and `.env.test.example` point to different DB
   names.
5. Generate Prisma Client and apply migrations only after the DB target is
   confirmed:

   ```powershell
   npm.cmd run db:generate
   npm.cmd run db:migrate
   ```

6. Seed is optional and inserts demo data into a fresh DB. Set a local
   `SEED_ADMIN_PASSWORD` in the process environment, then run:

   ```powershell
   npm.cmd run db:seed
   ```

   Review [persistence](../data/persistence-and-database-lifecycle.md) before
   seeding anything other than a disposable/demo database. The seed does not
   change an existing admin password; `db:rotate-admin` is a separate write.
   In production mode the current seed code requires this variable on every
   invocation, even when the admin already exists, so Compose restarts also
   need the value retained in the protected environment.

## Development, build, and verification

From `afrinov-platform/apps/backend`:

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The `dev` script watches TypeScript and reads `.env`. Typecheck, test, and
build scripts run Prisma Client generation as a pre-script. Unit tests do not
need a DB; the integration suite does.

The real-HTTP integration suite writes rows to its database and leaves them
behind. It loads only `.env.test`, forces `NODE_ENV=test`, and refuses remote
hosts or database names without the `_test` suffix. Never copy the ordinary
`.env` into `.env.test`. Set up a separate Compose service and test-only
database before running the guarded commands:

```powershell
# Prefer a dedicated POSTGRES_TEST_PASSWORD; Compose falls back to the
# required local POSTGRES_PASSWORD if it is unset.
Copy-Item .env.test.example .env.test
docker compose --profile test up -d test-db
npm.cmd run db:test:migrate
npm.cmd run db:test:seed
npm.cmd run test:integration
```

Set the `.env.test` URL password to match the effective test DB password and set
`SEED_ADMIN_PASSWORD` in that file or the shell. Keep `.env.test` untracked.
The test database uses port 5433 and its own Compose volume. CI uses an
ephemeral Postgres 16 service. The `db:test:migrate` and `db:test:seed`
wrappers apply the same direct-local-host, no-host-override, and `_test`-name
guard before writing.

## Compiled startup and container status

After a successful build, `npm.cmd start` runs `node dist/index.js`; inject
`DATABASE_URL`, `JWT_SECRET`, and other runtime variables through the process
environment. It does not load `.env` automatically.

The backend Dockerfile now installs from the workspace lockfile and copies
source plus Prisma schema before building. The root `.dockerignore` excludes
local `.env` files and machine-local build artifacts from the image context.
Compose also has an opt-in isolated test database profile. The image and Compose startup were not executed in
this audit because Docker engine access was unavailable, so treat container
startup as unverified until CI or another controlled environment builds and
runs it against disposable PostgreSQL.

## Health, logs, and routine diagnosis

- Liveness: `GET http://localhost:4000/health` should return 200 while the
  process is serving.
- Readiness: `GET http://localhost:4000/health/ready` should return 200 and
  `database: connected` when the DB is reachable; 503 means DB unavailable.
- API-prefixed copies are `/api/v1/health` and `/api/v1/health/ready`.
- Development logs use pretty Pino output. Production/default logs are
  structured Pino output. No centralized sink or metrics endpoint is included.
- Compose logs, when Docker is available: `docker compose logs --tail 200
  backend db`.

## Troubleshooting scenarios

| Symptom | Evidence to collect | Diagnostic command | Interpretation | Safe corrective action | Verification |
| --- | --- | --- | --- | --- | --- |
| Process exits with configuration error | Confirm variable presence without printing values; check `NODE_ENV` spelling | PowerShell: `foreach ($name in @('DATABASE_URL','JWT_SECRET','NODE_ENV','PORT')) { [pscustomobject]@{ Name=$name; IsSet=(Test-Path "Env:$name") } }` | Missing DB URL/JWT secret or invalid port stops startup before listen. An unset `NODE_ENV` is treated as production. | Set required variables via local `.env` for `npm run dev`, or inject them into the compiled process. Use a generated secret. | Restart and request `/health`; confirm startup log reaches “HTTP server listening”. |
| Port already in use | Listener PID and local port only | `netstat -ano | findstr :4000` | A `LISTENING` row indicates a process owns the port. | Identify the owning process using the reported PID and stop it through its normal service/terminal controls. Do not kill an unknown PID. Or choose a free `PORT`. | Confirm only the intended listener remains and `/health` responds. |
| Liveness works but readiness returns 503 | DB host/port reachability, DB service health, migration status; redact credentials | `docker compose ps db` (Compose) and `npx prisma migrate status` after verifying `DATABASE_URL` | Liveness does not depend on DB. Readiness `SELECT 1` failure indicates connectivity/auth/database availability; migration status distinguishes pending schema. | Start/recover the intended DB, correct injected config securely, or apply migrations only after confirming the target and backup. | `/health/ready` returns 200 with database connected. |
| Startup reports `EADDRINUSE` or listener bind failure | Port, host, `netstat` output | `netstat -ano | findstr :4000` | Another process or an unavailable interface owns the bind target. | Use a free port or correct `HOST`; avoid terminating a process until its owner is known. | Start process and request `/health`. |
| Login returns 401 | Response code, account active status through approved admin tooling, whether seed/rotation completed | `npm.cmd run diag:login` only in a non-production environment with approved local credentials | Invalid email/password, inactive account, or missing/unusable bootstrap credential can produce 401. | Use administrator-supported password rotation only after verifying DB target; never place passwords on command line/history. | Retry login through API and call `/api/v1/auth/me`. |
| `GET /api/v1/auth/login` returns 404 | Request method, caller, browser network initiator or monitoring/client configuration | Compare the request with the route contract; login is registered as POST-only | A GET does not match the current login route. The frontend submits login with POST. | Correct the caller only after establishing its source; do not infer that the POST 401 has the same cause. | Confirm the browser/client sends one POST to `/api/v1/auth/login`. |
| Protected endpoint returns 401 or 403 | HTTP status and safe error code; account state and role permissions | Use API response; inspect route's `preHandler` and permission code in its `*.routes.ts` file | 401 means token absent/invalid/account unavailable; 403 means active user lacks the route permission. | Obtain proper credentials/role through admin workflow. Do not disable authentication or change JWT secret to bypass. | Retry with a freshly issued token and least-required permission. |
| Browser cannot call API cross-origin | Request `Origin`, response CORS headers, configured origin names (not secrets) | Inspect browser network panel and `CORS_ORIGIN` presence without printing its value | Outside development, unset origin disables CORS. `CORS_ALLOW_ANY` is credentialed and should not be used as a production workaround. | Configure the exact trusted SPA origins in the deployment environment. | Retry browser request and verify allow-origin matches the trusted origin. |
| Unit tests fail loading Prisma | Node version, `npm.cmd --version`, generated-client command output | `node --version`; `npm.cmd run db:generate`; `npm.cmd test` | Ensure supported Node toolchain and generated client. Unit tests use dummy DB config and should not require Postgres. | Use Node 22.12+ or 24, install from workspace lockfile, and regenerate client. Do not run `npm install` upgrades without approval. | Repeat typecheck and unit tests. |
| Integration tests fail or pollute local data | Confirmed test database name/host, seed fixture setup, migration state | Review `vitest.integration.config.ts` and `scripts/test-environment.ts`; confirm `.env.test` exists without printing its URL | Config refuses remote hosts and database names without `_test`; integration tests still persist rows in that isolated database. | Use only the separate Compose test database and guarded `db:test:migrate` / `db:test:seed` commands. | Run suite against the disposable test DB and retire it through its isolated lifecycle. |
| Docker image build fails | Docker build output; verify build context root and Docker engine availability | `docker compose build backend` from `apps/backend` | The corrected Dockerfile has not been built in every environment; local Docker engine access was unavailable during this audit. | Preserve the build error and repair the image definition without bypassing Prisma generation. | Build image in CI and start it against disposable PostgreSQL before release. |

## Graceful shutdown and recovery

Send `SIGINT` from the foreground terminal or `SIGTERM` through the process
manager. The backend closes Fastify, disconnects Prisma, then exits. Confirm
the listener is gone and the supervisor reports normal termination. Do not
blindly kill processes.

No backup/restore or production rollback procedure is supplied in this repo.
If a production DB is unavailable or data integrity is uncertain, preserve
logs, stop further writes through the approved service controls, and follow
the deployment/database owner's verified recovery procedure. Do not reset the
database, delete migration records, or run imports/seeds to “repair” it.
