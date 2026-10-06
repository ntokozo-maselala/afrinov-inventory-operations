# Afrinov Platform — Implementation

A production-ready prototype implementing the system described in
`../afrinov-docs/docs/`. The implementation follows the architecture and ADRs
in that documentation set and is intended to be the runnable counterpart to
the specification.

## What's in this prototype

| Concern | Implementation |
|---|---|
| Architecture | Modular monolith, one deployable, internal bounded contexts (`identity`, `inventory`, `procurement`, `reporting`) |
| Backend | Node.js 20, Fastify, TypeScript strict, Zod validation |
| Database | PostgreSQL via Prisma |
| Frontend | React 18 + Vite + TypeScript + TailwindCSS |
| Auth | JWT (HS256), bcrypt-hashed passwords |
| Authorization | Role-based, server-side enforced, deny-by-default |
| Ledger | ADR-002: `inventory_transactions` is append-only; `inventory_balances` is recomputed |
| Tests | Vitest unit + API smoke |
| Container | Docker + docker-compose for local DB |

## What's intentionally NOT in this prototype

These are listed explicitly so the boundaries are clear, and not because they
were forgotten:

- **Operations** bounded context — project consumption reporting is wired
  (transactions carry a `projectNumber`) but the Projects CRUD UI is omitted.
- **Document Management** bounded context — delivery-note references are
  captured as text (`deliveryRef`); binary uploads are not implemented.
- **Multi-tenancy** — single site only (matches `sap-not-to-copy.md`).
- **Tool check-out/check-in endpoints** — the Tool aggregate is modelled
  (Material.category=TOOLS) but the dedicated UI + state machine transitions
  are deferred. Issuing a tool records an `Issue` transaction; `IN_STORE` /
  `CHECKED_OUT` semantics can be added on top without schema changes.
- **Full migration script for the `.xlsm`** — the data model can ingest the
  workbook but a one-off Excel importer is intentionally not in the prototype.
- **Observability infra** — structured logging via pino is in place; metrics,
  tracing, alerting are deployment-layer concerns (see Operations docs).

## Quick start (local dev)

Prerequisites: Node 20+, Docker, npm 10+.

### Full system (backend + frontend + database)

```bash
# 1. Start Postgres
cd apps/backend
docker compose up -d db

# 2. Backend
cp .env.example .env       # adjust if needed
npm install
npm run db:migrate
npm run db:seed
npm run dev                # http://localhost:4000

# 3. Frontend (new terminal)
cd ../frontend
npm install
npm run dev                # http://localhost:5173
```

Default admin (after seed): `admin@afrinov.local` / `ChangeMe!2026` — **change
on first login**.

### Frontend-only (no backend, no DB)

For inspecting the UI without running the backend. Uses an in-memory mock
store; the real backend is not touched. See
[`apps/frontend/FRONTEND_ONLY.md`](apps/frontend/FRONTEND_ONLY.md) for the
full guide.

```bash
cd apps/frontend
npm run dev:frontend-only   # http://localhost:5173, mock data only
```

## Repository layout

```
afrinov-platform/
├── apps/
│   ├── backend/             # Fastify API
│   └── frontend/            # React SPA
└── (workspace package.json)
```

```
apps/backend/src/
├── modules/
│   ├── identity/            # users, roles, auth
│   ├── inventory/           # materials, locations, transactions, balance
│   ├── procurement/         # suppliers, POs, goods receipts
│   └── reporting/           # read-only views (no mutations)
├── shared/                  # errors, events, db, decimal helpers, permissions
├── infrastructure/http/     # server bootstrap (in server.ts)
└── db/                      # migrate, seed
```

```
apps/frontend/src/
├── pages/                   # one per workflow
├── api/                     # fetch client + token storage
└── App.tsx                  # routes + layout
```

## Mapping docs → code

| Spec area | Doc | Code |
|---|---|---|
| ADRs | `00-governance/decision-log.md` | `apps/backend/prisma/schema.prisma`, `inventory.service.ts` |
| FR-INV-001…008 | `02-business-analysis/functional-requirements.md` | `modules/inventory/*` |
| FR-PROC-001…004 | same | `modules/procurement/*` |
| FR-REP-001…004 | same | `modules/reporting/reporting.service.ts` |
| FR-SEC-001…003 | same | `shared/authorization.ts`, `server.ts` (auth preHandler) |
| Bounded contexts | `03-domain/bounded-contexts.md` | `modules/<context>/` |
| State machines | `03-domain/state-machines.md` | `procurement.service.ts`, `inventory.service.ts` |
| Resource model | `08-api/resource-model.md` | `modules/*/*.routes.ts` |
| Error model | `08-api/error-model.md` | `shared/errors.ts` + central handler in `server.ts` |

## Validation

```bash
# Backend
cd apps/backend
npm run typecheck
npm run test
npm run build

# Frontend
cd ../frontend
npm run typecheck
npm run build
```

## See also

- `../afrinov-docs/docs/` — the source-of-truth specification.
- `IMPLEMENTATION_REPORT.md` — the executive summary delivered with this
  build, including validation results, known limitations, and next steps.