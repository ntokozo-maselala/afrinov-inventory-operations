# Aggregate Model

Aggregates define transactional consistency boundaries — what must be
saved together, atomically.

```
PurchaseOrder (aggregate root)
   |-- PurchaseOrderLine[]
   (Supplier referenced by id, not owned)

GoodsReceipt (aggregate root)
   |-- GoodsReceiptLine[]
   (PurchaseOrder referenced by id, not owned; posting a receipt updates
    the referenced PO's line received-quantities via a domain event, not
    a direct cross-aggregate write)

InventoryTransaction (aggregate root, single-entity aggregate)
   (Material, Location, Project, User all referenced by id)
   -- creating one is the ONLY way InventoryBalance changes

InventoryBalance (not an aggregate — a derived/materialized read model,
   recomputed or incrementally updated from InventoryTransaction events)

Material (aggregate root)
   (category, requiredStock, unitOfMeasure owned directly)

Location (aggregate root)

Supplier (aggregate root)
```

## Rule
No aggregate reaches across and mutates another aggregate's internals
directly. A Goods Receipt does not edit `PurchaseOrderLine.receivedQty` in
the same object graph it's saving — it publishes/handles a
`GoodsReceived` domain event that the Procurement module applies to its own
PO aggregate. This keeps the "PO lifecycle" rules (see
`04-processes/purchase-order-lifecycle.md`) inside Procurement, and the
"balance changes only via transactions" rule (ADR-002) inside Inventory.
