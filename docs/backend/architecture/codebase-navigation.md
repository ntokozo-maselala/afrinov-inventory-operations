# Backend codebase navigation

Paths below are repository-relative. Start at the
[`@afrinov/backend` package](../../../afrinov-platform/apps/backend/package.json).

| Question | File(s) and symbols |
| --- | --- |
| What starts the process? | `afrinov-platform/apps/backend/src/index.ts` — fatal process handlers, `loadConfig()`, `start()` call. `package.json` `dev` and `start` scripts select `src/index.ts` and `dist/index.js`. |
| Where is configuration loaded and checked? | `src/shared/config.ts` — `loadConfig`, `resolveCorsOrigin`, `isProcurementEnabled`, `isApiDocsEnabled`, `ConfigError`. `src/index.ts` validates before start; `src/server.ts` loads again for app/start. |
| Where is the Fastify instance built? | `src/server.ts` — `buildServer`, plugin/hook setup, `authenticate` decorator, root health routes, optional Swagger and versioned route registry. |
| Where are routes registered? | `src/server.ts` — dynamic imports and registration order under `/api/v1`. Feature contracts are in `src/modules/<feature>/*.routes.ts`. |
| Where is request middleware configured? | `src/server.ts` — request ID hook, CORS, Helmet, JWT, rate limiting, error handler. Fastify's built-in JSON parser receives the configured body limit. |
| Where is authentication enforced? | `src/server.ts` — `app.authenticate`; route declarations in `*.routes.ts` attach it as `preHandler`. Login is `modules/identity/auth.routes.ts`; credential verification is `modules/identity/identity.service.ts`. |
| Where is authorization enforced? | `src/shared/authorization.ts` — `requirePermission`, `loadUserPermissions`, `isActiveInDb`; role codes and permission mapping in `src/shared/permissions.ts`. Route-specific permission selection is in each route module. |
| Where does business logic live? | `src/modules/<feature>/*.service.ts`, with shared logic under `src/shared/`. Some simple reads/exports query Prisma directly from route files. |
| Where does database access occur? | `src/shared/db.ts` creates singleton Prisma client; services/routes import it directly. Schema is `prisma/schema.prisma`; SQL migrations are `prisma/migrations/`. |
| Where are stock balances managed? | `src/shared/inventory/balances.ts` — recompute/read helpers; `src/modules/inventory/inventory.service.ts` — movement checks/writes inside Prisma transactions; `src/modules/inventory/balances.ts` — public recompute helper also used by seed. |
| Where are errors translated to HTTP? | `src/shared/errors.ts` — `ApiError` and constructors; central `app.setErrorHandler` in `src/server.ts`. |
| Where are health checks implemented? | Root `/health` and readiness in `src/server.ts`; API-prefixed copies in `src/modules/health/health.routes.ts`. |
| Where are logs configured? | `src/server.ts` — Fastify/Pino logger and request behavior. No metrics/tracing integration found. |
| Where are tests configured? | `vitest.config.ts` unit tests; `vitest.integration.config.ts` real DB/HTTP tests; `tsconfig.tools.json`; `.eslintrc.cjs`; `src/**/*.test.ts`; `integration/**/*.test.ts`. |
| Where are development and production separated? | Package scripts (`dev` vs `start`), `shared/config.ts`, `server.ts`, seed's `NODE_ENV` check, `.env.example`, Docker Compose injected settings. No first-class staging config. |
| Where are migrations/seeds managed? | `src/db/migrate.ts`, `src/db/seed.ts`, `prisma/schema.prisma`, `prisma/migrations/`, and package scripts. |
| Where is deployment configured? | `Dockerfile`, `docker-compose.yml`, `.github/workflows/backend-ci.yml`. No deploy/release/IaC workflow found; container build path is statically incomplete and not tested. |

## Dependency map

```text
src/index.ts
  -> shared/config.ts
  -> server.ts
       -> Fastify plugins / shared errors / shared db / authorization
       -> dynamic route imports under modules/
            -> route-local Zod schemas
            -> feature service(s)
                 -> shared helpers / settings / events
                 -> shared/db.ts -> Prisma Client -> PostgreSQL
       -> openapi/document.ts (conditional)

package scripts -> Prisma CLI / TypeScript / Vitest / ESLint / tsx
CI workflow -> checks job + disposable PostgreSQL integration job
Dockerfile / Compose -> intended container and DB startup path (unverified)
```

## Important distinction

`package.json` has `main: dist/server.js`, but the process `start` script runs
`dist/index.js`. `server.ts` exports `buildServer()` and `start()`; the
application executable is `index.ts`. The `migration` module contains import
and reconciliation helpers but is not registered as an API route group.

For behavior flows, see [backend architecture](backend-architecture.md),
[request lifecycle](request-lifecycle.md), and
[runtime lifecycle](../operations/runtime-lifecycle.md).
