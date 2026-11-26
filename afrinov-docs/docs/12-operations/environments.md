<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-12-006</b></td>
<td align="center"><b><i>Environments</i></b><br><i>Operations</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-12-006 updated=2026-11-26 by="Ntokozo Maselala" body=c41bca63c678 -->

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
