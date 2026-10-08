# Task Context

Orientation for anyone, human or AI assistant, starting work in this
repository. It replaces an earlier exploration summary that described a
different backend (Express, Drizzle, `in-memory-pg`) and was no longer
accurate.

Rewritten 2026-10-07. Where this file and the code disagree, trust the code
and update this file.

## Repository layout

| Path | What it is |
| --- | --- |
| `afrinov-docs/docs/` | Specification: product, domain, processes, architecture, API, security, testing, operations |
| `afrinov-platform/` | npm workspaces monorepo; install dependencies here |
| `afrinov-platform/apps/backend/` | REST API: Fastify 5, Prisma 5, PostgreSQL 16, Zod, Vitest |
| `afrinov-platform/apps/frontend/` | React 18 + Vite + Tailwind SPA, Vitest and Playwright |
| `.github/workflows/` | CI (`backend-ci.yml`, `frontend-ci.yml`) |
| `gap-analysis.md` | What the platform replaces in the old spreadsheet, and the priorities |
| `decision-log.md` | Architecture decisions |

## Where to start

- Backend: `afrinov-platform/apps/backend/README.md` covers setup, environment
  variables, scripts, tests, code layout and the API.
- Platform overview: `afrinov-platform/README.md`.
- Specification: `afrinov-docs/docs/README.md`.

## Key facts

- Backend modules live in `apps/backend/src/modules/` (identity, inventory,
  procurement, operations, reporting, settings, audit, health), each with
  `*.routes.ts` and `*.service.ts`.
- Stock balances are derived: every stock change is an inventory transaction,
  and balances are recalculated from the ledger (ADR-002).
- Roles: `ADMIN`, `STORE_CONTROLLER`, `PROCUREMENT`, `APPROVER`, `TECHNICIAN`,
  `VIEWER`. Role permissions are in `apps/backend/src/shared/permissions.ts`.
- Unit tests mock the database; integration tests in
  `apps/backend/integration/` need a real PostgreSQL database.
