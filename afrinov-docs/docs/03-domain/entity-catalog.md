# Entity Catalog

For every entity: purpose, owner (domain), key attributes, lifecycle,
source in the AS-IS system, mutability, and auditability.

## Material
- **Purpose:** the thing being tracked as stock.
- **Owner:** Inventory.
- **Attributes:** id, sku, name, category (enum: FastenersSlugsInsulation,
  ToolingPPEElectrical, ProjectMaterial, Consumables, Tools), unitOfMeasure,
  requiredStock, active.
- **Lifecycle:** created → active → (optionally) discontinued.
- **AS-IS source:** one row per `*Main` sheet across five categories.
- **Mutable:** master fields yes (name, threshold); category change should
  be rare/audited.
- **Auditable:** yes.

## Location
- **Purpose:** where stock physically sits.
- **Attributes:** id, name (canonical), type, active.
- **Lifecycle:** created → active → retired.
- **AS-IS source:** free-text `Location`/`Rack` column — requires cleansing
  (see `07-data/migration-strategy.md`).
- **Mutable:** name/type, rarely.
- **Auditable:** yes.

## Supplier
- **Purpose:** external vendor of materials.
- **Attributes:** id, name, contact info.
- **Lifecycle:** created → active → inactive.
- **AS-IS source:** free-text `Supplier Name` on `*Issued` sheets — no
  master exists today.
- **Mutable:** contact details.
- **Auditable:** yes.

## PurchaseOrder / PurchaseOrderLine
- **Purpose:** a formal order for material from a supplier.
- **Attributes (PO):** id, supplier, status, createdBy, createdAt.
- **Attributes (Line):** material, orderedQty, receivedQty (derived).
- **Lifecycle:** see `state-machines.md`.
- **AS-IS source:** does not exist today — new capability.
- **Mutable:** while in Draft; append-only history after Submitted.
- **Auditable:** yes.

## GoodsReceipt / GoodsReceiptLine
- **Purpose:** records goods physically arriving.
- **Attributes:** id, optional PO reference, supplier, deliveryRef,
  receivedBy, receivedAt; lines: material, quantity.
- **AS-IS source:** rows where `In/Out = IN` on `*Issued` sheets.
- **Mutable:** no, once posted (creates InventoryTransactions).
- **Auditable:** yes.

## InventoryTransaction
- **Purpose:** the immutable ledger entry for any stock movement.
- **Attributes:** id, material, location, type, quantity (signed), reference
  (polymorphic: PO/GoodsReceipt/Project/AdjustmentReason), actor, postedAt.
- **AS-IS source:** rows on `*Issued` sheets (Receipt/Issue), implicit for
  Transfer/Adjustment (not currently modelled distinctly).
- **Mutable:** never after posting (ADR-002).
- **Auditable:** is itself the audit trail for stock.

## InventoryBalance
- **Purpose:** current on-hand quantity per material per location.
- **Attributes:** material, location, quantity (derived).
- **AS-IS source:** `Current Stock` cell.
- **Mutable:** never directly; recomputed from transactions.
- **Auditable:** N/A — audit lives at the transaction level.

## Project (reference)
- **Purpose:** ties a transaction to a client job.
- **Attributes:** projectNumber (e.g. `AFRI-1325`), description.
- **AS-IS source:** `Project No.` sheet + column on `*Issued` sheets.
- **Mutable:** minimal — reference data only in v1.
- **Auditable:** not primary; inherited via linked transactions.

## Employee / User
- **Purpose:** the person performing or receiving an action.
- **Attributes:** id, name, role(s), active.
- **AS-IS source:** `Employees` sheet (52 names), used as free-text
  `Issued By:`/`Issued To:` — becomes an authenticated account in TO-BE.
- **Mutable:** role assignment.
- **Auditable:** yes.

## Tool (Material subtype behaviour)
- **Purpose:** a Material in the Tools category with check-out tracking.
- **Attributes:** currentHolder (User, nullable), currentStatus.
- **AS-IS source:** `Tools Main`/`Tools Issued` with `Check In/Out` column.
- **Mutable:** currentHolder/status via transactions only.
- **Auditable:** yes.
