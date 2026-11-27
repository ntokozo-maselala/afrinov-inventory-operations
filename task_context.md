<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-GEN-008</b></td>
<td align="center"><b><i>Task Context</i></b><br><i>General</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-GEN-008 updated=2026-11-27 by="Ntokozo Maselala" body=3f9faf8b1ac6 -->

# Task Context

Orientation for anyone, human or AI assistant, starting work in this
repository.

Rewritten 2026-10-08, at the end of Phase 0; brought up to date on
2026-11-27 (TD-021). Where this file and the code disagree, trust the code
and update this file.

## What this is

A platform to replace Afrinov's stock workbook
(`AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm`), which tracks consumables,
tooling/PPE/electrical, fasteners and project material through IN/OUT logs.
The workbook itself is git-ignored and never committed.

`workbook-replacement-roadmap.md` holds the plan. Every checklist item of
Phases 0 to 3 (controls, daily store workflows, data migration, reporting)
and Phase 5 (tools) is ticked there; the roadmap's opening gap table, which
marks receiving, Issued To and the import "Missing", describes the start, not
now. Phase 4 (pilot and go-live: production environment, accounts,
training, parallel run, cutover) is open. What stands between the code and a
production release is in
`docs/engineering/PRODUCTION_READINESS_ASSESSMENT.md`.

## Repository layout

| Path | What it is |
| --- | --- |
| `afrinov-platform/` | npm workspaces monorepo; install dependencies and run scripts here |
| `afrinov-platform/apps/backend/` | REST API: Fastify 5, Prisma 7, PostgreSQL 16, Zod 4, Vitest 5 |
| `afrinov-platform/apps/frontend/` | React 19 + Vite 8 + Tailwind 4 SPA, Vitest and Playwright |
| `afrinov-docs/docs/` | Product, domain, processes, architecture, API, security, testing and operations references |
| `.github/workflows/` | CI: `backend-ci.yml`, `frontend-ci.yml`, `security-ci.yml`, `codeql.yml`, `docs-ci.yml` |
| `docs/engineering/` | How the repository is verified and released: gates, security controls, risks, readiness |
| `workbook-replacement-roadmap.md` | The plan, phase by phase, with what is done |
| `afrinov-docs/docs/00-governance/decision-log.md` | Architecture decisions, ADR-001 onwards (the root `decision-log.md` points there) |
| `gap-analysis.md`, `sap-lessons-for-afrinov.md` | Early analysis of the workbook and of SAP (pointers to `afrinov-docs/docs/`) |
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

Use Node 24: CI, the backend Docker image and the test tools all run on it.

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
- **Roles:** `ADMIN`, `STORE_CONTROLLER`, `PROCUREMENT`, `APPROVER` (view only),
  `TECHNICIAN`, `VIEWER`, `SALES` (sales RFQs), and those who sign orders:
  `PROCUREMENT_MANAGER`, `DIRECTOR`, `CEO`, `WORKSHOP_MANAGER` (ADR-030). Server permissions are in
  `apps/backend/src/shared/permissions.ts`. In the UI, `useHasRole()` lets
  ADMIN pass any check.
- **Purchase orders** go DRAFT → PENDING_APPROVAL → APPROVED →
  PARTIALLY_RECEIVED → RECEIVED → CLOSED, or CANCELLED (ADR-007). Procurement
  is on by default; `PROCUREMENT_ENABLED=false` (backend) and
  `VITE_PROCUREMENT_ENABLED=false` (frontend) switch it off (ADR-019).
- **Stores and Projects are kept apart** (ADR-020, ADR-021). An order with a
  project is Procurement's: raised on New purchase order, seen with
  `view:purchase_order`, signed by role and value (ADR-030); its delivery is received by
  the store into stock held for its project (ADR-027), through a receiving
  view with no prices. An order without a project is a
  Stores order: raised, seen and received into stock by the store controller
  with `order:stores_stock`, in Store → Order stock, and signed there by the
  Procurement Manager or Workshop Manager (ADR-030). Each side's orders are not found to the other. The
  server enforces it (`kindsSeen`, `requireForOrder` in
  `procurement.routes.ts`); the screens follow `lib/orderKind.ts`.
- **Stock carries its project** (ADR-027). Each movement says whose stock it
  is (`held_for_project`, null for Stores stock), and balances are per item,
  location and project. A project's own stock is issued only to that project;
  Stores measures (status, re-order, alerts) count Stores stock only. Leftovers
  from before keep their project on the item. See
  `afrinov-docs/docs/13-project-management/roadmaps/project-material-through-the-store-roadmap.md`.
- **Requests for quotation** go DRAFT → SENT → AWARDED, or CANCELLED from
  DRAFT or SENT (`rfq.service.ts`). Quotes are recorded while SENT; the
  award raises a draft purchase order in the same transaction. They are for
  one project and its material only, use the purchase order permissions and
  sit behind the same procurement switch.
- **Settings** come from `SETTING_CATALOG` in `settings.service.ts`. A key is
  added only with the code that reads it; one nothing reads is retired with a
  migration that deletes its row (ADR-035).
- **Production builds** of the frontend fail if `VITE_FRONTEND_ONLY` or
  `VITE_DEMO_AUTH_ENABLED` is true.
- **Tests:** unit tests mock the database with in-memory fakes; integration
  tests in `apps/backend/integration/` use a real database.

## Known follow-ups

The four follow-ups listed here before (the balance foreign keys, Node 20,
the GitHub Actions versions, `npm audit` findings) are all resolved
(TD-005, TD-018; `npm audit` reports none). What is open now is kept in the
registers, not here:

- `afrinov-docs/docs/13-project-management/technical-debt.md` (TD-) and
  `docs/engineering/RISK_REGISTER.md` (SEC-, OPS-, GATE-, …) — the current
  list, the release gate among them.
- `docs/audits/current-defects-report.md` — a dated extract of those
  registers; each entry that names code was checked against it at the report's
  baseline (entries waiting on a decision or a deployment can't be). Edition 3
  is at `02e4146`, before the readiness review: it still lists this file
  (TD-021) and others since closed.
- `docs/engineering/PRODUCTION_READINESS_ASSESSMENT.md` — the latest
  readiness verdict and what it waits on.

Fix an `npm audit` finding with a scoped override or an in-range bump, never
`npm audit fix --force`, which upgrades across major versions.
