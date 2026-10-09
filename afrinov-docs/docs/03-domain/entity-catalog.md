# Entity Catalog

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

For every entity: purpose, owner (domain), key attributes, lifecycle,
source in the AS-IS system, mutability, and auditability. Column-level
detail is in `07-data/database-schema.md`.

## Material
- **Purpose:** the thing being tracked as stock.
- **Owner:** Inventory.
- **Attributes:** id, sku (unique), name, description, category (enum:
  FASTENERS_SLUGS_INSULATION, TOOLING_PPE_ELECTRICAL, PROJECT_MATERIAL,
  CONSUMABLES, TOOLS), unitOfMeasure, requiredStock, unitCost (optional),
  active.
- **Lifecycle:** created, then active or inactive (`PATCH /materials/:id`).
  Category cannot be changed after creation (it is not in the update
  schema).
- **AS-IS source:** one row per `*Main` sheet; the import reads four
  categories (not Tools), see `07-data/migration-strategy.md`.
- **Mutable:** name, description, unit, Required Stock, unit cost, active.
- **Auditable:** yes (CREATE, UPDATE).

## Location
- **Purpose:** where stock physically sits.
- **Attributes:** id, name (unique), code (optional, unique), type (RACK,
  STOREROOM, SHOP_FLOOR_AREA, CONTAINER, OFF_SITE), active, address,
  description, contact person/phone/email, notes.
- **Lifecycle:** created, then active or inactive; deleted only when
  nothing refers to it (no racks, receipt lines, transactions or balances).
- **AS-IS source:** free-text `Location`/`Rack` column, mapped by a person
  during import (see `07-data/migration-strategy.md`).
- **Mutable:** all master fields.
- **Auditable:** yes (CREATE, UPDATE, ACTIVATE/DEACTIVATE, DELETE).

## Rack
- **Purpose:** a numbered storage position (e.g. `D-1`).
- **Attributes:** id, code (unique), name, description, optional location,
  optional project, capacity (informational), status (ACTIVE, INACTIVE,
  FULL), notes.
- **Lifecycle:** created as ACTIVE (or FULL); `DELETE` archives it to
  INACTIVE.
- **Auditable:** yes (CREATE, UPDATE, ARCHIVE).

## Supplier
- **Purpose:** external vendor of materials.
- **Attributes:** id, name (unique ignoring case), contact name/email/phone,
  notes, active.
- **Lifecycle:** created, active. **Planned:** update and deactivate (the
  `active` column exists; no endpoint changes it).
- **AS-IS source:** free-text `Supplier Name`; no master exists today. The
  import takes supplier names typed in by the buyer.
- **Mutable:** not through the API today.
- **Auditable:** yes (CREATE).

## PurchaseOrder / PurchaseOrderLine
- **Purpose:** a formal order for material from a supplier.
- **Attributes (PO):** id, number, supplier, status, notes,
  expectedDeliveryDate, createdBy/At, approved/delivered/cancelled/closed
  by and at, cancellation and close reasons.
- **Attributes (Line):** material, orderedQty, receivedQty (incremented as
  goods are received). No price is stored.
- **Lifecycle:** see `state-machines.md`.
- **AS-IS source:** does not exist today; new capability.
- **Mutable:** only notes and expected delivery date, while DRAFT,
  PENDING_APPROVAL or (if the setting allows) APPROVED. Lines are never
  edited after creation.
- **Auditable:** yes, except creation.

## GoodsReceipt / GoodsReceiptLine
- **Purpose:** records goods physically arriving.
- **Attributes:** id, number, optional PO, supplier, deliveryRef, status,
  receivedBy, receivedAt; lines: material, location, quantity, optional PO
  line.
- **AS-IS source:** rows where `In/Out = IN` on `*Issued` sheets.
- **Lifecycle:** counter receipts are created already POSTED; receipts
  recorded through the procurement API are created SUBMITTED and then
  posted.
- **Mutable:** no endpoint edits a receipt.
- **Auditable:** counter receipts yes (RECEIVE_STOCK); procurement receipt
  create and post no.

## InventoryTransaction
- **Purpose:** the immutable ledger entry for any stock movement.
- **Attributes:** id, material, location, type (RECEIPT, ISSUE,
  TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, RETURN), signed quantity,
  reference (type + id), recipient, reason code and note, project, actor,
  postedAt, pairedWith (transfer), reverses (reversal).
- **AS-IS source:** rows on `*Issued` sheets (Receipt/Issue), implicit for
  Transfer/Adjustment (not modelled distinctly in the workbook).
- **Mutable:** never after posting (ADR-002); corrected by reversal
  (ADR-005).
- **Auditable:** is itself the audit trail for stock.

## InventoryBalance
- **Purpose:** current on-hand quantity per material per location.
- **Attributes:** material, location, quantity, updatedAt.
- **AS-IS source:** `Current Stock` cell.
- **Mutable:** only by recompute from the ledger after a movement.
- **Auditable:** N/A; audit lives at the transaction level.

## Project
- **Purpose:** ties issues and returns to a client job.
- **Attributes:** projectNumber (PK, e.g. `AFRI-1325`), name, code,
  description, status (PLANNING, ACTIVE, ON_HOLD, COMPLETED, CANCELLED),
  manager (User), client, start/end date, notes, active.
- **AS-IS source:** `Project No.` sheet and column on `*Issued` sheets.
- **Lifecycle:** created; `DELETE` archives it (inactive and CANCELLED).
  Issues against an inactive project are refused.
- **Auditable:** yes (CREATE, UPDATE, ARCHIVE).

## Recipient ("Issued To")
- **Purpose:** who receives issued stock: a worker, machine, client site or
  contractor (ADR-008). Not a user account.
- **Attributes:** id, name (unique ignoring case), type, notes, active.
- **AS-IS source:** `Employees` sheet and the free-text `Issued To:` column.
- **Lifecycle:** created, then active or inactive; never deleted.
- **Auditable:** yes (CREATE, UPDATE).

## User
- **Purpose:** a person who signs in and performs actions.
- **Attributes:** id, email (unique), name, active, roles.
- **AS-IS source:** none; the workbook has no accounts. `Issued By:` maps
  to the transaction's actor.
- **Mutable:** name, active, roles (administrator only).
- **Auditable:** yes (CREATE, UPDATE).

## Setting, AuditLogEntry, Role, Permission
Supporting entities; see `07-data/database-schema.md` and
`07-data/audit-model.md`.

## Tool (Material subtype behaviour) — Planned
- **Purpose:** a Material in the Tools category with check-out tracking.
- **Attributes:** currentHolder, currentStatus. **Not in the schema.**
- **AS-IS source:** `Tools Main`/`Tools Issued` with `Check In/Out` column.

## Evidence
- `afrinov-platform/apps/backend/prisma/schema.prisma:28-531`
- `afrinov-platform/apps/backend/src/modules/inventory/material.routes.ts:18-25` (update schema has no category)
- `afrinov-platform/apps/backend/src/modules/inventory/location.service.ts:64-78,214-224`
- `afrinov-platform/apps/backend/src/modules/inventory/rack.service.ts:157-170`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts:33-36,78-95`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:442-447`
- `afrinov-platform/apps/backend/src/modules/procurement/goods-receipt.service.ts` (created SUBMITTED)
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts:72-82` (created POSTED)
- `afrinov-platform/apps/backend/src/modules/operations/project.service.ts:14-20,190-198`
- `afrinov-platform/apps/backend/src/modules/operations/recipient.service.ts:1-3`
