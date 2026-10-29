# Afrinov Inventory Platform: Stores and Procurement Separation Roadmap

Oct 29, 2026 · Sbonakaliso Ngcobo

## Summary

Four phases that take every connection out between the **Stores** side of the business and the **Projects** side. Stores orders are raised, approved, received and kept entirely in **Store → Order stock**, by the storeman. Procurement keeps project orders only. Nothing from one side shows on the other, and the server enforces it.

It builds on the [Stores Ordering Roadmap](stores-ordering-roadmap.md) (merged as #117), which split who *raises* each kind but still let each side see the other's orders and sent Stores orders to Procurement's approvers.

**Status:** Phase 1 is in PR #119 and Phase 2 in PR #120. Phase 3 is built on `feature/stores-receiving` (branched from #120), not yet committed. Phase 4 is next.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | Separate homes for each kind of order | M | Built |
| 2 | Access and approval on the server | M | Built |
| 3 | Receiving, and finishing project orders | M | Built |
| 4 | Roles end to end and docs | S | Planned |

Sizes: **S** is about a day, **M** is 2 to 4 days.

## How to run this

### The split

| | Stores (Store → Order stock) | Projects (Procurement) |
|---|---|---|
| Who | The storeman / inventory controller | The Procurement team |
| Orders | Stores items, no project | One project's material |
| Where an order lives | `/stock/orders/…` | `/purchase-orders/…` |
| Who sees them | Storeman (and Admin) | Procurement and approvers (and Admin) |
| Who approves | The storeman, by value | Approvers, by value, as now |
| Delivery | To the workshop, booked on Receive stock or the order's Receive | Straight to site (see Phase 3) |
| RFQs | No | Yes |

Admin keeps access to both. The Director's access is decided after this roadmap.

### Decisions

| Decision | Choice | Decided |
|---|---|---|
| Connections between the two sides | None: each side's screens show only its own orders, and the server enforces it | 29 Oct 2026 |
| Who sees Stores orders | Only those who order Stores stock: the storeman and Admin. Buyers and approvers don't | 29 Oct 2026 |
| Who approves Stores orders | The storeman, on the order's page in Order stock | 29 Oct 2026 |
| Project material at the workshop | It doesn't come there: it goes from the supplier straight to site, so the storeman doesn't receive it | 29 Oct 2026 |
| Storeman's approval limit | He may approve Stores orders he raised himself, by value against his own limit. **Each storeman is given a limit** (for example R 50 000) in Settings → Users before Phase 2 is released; above it, Admin approves. Blank means no limit, which is how every storeman starts (Qodo, PR #120) | 29 Oct 2026 |
| How a project order is finished | Procurement **confirms delivery** on the order, line by line, from the supplier's delivery note or the site's confirmation; no stock is added. (Not chosen: receiving it into a site location; the buyer closing it with no confirmation) | 29 Oct 2026 |
| Orders from before | Untouched: Stores orders already approved by an approver stay approved; old links redirect to each order's own section | Proposed |

### Order of work

First open the pull request for `fix/stock-order-catalogue-only` (stock orders take catalogue items only, the simpler New item drawer, the On order view), so this work starts from main. Then one branch and pull request per phase, `feature/stores-procurement-separation`, in order. Phase 1 changes no rules, so it can merge on its own: until Phase 2 hands approval to the storeman, an approver's Waiting for my approval still holds Stores orders (each opening in Order stock), so it matches the Dashboard's count (Qodo, PR #119). Phase 2 takes them out again. Merge #118, then #119, then Phase 2. Phases 2 and 3 change who may do what, so they should reach the business together.

## Phase 1: Separate homes for each kind of order

Size M. Frontend only. Changes where things are, not who may do what.

- [x] **1.1 A Stores order lives in Order stock.** It opens at `/stock/orders/:id`, its edit page at `/stock/orders/:id/edit`: the same order page as today, with the menu on **Order stock**, the breadcrumb Order stock › AFRI-…, and Back to Order stock. One page, not a copy, so approval, receiving, the PDF and the Activity stay one piece of code.
  Files: `App.tsx`, `lib/orderKind.ts` (an `orderPath` for each kind), `pages/PurchaseOrderDetail.tsx`, `pages/PurchaseOrderForm.tsx`
- [x] **1.2 Every link opens an order in its own section.** The Order stock list and its Receive, Receive stock's Receive against, a supplier's orders, and the page shown after saving a new or edited order. The Dashboard's Waiting for your approval links to a list, not an order, so it moves with the approval queues in 2.3.
  Files: `pages/StoresOrders.tsx`, `pages/ReceiveStock.tsx`, `pages/Dashboard.tsx`, `pages/SupplierDetail.tsx`, `pages/PurchaseOrderForm.tsx`
- [x] **1.3 Old links redirect.** `/purchase-orders/<a Stores order>` goes to `/stock/orders/…`, and a project order opened under `/stock/orders/…` goes to `/purchase-orders/…`. Bookmarks and emailed links keep working.
- [x] **1.4 Procurement shows project orders only.** The Purchase orders list loses its kind filter (Project orders, Stores orders, All orders) and lists project orders; nothing from the store shows anywhere in Procurement, except, until Phase 2, a Stores order waiting in its approver's Waiting for my approval.
  Files: `pages/PurchaseOrders.tsx`

Tests: `lib/orderKind.test.ts` (each kind's address), `PoApproval.test.tsx` (a Stores order opened under Procurement moves to Order stock, and the other way round), `PoDetails.test.tsx` (Procurement lists project orders only), `StoresOrders.test.tsx` and `PoReceiveDelivery.test.tsx` (Order stock's links).

**Done when:** opening any order lands in its own section, and Procurement shows no Stores order.

## Phase 2: Access and approval on the server

Size M. Backend, mock and frontend. No migration: it reuses the `order:stores_stock` permission from the Stores Ordering Roadmap.

- [x] **2.1 Only the store sees Stores orders.** Opening a Stores order, its Activity and its approval panel need `order:stores_stock`; without it the answer is *not found*, so a buyer can't even tell one exists. The order list leaves Stores orders out for anyone without it, and changing one (edit, submit, cancel, close, approve) is *not found* to them too. Order stock opens only for those who order Stores stock.
  Files: `procurement/procurement.routes.ts`, `procurement.service.ts`
- [x] **2.2 The storeman approves Stores orders.** Approving a Stores order needs `order:stores_stock`, by value against the approving user's limit (Settings → Users; blank means no limit). Approvers no longer approve them, and approving a project order is as now.
  Files: `procurement.routes.ts`, `po-approval.ts` (who may approve each kind), `procurement.service.ts`
- [x] **2.3 Each side's approval queue.** "Waiting for my approval" lists what the signed-in user may approve, so the storeman's holds Stores orders and an approver's holds project orders. Order stock gets the same view (`/stock/orders?status=mine`), and Procurement's holds project orders only again. The Dashboard's Pending Approvals card counts what the user may approve and opens their own section's queue; someone who approves both (Admin) sees how many of each and opens the side with project orders waiting, else Order stock.
  Files: `pages/StoresOrders.tsx`, `pages/Dashboard.tsx`, `pages/PurchaseOrderDetail.tsx`
- [x] **2.4 Approval limits for the storeman.** Settings → Users lets an admin set an approval limit on a storeman, as on an approver; the list says "Approves stock orders …" for him.
  Files: `pages/SettingsSections.tsx`
- [x] **2.5 API docs and mock.** `openapi/document.ts` names each kind's permission on approve and says a Stores order is *not found* without `order:stores_stock`. The mock signs in as Admin, who sees and approves both, so it needs no change.

Tests: `procurement.real-http.test.ts` (a buyer gets *not found* for a Stores order and none in a list; the storeman and an approver each approve only their own kind; the storeman is held to his limit), `procurement.service.test.ts` (each kind's approvers), `StoresOrders.test.tsx`, `Dashboard.test.tsx`, `ApprovalLimits.test.tsx`, `PoWaitingForMe.test.tsx`.

**Done when:** a buyer or approver gets *not found* for a Stores order and sees none in any list; the storeman approves a Stores order from Order stock within his limit.

## Phase 3: Receiving, and finishing project orders

Size M. Backend and frontend. No migration: the order's lines and statuses already record what arrived.

- [x] **3.1 The store receives Stores orders only.** Receive stock's "has an open order" lists the supplier's Stores orders only, and receiving against an order (the order's Receive delivery, or a goods receipt against it) needs `order:stores_stock` as well as the receive permissions. The storeman is no longer offered Receive delivery on a project order.
  Files: `pages/ReceiveStock.tsx`, `procurement/procurement.routes.ts`, `goods-receipt.service.ts`
- [x] **3.2 Finishing a project order.** Procurement **confirms delivery** on the order (`POST /purchase-orders/:id/confirm-delivery`, for those who raise project orders): what arrived on each line, the delivery note and the day it arrived. Each line is credited, and the order moves to Partly received, or Received once nothing is outstanding, then is closed as any order. No stock is added anywhere, and the Activity records each confirmation. Receiving into stock (Receive delivery, or a goods receipt against the order) refuses a project order.
  Files: `procurement.service.ts` (`confirmDelivery`), `procurement.routes.ts`, `goods-receipt.service.ts`, `pages/PurchaseOrderDetail.tsx` (Confirm delivery), `mock/mockApi.ts`, `openapi/document.ts`
- [x] **3.3 Projects stock.** Projects items bought from now hold no stock, as nothing is received into stock against a project order. Existing Projects stock stays as it is, and Issue stock still offers it to its own project until it is used up or moved to Stores (Project leftovers); nothing changed there.

Tests: `procurement.real-http.test.ts` (a buyer confirms part, then the rest, and no stock movement points at the order; more than outstanding, a day to come and a draft are refused; the storeman can't receive a project order by either way in, nor confirm it; a buyer can't receive the store's order through a goods receipt), `PoConfirmDelivery.test.tsx`, `PoApproval.test.tsx`, `mock/mockDelivery.test.ts`.

**Done when:** the storeman receives only Stores orders, and a project order can be finished by Procurement as decided.

## Phase 4: Roles end to end and docs

Size S. Tests and docs.

- [ ] **4.1 Roles.** Over real HTTP and on screen: the storeman raises, approves and receives Stores orders and never sees a project order; Procurement and approvers never see a Stores order; Admin sees both.
- [ ] **4.2 Docs.** ADR-021 records the separation and amends ADR-020 (each side no longer sees the other's orders; the storeman approves Stores orders). Also the purchase order lifecycle, the role table, the menu and page inventory, `task_context.md`, and the Stores Ordering Roadmap.

**Done when:** each role sees only its own side of the business.

## Releasing Phase 2

Set an approval limit on every store controller in **Settings → Users** before Phase 2 is deployed. Until then a storeman's limit is blank, which means he may approve any Stores order, including his own.

## Before each pull request

- From `afrinov-platform/`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:integration --workspace=@afrinov/backend`.
- Update `mock/mockApi.ts` and `openapi/document.ts` for any changed endpoint.

File references are relative to `afrinov-platform/apps/`. After this roadmap: the Director's access across both sides.
