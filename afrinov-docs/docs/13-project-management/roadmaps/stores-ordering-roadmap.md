# Afrinov Inventory Platform: Stores Ordering Roadmap

Oct 29, 2026 · Sbonakaliso Ngcobo

## Summary

Four phases that split ordering the way Afrinov works. The **Procurement team** buys project items only, for one project, through Purchase orders and RFQs. The **Storeman / Inventory controller** orders stock for the stores, from a new **Order stock** page under **Stores** in the menu. Today one New purchase order form does both, and the storeman can't order at all.

Both kinds stay ordinary purchase orders underneath: the same AFRI numbering, approval by value, PDF and receiving. What changes is who may raise which kind, from which page, with which items. The server enforces the split, so it holds even if someone bypasses the screens.

**Status:** All four phases built on `feature/stores-ordering`, in one pull request (#117), not yet merged. Recorded as ADR-020.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | Permission and server rules | M | Built |
| 2 | Order stock page under Stores | M | Built |
| 3 | Procurement for projects only | M | Built |
| 4 | Roles end to end and docs | S | Built |

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
| Approval of Stores orders | By value, by an approver, as every order is today | Built in Phase 1, tested in Phase 4 |
| What each side sees | Each can open the other's orders, read-only, so Procurement still sees what the store has on order | Built in Phases 1 to 3 |
| RFQs | Project-only; Stores stock is ordered directly at known prices. RFQ-0001 style numbers (no project) stop being issued | Built in Phase 1 |
| Existing orders | Untouched. Orders without a project (3 in the dev database) are Stores orders, edited, submitted, cancelled and closed by the store controller from now; older project orders holding Stores items keep them. An RFQ sent before the rule is still awarded with its Stores items; a draft RFQ without a project can't be sent | Built in Phase 1 |

### Order of work

All four phases share pull request #117, so the server rules, the store's page, Procurement's project-only forms and the docs arrive together.

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

Phases 2 and 3 closed the gaps Phase 1 left on screen: nothing offers a buyer a Stores order, or the storeman a project order.

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

- [x] **3.1 New purchase order needs a project.** No "No project" choice ("Choose the project…"), and saving without one is refused; lines offer Projects items only, that project's once chosen (picking one still sets the project); **+ New item** shows once the order has its project and adds a Projects item for it. A project order's edit page can't clear its project.
  Files: `pages/PurchaseOrderForm.tsx`, `components/PurchaseOrderDetailsFields.tsx`
- [x] **3.2 RFQs need a project.** The same on the RFQ form (a draft's own lines stay listed so they can be changed); "Stores" wording leaves the RFQ list, page, Activity and PDF: an older RFQ without a project shows "No project" or a dash.
  Files: `pages/RfqForm.tsx`, `pages/Rfqs.tsx`, `pages/RfqDetail.tsx`, `lib/rfqDocument.ts`
- [x] **3.3 The Purchase orders list.** A kind filter (Project orders, Stores orders, All orders, kept in the link as `?kind=`). Buyers land on project orders; approvers and Admin on all orders, so a Stores order waiting for approval isn't hidden. A buyer opens the store's orders read-only.
  Files: `pages/PurchaseOrders.tsx`
- [x] **3.4 A Projects item's Order button** opens New purchase order with the item, which sets its project. A supplier's **New order** opens the form the viewer orders from: Procurement's for a buyer, Order stock's for the storeman.

**Done when:** nothing in the Procurement section offers or accepts Stores items.

## Phase 4: Roles end to end and docs

Size S. Tests and docs.

- [x] **4.1 Roles.** Over real HTTP (`procurement.real-http.test.ts`, `rfqs.real-http.test.ts`): the storeman raises and changes Stores orders and can't raise project orders or RFQs; Procurement the other way round; an approver approves both kinds and raises neither; a technician or viewer can't raise or open either. On screen (`Sidebar.test.tsx`, `PoApproval.test.tsx`, `StoresOrders.test.tsx`, `PoFromNeed.test.tsx`): each role's menu offers only its own ordering, and an order's page offers its actions to its own team.
- [x] **4.2 Docs.** ADR-020 in the decision log and the change log; `task_context.md`; the purchase order lifecycle (the two kinds); the API's role table and resource model; the menu and page inventory; the product roadmap; the RFQ and procurement roadmaps; and this one.

**Done when:** each role sees and can do only its own ordering.

## Before each pull request

- From `afrinov-platform/`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:integration --workspace=@afrinov/backend`.
- Update `mock/mockApi.ts` and `openapi/document.ts` for any changed endpoint.
- Migrations only add rows or columns; nothing existing is changed or dropped.

File references are relative to `afrinov-platform/apps/`.
