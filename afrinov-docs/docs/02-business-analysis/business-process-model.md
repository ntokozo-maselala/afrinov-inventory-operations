# Business Process Model (Overview)

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
   as a distinct state machine — see `03-domain/state-machines.md`)
7. Supplier Management (`04-processes/supplier-management.md`)
8. Purchase Order Lifecycle (`04-processes/purchase-order-lifecycle.md`)
9. Reporting & Controls (`04-processes/reporting-and-controls.md`)

## Explicitly not modelled as a process (v1)
Scrap sale, office asset assignment — these are recorded in the workbook but
sit outside the inventory-to-stock loop (see `product-scope.md`).
