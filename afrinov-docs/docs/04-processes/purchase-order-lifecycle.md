# Process: Purchase Order Lifecycle

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Available only when `PROCUREMENT_ENABLED=true` (backend) and
`VITE_PROCUREMENT_ENABLED=true` (frontend). Pages: Purchase orders
(`/purchase-orders`, `/purchase-orders/:id`) and Goods receipts.

## States
`DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → RECEIVED → CLOSED`,
with `CANCELLED` before anything is received (ADR-007; full rules in
`03-domain/state-machines.md`). There is no `SENT`, `SHIPPED` or
`REJECTED` status.

## Steps
1. **Draft** (`POST /purchase-orders`): supplier and material lines with
   ordered quantities; number `PO-YYYY-NNNN`.
2. **Submit** (`POST /:id/submit`): to `PENDING_APPROVAL`, or straight to
   `APPROVED` when approval is turned off in settings.
3. **Approve** (`POST /:id/approve`, APPROVER or ADMIN).
4. **Send:** outside the system (email/phone); no status records it.
5. **Receive:** goods receipts post against the order, or
   `POST /:id/receive` books everything outstanding to one location;
   the order moves to `PARTIALLY_RECEIVED` or `RECEIVED`.
6. **Close** (`POST /:id/close`): from `PARTIALLY_RECEIVED` or `RECEIVED`;
   a reason is required when closing short.
7. **Cancel** (`POST /:id/cancel`): from `DRAFT`, `PENDING_APPROVAL` or
   `APPROVED`, with a reason, when the cancellation setting allows it.

## Business rules
- Lines cannot be edited after creation in any state. Notes and the
  expected delivery date can be edited in `DRAFT` and `PENDING_APPROVAL`,
  and in `APPROVED` when `purchaseOrders.allowEditAfterApproval` is on.
- An order cannot be cancelled once anything has been received.
- Received quantity per line is always ≤ ordered quantity. An authorised
  over-receipt override is **Planned** — it does not exist; over-receipt is
  refused.
- Each transition is written to the audit log (except creation) and shown
  as the order's history (`GET /:id/history`).

## Outputs
PurchaseOrder record with lifecycle timestamps and actors, driving Goods
Receipt matching in `goods-receiving.md`.

## Evidence
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts:97-224`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:138-455`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:573-592` — over-receipt refused
- `afrinov-platform/apps/frontend/src/App.tsx:125-136`
