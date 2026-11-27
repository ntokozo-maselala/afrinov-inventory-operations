<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-12-003</b></td>
<td align="center"><b><i>CI/CD</i></b><br><i>Operations</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-12-003 updated=2026-11-27 by="Ntokozo Maselala" body=6c1f347590e0 -->

# CI/CD

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** branch `ci/gate-02-required-checks`, 2026-11-27

## CI (implemented, GitHub Actions)
| Workflow | Runs on | Steps |
|---|---|---|
| `backend-ci.yml` → job **changes** ("Backend: what changed") | Every pull request; pushes to `main` touching `apps/backend`, the workspace manifests or the workflow | `git diff` of the pull request against its base: did `apps/backend`, the workspace manifests or the workflow change? Fails open (anything it can't tell runs everything) |
| `backend-ci.yml` → job **checks** ("Backend: typecheck, lint, unit tests, build") | After **changes**, when it says the backend changed; otherwise skipped, which counts as a pass | Node 24; `npm ci` at the workspace root; `prisma generate`; `npm run typecheck`, `lint`, `test`, `build` |
| `backend-ci.yml` → job **migration-drift** ("Backend: migration drift and database integrity") | As **checks** | `postgres:16-alpine` service; `prisma migrate deploy` on an empty database, then `prisma migrate diff --exit-code` |
| `backend-ci.yml` → job **integration** ("Backend: integration tests (real Postgres)") | As **checks** | Node 24; `postgres:16-alpine` service; random `JWT_SECRET` and `SEED_ADMIN_PASSWORD` generated and masked; `prisma generate`; `prisma migrate deploy`; `npm run db:seed`; `npm run test:integration`; backup and restore drill |
| `frontend-ci.yml` → job **changes** ("Frontend: what changed") | Every pull request; pushes to `main` touching `apps/frontend`, `apps/backend`, the workspace manifests or the workflow | As the backend's, for those paths (the browser tests run against the backend, so a backend change runs them) |
| `frontend-ci.yml` → job **checks** ("Frontend: typecheck, lint, unit tests, build") | After **changes**, when it says the frontend or backend changed; otherwise skipped as a pass | Node 24; `npm ci`; `typecheck`, `lint`, `test`, production `build` (fails if a demo flag is set) |
| `frontend-ci.yml` → job **e2e** ("Frontend: browser tests (Playwright, real backend)") | As the frontend **checks** | `postgres:16-alpine`; migrate and seed; Chromium; `npx playwright test` |
| `security-ci.yml` | Push/PR, weekly | Node 24; dependency audit, secret scanning, no spreadsheets |

Every pull request gets every check, so they can be required on `main`
(`docs/engineering/CI_CD_ARCHITECTURE.md`, "Branch protection"; GATE-02).

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
- `.github/workflows/backend-ci.yml`, `frontend-ci.yml` — the `changes` job, no
  `paths:` on `pull_request`, `Backend: …` / `Frontend: …` job names
