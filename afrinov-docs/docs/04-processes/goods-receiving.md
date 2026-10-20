# Process: Goods Receiving

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

## Inputs
Delivery from a supplier with a delivery note or invoice reference
(mirrors the workbook's `Delivery/Invoice No.` field); optionally an
approved Purchase Order.

## Actors
Store Controller, or Procurement (both hold `receive:inventory`).
*Unverified:* who receives on shift in practice.

## Two ways to receive
**1. At the counter, without a purchase order** — the everyday case, always
available.
1. Receive stock page (`/stock/receive`): choose the supplier, enter the
   delivery note or invoice number (required), the delivery date (defaults
   to today; may not be in the future) and one to 50 lines of item,
   location and quantity. A supplier or item not yet in the app can be
   added from the form. If the supplier has open purchase orders, the page
   asks whether the delivery is against one and links to receiving it on
   that order (way 2).
2. `POST /api/v1/stock-receipts` → `StockReceiptService.receive`, in one
   transaction: checks supplier, items and locations are active; numbers
   the receipt `GR-YYYY-NNNN`; creates a `goods_receipts` row already
   `POSTED` with its lines; inserts one RECEIPT transaction per line
   (`reference_type = 'GoodsReceipt'`); recomputes balances; writes a
   `RECEIVE_STOCK` audit entry.

**2. Against a purchase order** — unless procurement is switched off
(`PROCUREMENT_ENABLED=false`).
1. The order's page (`/purchase-orders/:id`): **Receive** records what
   arrived, line by line and to a location. It creates a goods receipt in
   `SUBMITTED` (`POST /goods-receipts`; the order must be APPROVED or
   PARTIALLY_RECEIVED) and posts it at once
   (`POST /goods-receipts/:id/post`). Or "receive everything outstanding"
   with `POST /purchase-orders/:id/receive`. There is no separate Goods
   receipts page.
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
- `afrinov-platform/apps/frontend/src/pages/ReceiveStock.tsx`, `PurchaseOrderDetail.tsx`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts` (`/stock-receipts`)
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts`
- `afrinov-platform/apps/backend/src/modules/procurement/goods-receipt.service.ts` — create, post
- `afrinov-platform/apps/backend/src/modules/inventory/stock-item.routes.ts`
- `afrinov-platform/apps/backend/integration/procurement.real-http.test.ts` — part deliveries, over-receipt
