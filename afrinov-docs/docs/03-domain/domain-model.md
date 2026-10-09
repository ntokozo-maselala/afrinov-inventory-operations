# Domain Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Core concepts and relationships
```
Supplier 1----* PurchaseOrder 1----* PurchaseOrderLine *----1 Material
                     |
                     | (receipt, optional)
                     v
Supplier 1----* GoodsReceipt 1----* GoodsReceiptLine *----1 Material, *----1 Location
                     |
                     v
            InventoryTransaction *----1 Material
            InventoryTransaction *----1 Location
            InventoryTransaction *----0..1 Project
            InventoryTransaction *----0..1 Recipient   ("Issued To")
            InventoryTransaction *----1 User (actor)
            InventoryTransaction 0..1----0..1 InventoryTransaction (transfer pair; reversal)
                     |
                     v
            InventoryBalance (derived: Material x Location -> quantity)

Material: category is an enum attribute (5 values)
Rack *----0..1 Location, Rack *----0..1 Project
Project *----0..1 User (manager)
```

## Key attributes
- **Material**: id, SKU, name, description, category, unit of measure,
  Required Stock, unit cost (optional; one price per item), active flag.
- **Location**: id, unique name, optional unique code, type (rack /
  storeroom / shop-floor area / container / off-site), active flag, address,
  description, contact fields, notes.
- **Rack**: id, unique code, name, optional location, optional project,
  capacity (informational), status (ACTIVE / INACTIVE / FULL).
- **Supplier**: id, name (unique ignoring case), contact details, notes,
  active flag.
- **Project**: project number (primary key, e.g. `AFRI-1325`), name,
  optional code, status, manager, client, dates, notes, active flag.
- **Recipient**: id, name (unique ignoring case and surrounding spaces),
  type (worker / machine / site / contractor), notes, active flag.
- **PurchaseOrder**: id, number `PO-YYYY-NNNN`, supplier, status, lines
  (material, ordered and received quantity — no price), notes, expected
  delivery date, created-by and lifecycle timestamps/actors.
- **GoodsReceipt**: id, number `GR-YYYY-NNNN`, optional PO, supplier,
  delivery/invoice reference, status, lines (material, location, quantity,
  optional PO line), received-by, received-at.
- **InventoryTransaction**: id, material, location, type (RECEIPT, ISSUE,
  TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, RETURN), signed quantity, reference
  (type + id, polymorphic), recipient, adjustment reason code and note,
  project, actor, posted-at, paired transfer leg, reversed transaction.
  Never updated after posting, except that the two legs of a new transfer
  or transfer reversal are linked to each other when created (ADR-002,
  ADR-005).
- **InventoryBalance**: material, location, quantity — recomputed as
  `SUM(InventoryTransaction.quantity)` for that pair after every movement.

**Planned:** a Tool (a Material with category TOOLS) with a current holder
and check-out state. No such state exists in the code; tools are issued
like any other material.

## Design note carried from the AS-IS analysis
The workbook's `Brought Forward` figure becomes the balance as of a point in
time, computable from the ledger. The month-end report does exactly this:
it rebuilds each item's stock at the end of a month from the ledger rows
posted before that date. At go-live the workbook's current stock enters as
one dated opening-balance RECEIPT per item and location
(`07-data/migration-strategy.md`).

## Evidence
- `afrinov-platform/apps/backend/prisma/schema.prisma:102-475`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:449-455` — PO numbers
- `afrinov-platform/apps/backend/src/modules/procurement/goods-receipt.service.ts` — `generateGRNumber`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:256-261,475-478` — the only updates link the legs of a new pair
- `afrinov-platform/apps/backend/src/modules/reporting/month-end.service.ts:5-9,79`
