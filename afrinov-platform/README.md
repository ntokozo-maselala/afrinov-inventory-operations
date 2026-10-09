# Afrinov Platform — Implementation

The runnable implementation of the system described in
`../afrinov-docs/docs/`. Where the code and that documentation disagree,
the disagreement is logged in
`../afrinov-docs/docs/13-project-management/technical-debt.md`.

*Last verified against code: 4e6d76f, 2026-10-09.*

## What's in this platform

| Concern | Implementation |
|---|---|
| Architecture | Modular monolith, one backend deployable; modules `identity`, `inventory`, `procurement`, `operations`, `reporting`, `settings`, `audit`, `health`, `migration` (boundaries are folder convention, not enforced) |
| Backend | Node.js, Fastify 5, TypeScript strict, Zod validation |
| Database | PostgreSQL 16 via Prisma 5 |
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Auth | JWT (HS256, 12 hours), bcrypt-hashed passwords; accounts created by an administrator |
| Authorization | Role-based, checked on the server by each route |
| Ledger | ADR-002: `inventory_transactions` is append-only through the API; `inventory_balances` is recomputed from it after every movement; mistakes are reversed (ADR-005) |
| Tests | Vitest unit tests (both apps), backend integration tests against PostgreSQL, one Playwright E2E test |
| Container | Dockerfile for the backend; docker-compose with PostgreSQL |

## What's intentionally NOT in this platform yet

- **Tool check-out/check-in** — tools are issued like other material; the
  check-out state machine is planned.
- **Document Management** — delivery-note references are text
  (`deliveryRef`); no file uploads.
- **Multi-tenancy / multi-site** — single site only (matches
  `sap-not-to-copy.md`).
- **Observability infrastructure** — structured logging via pino and health
  checks are in place; metrics, tracing and alerting are not.
- **Procurement by default** — purchase orders and goods receipts exist but
  are switched off unless `PROCUREMENT_ENABLED=true` (backend) and
  `VITE_PROCUREMENT_ENABLED=true` (frontend).

## Quick start (local dev)

Prerequisites: Node 22 or later (24 recommended; the test tools need 22+),
Docker, npm 10+. The full, current steps are in
[`apps/backend/README.md`](apps/backend/README.md) ("Running it locally").
In short:

```bash
# from afrinov-platform/
npm install

# Database and backend
cd apps/backend
cp .env.example .env          # then set JWT_SECRET (see the backend README)
POSTGRES_PASSWORD=afrinov docker compose up -d db
npx prisma generate
npm run db:migrate
SEED_ADMIN_PASSWORD=<choose one> npm run db:seed
npm run dev                   # http://localhost:4000 (API docs at /api/docs)

# Frontend (new terminal, from afrinov-platform/)
npm run dev:frontend          # http://localhost:5173
```

The seed creates `admin@afrinov.local` with the password you set in
`SEED_ADMIN_PASSWORD`. Without it the seed generates a random password and
does not print it.

### Frontend-only (no backend, no DB)

For inspecting the UI without running the backend. Uses an in-memory mock
store; the real backend is not touched. See
[`apps/frontend/FRONTEND_ONLY.md`](apps/frontend/FRONTEND_ONLY.md).

```bash
cd apps/frontend
npm run dev:frontend-only   # http://localhost:5173, mock data only
```

## Repository layout

```
afrinov-platform/
├── apps/
│   ├── backend/             # Fastify API, Prisma schema and migrations, scripts, integration tests
│   └── frontend/            # React SPA, Vitest tests, Playwright e2e
└── package.json             # npm workspaces
```

```
apps/backend/src/
├── index.ts, server.ts      # entry point and server bootstrap
├── modules/                 # identity, inventory, procurement, operations, reporting,
│                            # settings, audit, health, migration
├── shared/                  # config, db, errors, events, permissions, authorization, inventory helpers
├── openapi/                 # OpenAPI document for /api/docs
└── db/                      # migrate, seed
```

```
apps/frontend/src/
├── pages/                   # one per screen
├── components/, hooks/, lib/
├── api/                     # fetch client, auth, Excel downloads
├── config/                  # feature flags and build guard
├── mock/                    # in-memory API for frontend-only mode
└── App.tsx                  # routes
```

## Mapping docs → code

| Spec area | Doc | Code |
|---|---|---|
| ADRs | `00-governance/decision-log.md` | `apps/backend/prisma/schema.prisma`, `inventory.service.ts` |
| Data model, migrations, import | `07-data/` | `apps/backend/prisma/`, `src/modules/migration/`, `scripts/import-workbook.ts` |
| FR-INV-001…008 | `02-business-analysis/functional-requirements.md` | `modules/inventory/*` (FR-INV-008 not built) |
| FR-PROC-001…004 | same | `modules/procurement/*`, `modules/inventory/stock-receipt.service.ts` |
| FR-REP-001…004 | same | `modules/reporting/*` |
| FR-SEC-001…003 | same | `shared/authorization.ts`, `shared/permissions.ts`, `server.ts` (authenticate) |
| Bounded contexts | `03-domain/bounded-contexts.md` | `modules/<context>/` |
| State machines | `03-domain/state-machines.md` | `procurement.service.ts`, `inventory.service.ts` |
| Resource model | `08-api/resource-model.md` | `modules/*/*.routes.ts` |
| Error model | `08-api/error-model.md` | `shared/errors.ts` + central handler in `server.ts` |

## Validation

From `afrinov-platform/` (covers both apps):

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Backend integration tests need a migrated, seeded PostgreSQL database:
`npm run test:integration` in `apps/backend` (see its README).

## See also

- `../afrinov-docs/docs/` — the documentation tree.
- `../task_context.md` — orientation and how to run the platform locally.
- `../workbook-replacement-roadmap.md` — the plan for replacing the stock workbook.
- `../docs/archive/` — earlier audits and reports, including the
  `IMPLEMENTATION_REPORT.md` delivered with the first build.
