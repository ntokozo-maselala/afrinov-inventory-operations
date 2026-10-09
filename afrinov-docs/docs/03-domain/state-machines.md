# State Machines

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Purchase Order
Seven states (ADR-007; migration `20260101000004` mapped the old ones):
```
DRAFT -> PENDING_APPROVAL -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED
  \             \               \              \
   +-------------+---------------+--> CANCELLED  (only before anything is received)
                                   PARTIALLY_RECEIVED -> CLOSED (closing short, reason required)
DRAFT -> APPROVED  (submit, when the approval setting is off)
APPROVED / PARTIALLY_RECEIVED -> RECEIVED  ("receive everything outstanding")
```
Rules, as enforced:
- **Submit** (`DRAFT` only, at least one line) → `PENDING_APPROVAL`; or
  straight to `APPROVED` when `purchaseOrders.requireApprovalBeforeProcessing`
  is false.
- **Approve**: `PENDING_APPROVAL` → `APPROVED`.
- **Receive**: goods receipts may be posted only against `APPROVED` or
  `PARTIALLY_RECEIVED` orders. Posting sets `RECEIVED` when every line's
  received quantity reaches its ordered quantity, otherwise
  `PARTIALLY_RECEIVED`. A line can never be received above its ordered
  quantity. "Receive everything outstanding" books each line's shortfall
  and sets `RECEIVED`.
- **Close**: `PARTIALLY_RECEIVED` or `RECEIVED` → `CLOSED`; a reason is
  required when any line is short.
- **Cancel**: `DRAFT`, `PENDING_APPROVAL` or `APPROVED` → `CANCELLED`, with
  a reason, and only while `purchaseOrders.allowCancellation` is on.
- **Edit**: notes and expected delivery date only, in `DRAFT` or
  `PENDING_APPROVAL`, and also `APPROVED` when
  `purchaseOrders.allowEditAfterApproval` is on. Lines are never editable.
- Every transition is guarded by `WHERE status = <expected>`; a concurrent
  change returns 409 CONFLICT.
- There is no reject transition; an approver cannot reject an order (they
  lack the cancel permission). See ADR-007.

## Goods Receipt
```
(created) SUBMITTED -> POSTED          procurement receipts
(created) POSTED                       counter receipts (POST /stock-receipts)
```
Rules: a receipt can be posted only once and only from `SUBMITTED`; the
`DRAFT` state exists in the enum but no code creates it. Once POSTED it is
never edited. A counter receipt (no PO) can be corrected by reversing its
transactions; a receipt against a purchase order cannot be reversed
(it also changed the order's received quantities).

## Tool — Planned
```
IN_STORE -> CHECKED_OUT (to a specific person) -> IN_STORE
                |
                -> LOST / DAMAGED (terminal, requires Adjustment + reason)
```
Not implemented: there is no tool state in the schema and no check-out or
check-in endpoint. Tools are issued like any other material.

## Inventory Transaction
```
(none) -> POSTED   (no further states)
```
Transactions are created once and never transition (ADR-002). A mistake
is corrected by a **reversal**: a new row of the same type with the
opposite sign whose `reversesId` points at the original (ADR-005). A row
can be reversed at most once (unique `reversesId`); a reversal cannot itself
be reversed; both legs of a transfer are reversed together; an issue that
has had stock returned against it cannot be reversed until the returns are
reversed; no reversal may take a balance below zero.

## Project
`status` is one of PLANNING, ACTIVE, ON_HOLD, COMPLETED, CANCELLED, set
freely by `PATCH /projects/:projectNumber` (no transition rules).
Archiving sets CANCELLED and inactive.

## Rack
`status` is ACTIVE, INACTIVE or FULL, set freely on update; archiving sets
INACTIVE.

## Evidence
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:1-17,170-447`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:180-287` — reversal rules
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:542-624` — goods receipt posting and PO status
- `afrinov-platform/apps/backend/src/modules/procurement/goods-receipt.service.ts` — receipts created SUBMITTED
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts:72-82` — counter receipts created POSTED
- `afrinov-platform/apps/backend/prisma/schema.prisma:278-286,350-354`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000004_simplify_purchase_order_statuses/migration.sql`
- `afrinov-platform/apps/backend/src/modules/operations/project.service.ts:14-20,190-198`
- `afrinov-platform/apps/backend/src/modules/inventory/rack.service.ts:157-170`
