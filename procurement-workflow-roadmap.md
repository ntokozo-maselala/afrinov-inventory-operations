# Afrinov Inventory Platform: Procurement Workflow Roadmap

Oct 19, 2026 · Sbonakaliso Ngcobo

## Summary

Seven phases that make the procurement screens connect the way a buyer, an approver and a storeman actually work. The [Procurement Alignment Roadmap](procurement-alignment-roadmap.md) made the purchase order match the template; this one fixes how people get from one step to the next. Do it **before** that roadmap's Phase 7 switches procurement on for everyone.

**Phase 1 fixes a bug:** a goods receipt booked against an order from the Goods receipts page books the stock but never credits the order, so the same goods could later be received a second time.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | Receipts against an order credit the order (bug) | S–M | Not started |
| 2 | Show Goods receipts only to those who receive | S | Not started |
| 3 | Save a draft and submit it later | S | Not started |
| 4 | One way to receive, whatever arrives | M | Not started |
| 5 | Give approvers somewhere to start | S–M | Not started |
| 6 | Start an order from where the need shows | M | Not started |
| 7 | Decide on purchase order alerts | S or L | Not started |

Sizes: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## How to run this

### Where things stand (19 October 2026)

- No phase has started.
- It builds on the alignment roadmap's Phases 1 to 6 (`feature/supplier-master` to `feature/po-numbers`), which are in review.
- Phase 1 should go in before anyone receives against a purchase order in earnest. Procurement is switched on locally only, so nobody is affected yet.

### Order of work

One branch and pull request per phase, each on top of `feature/po-numbers` or the phase before. Phases 1, 2, 3 and 5 don't depend on each other. Phase 4 builds on Phase 1's receipt form, Phase 6 on Phase 3's draft orders, and Phase 7 comes last.

### Decisions needed

- **Phase 4:** must a delivery for an order always be booked against the order, or may the store still book it as a counter receipt?
- **Phase 7:** build in-app alerts for orders waiting for approval, or hide the setting until there is somewhere to show them?

### Rule of thumb

As in the platform flow roadmap: the server's permission map in `apps/backend/src/shared/permissions.ts` is the truth. No button may lead to a refusal, and every step should point to the next one.

## Phase 1: Make receipts against an order credit the order

**Bug.** Size S–M. Backend and frontend.

On the Goods receipts page, a receipt can be booked against a purchase order, but its lines are typed by hand and sent without the order line they belong to. Posting books the stock, but credits an order line only when it is told which one. So the order still shows everything outstanding and stays *Approved*. Later, **Receive all outstanding** would book the same goods a second time.

- [ ] **1.1 Fill the receipt from the order.** Choosing a purchase order on the receipt form lists that order's lines with what is still outstanding, already filled in. The storeman changes the quantities that arrived and picks the location, and each line is sent with its `purchaseOrderLineId`. The supplier comes from the order. Without an order, the form stays as it is.
  Files: `pages/GoodsReceipts.tsx`, `mock/mockApi.ts`
- [ ] **1.2 Never leave the server to guess.** A receipt against an order whose line names no order line is refused with a clear message, rather than booked without crediting the order. Receiving more than is outstanding stays refused.
  Files: `goods-receipt.service.ts`, `inventory.service.ts` (`postGoodsReceipt`)
- [ ] **1.3 Check existing data.** A one-off query lists posted receipts against an order that credited none of its lines, so any already booked this way can be corrected by hand. Procurement has only been switched on locally, so there should be none outside development databases.

**Done when:**
- Receiving part of an order from Goods receipts makes it *Partly received*, and the order shows what is still outstanding.
- Nothing can be received twice against the same order line.

## Phase 2: Show Goods receipts only to those who receive

Size S. Frontend only.

The Goods receipts menu item and its **New receipt** button show to every role. Only Store controller and Procurement may view receipts, and only roles that receive stock may post one, so a viewer, technician or approver sees a page that fails.

- [ ] **2.1 Gate the menu item and the page.** Add `receipts:view` (Store controller, Procurement) to the permission table and require it for the menu item. A typed or old link says "Your role cannot view goods receipts" instead of a failed list.
  Files: `hooks/usePermissions.ts`, `hooks/useNavGroups.tsx`, `pages/GoodsReceipts.tsx`
- [ ] **2.2 Gate New receipt and Post.** Both need `inventory:receive`. Add the procurement actions to the role check sheet test and the role-gating page test.
  Files: `pages/GoodsReceipts.tsx`, `hooks/usePermissions.test.tsx`, `pages/RoleGating.test.tsx`

**Done when:**
- For every role, no procurement button leads to a refusal.

## Phase 3: Let a buyer save a draft and submit it later

Size S. Frontend.

The new-order form only offers **Create & submit**, and the order page has no Submit action at all. A buyer waiting for a quote can't save the order, and since approval needs prices, unpriced orders sit in Pending approval. If submitting fails after the draft is created, the draft is stuck: nothing on screen can submit it.

- [ ] **3.1 Save draft.** **Save draft** beside **Create & submit** on the new-order form. Drafts open on their page.
  Files: `pages/PurchaseOrders.tsx`
- [ ] **3.2 Submit from the order page.** A draft shows **Submit for approval** to Procurement (and Admin). If lines have no price, it asks first: "2 lines have no price, so the order can't be approved until they do. Submit anyway?"
  Files: `pages/PurchaseOrderDetail.tsx`, `mock/mockApi.ts`
- [ ] **3.3 Find your drafts.** The Purchase orders list opens on *Draft* and *Pending approval* for Procurement, with the status filter in the link (`?status=`) so other pages can link to it.
  Files: `pages/PurchaseOrders.tsx`

**Done when:**
- A buyer can start an order, come back to it with the quoted prices, and submit it.

## Phase 4: One way to receive, whatever arrives

Size M. Frontend. Builds on Phase 1. **Needs a decision.**

There are three ways to book a delivery, with nothing pointing from one to the other. *Receive stock* books a counter receipt with no order. *Goods receipts* books one against an order. *Receive all outstanding* on an order books everything still owed. A partial delivery against an order can only be booked from Goods receipts. A storeman who uses Receive stock for an ordered delivery leaves the order showing it as outstanding.

- [ ] **4.1 Decide: ordered deliveries.**
  - **Option A (recommended):** when the supplier has open orders, Receive stock asks "Is this against a purchase order?" and lists them. Picking one moves to that order's receipt. "No" books a counter receipt as today, for deliveries nobody ordered through the app.
  - **Option B:** while a supplier has open orders, a counter receipt from them needs a reason.
- [ ] **4.2 Receive part of an order from its page.** **Receive all outstanding** becomes **Receive delivery**: the dialog lists each line with what is outstanding, filled in and editable, plus the location and delivery note. It is the same form as Phase 1's, so a partial delivery no longer needs the Goods receipts page.
  Files: `pages/PurchaseOrderDetail.tsx`, `pages/GoodsReceipts.tsx`
- [ ] **4.3 Connect the three.** Receive stock and the order page say which is which in one line each. A posted receipt links to its order, and the order lists its receipts (it does today).
  Files: `pages/ReceiveStock.tsx`, `pages/PurchaseOrderDetail.tsx`

**Done when:**
- A storeman booking a delivery from a supplier with open orders is offered the order, and a partial delivery is booked from the order's own page.

## Phase 5: Give approvers somewhere to start

Size S–M. Backend and frontend.

An approver signs in on the Dashboard, which says nothing about orders waiting for them. They have to open Purchase orders and filter it themselves, and only then find out whether each order is within their limit.

- [ ] **5.1 "Waiting for your approval".** A Dashboard card for those who may approve: the orders pending approval that are within their limit, with total and supplier, oldest first. Orders over their limit are counted separately ("3 more need a higher limit"). The list comes from a filter on `GET /purchase-orders` (`?awaitingMyApproval=true`), using the alignment roadmap's Phase 4 rules.
  Files: `procurement.routes.ts`, `procurement.service.ts`, `pages/Dashboard.tsx`
- [ ] **5.2 Filter the list the same way.** Purchase orders gains "Waiting for me" as a filter, linked from the card.
  Files: `pages/PurchaseOrders.tsx`
- [ ] **5.3 Land approvers there.** Under "By role", someone whose only role is Approver lands on Purchase orders filtered to "Waiting for me"; everyone else is unchanged.
  Files: `api/landingPath.ts`

**Done when:**
- An approver who signs in sees, without searching, the orders they can approve now.

## Phase 6: Start an order from where the need shows

Size M. Frontend. Builds on Phase 3.

The need to order appears on Stock status (items below their Required Stock), Supplier detail and Material detail. None of them can start an order: Stock status's button opens the order list. The platform flow roadmap dropped the pre-filled order while procurement was out of scope.

- [ ] **6.1 The new-order form reads the link.** `/purchase-orders/new?supplierId=…&materialIds=…` opens the form with the supplier and lines filled in, prices from unit cost, and quantities up to Required Stock where known.
  Files: `pages/PurchaseOrders.tsx`
- [ ] **6.2 Order from Stock status.** Tick items on the re-order list and choose **Order these**. If they come from more than one supplier (the last supplier of each), the buyer is asked which supplier to order from; the rest stay ticked for the next order.
  Files: `pages/StockStatus.tsx`
- [ ] **6.3 Order from Supplier and Material detail.** **New order** on Supplier detail (supplier filled in) and **Order** on Material detail (item filled in, its last supplier suggested), for Procurement.
  Files: `pages/SupplierDetail.tsx`, `pages/MaterialDetail.tsx`

**Done when:**
- A buyer goes from the re-order list to a filled-in draft order in two clicks.

## Phase 7: Decide on purchase order alerts

Size S or L. **Needs a decision.**

Settings has "Alert when purchase orders need approval or reach a new state", but nothing in the app sends or shows those alerts. The platform flow roadmap's Phase 7 faced the same question for stock alerts.

- [ ] **7.1 Decide: build alerts or hide the setting.**
  - **Option A (recommended for now):** hide the setting until something uses it (S). Phase 5's Dashboard card covers the approver's need.
  - **Option B:** in-app alerts: a bell with "AFRI-0412 is waiting for your approval", "AFRI-0412 was approved", "AFRI-0412 is late" (L). Email is a later step.
- [ ] **7.2 Carry out the choice.** Option A: remove the setting from Settings, keeping its key so nothing needs migrating. Option B: an alerts table, events from the order lifecycle (they are already dispatched as domain events), and the bell.
  Files: `pages/SettingsSections.tsx`, `shared/events.ts`

**Done when:**
- Every procurement setting does something.

## The journeys after these phases

Walk these as each role to test the roadmap. Each step should lead to the next without searching.

| Who | Journey | Phases |
|---|---|---|
| Buyer (Procurement) | Stock status → Order these → draft filled in → add quoted prices → Submit for approval | 3, 6 |
| Approver | Sign in → orders waiting for them, within their limit → open one → Approve → Download PDF for the supplier | 5 |
| Storeman (Store controller) | Delivery arrives → Receive stock → "Against an order?" → the order's receipt, outstanding filled in → change what arrived → Post → order shows Partly received | 1, 4 |
| Viewer, Technician | No procurement action that fails; Goods receipts not in the menu | 2 |

## Before each pull request

- Update `mock/mockApi.ts` for any new or changed endpoint, so `npm run dev:frontend-only` keeps working.
- Add new endpoints to `openapi/document.ts`, and keep `openapi.test.ts` green.
- From `afrinov-platform/`, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. For backend changes, also run `npm run test:integration`.
- Sign in as Procurement, Approver, Store controller and Viewer, and walk the journeys above that the phase changes.
- Update `procurement-alignment-roadmap.md` and this roadmap's status.

Based on a review of the procurement pages, the goods receipt posting code and the permission map on branch `feature/po-numbers`, 19 October 2026. File references are relative to `afrinov-platform/apps/`.
