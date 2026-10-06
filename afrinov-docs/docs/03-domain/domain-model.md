# Domain Model

## Core concepts and relationships
```
Supplier 1----* PurchaseOrder 1----* PurchaseOrderLine *----1 Material
                     |
                     | (receipt)
                     v
                GoodsReceipt 1----* GoodsReceiptLine *----1 Material
                     |
                     v
            InventoryTransaction *----1 Material
            InventoryTransaction *----1 Location
            InventoryTransaction *----0..1 Project (reference)
            InventoryTransaction *----1 User (actor)
                     |
                     v
            InventoryBalance (derived: Material x Location -> quantity)

Material *----1 MaterialCategory
Tool (a Material with category=Tools) --- has current holder (User) when checked out
```

## Key attributes
- **Material**: id, SKU/product ID, name, category, unit of measure,
  required-stock threshold, active flag.
- **Location**: id, canonical name, type (rack / storeroom / shop-floor
  area / container), active flag.
- **Supplier**: id, name, contact details.
- **PurchaseOrder**: id, supplier, status, lines, created-by, created-at.
- **GoodsReceipt**: id, optional PO reference, supplier, delivery/invoice
  reference, lines, received-by, received-at.
- **InventoryTransaction**: id, material, location, type (Receipt / Issue /
  Transfer-Out / Transfer-In / Adjustment), quantity (signed), reference
  (PO / GoodsReceipt / Project / adjustment reason), actor, timestamp.
  Immutable once posted (ADR-002).
- **InventoryBalance**: material, location, quantity — a materialized view
  over `SUM(InventoryTransaction.quantity)`, never written directly.

## Design note carried from the AS-IS analysis
The existing `Brought Forward` figure becomes, in the target model, simply
the balance as of a point in time — computable from the ledger rather than a
separately maintained number, eliminating the class of bug where brought-
forward and computed current stock disagree.
