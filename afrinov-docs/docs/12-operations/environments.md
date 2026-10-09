# Environments

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Environment | Purpose | Data | Evidence |
|---|---|---|---|
| local | Developer machines: Docker Postgres, `npm run dev:backend` and `dev:frontend` | Demo seed (`npm run db:seed`) | `apps/backend/README.md`, `src/db/seed.ts` |
| frontend-only | UI review without backend or database | In-memory mock data, reset on reload | `apps/frontend/FRONTEND_ONLY.md` |
| CI | Throwaway Postgres per integration run | Seed data | `.github/workflows/backend-ci.yml` |
| staging | Migration rehearsal, UAT, pre-release validation | Sanitised copy of migrated data | **Planned** — not defined in the repository |
| production | Live system of record | Real data, post-cutover | **Planned** — hosting *Unverified* |

`NODE_ENV` selects behaviour: `development` (pretty logs, local CORS
origins, API docs on), `test`, or `production` (the default when unset:
strict secret checks, CORS off unless `CORS_ORIGIN` is set, API docs off
unless `API_DOCS_ENABLED=true`).

## Evidence
- `afrinov-platform/apps/backend/src/shared/config.ts:42-141`
- `afrinov-platform/apps/frontend/package.json` — `dev:frontend-only`
