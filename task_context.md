# Task Context

Orientation for anyone, human or AI assistant, starting work in this
repository.

Rewritten 2026-10-08, at the end of Phase 0. Where this file and the code
disagree, trust the code and update this file.

## What this is

A platform to replace Afrinov's stock workbook
(`AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm`), which tracks consumables,
tooling/PPE/electrical, fasteners and project material through IN/OUT logs.
The workbook itself is git-ignored and never committed.

`workbook-replacement-roadmap.md` holds the plan. Phase 0 (clean-up and
controls) is done; Phase 1 (daily store workflows: receive stock, Issued To,
returns) is next.

## Repository layout

| Path | What it is |
| --- | --- |
| `afrinov-platform/` | npm workspaces monorepo; install dependencies and run scripts here |
| `afrinov-platform/apps/backend/` | REST API: Fastify 5, Prisma 7, PostgreSQL 16, Zod 4, Vitest |
| `afrinov-platform/apps/frontend/` | React 19 + Vite 8 + Tailwind 4 SPA, Vitest and Playwright |
| `afrinov-docs/docs/` | Original specification: product, domain, processes, architecture, API, security, testing, operations |
| `.github/workflows/` | CI: `backend-ci.yml`, `frontend-ci.yml`, `security-ci.yml`, `codeql.yml` |
| `workbook-replacement-roadmap.md` | The plan, phase by phase, with what is done |
| `decision-log.md` | Architecture decisions, ADR-001 onwards |
| `gap-analysis.md`, `sap-lessons-for-afrinov.md` | Early analysis of the workbook and of SAP |
| `docs/archive/` | Earlier audits and reports, kept for history; several are out of date |

## Running it locally

Follow `afrinov-platform/apps/backend/README.md` ("Running it locally"): it
covers Docker Postgres, `.env`, migrations and seeding the admin account.
Then, from `afrinov-platform/`, in two terminals:

```sh
npm run dev:backend    # API on http://localhost:4000 (docs at /api/docs)
npm run dev:frontend   # app on http://localhost:5173
```

`npm run dev:frontend-only`, run in `apps/frontend/`, starts the frontend on
mock data with no backend.

Use Node 24, as CI and the backend Docker image do.

## Checking a change

From `afrinov-platform/`: `npm run lint`, `npm run typecheck`, `npm test` and
`npm run build` cover both apps. The backend integration tests
(`npm run test:integration` in `apps/backend/`) need a real PostgreSQL
database; CI runs them on every backend pull request.

## Key facts

- **Stock is a ledger.** Every change is an inventory transaction and balances
  are recalculated from it (ADR-002). Posted transactions are never edited;
  mistakes are corrected with a reversal that points at the original
  (ADR-005, `POST /inventory-transactions/:id/reversal`).
- **Stock can never go below zero.** This is a fixed rule, not a setting.
- **Recipients ("Issued To")** are the people and places stock is issued to:
  workers, machines, client sites and contractors (ADR-008). They are not
  users; manage them on the Recipients page.
- **Accounts are created by an administrator.** There is no self-registration
  (ADR-006).
- **Passwords:** at least 12 characters. Users change their own from the
  header; an administrator resets one under Settings → Users, and the user must
  then choose a new one before anything else. Five wrong passwords lock an
  account for 15 minutes. Every sign-in attempt is audited (ADR-024).
- **Nobody approves a project order they raised** (ADR-022); the store
  controller approves his own Stores orders within his limit (ADR-021).
- **The seed writes only the bootstrap**; demo data comes from
  `npm run db:seed:demo`, never in production (ADR-023).
- **Roles:** `ADMIN`, `STORE_CONTROLLER`, `PROCUREMENT`, `APPROVER`,
  `TECHNICIAN`, `VIEWER`. Server permissions are in
  `apps/backend/src/shared/permissions.ts`. In the UI, `useHasRole()` lets
  ADMIN pass any check.
- **Purchase orders** go DRAFT → PENDING_APPROVAL → APPROVED →
  PARTIALLY_RECEIVED → RECEIVED → CLOSED, or CANCELLED (ADR-007). Procurement
  is on by default; `PROCUREMENT_ENABLED=false` (backend) and
  `VITE_PROCUREMENT_ENABLED=false` (frontend) switch it off (ADR-019).
- **Stores and Projects are kept apart** (ADR-020, ADR-021). An order with a
  project is Procurement's: raised on New purchase order, seen with
  `view:purchase_order`, approved by approvers, and its delivery to site
  confirmed on the order (no stock added). An order without a project is a
  Stores order: raised, seen, approved (within the storeman's limit) and
  received into stock by the store controller with `order:stores_stock`, in
  Store → Order stock. Each side's orders are not found to the other. The
  server enforces it (`kindsSeen`, `requireForOrder` in
  `procurement.routes.ts`); the screens follow `lib/orderKind.ts`.
- **Requests for quotation** go DRAFT → SENT → AWARDED, or CANCELLED from
  DRAFT or SENT (`rfq.service.ts`). Quotes are recorded while SENT; the
  award raises a draft purchase order in the same transaction. They are for
  one project and its material only, use the purchase order permissions and
  sit behind the same procurement switch.
- **Settings** come from the catalog in `settings.service.ts`. Removing a key
  there retires it; the seed deletes its row.
- **Production builds** of the frontend fail if `VITE_FRONTEND_ONLY` or
  `VITE_DEMO_AUTH_ENABLED` is true.
- **Tests:** unit tests mock the database with in-memory fakes; integration
  tests in `apps/backend/integration/` use a real database.

## Known follow-ups

The production readiness assessment (2026-10-30) and its remediation plan are
in `docs/audits/production-readiness/`. What remains open before go-live is
listed in its remediation plan; most of it is hosting, backups and a restore
drill, which need decisions outside the repository.
