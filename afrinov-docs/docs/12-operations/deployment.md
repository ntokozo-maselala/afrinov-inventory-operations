# Deployment

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** feature/audit-p1-go-live-safety, 2026-11-11

## What exists
`apps/backend/docker-compose.yml` builds the backend image and runs it next
to PostgreSQL 16. The backend container's command is:
`npx prisma migrate deploy && node dist/db/seed.js && node dist/index.js`
— apply migrations, run the idempotent seed, start the API.

The seed loads only what the application needs: permissions, roles, settings
and the admin account (`SEED_ADMIN_PASSWORD` required in production). Demo
data loads only with `SEED_DEMO_DATA=true`, and the seed refuses that flag
when `NODE_ENV` is `production`, so a live ledger never holds demo stock
(system audit H1).

The `backup` service in the same file backs the database up every evening and
copies it off site (ADR-037). Required environment: `POSTGRES_PASSWORD`, `JWT_SECRET`,
`SEED_ADMIN_PASSWORD`, `BACKUP_REMOTE` and `BACKUP_DISK`, and `TRUST_PROXY` set to the reverse proxy's address
(see `reverse-proxy.md`). `CORS_ORIGIN` is needed only if the screens are
served from another address than the API, which the screens don't support
today.

The frontend is built with `npm run build` into static files, served by the
reverse proxy (`reverse-proxy.md`).

The server shuts down gracefully on SIGTERM/SIGINT (stops accepting
requests, closes the database pool).

## First start of production

1. Start the stack with the variables above. The seed creates
   `admin@afrinov.local` with `SEED_ADMIN_PASSWORD`.
2. Sign in as that admin and change the password from the header
   (**Change password**). Every other sign-in of the account ends.
3. Create the other accounts, and give a second person the Admin role, so
   one can reset the other's password (ADR-036). Until then Settings → Users
   and the Dashboard warn; once two exist, the system keeps two.
4. Set up backups (`backup-and-recovery.md`): the key in `secrets/`, the
   backup disk, the off-site store; then take one and run the restore test,
   before any stock is entered. The `backup` service then runs every evening.
5. Import the workbook once, after the go-live count
   (`workbook-replacement-roadmap.md`, Cutover and go-live).

## Planned
- Smoke tests after deploy (auth, current-stock read, a test issue in a
  non-production environment).
- Rollback = redeploy the previous image. Prisma migrations here are
  forward-only; there are no down migrations, so a rollback across a
  schema change needs a manual plan.

## Evidence
- `afrinov-platform/apps/backend/docker-compose.yml`
- `afrinov-platform/apps/backend/Dockerfile`
- `afrinov-platform/apps/backend/src/db/seed-plan.ts` — what the seed loads
- `afrinov-platform/apps/backend/src/server.ts` — graceful shutdown
- `afrinov-platform/apps/backend/prisma/migrations/` — `migration.sql` files only
