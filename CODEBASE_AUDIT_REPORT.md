# Codebase Audit Report

**Audit date:** 2026-10-12  
**Repository:** `afrinov-inventory-operations`, branch `main`, HEAD `e2063cf`  
**Scope:** Repository layout, workspace scripts and lockfiles, local toolchain, reported command failures, frontend/backend build and test paths, CI, environment and database prerequisites, and dependency audit.

## Executive assessment

The application source is in substantially better shape than the initial command failures suggested. The immediate failures came from an incomplete `node_modules` tree. After a lockfile-based install and allowing the dependency setup scripts required by npm 11, both workspaces typecheck, lint, build, and their unit tests pass. The frontend-only server starts, and both normal and frontend-only frontend bundles build.

The Tailwind/PostCSS incident is **not present in the current installed frontend workspace**. The frontend resolves Tailwind 3.4.19, whose PostCSS plugin matches the existing v3 configuration and CSS directives. The root dependency tree also contains Tailwind 4.3.3 transitively, but that is not the version resolved from the frontend workspace's PostCSS configuration. The untracked `build-errors.md` describes an earlier v4 state and must not be treated as current evidence.

The backend cannot be fully started or integration-tested in this environment: `apps/backend/.env` is absent and Docker is not installed. The root package has no `dev` script; supported commands are `dev:backend` and `dev:frontend` from `afrinov-platform/`, or `dev` within an app workspace. npm's full advisory endpoint reports **7 development-tree vulnerabilities (2 moderate, 5 high)**, while `npm audit --omit=dev` reports zero. No dependency upgrade was applied because npm's suggested force fix crosses the Tailwind major version and would require a deliberate migration.

This is a recovered local build/test workflow, **not a production-readiness sign-off**. The existing technical-debt register records open database integrity, authorization, audit coverage, CI runtime, and other product risks.

## Repository and architecture

- The Git repository root is `C:\Users\Ntokozo Maselala\afrinov-inventory-operations`; there is no root `package.json`.
- The runnable monorepo is `afrinov-platform/`, an npm workspaces project with `apps/backend` and `apps/frontend`. Its authoritative lockfile is `afrinov-platform/package-lock.json` (lockfile v3).
- A separate tracked root `package-lock.json` has no matching root manifest/package entry. It is not the active workspace lockfile and was left unchanged.
- Backend: Fastify 5, TypeScript, Prisma 5, PostgreSQL, Zod, Vitest. Frontend: React 18, Vite 8, TypeScript, Tailwind 3, Vitest, Playwright.
- Product architecture is a modular monolith. Backend entry points are `src/index.ts` and `src/server.ts`; the SPA entry is `src/main.tsx` and routes are in `src/App.tsx`.
- Product and setup documentation is in `afrinov-docs/docs/`; onboarding is in `afrinov-docs/docs/13-project-management/onboarding.md`; prior technical debt is tracked in `afrinov-docs/docs/13-project-management/technical-debt.md`.
- No `AGENTS.md` was found in the repository. Existing untracked `backend-audit.md` and `build-errors.md` were read and preserved.

## Toolchain and dependency findings

| Item | Manifest/lock evidence | Observed local version/state |
|---|---|---|
| Node | Platform docs require Node 22+ | Node 24.21.0 |
| npm | Workspace docs require npm 10+ | npm 11.19.0; use `npm.cmd` in this PowerShell environment because `npm.ps1` is blocked by execution policy |
| TypeScript | Both workspaces declare `^5.5.3` | 5.9.3 |
| Vite | Frontend declares `^8.2.2` | 8.2.2 |
| React | Frontend declares React 18 | 18.3.1 |
| React Vite plugin | Frontend declares `@vitejs/plugin-react ^4.3.1` | 4.7.0, whose peer range ends at Vite 7; Vite 8 build/dev smoke checks pass, but this is an unsupported peer combination |
| Tailwind | Frontend declares `^3.4.19` | Frontend workspace resolves 3.4.19; a separate root-level 4.3.3 is transitive |
| PostCSS | Frontend declares `^8.4.39` | 8.5.26 |
| Prisma | Backend declares `^5.18.0` | CLI/client 5.22.0 |
| Install scripts | npm 11 blocks unapproved package scripts by default | Prisma engine/client and esbuild setup scripts were approved in the workspace manifest so clean installs can prepare required binaries |

Before reinstall, npm reported missing workspace dependencies (`@afrinov/backend`, `cross-env`) and runtime tools (`prisma`, `tsx`, `cross-env`); the tree also had broken frontend module resolution. `npm.cmd ci --no-audit --no-fund` installed 740 packages from the existing lockfile. The lockfile did not change. Prisma engine download initially failed under sandbox network restrictions; after network approval, Prisma generation succeeded.

## Current command map

Run workspace-wide checks from `afrinov-platform/`:

| Command | Intended root | What it runs | Result |
|---|---|---|---|
| `npm run typecheck` | `afrinov-platform/` | Backend Prisma generation + tools typecheck; frontend `tsc -b --noEmit` | PASS after install/network approval |
| `npm run lint` | `afrinov-platform/` | ESLint in both workspaces | PASS |
| `npm test` | `afrinov-platform/` | Backend and frontend Vitest suites | PASS: 40 files/550 tests backend; 37 files/384 tests frontend |
| `npm run build` | `afrinov-platform/` | Backend Prisma generation + TypeScript build; frontend TypeScript + Vite build | PASS; warnings noted in `VERIFICATION_REPORT.md` |
| `npm run dev:backend` | `afrinov-platform/` | Backend `dev` script | BLOCKED: no `apps/backend/.env`; Docker/Postgres also absent |
| `npm run dev:frontend` | `afrinov-platform/` | Frontend Vite server against API proxy | PASS: server ready and `GET /` returned HTTP 200 |
| `npm run dev:frontend-only` | `afrinov-platform/apps/frontend/` | `cross-env VITE_FRONTEND_ONLY=true vite` | PASS: Vite reported ready on port 5173 |
| `npm run build:frontend-only` | `afrinov-platform/apps/frontend/` | TypeScript + demo-mode Vite build | PASS |
| `npm run preview` | `afrinov-platform/apps/frontend/` | Serve built frontend | Not run |
| `npm run test:integration` | `afrinov-platform/apps/backend/` | Real HTTP tests against PostgreSQL | BLOCKED: no Docker/database or local env |
| `npm run db:migrate`, `npm run db:seed` | `afrinov-platform/` aliases or backend workspace | Database mutation/seed | NOT RUN: no database; migration/seed side effects are intentionally avoided |
| `npm run dev` | Workspace-specific only | Backend hot reload or ordinary frontend Vite, depending on workspace | From repository root: FAILS because no root package; from platform root: FAILS because no root `dev` script; backend root: BLOCKED by missing `.env` |

There is no root full-stack `dev` script, frontend `test:e2e` script, or package-level database-start script. Playwright config and one E2E test exist, but no E2E command is wired into package scripts or CI.

## Product and operational review

- Backend configuration validates required database/JWT settings before startup. CORS defaults are restricted in development and disabled in production unless configured. Fastify includes helmet, JWT, rate limiting, central errors, health/readiness routes, and server-side permission checks.
- Frontend includes route/component tests, mock API mode, API proxy, and a production-build guard against demo flags. Unit tests and static checks pass, but browser behavior against a live API was not exercised.
- Backend unit tests use mocks; integration tests require a real PostgreSQL instance and were not run. Existing docs identify gaps including missing `inventory_balances` foreign keys in migrations, app-convention-only ledger/audit immutability, incomplete audit events, reads permitted to any authenticated role for some data, a hard-coded E2E test credential, and Node 20 in backend CI/Docker. See TD-005, TD-006, TD-008, TD-014, TD-017, TD-018 in the technical-debt register.
- CI definitions were inspected but not run remotely. Backend CI uses Node 20 while frontend CI uses Node 24; the backend README itself says local development and current tests need Node 22+.
- `npm audit --omit=dev`: 0 vulnerabilities. Full `npm audit`: 7 findings (2 moderate, 5 high) in the development dependency graph, associated with Tailwind 3.4.19's transitive CSS/glob chain. npm proposes `--force` and Tailwind 4.3.3, which is a breaking major migration. No audit fix was applied.
- Production bundles build, but the frontend emits a direct `eval` warning from ExcelJS and a >500 kB ExcelJS chunk warning. These do not fail the build; they remain performance/security review items.

## Files changed

Only `afrinov-platform/package.json` was modified: npm 11 install-script approvals were recorded for the four packages whose setup scripts are necessary for Prisma and esbuild. `package-lock.json` and application source/configuration were not changed. Generated build output and installed dependencies are ignored. Existing untracked audit notes were preserved.

See [FAILURE_REGISTER.md](FAILURE_REGISTER.md), [ROOT_CAUSE_ANALYSIS.md](ROOT_CAUSE_ANALYSIS.md), [RECOVERY_PLAN.md](RECOVERY_PLAN.md), and [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) for evidence and remaining gates.
