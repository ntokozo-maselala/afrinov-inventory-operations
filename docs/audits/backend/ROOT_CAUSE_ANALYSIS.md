# Root Cause Analysis

**Date:** 2026-10-12  
**Incident:** Reported `npm run typecheck`, `npm run dev`, `npm run dev:frontend-only`, and related commands failing.

## Confirmed causal chain

```text
Incomplete workspace node_modules
  ├─ missing @afrinov/backend / cross-env / prisma / tsx
  │    ├─ backend pretypecheck cannot run Prisma generation
  │    ├─ backend build/test cannot start
  │    ├─ backend dev cannot start its watcher
  │    └─ frontend-only command cannot invoke cross-env
  └─ incomplete/broken module resolution
       ├─ frontend typecheck reports missing test-library exports and Node types
       ├─ Vitest cannot resolve Vite
       └─ frontend build stops before CSS processing

npm 11 lifecycle-script policy
  └─ Prisma engine/client and esbuild binaries withheld on clean install
       └─ Prisma generation / native build tooling remain unavailable until approved

No apps/backend/.env + no Docker/PostgreSQL
  ├─ backend `dev` exits because Node cannot load .env
  └─ live readiness, migrations, and DB integration tests cannot be verified

No repository-root package.json + no platform-root `dev` script
  └─ generic `npm run dev` from either root is an invocation error

PowerShell resolves npm.ps1 under restrictive execution policy
  └─ `npm` fails before npm reads workspace scripts; `npm.cmd` bypasses this shell shim issue
```

## Tailwind/PostCSS incident

The current failure graph does **not** contain an active Tailwind/PostCSS root cause. The installed frontend package is Tailwind 3.4.19, and `apps/frontend/postcss.config.js` uses the v3 `tailwindcss` PostCSS plugin with v3 CSS directives. The frontend production build successfully processes CSS. The root install has a separate transitive Tailwind 4.3.3 through another package; that is not the frontend workspace's Tailwind resolution. The previous `build-errors.md` documents an earlier v4 mismatch and is stale for this checkout.

The important current Tailwind issue is instead F-08: the v3 transitive tree contains reported dev-dependency advisories. npm proposes a forced Tailwind v4 major update, which would recreate the kind of config mismatch described by the historical incident if done without migration.

## Why the commands failed, then passed

1. The initial dependency listing showed the install tree was incomplete. Installing from the committed workspace lockfile restored expected dependencies without changing that lockfile.
2. npm 11 did not run four dependency lifecycle scripts. Recording targeted approvals made required setup explicit; Prisma's engine still needed network access to its binary host.
3. Once Prisma generation succeeded, backend and frontend typechecks passed with no source edits. This disproves the older untracked `backend-audit.md` as current evidence of 210 errors due to an ungenerated client: the present backend `pretypecheck` already runs `db:generate`.
4. Frontend unit tests (384) and backend unit tests (550) passed. Workspace build compiled the backend and generated frontend bundle.
5. Backend dev still cannot be demonstrated because `tsx --env-file=.env` correctly fails on a missing local file; PostgreSQL/Docker are absent. This is a prerequisite gap, not evidence of a backend runtime defect.

## Root causes vs. symptoms

| Category | Findings |
|---|---|
| Root cause recovered | Incomplete install tree; npm 11 withheld lifecycle setup scripts |
| Root cause environmental | Restricted egress to Prisma/npm advisory hosts; absent `.env`, Docker, and PostgreSQL |
| Invocation/shell | Commands run from repository root or monorepo root without a matching script; PowerShell blocks `npm.ps1` |
| Historical symptom now absent | Tailwind v4 loaded as PostCSS plugin; current workspace resolves Tailwind v3 and builds |
| Independent residuals | Dependency advisories, Vite/plugin peer mismatch, old backend CI runtime, documented database/security technical debt |

## Confidence and limits

The install, command, and Tailwind findings are confirmed by direct command output and lock/install inspection. Backend integration behavior, actual browser-to-API behavior, deployment, migration safety against a production-like database, and CI are unverified. Static code inspection and passing unit tests do not establish production readiness.
