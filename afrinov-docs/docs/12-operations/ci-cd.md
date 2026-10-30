# CI/CD

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** working tree, 2026-10-29

## CI (implemented, GitHub Actions)
| Workflow | Runs on | Steps |
|---|---|---|
| `backend-ci.yml` → job **checks** | Pull requests touching `apps/backend`, the workspace manifests or the workflow; pushes to `main` | Node 24; `npm ci` at the workspace root; `prisma generate`; `npm run typecheck`, `lint`, `test`, `build` |
| `backend-ci.yml` → job **integration** | Same triggers | Node 24; `postgres:16-alpine` service; random `JWT_SECRET` and `SEED_ADMIN_PASSWORD` generated and masked; `prisma generate`; `prisma migrate deploy`; production-mode `npm run db:seed` then `npm run db:check-bootstrap` (no business data); `npm run db:seed:demo` must fail in production; demo seed with `NODE_ENV=test`; `npm run test:integration` |
| `frontend-ci.yml` → job **checks** | Pull requests touching `apps/frontend`, the workspace manifests or the workflow; pushes to `main` | Node 24; `npm ci`; `typecheck`, `lint`, `test`, production `build` (fails if a demo flag is set) |
| `security-ci.yml` | Push/PR | Node 24; dependency and static-analysis checks |

Both workflows cancel superseded runs on the same ref and have read-only
`contents` permission. Every job pins the same Node major (24), matching the
backend Docker image, so the backend suite runs Vitest 5 on a supported
runtime (TD-018 resolved 2026-10-28).

## CD — Planned
There is no deployment job. Running API/E2E tests against staging on merge,
automatic staging deploys and gated production promotion are **Planned**.

## Evidence
- `.github/workflows/backend-ci.yml` — Node 24 on `checks` and `integration`
- `.github/workflows/frontend-ci.yml` — Node 24
- `.github/workflows/security-ci.yml` — Node 24
- `apps/backend/Dockerfile` — `node:24-alpine` in both stages
