# Runtime lifecycle

## Commands and environment source

The npm workspace is `afrinov-platform/`; the package root is
`afrinov-platform/apps/backend/`.

| Mode | Command | Environment loading |
| --- | --- | --- |
| Development/watch | From `apps/backend`: `npm run dev` (or workspace `npm run dev:backend` from `afrinov-platform/`) | Script runs `tsx watch --env-file=.env src/index.ts`, so Node loads the backend `.env` file. |
| Compiled build | `npm run build` | `prebuild` generates Prisma Client, then `tsc -p tsconfig.build.json` emits `dist/`. |
| Compiled process | From `apps/backend`: `npm start` | Runs `node dist/index.js`; it does not pass `--env-file`. Inject/export the required variables before starting. |
| Compose | From `apps/backend`: `docker compose up --build` | Compose injects environment values into the backend container, runs migration and seed, then invokes `node dist/index.js`. Dockerfile and workspace-root build context were corrected; image build remains unverified. |
| Unit tests | `npm test` | Vitest config uses a dummy `DATABASE_URL` fallback. Tests in `src/**/*.test.ts` use mocks/in-memory fakes for database-dependent paths. |
| Integration tests | `npm run test:integration` | Integration config reads `.env.test` only, forces `NODE_ENV=test`, and requires a local `_test` PostgreSQL URL; tests persist rows in that isolated DB. |

In PowerShell installations where `npm.ps1` is blocked by execution policy,
`npm.cmd` invokes the same npm executable. This audit host required that form.

## Initialization order

1. npm starts `tsx` in watch mode or Node runs compiled `dist/index.js`.
2. ESM evaluates `index.ts` imports. `server.ts` imports `shared/db.ts`, which
   constructs a Prisma Client at module load. The client is lazy and does not
   connect until a query executes. No connection is established by construction
   alone.
3. `index.ts` registers `uncaughtException` and `unhandledRejection` handlers.
   Both log to stderr and exit with status 1; they do not recover and continue.
4. `index.ts` calls `loadConfig()` before starting. A configuration error is
   printed and the process exits 1. `start()` loads config again, and
   `buildServer()` loads it again unless test options bypass validation.
5. `start()` builds the Fastify instance. It configures Pino (pretty transport
   only for development), 1 MB body limit, 30-second request timeout, and
   10-second plugin timeout (60 seconds when `NODE_ENV=test`).
6. Plugins and hooks are registered in source order: request ID hook, CORS,
   Helmet, JWT, rate limiting, the `authenticate` decorator, central error
   handler, root service/liveness/readiness routes, optional Swagger/OpenAPI,
   then the `/api/v1` feature route plugin.
7. Feature routes are dynamically imported and registered in this order:
   auth, users, materials, locations, stock items, inventory, tools, suppliers,
   optional procurement, projects, recipients, reports, settings, audit, and
   API-prefixed health.
8. A best-effort `SELECT 1` is run against PostgreSQL. Failure is logged but
   does not prevent the HTTP listener from starting.
9. `SIGTERM` and `SIGINT` handlers are installed. Fastify then binds
   `HOST:PORT`, defaulting to `0.0.0.0:4000`. A listener failure is logged,
   Prisma is disconnected, and the process exits 1.

The order above comes from `src/index.ts`, `src/server.ts`,
`src/shared/config.ts`, and `src/shared/db.ts`; framework plugin internals are
not treated as application initialization steps. The Prisma client is created
before the `index.ts` validation body runs, but there is no database connection
until the explicit startup probe or a later request.

## Request-time boundary

Fastify parses HTTP input (with its default JSON parser), applies global
plugins, assigns/logs request IDs, enforces rate limits, and dispatches the
registered route. Feature routes commonly run in this order: authentication
pre-handler, permission check if required, Zod `safeParse`, service/business
logic, Prisma query or transaction, response serialization. Errors raised as
`ApiError` use the shared `{ error: { code, message, details } }` shape;
unhandled `Error` instances are logged and returned as generic 500 responses.
See the [request lifecycle](../architecture/request-lifecycle.md).

## Readiness and failure behavior

`GET /health` reports process liveness and does not query PostgreSQL.
`GET /health/ready` runs `SELECT 1`, returns 200 when it succeeds, and 503 on
failure. The same pair exists at `/api/v1/health` and
`/api/v1/health/ready`. The startup probe is informational, not a readiness
gate. A running process can therefore be alive while not ready to serve
database-dependent requests.

This was observed against a dummy, unreachable local database URL: the compiled
process bound its listener, `/health` returned 200, and `/health/ready`
returned 503. No real database was contacted.

## Shutdown and watch restarts

On `SIGTERM` or `SIGINT`, `start()` runs a guarded shutdown sequence: call
`app.close()`, disconnect the singleton Prisma client, log completion, and
exit 0. On shutdown error it logs and exits 1. If the port bind fails, it
disconnects Prisma before exiting. `uncaughtException` and
`unhandledRejection` use the fatal exit path rather than attempting graceful
recovery.

`tsx watch` restarts the development process when watched files change. The
global Prisma-client slot in `shared/db.ts` avoids duplicate clients during
module reloads within one process. Whether every watch restart delivers a
signal and completes cleanup was not separately measured. There is no
configured process supervisor, shutdown deadline, forced-exit timer, worker
pool, or external queue to drain.

## Startup and shutdown sequence diagram

See [backend-lifecycle.mmd](../architecture/diagrams/backend-lifecycle.mmd).

## Evidence and limits

- Source confirms the lifecycle and signal handlers. A local process probe
  verified listener, liveness, and not-ready responses with an unreachable
  dummy DB.
- PostgreSQL startup success, live migrations, Docker startup, container
  signal behavior, and watch restart cleanup were not verified.
- `npm start` and Docker execute compiled output. Building that output is
  locally typechecked; building the Docker image itself is not verified
  because Docker engine access is unavailable.
