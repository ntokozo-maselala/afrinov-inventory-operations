# Deployment

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## What exists
`apps/backend/docker-compose.yml` builds the backend image and runs it next
to PostgreSQL 16. The backend container's command is:
`npx prisma migrate deploy && node dist/db/seed.js && node dist/index.js`
— apply migrations, run the idempotent seed (creates the admin on first
start; `SEED_ADMIN_PASSWORD` required then), start the API. Required
environment: `POSTGRES_PASSWORD`, `JWT_SECRET`; `CORS_ORIGIN` is needed for
a browser frontend in production. The frontend is built with
`npm run build` into static files; how they are served is not defined in
the repository.

The server shuts down gracefully on SIGTERM/SIGINT (stops accepting
requests, closes the database pool).

## Planned
- Smoke tests after deploy (auth, current-stock read, a test issue in a
  non-production environment).
- Rollback = redeploy the previous image. Prisma migrations here are
  forward-only; there are no down migrations, so a rollback across a
  schema change needs a manual plan.

## Evidence
- `afrinov-platform/apps/backend/docker-compose.yml`
- `afrinov-platform/apps/backend/Dockerfile`
- `afrinov-platform/apps/backend/src/server.ts:377-395` — graceful shutdown
- `afrinov-platform/apps/backend/prisma/migrations/` — `migration.sql` files only
