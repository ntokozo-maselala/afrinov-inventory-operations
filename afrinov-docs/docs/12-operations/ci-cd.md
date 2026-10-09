# CI/CD

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## CI (implemented, GitHub Actions)
| Workflow | Runs on | Steps |
|---|---|---|
| `backend-ci.yml` → job **checks** | Pull requests touching `apps/backend`, the workspace manifests or the workflow; pushes to `main` | Node 20; `npm ci` at the workspace root; `prisma generate`; `npm run typecheck`, `lint`, `test`, `build` |
| `backend-ci.yml` → job **integration** | Same triggers | `postgres:16-alpine` service; random `JWT_SECRET` and `SEED_ADMIN_PASSWORD` generated and masked; `prisma generate`; `prisma migrate deploy`; `npm run db:seed`; `npm run test:integration` |
| `frontend-ci.yml` → job **checks** | Pull requests touching `apps/frontend`, the workspace manifests or the workflow; pushes to `main` | Node 24; `npm ci`; `typecheck`, `lint`, `test`, production `build` (fails if a demo flag is set) |

Both workflows cancel superseded runs on the same ref and have read-only
`contents` permission. *Unverified:* the backend jobs run Vitest 5 on Node
20, while the frontend workflow notes that Vitest 5 needs Node 22 or later;
the outcome of recent backend runs was not checked (TD-018).

## CD — Planned
There is no deployment job. Running API/E2E tests against staging on merge,
automatic staging deploys and gated production promotion are **Planned**.

## Evidence
- `.github/workflows/backend-ci.yml:1-110`
- `.github/workflows/frontend-ci.yml:1-55`
