# Verification Report

**Date:** 2026-10-12  
**Workspace:** `afrinov-platform/`  
**Runtime:** Node 24.21.0, npm 11.19.0 on Windows PowerShell. `npm` invoked the blocked PowerShell shim; all project commands below used `npm.cmd`.

## Commands and outcomes

| Command | Working directory | Exit/status | Result and evidence |
|---|---|---:|---|
| `git status --short --branch`; `git log -5 --oneline` | Repository root | 0 | Branch `main`, HEAD `e2063cf`; initial tree had only pre-existing untracked `backend-audit.md` and `build-errors.md`. No staged/user modifications. |
| `node --version`; `npm.cmd --version` | Repository root | 0 | Node `v24.21.0`, npm `11.19.0`. Plain `npm --version` fails because PowerShell blocks `npm.ps1`. |
| `npm.cmd ls --depth=0` | `afrinov-platform/` | 1 initially | Confirmed unmet backend workspace and root `cross-env`; initial tree was incomplete. |
| `npm.cmd ci --no-audit --no-fund` | `afrinov-platform/` | 0 | Installed 740 packages from lockfile. npm 11 initially withheld Prisma client/engine/CLI and esbuild lifecycle scripts. Lockfile stayed unchanged. |
| `npm.cmd install-scripts approve @prisma/client @prisma/engines prisma esbuild` | `afrinov-platform/` | 0 | Added scoped `allowScripts` entries to workspace `package.json`. |
| `npm.cmd run typecheck` (before engine network access) | `afrinov-platform/` | 1 | Prisma generation could not fetch the Windows query engine from `binaries.prisma.sh`; frontend workspace typecheck itself completed. |
| `npm.cmd run typecheck` (after network access) | `afrinov-platform/` | 0 | Prisma Client 5.22.0 generated; backend tools typecheck and frontend typecheck pass. |
| `npm.cmd run lint` | `afrinov-platform/` | 0 | ESLint completed for backend and frontend. |
| `npm.cmd test` | `afrinov-platform/` | 0 | Backend: 40 files, 550 tests passed. Frontend: 37 files, 384 tests passed. Total 934 passing unit tests. |
| `npm.cmd run build` | `afrinov-platform/` | 0 | Backend Prisma generation and TypeScript build passed; frontend typecheck and Vite production bundle passed. |
| `npm.cmd run build:frontend-only` | `afrinov-platform/apps/frontend/` | 0 | Demo-mode TypeScript and Vite production build passed. |
| `npm.cmd run dev:frontend-only` | `afrinov-platform/apps/frontend/` | Running, stopped by auditor | Vite 8.2.2 reported ready at `http://localhost:5173/`. No backend was needed. |
| `npm.cmd run dev:frontend` | `afrinov-platform/` | Running, stopped by auditor | Root workspace alias started Vite; `GET http://localhost:5173/` returned HTTP 200. This verifies the dev server shell, not backend API requests. |
| `npm.cmd run dev` | `afrinov-platform/apps/backend/` | 1 | `node: .env: not found`; no local backend environment file exists. |
| `npm.cmd run dev` | `afrinov-platform/` | 1 | `Missing script: "dev"`; workspace root has no combined dev script. |
| `docker --version` | Repository root | 1 | Docker command is not installed/on PATH. |
| `npm.cmd run test:integration` | Backend workspace | NOT RUN | Requires migrated/seeded PostgreSQL; Docker/DB unavailable. |
| `npm.cmd run db:migrate` / `db:seed` | Platform/backend workspace | NOT RUN | No database configured; migration/seed side effects were not attempted. A `--help` probe for the migration script hit a Node `uv_os_get_passwd` environment error and did not perform a migration. |
| `npm.cmd audit --omit=dev` | `afrinov-platform/` | 0 | Found 0 production dependency vulnerabilities. |
| `npm.cmd audit` | `afrinov-platform/` | 1 (findings) | Found 7 dev-tree advisories: 2 moderate, 5 high. npm's suggested `--force` changes Tailwind to 4.3.3, a breaking major change; not applied. |
| `git diff --check` | Repository root | 0 | No whitespace errors in tracked diff. |

## Build warnings

Builds report Vite config loader and React plugin `esbuild` deprecations, ExcelJS direct `eval`, and a minified ExcelJS chunk around 1.06 MB (gzip ~247 KB). They are warnings; the builds exit successfully. The Vite 8.2.2 and React plugin 4.7.0 peer range mismatch remains an open compatibility finding.

## Final working tree

- Modified: `afrinov-platform/package.json` only, for npm 11's four targeted install-script approvals.
- Unchanged: `afrinov-platform/package-lock.json`, source code, Tailwind/PostCSS config, environment files, and migrations.
- Preserved pre-existing untracked files: `backend-audit.md`, `build-errors.md`.
- New requested artifacts: `CODEBASE_AUDIT_REPORT.md`, `FAILURE_REGISTER.md`, `ROOT_CAUSE_ANALYSIS.md`, `RECOVERY_PLAN.md`, and this report.

## Unverified or blocked

- Backend startup with a configured `.env`, DB readiness, seed, and live API requests.
- PostgreSQL integration tests, migration execution, and production-like migration safety.
- Playwright E2E and browser-console/visual checks.
- Remote CI results and deployment behavior.
- Production readiness; open findings in `FAILURE_REGISTER.md` and the existing technical-debt register remain.
