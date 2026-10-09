# Deployment Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## What the repository provides
- **Backend container:** `apps/backend/Dockerfile`, a two-stage
  `node:20-alpine` build. It compiles TypeScript, prunes dev dependencies,
  runs as an unprivileged `app` user and exposes port 4000.
- **Compose stack:** `apps/backend/docker-compose.yml` runs two services:
  `db` (`postgres:16-alpine`, named volume `afrinov_pg`, health check) and
  `backend` (built from the monorepo root). On start the backend container
  runs `npx prisma migrate deploy`, then the compiled seed
  (`node dist/db/seed.js`), then `node dist/index.js`. `NODE_ENV` defaults
  to `production` in the container.
- **Frontend:** a static bundle produced by `npm run build` (Vite). The
  repository contains no container, web server configuration or hosting
  definition for it. In development the Vite dev server proxies `/api` to
  `http://localhost:4000`.

No queue or cache layer is used.

## v1 target
*Unverified:* the hosting target (which server, managed PostgreSQL or not,
how the frontend is served and how TLS is terminated) is not defined in the
repository.

## Environments
Only `local` (developer machines, Docker Postgres) and the throwaway CI
database are evidenced in the repository. `staging` and `production` are
**Planned** — see `12-operations/environments.md`.

## Deployment method
**Planned.** There is no deployment pipeline in the repository; CI builds
and tests but does not deploy (see `12-operations/ci-cd.md`). The
container start command applies migrations before starting the API, so a
deployment of the container image is "migrate, seed (idempotent), start".

## Evidence
- `afrinov-platform/apps/backend/Dockerfile`
- `afrinov-platform/apps/backend/docker-compose.yml`
- `afrinov-platform/apps/frontend/vite.config.ts:19-24` — dev proxy
- `.github/workflows/backend-ci.yml`, `.github/workflows/frontend-ci.yml` — no deploy jobs
