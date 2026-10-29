# Afrinov Inventory Platform: Stores Ordering Roadmap

Oct 29, 2026 · Sbonakaliso Ngcobo

## Summary

Four phases that split ordering the way Afrinov works. The **Procurement team** buys project items only, for one project, through Purchase orders and RFQs. The **Storeman / Inventory controller** orders stock for the stores, from a new **Order stock** page under **Stores** in the menu. Today one New purchase order form does both, and the storeman can't order at all.

Both kinds stay ordinary purchase orders underneath: the same AFRI numbering, approval by value, PDF and receiving. What changes is who may raise which kind, from which page, with which items. The server enforces the split, so it holds even if someone bypasses the screens.

**Status:** Phases 1 and 2 built on `feature/stores-ordering`, in one pull request (#117), not yet merged: Phase 1 needs Phase 2's page.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | Permission and server rules | M | Built |
| 2 | Order stock page under Stores | M | Built |
| 3 | Procurement for projects only | M | Planned |
| 4 | Roles end to end and docs | S | Planned |

Sizes: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## How to run this

### The split

| | Procurement team | Storeman / Inventory controller |
|---|---|---|
| Menu | **Procurement:** Purchase orders, New purchase order, RFQ | **Stores:** **Order stock**, beside Stock, Issue, Receive, Return, Count and Tools |
| Buys | Project items (Project Material), for one project | Stores items, for the shelf |
| Project on the order | Required | None |
| **+ New item** on a line | Adds a Projects item for the order's project | Adds a Stores item |
| RFQs | Yes, for a project only | No |
| Approval | By value, as now | By value, as now |
| Receiving | As now | As now |

### Decisions

| Decision | Choice | Decided |
|---|---|---|
| Who orders what | Procurement buys project items only; the storeman orders Stores stock only | 29 Oct 2026 |
| Where Stores ordering lives | A new **Order stock** page under **Stores** in the menu | 29 Oct 2026 |
| What a Stores order is | An ordinary purchase order without a project, holding Stores items only | Built in Phase 1 |
| How the split is enforced | A new permission, **order Stores stock**, held by the store controller (and Admin). An order with a project needs the purchase order permissions; one without needs the new one | Built in Phase 1 |
| Approval of Stores orders | By value, by an approver, as every order is today | Proposed |
| What each side sees | Each can open the other's orders, read-only, so Procurement still sees what the store has on order | Proposed |
| RFQs | Project-only; Stores stock is ordered directly at known prices. RFQ-0001 style numbers (no project) stop being issued | Built in Phase 1 |
| Existing orders | Untouched. Orders without a project (3 in the dev database) are Stores orders, edited, submitted, cancelled and closed by the store controller from now; older project orders holding Stores items keep them. An RFQ sent before the rule is still awarded with its Stores items; a draft RFQ without a project can't be sent | Built in Phase 1 |

### Order of work

One branch and pull request per phase, in order, except Phases 1 and 2, which share #117 so the server rules and the store's page arrive together. Phase 3 can follow Phase 2 or run beside it.

## Phase 1: Permission and server rules

Size M. Backend, with a migration, and the mock.

- [x] **1.1 The permission.** `order:stores_stock`, granted to `STORE_CONTROLLER` (Admin has every permission). Migration `20260101000030_order_stores_stock` inserts it and both grants for existing databases; the seed keeps it in step from `permissions.ts`.
  Files: `shared/permissions.ts`, `prisma/migrations/20260101000030_order_stores_stock`
- [x] **1.2 Which kind an order is.** No project: a Stores order. A project: a project order. Raising, editing, submitting, cancelling and closing a Stores order needs `order:stores_stock`; a project order needs the purchase order permissions as now. Approving and receiving are unchanged. An edit can't move an order from one kind to the other (400), and someone who may change neither kind is refused (403) before the order is looked up.
  Files: `procurement/procurement.routes.ts`, `procurement.service.ts`
- [x] **1.3 Which items go on which.** A Stores order takes Stores items only; a project order takes that project's Project Material only (`refuseStoresOnProjectOrder`). New orders only, so older orders keep what they hold, and an order awarded from an RFQ keeps its lines.
  Files: `procurement.service.ts`, `inventory/material-section.ts`
- [x] **1.4 RFQs need a project.** Raising, sending or moving a draft RFQ off its project is refused, and its lines are the project's material only.
  Files: `procurement/rfq.service.ts`, `rfq.routes.ts`
- [x] **1.5 Listing by kind.** `GET /purchase-orders?kind=stores|projects`, for each page's list.
- [x] **1.6 API docs and mock.** The new rules in `openapi/document.ts` (each order route names both permissions) and `mock/mockApi.ts`.

**Done when:** the server refuses a storeman's project order, a buyer's Stores order, a Stores item on a project order and an RFQ without a project.

**Until Phase 3:** Procurement's New purchase order still offers "No project", which the server refuses a buyer. Phase 2 moved Stock status's re-order list to the store, and gave the storeman the Order stock page.

## Phase 2: Order stock page under Stores

Size M. Frontend. Needs Phase 1.

- [x] **2.1 The page.** Store → **Order stock** (`/stock/orders`): the store's orders from `?kind=stores`, newest first, with search and a status filter, and **New order** for the storeman. Anyone who may see orders can open it; the menu entry shows to those who order Stores stock, when procurement is on.
  Files: `pages/StoresOrders.tsx`, `hooks/useNavGroups.tsx`, `hooks/usePermissions.ts` (`stores:order`), `App.tsx`
- [x] **2.2 The order form.** `/stock/orders/new`: the purchase order form in its Stores form: supplier, delivery, lines of Stores items, **+ New item** adding Stores items, no Project field. Save draft or submit for approval. Its edit page follows the order's kind.
  Files: `pages/PurchaseOrderForm.tsx`, `components/PurchaseOrderDetailsFields.tsx`, `lib/orderKind.ts`
- [x] **2.3 Where re-ordering starts.** Stock status's re-order list (**Order these**, **New stock order**) and a Stores item's **Order** button open the Stores order form, filled in as before, for the storeman. A Projects item's **Order** stays with Procurement; a supplier's **New order** stays Procurement's until Phase 3.
  Files: `pages/StockStatus.tsx`, `pages/MaterialDetail.tsx`
- [x] **2.4 The order's own page.** Shared with project orders; its breadcrumb (Order stock or Purchase orders) and its Edit, Submit, Cancel and Close follow its kind and who is looking. Approve and Receive are as before.
  Files: `pages/PurchaseOrderDetail.tsx`

**Done when:** a storeman orders Stores stock from the Stores section, it goes for approval, and it is received as now.

## Phase 3: Procurement for projects only

Size M. Frontend. Needs Phase 1.

- [ ] **3.1 New purchase order needs a project.** No "No project" choice; lines offer that project's material only; **+ New item** adds Projects items only.
  Files: `pages/PurchaseOrderForm.tsx`, `components/PurchaseOrderDetailsFields.tsx`
- [ ] **3.2 RFQs need a project.** The same on the RFQ form; "Stores" wording leaves the RFQ list, page and PDF.
  Files: `pages/RfqForm.tsx`, `pages/Rfqs.tsx`, `pages/RfqDetail.tsx`, `lib/rfqDocument.ts`
- [ ] **3.3 The Purchase orders list.** Project orders by default, with the store's orders a filter away, read-only.
  Files: `pages/PurchaseOrders.tsx`
- [ ] **3.4 A Projects item's Order button** opens New purchase order for its project.

**Done when:** nothing in the Procurement section offers or accepts Stores items.

## Phase 4: Roles end to end and docs

Size S. Tests and docs.

- [ ] **4.1 Roles.** Over real HTTP and on screen: the storeman raises Stores orders and can't raise project orders or RFQs; Procurement the other way round; approvers approve both; everyone else as now.
- [ ] **4.2 Docs.** `task_context.md`, the product roadmap, the procurement roadmaps and this one.

**Done when:** each role sees and can do only its own ordering.

## Before each pull request

- From `afrinov-platform/`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:integration --workspace=@afrinov/backend`.
- Update `mock/mockApi.ts` and `openapi/document.ts` for any changed endpoint.
- Migrations only add rows or columns; nothing existing is changed or dropped.

File references are relative to `afrinov-platform/apps/`.
