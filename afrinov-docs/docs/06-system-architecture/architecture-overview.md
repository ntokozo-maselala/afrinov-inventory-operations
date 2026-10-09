# Architecture Overview

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Style
**Modular monolith.** One deployable backend (a Fastify 5 API in
`afrinov-platform/apps/backend`) and one React single-page frontend
(`afrinov-platform/apps/frontend`), in one npm-workspaces repository. The
backend is organised into modules under `src/modules/` that broadly follow
the bounded contexts in `03-domain/bounded-contexts.md`: `identity`,
`inventory`, `procurement`, `operations` (projects and recipients),
`reporting`, plus `settings`, `audit`, `health` and `migration` (the
workbook import). This is the right choice at Afrinov's scale (per
ADR-001): it avoids the operational overhead of microservices.

The module boundaries are a folder convention only. Nothing in the build or
lint configuration enforces them, and several modules import each other or
read each other's tables (see `module-architecture.md`, and TD-004 in
`13-project-management/technical-debt.md`).

## Layers within each module
```
HTTP layer       *.routes.ts    — Zod request validation, permission check, calls a service
        |
Service layer    *.service.ts   — business rules and the database transaction (Prisma $transaction)
        |
Prisma Client    shared/db.ts   — one PrismaClient for the whole process, PostgreSQL 16
```
There is no separate domain layer and no repository layer: services
contain the business rules and call the Prisma client directly. A few route
files also query Prisma directly (`audit.routes.ts`, `health.routes.ts`).

## Cross-cutting
Shared code lives in `src/shared/` and is used by every module:
configuration and its validation (`config.ts`), the Prisma client
(`db.ts`), the error model (`errors.ts`), role permissions
(`permissions.ts`) and the per-request permission check
(`authorization.ts`), an in-process domain-event dispatcher (`events.ts`),
decimal helpers, and the inventory balance and stock-status helpers
(`shared/inventory/`). Authentication is a Fastify decorator
(`app.authenticate`) registered in `server.ts`; each route opts in with a
`preHandler`. Audit entries are written by each service, not by shared
middleware — see `10-security/audit-and-accountability.md`.

## Why not microservices (yet)
No team-scaling or independent-deployment pressure exists today; splitting
now would add distributed-systems complexity (network calls, eventual
consistency, service discovery) to solve a problem Afrinov doesn't have.
*Unverified:* whether a future split (e.g. Reporting as its own service) is
possible without redesign — today the reporting module reads inventory and
material tables directly, so it would need read interfaces first.

## Evidence
- `afrinov-platform/package.json:6-9` — npm workspaces `apps/*`
- `afrinov-platform/apps/backend/src/server.ts:45-281` — Fastify bootstrap and route registration under `/api/v1`
- `afrinov-platform/apps/backend/src/modules/` — module folders
- `afrinov-platform/apps/backend/src/shared/db.ts:9-13` — single PrismaClient
- `afrinov-platform/apps/backend/src/modules/audit/audit.routes.ts:31` — route querying Prisma directly
- `afrinov-platform/apps/backend/.eslintrc.cjs` — no import-boundary rules
