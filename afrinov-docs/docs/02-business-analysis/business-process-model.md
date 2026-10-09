# Business Process Model (Overview)

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Detailed versions of each process live in `04-processes/`. This is the map.

```
SUPPLIER                 STORES                    PROJECT / WORKSHOP
   |                        |                              |
   |--- delivers goods ---->|                              |
   |                        |--- Goods Receipt ----------->|
   |                        |    (stock increases)         |
   |                        |                              |
   |                        |<--- material/tool request ---|
   |                        |--- Stock Issue ------------->|
   |                        |    (stock decreases)         |
   |                        |                              |
   |                        |<== Stock Transfer (rack A -> rack B) ==>|
   |                        |                              |
   |                        |--- Stock Adjustment ---------|
   |                        |    (count correction, damage, scrap)   |
```

## Processes in scope
1. Procure-to-Stock (`04-processes/procure-to-stock.md`)
2. Goods Receiving (`04-processes/goods-receiving.md`)
3. Stock Issuing (`04-processes/stock-issuing.md`)
4. Stock Transfer (`04-processes/stock-transfer.md`)
5. Stock Adjustment (`04-processes/stock-adjustment.md`)
6. Tool Check-Out/Check-In (part of `04-processes/stock-issuing.md`, flagged
   as a distinct state machine — see `03-domain/state-machines.md`) —
   **Planned**, not implemented
7. Supplier Management (`04-processes/supplier-management.md`)
8. Purchase Order Lifecycle (`04-processes/purchase-order-lifecycle.md`)
9. Reporting & Controls (`04-processes/reporting-and-controls.md`)

## Implemented sub-processes not in the original map
- Stock count by location, posting differences as adjustments
  (`04-processes/stock-adjustment.md`).
- Return of unused stock against an issue (`04-processes/stock-issuing.md`).
- Reversal of a mistaken movement (ADR-005; `04-processes/stock-adjustment.md`).
- Counter receipt without a purchase order (`04-processes/goods-receiving.md`).
- Month-end reporting (`04-processes/reporting-and-controls.md`).

## Explicitly not modelled as a process (v1)
Scrap sale, office asset assignment — these are recorded in the workbook but
sit outside the inventory-to-stock loop (see `product-scope.md`).

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:83-170`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts:60-76`
