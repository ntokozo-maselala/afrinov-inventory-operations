# Process: Goods Receiving

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

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
   location and quantity.
2. `POST /api/v1/stock-receipts` → `StockReceiptService.receive`, in one
   transaction: checks supplier, items and locations are active; numbers
   the receipt `GR-YYYY-NNNN`; creates a `goods_receipts` row already
   `POSTED` with its lines; inserts one RECEIPT transaction per line
   (`reference_type = 'GoodsReceipt'`); recomputes balances; writes a
   `RECEIVE_STOCK` audit entry.

**2. Against a purchase order** — only when `PROCUREMENT_ENABLED=true`.
1. Goods receipts / purchase-order pages: `POST /goods-receipts` creates a
   receipt in `SUBMITTED` (order must be APPROVED or PARTIALLY_RECEIVED),
   then `POST /goods-receipts/:id/post` posts it; or "receive everything
   outstanding" with `POST /purchase-orders/:id/receive`.
2. Posting inserts RECEIPT transactions, increments each order line's
   received quantity (never above the ordered quantity), marks the receipt
   `POSTED`, and moves the order to PARTIALLY_RECEIVED or RECEIVED — all in
   one transaction.

## Business rules
- Quantity received need not equal quantity ordered (partial delivery is
  normal); it may not exceed it.
- Once posted, a receipt is never edited. A counter receipt is corrected by
  reversing its transactions (ADR-005); a receipt against a purchase order
  cannot be reversed in the system.

## Exceptions
- Duplicate delivery note number → warn, don't block. **Planned** — no
  duplicate check exists.
- Material not yet in the Material master → must be created first; an
  authorised user can create it with an opening quantity in one step
  (`POST /stock-items`, needs `create:material` and `receive:inventory`).

## Outputs
GoodsReceipt (+ lines), InventoryTransaction(s), updated InventoryBalance,
updated PurchaseOrder (if linked), audit entry (counter receipts only).

## Evidence
- `afrinov-platform/apps/frontend/src/pages/ReceiveStock.tsx`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:35-44,132-143`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts:30-123`
- `afrinov-platform/apps/backend/src/modules/procurement/goods-receipt.service.ts` — create, post
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:197-202,542-624`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-item.routes.ts:38-58`
