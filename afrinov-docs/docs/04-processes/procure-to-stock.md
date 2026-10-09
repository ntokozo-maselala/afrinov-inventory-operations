# Process: Procure-to-Stock

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

The purchase-order part of this process is switched off by default
(`PROCUREMENT_ENABLED` on the backend, `VITE_PROCUREMENT_ENABLED` on the
frontend). With it off, buying stays outside the system and stock arrives
through counter receipts (`goods-receiving.md`).

## Trigger
An item's stock status becomes URGENT or WARNING — on hand, totalled over
all locations, below the configured percentage of its Required Stock
(defaults 20% and 40%) — or a manual need is identified. The Stock status
page lists these and downloads them as an Excel re-order list.

## Actors
Store Controller / Procurement (may be the same person), Supplier
(external), Approver (when approval is required).

## Steps
1. Re-order candidate identified (Stock status page, re-order list
   download, or manual).
2. Purchase Order drafted: supplier and material lines with quantities
   (no prices are stored).
3. PO submitted → `PENDING_APPROVAL`, then approved; or straight to
   `APPROVED` when `purchaseOrders.requireApprovalBeforeProcessing` is off.
4. PO sent to supplier — outside the system (no "sent" status).
5. Supplier delivers goods.
6. Goods Receipt recorded against the PO, or the whole outstanding quantity
   received in one step.
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
- `afrinov-platform/apps/backend/src/shared/config.ts:84-86`, `afrinov-platform/apps/frontend/src/config/features.ts`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.ts:22-43`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts:51-58,116-132`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:138-167,200-252,396-429`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:573-617`
