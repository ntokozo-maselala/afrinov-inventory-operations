# Process: Goods Receiving

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

## Inputs
Delivery from a supplier with a delivery note or invoice reference
(mirrors the workbook's `Delivery/Invoice No.` field). With procurement on,
an approved Stores purchase order (ADR-022).

## Actors
With procurement on, the Store Controller (and Admin): the server needs
`receive:inventory` and the order to be the store's (`order:stores_stock`);
the page also asks for `receive:purchase_order`. With procurement off, anyone with
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
   the form.
2. `POST /api/v1/stock-receipts` → `StockReceiptService.receive`, in one
   transaction: checks supplier, items and locations are active; numbers
   the receipt `GR-YYYY-NNNN`; creates a `goods_receipts` row already
   `POSTED` with its lines; inserts one RECEIPT transaction per line
   (`reference_type = 'GoodsReceipt'`); recomputes balances; writes a
   `RECEIVE_STOCK` audit entry.

**2. Procurement on: only against an approved Stores order** (ADR-022).
1. Receive stock lists the store's orders that are APPROVED or
   PARTIALLY_RECEIVED; there is no supplier to pick, no free lines and no new
   item. Choosing one fills in its outstanding lines; what arrived is booked
   line by line and to a location, with the delivery note and date, as a goods
   receipt recorded and posted in one step (`POST /goods-receipts` with
   `post: true` and an `Idempotency-Key`). The order's page and Order stock
   open Receive stock with the order chosen (`?order=<id>`). Or "receive
   everything outstanding" with `POST /purchase-orders/:id/receive`.
   A receipt with no order is refused, by `POST /stock-receipts` and by
   `POST /goods-receipts` without `purchaseOrderId` (400). When no order is
   waiting, the page says so and links to Order stock.
2. Posting inserts RECEIPT transactions, increments each order line's
   received quantity (never above the ordered quantity), marks the receipt
   `POSTED`, and moves the order to PARTIALLY_RECEIVED or RECEIVED — all in
   one transaction.

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
- Material not yet in the Material master → add it from Receive stock, or
  create it with an opening quantity in one step (`POST /stock-items`,
  needs `create:material` and `receive:inventory`).

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
