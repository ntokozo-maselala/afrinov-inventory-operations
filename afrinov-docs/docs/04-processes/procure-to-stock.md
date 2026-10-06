# Process: Procure-to-Stock

## Trigger
A material's `InventoryBalance` falls at or below its `requiredStock`
threshold, or a manual need is identified.

## Actors
Store Controller / Procurement (v1 may be the same person), Supplier
(external), Approver (if approval rule applies).

## Steps
1. Reorder candidate identified (system-flagged or manual).
2. Purchase Order drafted: supplier selected, material lines and quantities
   added.
3. PO submitted, optionally approved (approval rule TBD with business —
   today's system has no approval step at all).
4. PO sent to supplier (outside the system in v1 — email/phone, as today).
5. Supplier delivers goods.
6. Goods Receipt recorded, matched to the PO.
7. InventoryTransaction (Receipt) created per line; InventoryBalance
   updated; PO received-quantity updated.
8. PO status becomes PARTIALLY_RECEIVED or FULLY_RECEIVED.

## Business rules
- A PO can be received in multiple partial deliveries.
- A receipt can happen without a PO (ad hoc), preserving today's informal
  practice, but should be flagged in reporting as "unplanned receipt" so the
  gap between informal and planned buying is visible for the first time.

## Exceptions
- Quantity received differs from ordered → receipt records actual quantity;
  PO stays PARTIALLY_RECEIVED or is closed short, per business decision.
- Wrong material delivered → do not force-match; record as ad hoc receipt,
  investigate PO separately.
- Damaged goods on arrival → receive at correct quantity only; log the
  shortfall as a note, don't silently inflate the PO's received count.

## Outputs
GoodsReceipt record, InventoryTransaction(s), updated PO status, updated
InventoryBalance.
