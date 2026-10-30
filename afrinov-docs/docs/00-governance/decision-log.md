# Architecture & Product Decision Log

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Each entry is an immutable record. Once accepted, don't edit — supersede with
a new ADR and link back.

---

### ADR-001 — Treat inventory as one bounded domain within a larger operations platform
**Date:** 2026-09-01 · **Status:** Accepted

**Context:** The first build was a standalone inventory application (items,
suppliers, POs, reports, documents, settings, dashboard) mirroring the
existing Excel system. Direction from the business owner is to model the
system the way SAP models enterprise resource planning — inventory as one
module among several, not the whole product.

**Decision:** Adopt a modular-monolith architecture with explicit bounded
contexts (`Procurement`, `Inventory`, `Operations`, `Reporting`,
`Identity & Access`, `Document Management`), see `03-domain/bounded-contexts.md`.

**Alternatives considered:** (1) Keep it a standalone inventory app.
(2) Build a full multi-module ERP immediately. (3) Modular platform, inventory
module first — **chosen**, because it satisfies the stated direction without
committing to features (finance, payroll, CRM) the business hasn't asked for.

**Consequences:** Slower initial delivery; every new page must be justified
against a business capability, not added ad hoc.

---

### ADR-002 — Model stock as an append-only transaction ledger, not a mutable quantity field
**Date:** 2026-09-01 · **Status:** Accepted

**Context:** Every existing `*Main` sheet (e.g. `Fasteners, Slugs & Insluation M`,
`Consumables Main`, `Project Material Main`) stores `Current Stock` as
`Brought Forward + IN - OUT`, edited directly, with a separate `*Issued` sheet
logging individual movements. The two can and do drift apart because nothing
enforces that the master row reflects the sum of its movements.

**Decision:** `InventoryBalance` becomes a derived/materialized view over an
immutable `InventoryTransaction` ledger. No code path may write to a balance
directly.

**Consequences:** Every stock change becomes traceable to a transaction, user,
timestamp, and reference document (delivery note, project number) — closing
the biggest gap identified in `02-business-analysis/gap-analysis.md`.

---

### ADR-003 — Normalise locations instead of keeping free-text rack labels
**Date:** 2026-09-01 · **Status:** Accepted

**Context:** The workbook's `Location` column mixes rack codes (`D-1`, `F-7`,
`N-1`), free text (`Boiler Shop`, `machine shop`, `up stairs`), and typos
(`Store`, `Stores`, `STOREROOM`, `Storeroom`, `Store room `) for what is
almost certainly the same physical place.

**Decision:** Introduce a `Location` master table (see
`03-domain/entity-catalog.md`) with a canonical name and type
(`rack`, `shop-floor area`, `storeroom`, `container`, `off-site`), and migrate
free text into it during import, flagging ambiguous matches for manual review
rather than auto-merging.

**Consequences:** One-time cleansing effort during migration; all future
location references become a foreign key, not a string.

---

### ADR-004 — Keep the five existing material categories as `Material.category`, not five separate schemas
**Date:** 2026-09-01 · **Status:** Accepted

**Context:** The workbook maintains parallel, near-identical sheet families
for five categories: Fasteners/Slugs/Insulation, Tooling/PPE/Electrical,
Project Material, Consumables, and Tools — each with its own `Main`,
`Issued`, `Stock Report`, and `Stock Summary` sheet, duplicating the same
columns five times.

**Decision:** One `Material` table with a `category` attribute and one
`InventoryTransaction` table for all movements. Category-specific reporting
is a filtered view, not a separate schema.

**Consequences:** Removes structural duplication; category-specific business
rules (e.g. PPE may need expiry/certification tracking, Tools may need
check-out/check-in-by-person tracking) become attributes or extensions, not
forked tables.

---

*(Add new ADRs below this line as decisions are made. Do not renumber or
delete prior entries.)*

---

### ADR-005 — Correct ledger mistakes by reversal, never by editing
**Date:** 2026-10-08 · **Status:** Accepted

**Context:** ADR-002 makes the transaction ledger append-only, but an
endpoint (`PATCH /inventory-transactions/:id`) still let a store controller
change who posted a movement. People make entry mistakes; the ledger needs a
way to correct them that keeps the record trustworthy.

**Decision:** Posted transactions are never updated. A mistake is corrected
by a reversing entry: the original's type with the opposite sign, linked to
it through a unique `reverses_id`, with a mandatory reason. Both legs of a
transfer are reversed together; a reversal cannot be reversed, and cannot
take stock below zero.

**Consequences:** Every correction stays visible in the history with who
made it and why. Signed totals net reversals out on their own; summaries
that add absolute quantities by type must leave reversed pairs out.

---

### ADR-006 — Accounts are created by an administrator; no self-registration
**Date:** 2026-10-08 · **Status:** Accepted

**Context:** The platform had a sign-up page and an opt-in
`POST /auth/register` route that created read-only accounts. The system is
internal to Afrinov: everyone who uses it is known to the business.

**Decision:** Remove self-registration (route, page and the
`security.allowSelfRegistration` setting). An administrator creates accounts
and assigns roles under Settings → Users.

**Consequences:** One fewer unauthenticated endpoint. Onboarding a storeman
needs an administrator, which matches how access is controlled today.

---

### ADR-007 — Purchase orders: no shipping stage, receive then close
**Date:** 2026-10-08 · **Status:** Accepted

**Context:** The purchase-order lifecycle modelled courier shipments
(APPROVED → SHIPPED with carrier and tracking → DELIVERED) and carried six
leftover statuses (SUBMITTED, SENT, PARTIALLY_RECEIVED, FULLY_RECEIVED,
CLOSED, REJECTED) with overlapping meanings. Afrinov's suppliers are local
and deliver with an invoice. Partly delivered orders also had no way to be
finished, and goods could be received against any order.

**Decision:** Seven statuses: DRAFT → PENDING_APPROVAL → APPROVED →
PARTIALLY_RECEIVED → RECEIVED → CLOSED, or CANCELLED before anything is
received. Receiving happens through goods receipts, or "receive all
outstanding" in one step; only APPROVED and PARTIALLY_RECEIVED orders can be
received against. Closing short needs a reason. Removed statuses are mapped
by migration 20260101000004; the shipping columns stay, unused, so history is
kept.

**Consequences:** Fewer states to explain and test. A rejected order is
recorded as cancelled with a reason. Approvers cannot yet reject an order
themselves (they lack the cancel permission); revisit if procurement is used.

---

### ADR-008 — "Issued To" is a typed recipients list, required on every issue
**Date:** 2026-10-08 · **Status:** Accepted

**Context:** The workbook's "Issued To" column was free text backed by an
Employees sheet that mixed workers with machines (Forklift, Generator),
client sites (Northam, Samancor) and contractors (KTS, Kenflex). In the
platform, `recipientId` had to be a user who logs in, and the issue form did
not ask for it, so nobody was recorded as receiving stock.

**Decision:** A `Recipient` list with a type on each entry: WORKER, MACHINE,
SITE or CONTRACTOR. Names are unique ignoring case. Recipients are
deactivated, never deleted. Every issue must name an active recipient
(enforced on the issue form in Phase 1, step 2). Admins and store
controllers manage the list; anyone signed in can read it.

**Consequences:** Every issue says who received the stock, which gives the
per-worker accountability the Consumable Box sheet was attempting, and
reports can filter by recipient type.

---

*ADR-005 to ADR-008 were recorded in the repository-root `decision-log.md`
on 2026-10-08 and merged here on 2026-10-09; the text is unchanged. The
entries below are marked **Inferred from code**: the decision is evidenced
by the code and commit history but was not written up when it was made.
Confirm or correct each, then change its status to Accepted.*

---

### ADR-009 — Technology stack: Fastify, Prisma, PostgreSQL, React
**Date:** recorded 2026-10-09 (schema first committed 2026-10-06) ·
**Status:** Inferred from code

**Decision:** One npm-workspaces repository with a TypeScript backend
(Fastify 5, Prisma 5 on PostgreSQL 16, Zod validation, Vitest) and a React
18 single-page frontend (Vite, Tailwind CSS, React Router), deployed as one
backend container plus static frontend files.

**Evidence:** `afrinov-platform/package.json`,
`afrinov-platform/apps/backend/package.json`,
`afrinov-platform/apps/frontend/package.json`,
`afrinov-platform/apps/backend/docker-compose.yml`.

---

### ADR-010 — Balances are a table recomputed from the ledger in the same transaction
**Date:** recorded 2026-10-09 · **Status:** Inferred from code

**Context:** ADR-002 calls `InventoryBalance` a derived/materialised view.

**Decision (as built):** `inventory_balances` is an ordinary table. After
every movement, the service recomputes the affected rows as the sum of the
ledger and upserts them inside the same database transaction. Point-in-time
figures (month-end) are rebuilt from the ledger instead.

**Consequences:** Balances cannot drift from the ledger through the API;
direct SQL could still change them (TD-006). The recompute exists in three
copies (TD-009).

**Evidence:** `afrinov-platform/apps/backend/src/shared/inventory/balances.ts:6-21`,
`afrinov-platform/apps/backend/src/modules/reporting/month-end.service.ts:79`.

---

### ADR-011 — JWT bearer tokens with a database check on every request
**Date:** recorded 2026-10-09 · **Status:** Inferred from code

**Decision:** Email/password login returns an HS256 JWT valid 12 hours;
every request re-checks that the user is active. Role-to-permission grants
are defined in code and written to the database by the seed; each route
checks the permission it needs.

**Evidence:** `afrinov-platform/apps/backend/src/server.ts:105-178`,
`afrinov-platform/apps/backend/src/shared/permissions.ts`,
`afrinov-platform/apps/backend/src/db/seed.ts:130-145`.

---

### ADR-012 — Procurement is off by default, behind a feature switch
**Date:** 2026-10-06 (commit 1e70c23) · **Status:** Superseded by ADR-019

**Decision:** Purchase-order and goods-receipt routes and pages exist only
when `PROCUREMENT_ENABLED=true` (backend) and `VITE_PROCUREMENT_ENABLED=true`
(frontend). Suppliers and counter receipts work either way.

**Evidence:** `afrinov-platform/apps/backend/src/server.ts:269-271`,
`afrinov-platform/apps/backend/src/shared/config.ts:84-86`,
`afrinov-platform/apps/frontend/src/App.tsx:125-136`.

---

### ADR-013 — No negative stock, as a fixed rule
**Date:** 2026-10-08 (commit ff0e451) · **Status:** Inferred from code

**Decision:** No issue, transfer, negative adjustment or reversal may take
any balance below zero. It is not a setting and has no override.

**Evidence:**
`afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:223-233,314-322,446-452,505-514`.

---

### ADR-014 — Stock status by percentage of Required Stock
**Date:** 2026-10-09 (commit b4f2839) · **Status:** Inferred from code

**Decision:** Each item is URGENT, WARNING or OK by its total on hand (all
locations) as a share of its Required Stock, with bands from settings
(defaults 20% and 40%); NOT_SET when no Required Stock is set. This
replaces a single "low stock" flag and follows the workbook's URGENCY
column.

**Evidence:** `afrinov-platform/apps/backend/src/shared/inventory/stock-status.ts:1-54`.

---

### ADR-015 — Opening balances are imported once, by a command-line tool with a dry run
**Date:** 2026-10-08 (commit 601b401) · **Status:** Inferred from code

**Decision:** The workbook enters the platform through
`npm run import:workbook`: a dry run and person-reviewed mapping files
first, then a single all-or-nothing import of items, locations, master data
and one dated opening-balance receipt per item and location; a second
import is refused. A reconciliation report compares the result with the
workbook.

**Evidence:** `afrinov-platform/apps/backend/scripts/import-workbook.ts`,
`afrinov-platform/apps/backend/src/modules/migration/opening-balance.service.ts:1-9`.

---

### ADR-016 — Month-end figures are rebuilt from the ledger
**Date:** 2026-10-09 (commit 4e6d76f) · **Status:** Inferred from code

**Decision:** The month-end report computes stock as at the end of the
month from ledger rows posted before the first of the next month (UTC), so
a past month's report does not change; values use current unit prices.

**Evidence:**
`afrinov-platform/apps/backend/src/modules/reporting/month-end.service.ts:1-84`.

---

### ADR-017 — API documentation generated from the route schemas
**Date:** 2026-10-07 (commit b5f93a7) · **Status:** Inferred from code

**Decision:** The OpenAPI document served at `/api/docs` is generated from
the Zod schemas the routes validate with; a unit test fails when documented
and registered routes differ. Off in production unless enabled.

**Evidence:** `afrinov-platform/apps/backend/src/openapi/document.ts`,
`afrinov-platform/apps/backend/src/openapi/openapi.test.ts:37-39`.

---

### ADR-018 — Store controllers may add and edit suppliers
**Date:** 2026-10-16 · **Status:** Accepted

**Context:** Only Procurement (and Admin) held `create:supplier` and
`edit:supplier`. With procurement switched off (ADR-012), suppliers exist
only to record who a delivery came from, and the person booking deliveries
on Receive stock is the store controller. A delivery from a new supplier
could not be booked until someone else added the supplier, and Receive stock
sent store controllers to a Suppliers page where they could not do it.

**Decision:** `STORE_CONTROLLER` also holds `create:supplier` and
`edit:supplier`. Receive stock lets them add a supplier from the form, as it
already lets them add a new item. Purchase orders stay with Procurement.

**Consequences:** A counter delivery from a new supplier is booked in one
go. More people can create suppliers, so duplicates are more likely; names
are already unique ignoring case and spacing. There is no route to edit a
supplier yet, so `edit:supplier` has nothing to apply to until one is built.

**Evidence:** `afrinov-platform/apps/backend/src/shared/permissions.ts`,
`afrinov-platform/apps/frontend/src/hooks/usePermissions.ts` (`suppliers:manage`).

---

### ADR-019 — Procurement is on by default
**Date:** 2026-10-20 · **Status:** Accepted

**Context:** ADR-012 kept purchase orders and goods receipts off unless both
switches were set to `true`. The purchase order work aligned to the Item
Description template (suppliers, pricing and VAT, approval by order value,
order numbers, receiving against an order) is now in main, and procurement
is in scope again. With the old default, every fresh setup and deployment
had to remember two settings before purchase orders appeared.

**Decision:** `PROCUREMENT_ENABLED` (backend) and `VITE_PROCUREMENT_ENABLED`
(frontend) are on unless set to `false`. The switch stays, so a deployment
can still turn procurement off. Supersedes ADR-012.

**Consequences:** Purchase orders show in the menu, dashboard and settings
without configuration. A deployment that wants procurement off must now set
both variables to `false`, and keep the two in step.

**Evidence:** `afrinov-platform/apps/backend/src/shared/config.ts`
(`isProcurementEnabled`), `afrinov-platform/apps/frontend/src/config/features.ts`,
`afrinov-platform/apps/backend/docker-compose.yml`.

---

### ADR-020 — The store orders Stores stock; Procurement buys for projects
**Date:** 2026-10-29 · **Status:** Accepted

**Context:** One New purchase order form, held by Procurement, raised every
order: project material for a job and Stores stock for the shelf alike, and
the store controller, who sees what the shelf needs, could not order at all.
Afrinov's workflow splits the two: the Procurement team buys project items
for one project, and the storeman or inventory controller orders stock for
the stores.

**Decision:** An order's kind follows its project. An order with a project
is a project order: raised, edited, submitted, cancelled and closed with the
purchase order permissions, from Procurement, holding that project's
material only. An order without a project is a Stores order: the same
actions need the new `order:stores_stock`, held by `STORE_CONTROLLER` (and
Admin), from Store → Order stock, holding Stores items only. An order can't
change kind. Requests for quotation are for a project only. Approval by
value, receiving and viewing are unchanged and shared.

**Consequences:** Each team sees and does only its own ordering, and the
server refuses the rest, whatever the screens show. Both kinds stay ordinary
purchase orders: one numbering, one approval, one order document. Existing
orders keep what they hold; orders without a project became Stores orders,
changed by the store controller from then on, and an RFQ sent before the rule
is still awarded with its Stores items. Migration `20260101000030` adds the
permission to existing databases.

**Evidence:** `afrinov-platform/apps/backend/src/shared/permissions.ts`,
`afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts`
(`requireForKind`, `requireForOrder`), `procurement.service.ts`,
`rfq.service.ts`, `afrinov-platform/apps/frontend/src/lib/orderKind.ts`,
`afrinov-docs/docs/13-project-management/roadmaps/stores-ordering-roadmap.md`.

### ADR-021 — Whoever raises a purchase order cannot approve it
**Date:** 2026-10-30 · **Status:** Proposed — implemented, pending business confirmation

**Context:** Approval checked the approver's permission and limit only. The
person who raised an order could approve it, so one person could commit
company money with no second pair of eyes (PRA-06 in
`docs/audits/production-readiness/`). For Stores orders this was the normal
path: the permission that raises them also approves them. With
`purchaseOrders.requireApprovalBeforeProcessing` off, submitting approved any
order, of any value, as the submitter.

**Decision:** The approver must be a different person from the order's
creator, for both kinds of order and for administrators. With approval
switched off, submitting approves an order only when the submitter could
have approved it anyway (they hold the approve permission for its kind and
it is within their limit); otherwise it goes for approval as usual. An
approval and an edit of the same order take a row lock, so an approval can
never be checked against one total and land on another (PRA-07).

**Consequences:** Every order needs two people. A site with a single store
controller has its Stores orders approved by an administrator or a second
store controller. "Waiting for my approval" no longer lists a user's own
orders, and the approval panel says why the creator cannot approve. Reverse
this ADR only by an explicit business decision; the check is one function
(`selfApprovalBlock`).

**Evidence:** `afrinov-platform/apps/backend/src/modules/procurement/po-approval.ts`
(`selfApprovalBlock`), `procurement.service.ts` (`approve`, `approval`,
`awaitingApproval`, `submit`, `update`),
`integration/production-controls.real-http.test.ts`.

### ADR-022 — The seed writes only the bootstrap; demo data never reaches production
**Date:** 2026-10-30 · **Status:** Accepted

**Context:** The container's start command runs the seed on every start, and
the seed loaded demo suppliers, materials, projects, purchase orders and stock
movements unconditionally (PRA-01). In the system of record that is fictitious
stock that ADR-002 and ADR-005 then forbid deleting, and every restart
rewrote the demo materials.

**Decision:** `npm run db:seed` (and `node dist/db/seed.js`) writes only the
bootstrap: permissions, roles, the first administrator (with a forced password
change) and the settings catalog. Demo data needs `--demo` (or
`SEED_DEMO_DATA=true`, `npm run db:seed:demo`) and is refused unless
`NODE_ENV` is `development` or `test`; an unset `NODE_ENV` counts as
production, as in `loadConfig()`. `SEED_ADMIN_PASSWORD` is needed only to
create the admin.

**Consequences:** A new production database starts empty apart from the
bootstrap, ready for the opening-balance import. Developers and the
integration suites load demo data explicitly. CI proves both rules on every
backend pull request (`npm run db:check-bootstrap` after a production-mode
seed; the demo seed must fail in production).

**Evidence:** `afrinov-platform/apps/backend/src/db/seed.ts`, `seed-mode.ts`,
`scripts/check-bootstrap-only.ts`, `.github/workflows/backend-ci.yml`.

### ADR-023 — Password lifecycle and sign-in controls
**Date:** 2026-10-30 · **Status:** Accepted

**Context:** No one could change or reset a password in the product, the
bootstrap admin's seeded password could not be replaced at first sign-in,
sign-ins were not recorded, and nothing slowed down guessing one account's
password from many addresses (PRA-05, PRA-09).

**Decision:** Passwords need at least 12 characters (length, not character
classes, per NIST SP 800-63B). A user changes their own with their current
password (`POST /auth/password`). An administrator sets a temporary password
(`POST /users/:id/password-reset`) that the user must replace before anything
else works; the bootstrap admin starts the same way. A change or reset ends
every earlier session: tokens issued before `users.password_changed_at` are
refused. Five wrong passwords in a row lock the account for 15 minutes
(429 `ACCOUNT_LOCKED`); an administrator's reset lifts it. Every attempt is
written to the audit log as an `Authentication` entry with IP and user agent;
an unknown email is recorded only as a fingerprint. Unknown emails cost the
same bcrypt work as known ones. The browser signs out after
`security.sessionTimeoutMinutes` without activity.

**Consequences:** A locked-out or forgetful user goes to an administrator,
who resets the password; there is no email self-service (no mail is sent by
the system). Password changes need no restart and take effect on the next
request. The 12-hour token lifetime is unchanged and remains the upper bound
of a session.

**Evidence:** `afrinov-platform/apps/backend/src/modules/identity/`
(`identity.service.ts`, `auth.routes.ts`, `user.routes.ts`,
`password-policy.ts`), `src/server.ts` (`authenticate`), migration
`20260101000031_password_lifecycle`,
`afrinov-platform/apps/frontend/src/pages/ChangePassword.tsx`,
`src/components/IdleSignOut.tsx`,
`integration/password-lifecycle.real-http.test.ts`.
