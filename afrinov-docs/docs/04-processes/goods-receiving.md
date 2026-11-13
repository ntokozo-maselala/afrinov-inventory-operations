# Process: Goods Receiving

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

## Inputs
Delivery from a supplier with a delivery note or invoice reference
(mirrors the workbook's `Delivery/Invoice No.` field). With procurement on,
an approved purchase order: the store's own, or a project's (ADR-022, ADR-027).

## Actors
With procurement on, the Store Controller (and Admin): the server needs
`receive:inventory`, and `order:stores_stock` for a Stores order or
`receive:purchase_order` for a project order (ADR-027); the page asks for
`receive:purchase_order`. With procurement off, anyone with
`receive:inventory` (Store Controller, Procurement).
*Unverified:* who receives on shift in practice.

## How a delivery is received
Which way depends on whether procurement is switched on
(`PROCUREMENT_ENABLED`); Receive stock (`/stock/receive`) is the page for both.

**1. Procurement off: at the counter, without a purchase order.**
1. Receive stock: choose the supplier, enter the delivery note or invoice
   number (required), the delivery date (a day in South Africa, defaults to
   today; may not be in the future) and one to 50 lines of item, location
   and quantity. A supplier or item not yet in the app can be added from
   the form. A Projects item with no project is refused, as its stock could
   never be issued (ADR-023).
2. `POST /api/v1/stock-receipts` → `StockReceiptService.receive`, in one
   transaction: checks supplier, items and locations are active; numbers
   the receipt `GR-YYYY-NNNN`; creates a `goods_receipts` row already
   `POSTED` with its lines; inserts one RECEIPT transaction per line
   (`reference_type = 'GoodsReceipt'`); recomputes balances; writes a
   `RECEIVE_STOCK` audit entry.

**2. Procurement on: only against an approved order** (ADR-022), the store's
own or a project's (ADR-027).
1. Receive stock lists the orders the user receives that are APPROVED or
   PARTIALLY_RECEIVED (`GET /purchase-orders/receivable`, which has no
   prices): the store's own, and projects', labelled with their project
   ("AFRI-0430 · for AFRI-1325 · Plant upgrade"). There is no supplier to
   pick, no free lines and no new item. Choosing one fills in its outstanding lines; what arrived is booked
   line by line and to a location, with the delivery note and date, as a goods
   receipt recorded and posted in one step (`POST /goods-receipts` with
   `post: true` and an `Idempotency-Key`). The order's page and Order stock
   open Receive stock with the order chosen (`?order=<id>`). Receiving
   everything outstanding in one call (`POST /purchase-orders/:id/receive`) is
   retired: it skipped the count of what arrived (system audit D3, ADR-039).
   A receipt with no order is refused, by `POST /stock-receipts`, by
   `POST /goods-receipts` without `purchaseOrderId`, and by posting one saved
   with no order before this rule (`POST /goods-receipts/:id/post`), all 400.
   When no order is waiting, the page says so and links to Order stock. A
   Stores item's **Receive** opens it on the orders still owed that item
   (`?materialId=`), choosing the order when only one is; a Projects item has
   no Receive.
2. Posting inserts RECEIPT transactions, increments each order line's
   received quantity (never above the ordered quantity), marks the receipt
   `POSTED`, and moves the order to PARTIALLY_RECEIVED or RECEIVED — all in
   one transaction. A project order's RECEIPTs are held for its project
   (`held_for_project`); a Stores order's are Stores stock.
3. A project order's lines go to the project receiving location
   (`inventory.projectReceivingLocationId`, Settings → Inventory) when one is
   set, with no location to choose; otherwise to a location per line.
   Project material isn't shelved: the confirmation offers **Issue it now**,
   which opens Issue stock with the project and what arrived filled in.
   Procurement closes a project order; the store closes its own.

## Business rules
- Quantity received need not equal quantity ordered (partial delivery is
  normal); it may not exceed it. Over-receipt is refused when the receipt
  is recorded, and rolls back if it is posted. Each receipt credits the
  order's lines, so what is left shows as still owed.
- Once posted, a receipt is never edited. A counter receipt is corrected by
  reversing its transactions (ADR-005); a receipt against a purchase order
  cannot be reversed in the system.

## Exceptions
- Duplicate delivery note number → warn, don't block. **Planned** — no
  duplicate check exists.
- Material not yet in the Material master → add it from Receive stock, then
  receive it. Creating an item with stock in one call (`POST /stock-items`) is
  retired (system audit D3, ADR-039).

## Outputs
GoodsReceipt (+ lines), InventoryTransaction(s), updated InventoryBalance,
updated PurchaseOrder (if linked), audit entry (counter receipts only).

## Evidence
- `afrinov-platform/apps/frontend/src/pages/ReceiveStock.tsx` (`ReceiveAgainstOrder`, `CounterReceipt`)
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts` (`/stock-receipts`)
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts`
- `afrinov-platform/apps/backend/src/modules/procurement/goods-receipt.service.ts` — create, post
- `afrinov-platform/apps/backend/src/modules/inventory/stock-item.routes.ts`
- `afrinov-platform/apps/backend/integration/procurement.real-http.test.ts` — part deliveries, over-receipt
