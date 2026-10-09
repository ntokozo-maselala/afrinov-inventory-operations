# Secrets Management

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Secrets are read from environment variables; none are committed. In the
repository:

| Secret | Variable | Handling in code |
|---|---|---|
| Database connection string | `DATABASE_URL` | Required at start-up. In `docker-compose.yml` it is assembled from `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`, and `POSTGRES_PASSWORD` must be supplied |
| JWT signing key | `JWT_SECRET` | Required. With `NODE_ENV=production` (the default when unset) the server refuses to start with an empty value or any value from a built-in list of known placeholders, including the ones in the committed example files |
| First admin password | `SEED_ADMIN_PASSWORD` | Read by the seed only when it first creates `admin@afrinov.local`; mandatory in production; in development an unset value makes the seed generate a random password it does not print |

`.env` files are git-ignored (only `.env.example` and `.env.test.example`
are tracked) and excluded from the Docker build context. CI generates a
fresh random `JWT_SECRET` and admin password per run and masks them.

*Unverified / Planned:* a secrets manager for production, a rotation
procedure (rotate on suspected compromise or when an admin leaves), and
confirmation that secrets are never logged — the start-up log prints
environment, port and URLs but not configuration values.

## Evidence
- `afrinov-platform/apps/backend/src/shared/config.ts:28-77`
- `afrinov-platform/apps/backend/src/db/seed.ts:154-176`
- `afrinov-platform/apps/backend/docker-compose.yml` — `DATABASE_URL`, `JWT_SECRET`, `SEED_ADMIN_PASSWORD`
- `afrinov-platform/.gitignore`, `afrinov-platform/.dockerignore`
- `.github/workflows/backend-ci.yml:90-98`
- `afrinov-platform/apps/backend/src/server.ts:360-406` — start-up log lines
