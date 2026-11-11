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
**Date:** 2026-10-09 (commit b4f2839) · **Status:** Accepted (confirmed with the business 2026-11-02)

**Decision:** Each item is URGENT, WARNING or OK by its total on hand (all
locations) as a share of its Required Stock, with bands from settings
(defaults 20% and 40%); NOT_SET when no Required Stock is set. This
replaces a single "low stock" flag and follows the workbook's URGENCY
column.

**Confirmed:** 2026-11-02. Required Stock is the quantity to keep on hand,
not a reorder threshold: an item is flagged when it runs short of it by the
bands above, and an order tops it back up to it. This corrects assumption
A-05. The application calls the field Required (Required stock) everywhere;
it was labelled Reorder on the Materials page and in the reports.

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

---

### ADR-021 — Stores and Projects are kept apart, with no connections
**Date:** 2026-10-29 · **Status:** Accepted · **Amends:** ADR-020

**Context:** ADR-020 split who *raises* each kind of order, but the two sides
still met: each could open the other's orders, Procurement's approvers
approved Stores orders, and the store received deliveries against project
orders. At Afrinov the two are different sides of the business: the store
keeps stock for the workshop, and project material goes from the supplier
straight to site.

**Decision:** No connections between the two sides.
- **Where:** a Stores order lives in Store → Order stock (`/stock/orders/:id`),
  a project order in Procurement (`/purchase-orders/:id`); each opens only in
  its own section.
- **Who sees:** Stores orders only those with `order:stores_stock` (the store
  controller and Admin); project orders and RFQs only those with
  `view:purchase_order` (Procurement, approvers and Admin). The store
  controller no longer holds `view:purchase_order`. Each side's orders are not
  found (404) to the other, so neither can tell the other's exist.
- **Who approves:** the storeman approves Stores orders, by value against his
  own limit, including orders he raised. His limit is set in Settings → Users,
  and until it is, he approves none (a blank limit would otherwise mean any
  value, unchecked); above it, Admin approves. Approvers approve project
  orders, as before.
- **Delivery:** a Stores order is received into stock by the store; a project
  order is never received into stock: Procurement confirms its delivery on
  the order, line by line, and no stock is added.

**Consequences:** Each role sees and does only its own side. Admin sees both.
A store controller approves nothing until an admin sets his limit, so a
limit is set on each at release. Projects items bought from now hold no stock;
existing Projects stock stays issuable to its project. Migration
`20260101000031` removes the store controller's `view:purchase_order`.

**Evidence:** `afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts`
(`kindsSeen`, `requireForOrder`, `requireViewOrder`, `confirm-delivery`),
`po-approval.ts` (`approvePermissionFor`), `procurement.service.ts`
(`confirmDelivery`, `awaitingApproval`), `afrinov-platform/apps/frontend/src/lib/orderKind.ts`,
`afrinov-docs/docs/13-project-management/roadmaps/stores-procurement-separation-roadmap.md`.

### ADR-022 — The store receives only against approved Stores orders
**Date:** 2026-10-30 · **Status:** Accepted · **Amends:** ADR-021

**Context:** Receive stock booked a delivery against one of the store's
orders, or, if not against one, as a counter receipt of any items. With
ordering in place, a counter receipt let stock into the store that no one had
ordered or approved.

**Decision:** While procurement is switched on, stock is received into the
store only against an approved Stores order (APPROVED or PARTIALLY_RECEIVED).
Receive stock lists those orders and nothing else: no supplier to pick, no free
lines, no new item. The server refuses a receipt with no order
(`POST /stock-receipts`, and `POST /goods-receipts` without `purchaseOrderId`).
Receiving a Stores order already needs `order:stores_stock`, so Procurement
no longer receives; the page and its links show to those who receive orders
(`receive:purchase_order`). With procurement off there are no orders, and
counter receipts stay the way stock arrives.

**Consequences:** An unplanned delivery (a cash purchase, extra stock) needs a
Stores order raised and approved before it is received. Adjustments, returns,
stock counts and opening balances are not receiving and are unchanged.

**Evidence:** `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts`
(`COUNTER_RECEIPTS_OFF`), `procurement.routes.ts` (`POST /goods-receipts`),
`afrinov-platform/apps/frontend/src/pages/ReceiveStock.tsx`,
`afrinov-platform/apps/frontend/src/lib/orderKind.ts` (`canReceiveStock`).

### ADR-023 — A project lives on the order, not the catalogue item
**Date:** 2026-11-01 · **Status:** Accepted · **Amends:** the Materials Sections decisions behind its Phases 5 and 6; ADR-022 (leftovers)

**Context:** Each Projects item belonged to one project (`materials.project_number`),
and ordering refused an item with no project or another project's item. That
made sense while project material came into the store, where the store had to
know whose stock was on the shelf. Since ADR-021, project material goes from
the supplier straight to site and is never stock, so its project is already
known where it matters: on the purchase order, its RFQ and its delivery
confirmation. Tagging the item too meant one catalogue entry per project
(`PROJ-AFRI-1325-PLATE`), items waiting for a project, and a step to give them one.

**Decision:** The order says which project its material is for.
- A Projects item is a plain catalogue entry with no project of its own; the
  item form has no Project field, and the "Needs a project" step is gone.
- A project order (and RFQ) takes any Projects item, whatever project it was
  tagged with; a Stores order takes Stores items only, both checked by the
  server. An order awarded from an RFQ sent before project orders took
  Projects items only keeps the Stores items it was quoted for.
- An item tagged with an open project only suggests the order's project while
  none is chosen; it never fixes it.
- Leftovers received before the separation keep the project they have: issued
  only to that project, moved to Stores once it closes. Leftovers on an item
  with no project aren't issued but moved to Stores
  (`/materials/no-project/leftovers`). Moving to Stores is refused while the
  item is on an open project order or RFQ.
- No stock is created that can't be issued: a counter receipt and `POST
  /stock-items` refuse a Projects item with no project.

**Consequences:** No migration: `materials.project_number` stays, for leftovers
only. A project's material is read from its orders (the Projects page links to
them). With procurement off there are no orders to carry a project, so new
project material can't be received or issued; only items tagged before can.
Per-project duplicates in the catalogue can be merged later.

**Evidence:** `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts`,
`rfq.service.ts`, `afrinov-platform/apps/backend/src/modules/inventory/material-section.ts`
(`refuseProjectMaterialOnStoresOrder`, `projectForNewMaterial`),
`project-leftovers.service.ts`, `stock-receipt.service.ts`,
`afrinov-platform/apps/frontend/src/pages/PurchaseOrderForm.tsx`, `RfqForm.tsx`,
`Materials.tsx`, `MaterialDetail.tsx`, `components/MaterialForm.tsx`,
`afrinov-docs/docs/13-project-management/roadmaps/project-on-the-order-roadmap.md`.

### ADR-024 — A tool loan has a due date; its state is worked out, not stored
**Date:** 2026-11-02 · **Status:** Accepted · **Amends:** the overdue flag (`inventory.toolOverdueDays`, migration 20260101000012)

**Context:** A tool loan was flagged overdue once it had been out longer than
one number of days, the same for a drill lent for a shift and a generator sent
to a site for a project. Nobody agreed a return date, a loan could not be
extended without a false check-in, and a tool could stay overdue indefinitely.
Owned stock counts tools out on loan, so a tool that will never come back
still counted against Required Stock.

**Decision:**
- Each check-out agrees a due date, kept on the `LOAN` row (`due_on`). The
  row is still never updated.
- A later date is an extension in `tool_loan_extensions`, with who, when and
  why. Rows there are only ever added.
- A loan’s state (ON_LOAN, DUE_SOON, OVERDUE, NEEDS_DECISION) is worked out
  from its due date and today each time, as a tool’s state already was from
  the ledger. Nothing stores it, so it cannot disagree with the movements.
- Nothing happens to a tool automatically: no write-off, no refused return.
  A loan that needs a decision waits for a person to check it in, extend it or
  declare it lost.
- Lending to someone with an overdue tool asks for a reason by default; the
  store can block it for contractors or for everyone.

**Consequences:** One migration adds the column, the table, three settings and
`extend:tool_loan`. Loans from before it have no due date and fall due the
default period after they went out, so nothing flagged before changes. There
are no notifications: recipients mostly do not sign in, so the store sees what
is due on the Tools page and the Dashboard.

**Evidence:** `afrinov-platform/apps/backend/src/modules/inventory/tool-loan-terms.ts`,
`tool-loan.service.ts`, `tool.routes.ts`,
`afrinov-platform/apps/backend/prisma/migrations/20260101000033_tool_loan_due_dates/migration.sql`,
`afrinov-docs/docs/04-processes/tool-loans.md`.

### ADR-025 — Movements lists every tool loan event, not only the ones that move stock
**Date:** 2026-11-02 · **Status:** Accepted · **Amends:** ADR-024 (extensions only later)

**Context:** Movements is where the store looks to see what happened, but it
listed only ledger lines. A tool loan's agreed due date, each later date and
its reason, and the reason for lending to someone with an overdue tool were
recorded but could not be seen there: the due date and extensions only on the
Tools page while the tool was out, the override reason only in the audit log.
Once a tool came back, nobody could tell from the app that it came back two
weeks late. An extension could also only move a date later, so a mistyped date
could not be put right.

**Decision:**
- A due date change is not posted as a movement. Every movement moves stock,
  and a reversal is the same movement with the opposite sign; a zero-quantity
  row would have to be skipped by every total, count and reconciliation, and a
  reversal of it would mean nothing.
- Movements reads both records and lists them together by time: ledger lines
  from `inventory_transactions`, due date changes from `tool_loan_extensions`
  (type `DUE_DATE_CHANGE`, no quantity). One cursor pages both. All movements
  and the Tools check in/out report include them, as do their downloads; the
  other reports do not. The rule is: if it happened to stock in the store, it
  is on Movements.
- The reason for lending to someone with an overdue tool is kept on the
  check-out (`overdue_override_reason`), set once and never changed, and
  copied there from the audit log for earlier check-outs.
- A due date may be moved earlier as well as later, never before today, with a
  reason. The most recent change wins. A wrong date is put right by another
  change; nothing is deleted. The route is `POST /tools/loans/:id/due-date`;
  the permission keeps its code, `extend:tool_loan`.
- `GET /tools/loans/:id/history` tells one loan in order. The day a loan went
  overdue is worked out from the dates and shown as such, never stored.

**Consequences:** One migration adds the column and an index and fills in past
override reasons. Stock totals, balances and reversals are unchanged. A
consumer of `GET /inventory-transactions` must allow a row with a null
quantity, or ask for a `type` or a report other than loans.

**Evidence:** `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts`
(`queryHistory`, `listsDueDateChanges`, `mergeNewestFirst`), `tool-loan.service.ts`
(`changeDueDate`, `history`), `tool-loan-terms.ts`,
`afrinov-platform/apps/backend/prisma/migrations/20260101000034_loan_events_on_movements/migration.sql`,
`afrinov-platform/apps/frontend/src/components/reports/LedgerReport.tsx`, `components/LoanHistory.tsx`.

### ADR-026 — A tracked consumable's issue is closed off as used up or broken, without moving stock
**Date:** 2026-11-03 · **Status:** Accepted

**Context:** An issue takes stock off the shelf, and Stock used counts it as
used straight away. For most consumables that is right. For costly ones
(grinding and cutting discs, blades) the store wants to know whether what was
issued was worn out, broke early, or is still with the person, and the stub
or broken piece brought back to the counter was recorded nowhere. A return is
the wrong record for it: a return puts stock back on the shelf.

**Decision:**
- An item may **track use after issue** (`materials.track_use`): off by
  default, switched per item, refused on a tool (tools are lent and checked
  back in, `tool-loans.md`).
- Part of an issue line of such an item is closed off as **Used up** or
  **Broken** (`consumable_outcomes`), with a quantity and an optional note.
  Nothing is posted to the ledger and no balance changes: the stock left at
  the issue.
- **Still out** = issued − returned − used up − broken. Returns and outcomes
  share that limit and take the issue's balance lock, so neither can spend
  what the other has.
- Outcomes are only added to. A mistake is withdrawn by a row naming the
  outcome (`withdraws_id`, unique), with a reason; both are kept and count
  for nothing, as a reversal does in the ledger. A withdrawal cannot be
  withdrawn.
- An issue with live outcomes cannot be reversed until they are withdrawn,
  as with returns.
- Recording needs `issue:inventory`; withdrawing needs
  `reverse:inventory_transaction`. No new permission code. Routes:
  `GET`/`POST /inventory-transactions/:id/outcomes`,
  `POST /consumable-outcomes/:id/withdrawal`; both posts take an
  `Idempotency-Key`.
- Used up and broken are booked at the counter on **Return stock**, with
  anything going back on the shelf, as one booking (`POST /inventory-returns`
  lines take `quantity`, `usedUp`, `broken`). Movements is where people
  look things up: it shows the result and keeps corrections (withdraw), and
  books nothing new. The per-issue route stays for API clients.
- Every counter visit and every withdrawal is on Movements, each at its own
  time; nothing that was booked is missing from the history. A return's row
  says what that visit brought back: back on the shelf, and the used up and
  broken booked with it (`consumable_outcomes.return_transaction_id`). A
  visit with nothing back on the shelf has no RETURN, so each of its marks is
  a row of its own (type USED_UP or BROKEN), and each withdrawal is a row
  (OUTCOME_WITHDRAWN); these move no stock, so their quantity is null. An
  issue's row says only who it went to and how much is still out, not what
  came back later.
- Movements issue rows, Stock used (by recipient and line by line) and their
  downloads carry used up, broken and still out for tracked items. Still out
  is as of now, not as of the end of the period.
- Switching an item off stops new outcomes; earlier ones stay listed and
  still count.

**Consequences:** One migration adds the column, the enum and the table.
Stock totals, balances and the value on Stock used are unchanged; still out
is a new figure, null for items that do not track use.

**Evidence:** `afrinov-platform/apps/backend/src/modules/inventory/consumable-outcome.service.ts`,
`consumable-outcomes.ts`, `inventory.service.ts` (`bookReturn`, `returnToStock`,
`reverse`, `queryHistory`), `modules/reporting/consumption.service.ts`,
`afrinov-platform/apps/backend/prisma/migrations/20260101000036_consumable_outcomes/migration.sql`,
`afrinov-platform/apps/backend/prisma/migrations/20260101000037_outcome_return_link/migration.sql`,
`afrinov-platform/apps/frontend/src/pages/ReturnStock.tsx`, `components/ConsumableOutcomes.tsx`, `components/MaterialForm.tsx`.

### ADR-027 — Project material comes through the store, held for its project
**Date:** 2026-11-03 · **Status:** Accepted · **Amends:** ADR-021 (delivery), ADR-023 (whose stock it is)

**Context:** ADR-021 had project material go from the supplier straight to
site: a project order was never received into stock, and Procurement
confirmed its delivery on the order. That is not how Afrinov works. On
2 and 3 Nov 2026 the business confirmed that all project material comes
through the store, that the storeman books its delivery, that the same
catalogue item can be bought for two projects at once, and that once
received it goes straight to the workshop and is issued: it is never shelved.
Since ADR-023 the project lives on the order, not the item, so the item can't
say whose stock is on the shelf.

**Decision:** Stock carries its project.
- Every movement records whose stock it is, `held_for_project` (null for
  Stores stock), apart from `project_number` (who it was used for). Balances
  are kept per item, location and project held for (`''` for Stores stock).
  A project holding stock can't be deleted or renumbered.
- The store controller (and Admin) receives project orders on Receive stock,
  through a receiving-only view (`GET /purchase-orders/receivable`: supplier,
  project, lines and what each owes; no prices, approval or RFQ) with
  `receive:purchase_order`. The order itself stays Procurement's (not found
  to the store), and Procurement closes it. The delivery's stock is held for
  the order's project. Confirm delivery is retired: the endpoint refuses (400)
  and points to Receive stock; past confirmations stay as history.
- A setting, `inventory.projectReceivingLocationId`, names one location
  (such as Workshop floor) that project deliveries are booked to; with none
  set, the storeman chooses per line. After booking, **Issue it now** opens
  Issue stock with the project and what arrived filled in. Project stock not
  yet issued is listed on Stock and Projects.
- A project's own stock is issued to that project only; an issue line names
  the stock it takes. Returns and reversals go back to the stock they came
  from. Transfers and adjustments keep the stock's project (API only); counts
  stay Stores-only. Project material isn't shelved, so no screen moves it.
- Stores measures count Stores stock only: stock status, re-order, stock
  alerts and the tool list. Value reports (month-end, the inventory report,
  the Dashboard) count held stock under the project it is held for.
- Leftovers received before keep their project on the item, as Stores stock:
  no migration gives them a project, so `materials.project_number` is still
  read for them.
- When a project is completed or cancelled, Move to Stores takes its held
  stock off the project onto Stores stock at the same location (a linked
  TRANSFER_OUT and TRANSFER_IN, reference `MoveToStores`), then makes the
  item a Stores item if it is the project's own or has no project. A Stores
  item, or another project's item, keeps what it is: only the stock held for
  this project moves, and another project's item then holds it as that
  project's leftover. It is refused while another project holds the item, or
  it is on an open project order or RFQ. The pair isn't reversed on its own,
  as the item changed with it.

**Consequences:** Migration `20260101000035` changes the
`inventory_balances` primary key (every existing balance kept as Stores
stock); migrations `20260101000038` and `20260101000039` add settings rows.
Procurement no longer confirms deliveries. Consumption by project is
unchanged (it reads `project_number`).

**Evidence:** `afrinov-platform/apps/backend/prisma/schema.prisma`,
`src/shared/inventory/balances.ts`, `src/modules/inventory/inventory.service.ts`
(`issue`, `transfer`, `adjust`, `postGoodsReceipt`), `project-leftovers.service.ts`,
`src/modules/procurement/procurement.routes.ts` (`receivable`, `requireReceiveOrder`),
`procurement.service.ts`, `src/modules/reporting/`, `src/modules/settings/settings.service.ts`,
`afrinov-platform/apps/frontend/src/pages/ReceiveStock.tsx`, `IssueStock.tsx`,
`ProjectLeftovers.tsx`, `components/LeftoversNotice.tsx`,
`afrinov-docs/docs/13-project-management/roadmaps/project-material-through-the-store-roadmap.md`.

### ADR-028 — Nobody approves their own order or their own large write-off
**Date:** 2026-11-03 · **Status:** Accepted

**Context:** A store controller could raise, approve, receive and close the
same Stores order, and an admin the same project order. Any adjustment,
however large, posted on one person's say-so, so stock could be written off
or added from nowhere unchecked, and a technician could write off a tool
they had borrowed by checking it in as lost. These are the classic ways
stock and money go missing.

**Decision:**
- **Purchase orders:** whoever raised an order never signs it, whatever
  their role (`signRefusal`; `approve()` refuses with who else can, and
  `approval`, the signers named and "Waiting for my approval" leave them
  out). Since ADR-030 orders are signed by role rather than approved within a
  limit; the rule holds for every signature an order needs. Orders submitted
  with approval switched off still auto-approve, as before.
- **Write-offs:** an adjustment worth more than
  `inventory.writeOffApprovalAbove` (R 1 000 by default, at the item's unit
  cost), or of an item with no unit cost, posts nothing: it becomes an
  `adjustment_requests` row (202, `PENDING_APPROVAL`). Someone else with
  `approve:write_off` (store controller, admin) approves it, which checks the
  stock again and posts the ADJUSTMENT booked to whoever asked, or rejects
  it with a reason. Whoever asked may withdraw their own. Within the limit an
  adjustment posts at once. `inventory.requireWriteOffApproval` (on by
  default) switches the rule off.
- **Stock counts:** a count difference over the limit becomes a request
  (COUNT_VARIANCE, the count's id) and the rest of the count posts; once
  approved it posts as part of its count. An item with any adjustment
  already waiting at that location can't be counted until that one is
  decided, or both could correct the same difference. A difference too large
  for the quantity column is refused.
- **The rule** (`write-off-limit.ts`, one place for every path): the exact
  value, quantity × unit cost, is compared with the limit, and only rounded
  to the cent for storing and showing; a limit of 0 holds every adjustment,
  of a free item too; an item with no unit cost is always held.
- **Lost tools:** checking a tool in as lost needs `adjust:inventory`; a
  borrower checks it in as good or damaged and the store writes it off. A
  lost tool over the limit, or with no unit cost, stays on loan while its
  write-off waits (the request keeps the loan and its project), so it can't
  be lent or checked in again; approving posts its return and its LOSS
  against the loan, as a lost tool within the limit is; rejecting leaves it
  on loan to the borrower.
- **Reversals:** an adjustment over the limit is not reversed directly, as
  that would undo, or mirror, an approved one on one person's say-so. It is
  put right by an adjustment the other way, which waits for approval.
  Movements says so on the adjustment (`reversalNeedsApproval`).
- **What the screens follow:** sign-in and `/auth/me` return the permission
  codes the user's roles grant, so a role given `approve:write_off` in the
  database sees Write-offs to approve and its controls.

**Consequences:** Migration 045 adds the table, the permission and the two
settings. A store with one store controller needs the admin to approve its
Stores orders and its large write-offs. Screens: Store → Write-offs to
approve, and Settings → Inventory.

**Evidence:** `afrinov-platform/apps/backend/src/modules/procurement/po-approval.ts`,
`procurement.service.ts` (`approve`, `approval`, `awaitingApproval`),
`modules/inventory/write-off-approval.service.ts`, `inventory.routes.ts`, `tool.routes.ts`,
`afrinov-platform/apps/backend/prisma/migrations/20260101000045_write_off_approval/migration.sql`,
`afrinov-platform/apps/backend/integration/write-off-approval.real-http.test.ts`,
`afrinov-platform/apps/frontend/src/pages/WriteOffApprovals.tsx`.

### ADR-029 — A delivery counts on the day it is booked, not its delivery note's date
**Date:** 2026-11-03 · **Status:** Accepted

**Context:** A delivery note can be dated earlier than it is booked. The
ledger booked the stock when it was entered, so month-end closing stock
counted it then, while the received-stock report counted it on the note's
date. A delivery noted 31 Oct and booked 2 Nov was in October's received
stock but not October's closing stock, so the two reports did not add up.

**Decision:** The ledger stays at the booking time: a back-dated note never
changes a month already reported, and the ledger is never rewritten. Goods
receipts record when they were posted (`goods_receipts.posted_at`), and the
received-stock report, its downloads and its paging use that, showing the
delivery note's date beside it ("Booked", "Note dated").

**Consequences:** Migration 046 adds the column, filled for earlier
deliveries from their first RECEIPT, or when they were recorded. A report run
by delivery-note date is no longer offered; the note's date is still on
every row.

**Evidence:** `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts` (`list`),
`inventory.service.ts` (`postGoodsReceipt`),
`afrinov-platform/apps/backend/prisma/migrations/20260101000046_goods_receipt_posted_at/migration.sql`,
`afrinov-platform/apps/frontend/src/components/reports/ReceivedStockReport.tsx`, `src/api/exportReports.ts`.

### ADR-030 — Purchase orders are signed by role and value
**Date:** 2026-11-05 · **Status:** Accepted · **Amends:** ADR-021 (who approves Stores orders)

**Context:** Each approver had a limit in rand including VAT, one signature
approved an order, and the store controller approved the store's own orders.
Afrinov's rule is different: the Procurement Manager approves under R200 000,
and from R200 000 both the Procurement Manager and the Director must, in that
order.

**Decision:** An order is signed by role, by its value in rand excluding VAT.
A project order under the threshold needs the Procurement Manager; at or above
it, the Procurement Manager and then the Director. A Stores order needs the
Procurement Manager at any value, as Stores orders are small. The CEO or
Workshop Manager may stand in on a project order, and the Workshop Manager on a
Stores order; they may sign at any time, with no "away" switch, and the record
shows they stood in. Nobody signs an order twice. Admin signs only by holding a
signing role. An order in another currency is converted at a rate an admin keeps
in Settings, locked on the order at submission, so that nobody raising an order
sets who has to approve it. The threshold is a setting.

**Consequences:** Approval limits are retired: `users.approval_limit` is no
longer read, and is kept so older records keep their history. The APPROVER role
is view only. The store controller no longer approves Stores orders. An admin
must assign the new roles before anyone can sign. Orders approved earlier keep
their approver as a Manager signature, so one from R200 000 goes back for both
signatures if its money changes. An approved order goes back for signing when an
edit raises its value excluding VAT by any amount or changes its VAT rate, as
nobody signed for the new amount; it stays approved when its value falls. Migrations
`20260101000043` and `20260101000044`.

**Evidence:** `afrinov-platform/apps/backend/src/modules/procurement/po-approval.ts`,
`procurement.service.ts` (`submit`, `approval`, `approve`, `update`),
`procurement.routes.ts` (`requireApproveOrder`, `kindsSeen`),
`src/shared/permissions.ts`, `src/modules/settings/settings.service.ts`,
`afrinov-platform/apps/frontend/src/pages/PurchaseOrderDetail.tsx`,
`src/lib/poDocument.ts`, `src/pages/SettingsSections.tsx`.

### ADR-031 — Materials counts items; Stock counts lines; one definition relates them
**Date:** 2026-11-06 · **Status:** Accepted

**Context:** Stock plus Tools never matched Materials, so items looked missing
from the catalogue. Nothing was: all three read the same table. They count
different things. Stock counts lines, an item at a location, so an item in two
places is two; it can't list an item never received, which has no balance.
Tools counts active tools only. The Stores tab already included tools, so a
received tool was counted on both pages, and Materials opened on Stores, so
Project Material was out of sight.

**Decision:** Materials is the one page that counts every item. It opens on All
items, with Stores, Tools and Projects tabs that add up to it, and each item
shows its stock state: in stock, held for a project, out of stock or never
received. One definition serves everything: `catalogueTabOf`, `stockStateOf` and
`summarise` in `modules/inventory/catalogue.service.ts`, read by
`GET /materials/summary`, the rows of `GET /reports/stock-status` and
`check:catalogue`. Stock shows both its lines and the items they make up, and
links to what it can't list.

**Consequences:** A tool's own tab is a view only. `sectionOf` still puts tools
in Stores, so order rules, stock rules and reports are unchanged, and
`?section=STORES` on `GET /materials` still includes them. Stock status keeps
its defaults (active Stores items) and takes `?section=ALL&includeInactive=true`
for Materials, which now shows what an inactive item still holds. An item whose
only stock is held for a project is not "never received", though Stock doesn't
list it, so `notOnStock` and `states.NEVER_RECEIVED` can differ. Add a new way of
counting items here, not on a page. No schema change.

### ADR-032 — Job tracking moves into the platform
**Date:** 2026-11-07 · **Status:** Accepted · **Amends:** the product scope (full project management and production scheduling out of scope)

**Context:** Afrinov tracks each job's progress in ClickUp. Before that it used
the *03 Projects Tracking Schedule* workbook: one sheet per month, each job
broken into steps with planned and actual dates, the person assigned, % complete
and a chart. The business says ClickUp holds the same things, and plans to move
away from it. The workbook's layout was sound but its rules were not: "Actual
End" held the expected finish until a step was done; the baseline was worked out
from gaps, so editing a step moved the plan; variance compared durations, not
dates; completed jobs were marked by strikethrough; and unfinished jobs fell off
when a month's sheet was rolled over.

**Decision:** Job tracking is in scope. A project holds one or more schedules,
each a named list of steps from a template, with a locked baseline, a forecast
and an actual date per step, progress and the user assigned. A split job has a
schedule per part, a recurring job a new schedule each month on the same
project, and a joint job is tracked on one of its projects, naming the others it
covers. Only the project's manager and Admin change its schedules. Durations and
variance are counted in working days (Monday to Friday, less closed days kept in
Settings), variance by end date, and progress weighted by planned working days.
The Procurement step reads the project's orders and deliveries. Jobs in ClickUp
are not imported. Budgets, step dependencies, resource levelling and workshop
scheduling stay out.

**Consequences:** `01-product/product-scope.md`, `capability-map.md` and
`product-roadmap.md` list job tracking as planned. The work follows
`13-project-management/roadmaps/project-tracking-roadmap.md` in six phases; its
Decisions table records the choices and which of them engineering made and may
change. Until Phase 5's cut-over date, ClickUp stays the record.

**Evidence:** `afrinov-docs/docs/13-project-management/roadmaps/project-tracking-roadmap.md`
(Decisions, Field map, Workbook faults not to copy).

### ADR-033 — An item's status is on Movements, an item is cleared before it is deactivated, and on an inactive item nothing moves
**Date:** 2026-11-06 · **Status:** Accepted

**Context:** Deactivating an item moved no stock, so it reached only the audit
log. All movements had no row for it, and Other changes is limited to Admin and
Store Controller with no download. The inventory report also limited its
movements to the items it showed, active ones by default, so deactivating an
item took its past movements out of the Settings > Data export. An item could be
deactivated with stock on hand: that stock could not be issued, adjusted or
written off, and it dropped out of the default stock value with no approval,
which made deactivating a way round the write-off limit (ADR-028). Deliveries on
an order, returns, reversals, tool check-ins, count differences and order lines
did not check the item at all, so a cleared item could fill up again.

**Decision:**
- The ledger stays the truth for quantities (ADR-002). A status change is not a
  ledger line: it moves no stock and belongs to no one location. It has its own
  append-only record, `material_status_changes`, written in the same transaction
  as the change, and a row on Movements with a null quantity, as a due date
  change has. All movements, an item's history and the downloads show it.
- A status change takes a reason from a list, with a note when the reason is
  Other: Obsolete, Superseded, Supplier discontinued, Created in error to
  deactivate; Back in use, Stock came back, Deactivated in error to reactivate.
  Coded, so the reasons can be reported on. Changes from before this record are
  copied from the audit log with no reason.
- `PATCH /materials/:id/status` is the only way to change status. `active` is
  refused on the general update, not ignored, so nothing can skip the record.
  Changing an item to the status it has does nothing, so a retry is safe.
- An item is deactivated only when clear: no stock on hand anywhere, held for a
  project included; no tool out on loan; no adjustment waiting for approval; no
  draft, pending, approved or part-received order still owing some. There is no
  override: it would reopen the way round the write-off limit. Stock issued to
  someone does not count, as most of it is used and never comes back.
- Inactive means nothing moves: every path that moves stock, and raising or
  sending an order, is refused until the item is reactivated, in the same words,
  naming who to ask. Reactivating needs only a reason, so stock that turns up can
  always be booked. Used up and broken move no stock, so they can still be booked.
- The item's row is the lock: `checkMaterialActive` holds it `FOR SHARE` and a
  status change `FOR UPDATE`, so a movement finishes first and is seen by the
  check, or waits and is refused. Every path takes its balance lock first.

**Consequences:** An inactive item holds no stock unless it did before this rule,
and `check:item-status` lists those; each is reactivated, cleared and deactivated
again. It also confirms each item's flag agrees with its newest status change.
Other changes still names a status change, as the audit trail. A store person
needs someone who can reactivate to hand when a return comes in for an inactive
item. Locations, projects, recipients and suppliers keep their status under
Other changes; this pattern can extend to them. A later lifecycle with a phasing
out stage, no new orders but stock still issued, would replace the active flag.
Migration `20260101000051_material_status_changes` adds the table and only adds;
the pre-flight query is in `docs/engineering/DATABASE_ASSURANCE.md`.

**Numbering:** Recorded first as ADR-032, a number job tracking took at the same
time, and lost from this log when the two merged. Restored here as ADR-033 on
2026-11-07. The comment in that migration still says ADR-032: a migration already
applied is not edited, as its checksum would change.

### ADR-034 — The person collecting a slip confirms it, by counter PIN or signature
**Date:** 2026-11-10 · **Status:** Accepted

**Context:** An issue and a tool loan record a recipient chosen by whoever is at
the counter. Most recipients never sign in, and nothing showed that the person
named took the stock (gap G8, process P-06 step 4 "Unsupported"). Store staff
sign paper slips today. The owner agreed the platform should record proof of
receipt, chose the options below on the prototype of 10 Nov 2026, and answered
that nobody may confirm on another person's behalf.

**Decision:**
- The slip posts first, exactly as before: stock has left the shelf whether or
  not anyone signs, so the ledger says so. A confirmation is a record of its own,
  `receipt_confirmations`, beside the slip (one `issueId`, issue or tool loan),
  and never moves a balance. Issue and check-out, their idempotency keys and
  balance locks are unchanged.
- The person collecting confirms with a counter PIN, a signature drawn on
  screen, or a photo of the signed paper slip. Or the reason they didn't is
  recorded (left, can't, no screen, says the slip is wrong, other), and a real
  confirmation can follow later. A slip is confirmed once: a partial unique
  index allows one row that is not NONE per slip.
- A worker or contractor confirms only their own slip. A machine or site
  can't: the worker or contractor who collected for it confirms, and the slip
  says "collected by".
- A confirmation stores a fingerprint of the slip's lines. A line reversed
  afterwards makes the slip read "changed after it was confirmed".
- A PIN is 4 to 6 digits, typed twice by its owner, kept only as a bcrypt hash
  (cost 10) that no read or audit entry returns. Runs, repeats and repeated
  pairs are refused. A set PIN is replaced only after a reset with a reason. A
  wrong PIN is counted in a transaction of its own, holding the recipient's row,
  so it stands although the confirmation is refused and tries at the same moment
  can't pass the limit (`inventory.receiptPinTries`, 5); then it locks until a
  store controller unlocks it. The PIN is left out of the stored idempotency hash.
- Images sit in `receipt_images`, apart from their record, so they can be
  removed after `inventory.receiptImageKeepMonths` (24, at least 24, or 0 for
  always) and the fact the slip was signed stays. They are personal information
  (POPIA): only `view:reports` sees them.
- `inventory.receiptConfirmation` is off, ask or require; it starts at ask, to
  move to require once the counter is ready. Capturing needs the permission that
  posts that kind of slip; PINs need `manage:recipients`.

**Consequences:** A confirmation proves the hand-over at the counter, nothing
after it. A technician issuing to themselves still confirms with their own PIN,
since recipients are not linked to user accounts. A PIN can be watched or shared,
so each slip shows the method used. Returns and check-ins are not confirmed.
Migration `20260101000053_receipt_confirmations` only adds. A printed slip not
confirmed on screen carries lines to sign on paper. With the setting at require,
the Dashboard counts slips of the last 30 days not confirmed: a window, so the
number can't grow for ever. The server removes images past their keep period
hourly, and `check:receipts` reports the rest, read-only.

**Edge cases (10 Nov 2026):** a review of 33 cases against the merged code,
with the owner's choices, added these rules:
- A tool loan counts as waiting only while a tool on it is still out. Once
  everything is back, the tool is the proof. `check:receipts` lists returned
  loans that were never confirmed, apart from the slips still waiting.
- A disputed slip, of any age, is counted on the Dashboard for whoever corrects
  slips (`reverse:inventory_transaction`: the store controller, with Admin as
  cover), on Ask as well as Required. Issued stock has a Disputed filter.
- While the hand-over is open, only its Skip or Cancel button closes it. A tap
  outside or Escape does nothing until it is done.
- Someone who has since left (inactive) can't use a PIN or sign, but a paper
  slip they signed at the time is accepted as theirs.
- A slip with every line reversed can't be confirmed. The route refuses it
  before any PIN is checked, so no try is counted.
- A PIN unlocked three or more times in 30 days is shown on Recipients and
  listed by `check:receipts` with who unlocked it.
- Before a shorter image keep period is saved, Settings says how many images it
  removes.
- A contractor's staff are set up as their own contractor recipients, each
  with a PIN, and the company as a Site. This is a naming rule, shown on the
  recipient form, and needs no code.
- A disputed slip never holds an image: a dispute is a NONE record, an image
  comes only with the confirmation that settles it, and a confirmed slip can't
  be disputed again. Removing images on schedule can't touch an open dispute.

### ADR-035 — Every setting has an effect: idle sign-out is enforced, unread settings are retired
**Date:** 2026-11-11 · **Status:** Accepted

**Context:** Nine settings were stored, shown and editable, but nothing read
them: the session timeout, the three notification switches, the date and time
formats, rows per page, the system description and the default unit of
measure (requirements gap "Settings that do nothing", TD-010). An administrator
changing one would expect an effect. The session timeout matters most: the
threat model names shared shop-floor terminals, and a sign-in lasted a fixed
12 hours whatever the setting said. The owner chose, for each, to build its
effect or take it off the page.

**Decision:**
- **Idle sign-out is enforced by the server.** A sign-in token lasts the idle
  time in `security.sessionTimeoutMinutes` (60; 5 to 720) and carries
  `auth_time`, when the sign-in began. `POST /auth/refresh` issues a new token
  for the idle time from now, for the same sign-in, with the account's roles as
  they are now; it is refused once the sign-in is 12 hours old or the account
  has been deactivated. Every authenticated request is refused with 401 when
  its token is older than the idle time in force now, so a shorter setting
  closes idle sessions at once rather than when their tokens run out. A token
  from before this decision has no `auth_time`; its sign-in counts from its
  issue. The rules are pure functions in `identity/session-policy.ts`.
- **The screen renews while the person works.** `SessionKeeper`, in the app
  shell, records activity (pointer, key, wheel, touch) in storage shared by the
  tabs, renews the token at most once a minute when there has been activity
  since it was issued, warns in the last minute when there has not ("Are you
  still there?", with Stay signed in), and ends the session when the token runs
  out, as a refused request does. A failed renewal for any reason but a refused
  token is tried again after 30 seconds, and a renewal never replaces the token
  of a newer sign-in. The 12-hour limit is not renewable; the warning says so.
- **The default unit of measure is a unit on the list.** It starts a new
  material on the item form, until someone picks another; a unit taken out of
  use since, or a setting that can't be read, starts it on each. The server
  saves only an active listed unit, under its code (`checkUnitOfMeasure`), and
  Settings offers the units in use instead of free text.
- **Seven settings are retired:** `general.systemDescription`,
  `general.dateFormat`, `general.timeFormat`, `general.defaultPageSize` and
  `notifications.enableInAppNotifications`, `…LowStockNotifications`,
  `…PurchaseOrderNotifications`. Nothing sends notifications (no handler reads
  `StockThresholdReached`), stock status and the re-order list already follow
  `inventory.enableStockAlerts`, every date shows one way ("12 Aug 2026,
  14:32") that can't be misread, and lists load more on demand. Settings has no
  Notifications section; its old address opens General.
- Migration `20260101000054_retire_unread_settings` changes data only: it
  deletes the seven rows, gives the two kept settings their new descriptions
  (Settings shows a row's description and the seed never rewrites a row), and
  moves a stored default unit not on the list onto a listed one. Audit history
  of the retired settings stays.

**Consequences:** A setting on the page now does what it says, and one with no
effect is not added: it is built with its effect or not at all. Each
notification switch can return with an alerts feature that reads it. A
shortened idle time signs out everyone idle for longer, at once. Logging out
still only discards the token in the browser; server-side revocation remains
planned. Tests: `session-policy.test.ts`, `auth.routes.test.ts` (session
timeout), `settings.service.test.ts`, `migrations.test.ts`,
`lib/session.test.ts`, `SessionKeeper.test.tsx`, `MaterialForm.test.tsx`,
`SettingsWithEffect.test.tsx`, `SettingsInventory.test.tsx`.

### ADR-036 — Passwords can be changed and reset; someone always holds Admin; demo data stays out of production
**Date:** 2026-11-11 · **Status:** Accepted

**Context:** The system audit at `c888bbf` (phase P1, go-live safety) found
that nobody could change or reset a password in the application, although the
seed tells operators to rotate the first admin password after first sign-in
(F1); that an Admin could deactivate or demote any account, including their
own and the last Admin's, after which only direct database access could
recover user management (F2); that behind a reverse proxy every request looks
as if it came from the proxy, so five wrong passwords by anyone blocked
sign-in for everyone (F4, D-36); and that the seed loaded demo items, orders
and a demo ledger in every environment, production included, where the
append-only ledger could never be cleaned and the one-time workbook import
would refuse the database (H1, D-01). The owner approved the recommended
option for each.

**Decision:**
- **Anyone changes their own password** (`POST /auth/password`): the current
  one first, then a new one of 8 to 128 characters that differs from it. The
  change ends every other sign-in of the account, since
  `users.password_changed_at` is checked on every request and a sign-in that
  began before it is refused with 401; this one carries on with the fresh
  token returned. Rate limited as sign-in is.
- **An Admin sets a temporary password for someone else**
  (`POST /users/:id/password`, `manage:users`), never for themselves. It ends
  the person's current sign-ins and sets `users.must_change_password`. Until
  they choose their own, the server accepts only `GET /auth/me`,
  `POST /auth/refresh` and `POST /auth/password` from them (403 otherwise),
  and the screens show only the change-password form. It also clears the
  account's wrong-password count. Both are logged (`PASSWORD_CHANGE`,
  `PASSWORD_RESET`), never the password.
- **Someone always holds Admin.** A change that would leave no active account
  with the Admin role is refused, and nobody deactivates their own account or
  takes away their own Admin role. Account changes take an advisory lock, so
  two Admins can't remove each other at once.
- **The proxy is named.** `TRUST_PROXY` lists the reverse proxy's address or
  range; only those are believed for `X-Forwarded-For`. `true` and hop counts
  are refused at start-up. Sign-in is also limited per account: 10 wrong
  passwords in 15 minutes and the account waits, in memory, per process.
  `12-operations/reverse-proxy.md` gives the proxy setup.
- **Demo data only on request, never in production.** The seed always loads
  permissions, roles, settings and the admin account; it loads the demo
  business only with `SEED_DEMO_DATA=true`, and refuses that flag, writing
  nothing, when `NODE_ENV` is production (`db/seed-plan.ts`). The test
  database seed and CI ask for it.
- Migration `20260101000055_password_change` adds the two columns; existing
  accounts keep their passwords.

**Consequences:** A forgotten password is an Admin's five-minute job, so at
least two people should hold Admin (one store controller and Admin cover each
other, see D-42). The first admin's password is changed in the app; the
`db:rotate-admin` script stays for an account nobody can sign in to.
Production is seeded empty of stock, so the cutover imports into it once,
after the count, and the pilot and parallel run use a rehearsal copy
(`workbook-replacement-roadmap.md`). Backups follow
`12-operations/backup-and-recovery.md`, tested on a copy. Logging out still
only discards the token in the browser (system audit F7, phase P6). Tests:
`identity.service.test.ts`, `auth.routes.test.ts` (passwords),
`login-throttle.test.ts`, `session-policy.test.ts`, `config.test.ts`,
`seed-plan.test.ts`, `PasswordForms.test.tsx`, `PoSigningRoles.test.tsx`.
