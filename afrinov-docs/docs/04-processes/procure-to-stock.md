# Process: Procure-to-Stock

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

The purchase-order part of this process is on unless switched off
(`PROCUREMENT_ENABLED=false` on the backend, `VITE_PROCUREMENT_ENABLED=false`
on the frontend; ADR-019). With it off, buying stays outside the system and
stock arrives through counter receipts (`goods-receiving.md`). The order
itself is described in full in `purchase-order-lifecycle.md`.

## Trigger
An item's stock status becomes URGENT or WARNING — on hand, totalled over
all locations, below the configured percentage of its Required Stock
(defaults 20% and 40%) — or a manual need is identified. The Stock status
page lists these and downloads them as a re-order list (Excel or PDF).

## Actors
Store Controller / Procurement (may be the same person), Supplier
(external), Approver (when approval is required).

## Steps
1. Re-order candidate identified (Stock status page, re-order list
   download, an item's page, or manual).
2. Purchase Order raised — from the Stock status list, the item or the
   supplier, which fill in the supplier and lines, or from scratch: lines
   with quantities and unit prices, VAT, and the template's order and
   delivery details. It can be saved as a draft until the quote arrives.
3. PO submitted → `PENDING_APPROVAL`, then approved by an approver whose
   limit covers the order total; or straight to `APPROVED` when
   `purchaseOrders.requireApprovalBeforeProcessing` is off.
4. The order document (PDF, the template's Order sheet) is sent to the
   supplier — outside the system (no "sent" status).
5. Supplier delivers goods.
6. The delivery is received on the order's page, line by line, or the whole
   outstanding quantity in one step. Receive stock points to the order when
   the supplier has open orders.
7. RECEIPT transactions created; balances recomputed; PO line received
   quantities updated.
8. PO status becomes `PARTIALLY_RECEIVED` or `RECEIVED`; it is then closed
   (`CLOSED`), with a reason if closed short.

## Business rules
- A PO can be received in several partial deliveries, never above the
  ordered quantity per line.
- A receipt can happen without a PO (counter receipt). Flagging these in
  reporting as "unplanned receipts" is **Planned**; no report does this
  yet.

## Exceptions
- Quantity received differs from ordered → the receipt records the actual
  quantity; the PO stays `PARTIALLY_RECEIVED` or is closed short with a
  reason.
- Wrong material delivered → do not force-match; record as a counter
  receipt and investigate the PO separately. *Unverified* (process advice).
- Damaged goods on arrival → receive the good quantity only.
  *Unverified* (process advice).

## Outputs
GoodsReceipt record, InventoryTransaction(s), updated PO status, updated
InventoryBalance.

## Evidence
- `afrinov-platform/apps/backend/src/shared/config.ts` (`isProcurementEnabled`), `afrinov-platform/apps/frontend/src/config/features.ts`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.ts`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts`, `po-approval.ts`, `po-pricing.ts`
- `afrinov-platform/apps/frontend/src/pages/PurchaseOrderForm.tsx`, `StockStatus.tsx`, `ReceiveStock.tsx`
