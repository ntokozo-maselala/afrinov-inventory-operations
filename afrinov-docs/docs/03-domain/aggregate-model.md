# Aggregate Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Aggregates define transactional consistency boundaries — what must be
saved together, atomically. In the code each boundary is one Prisma
`$transaction` inside a service method.

```
PurchaseOrder (aggregate root)
   |-- PurchaseOrderLine[]           (created with the order; never edited afterwards)
   (Supplier referenced by id, not owned)

GoodsReceipt (aggregate root)
   |-- GoodsReceiptLine[]
   (PurchaseOrder optional, referenced by id)

InventoryTransaction (aggregate root, single-entity aggregate)
   (Material, Location, User actor, Project, Recipient referenced by id;
    transfer legs paired through pairedWithId; a reversal points at the
    row it reverses through reversesId)
   -- creating one is the ONLY way InventoryBalance changes

InventoryBalance (not an aggregate — a read model, recomputed from the
   ledger sum for each affected material/location in the same database
   transaction as the movement)

Material (aggregate root)       Location (aggregate root)     Rack (aggregate root)
Supplier (aggregate root)       Project (aggregate root)      Recipient (aggregate root)
```

## Rule
*Intended:* no aggregate reaches across and mutates another aggregate's
internals directly; a Goods Receipt publishes `GoodsReceived` and
Procurement applies it to its own PO.

*As implemented:* posting a goods receipt updates the purchase order
directly, in the same database transaction:
`InventoryService.postGoodsReceipt` inserts the RECEIPT rows, increments
each `PurchaseOrderLine.receivedQty` (refusing to exceed the ordered
quantity), marks the receipt POSTED and sets the order to
PARTIALLY_RECEIVED or RECEIVED. `PurchaseOrderService.receive`
(receive everything outstanding) likewise writes inventory rows directly.
`GoodsReceived` is dispatched afterwards but has no handler (TD-007). The
"balance changes only via transactions" rule (ADR-002) does hold: every
balance write is a recompute from the ledger.

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:542-624` — goods receipt posting
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:289-356` — receive all outstanding
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:138-167` — lines created with the order; `update` changes only notes and expected date (:170-198)
- `afrinov-platform/apps/backend/prisma/schema.prisma:414-459` — transaction references, `pairedWithId`, `reversesId`
- `afrinov-platform/apps/backend/src/shared/inventory/balances.ts:6-21`
