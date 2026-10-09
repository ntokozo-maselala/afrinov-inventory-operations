# Database Schema

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

PostgreSQL 16, defined in `afrinov-platform/apps/backend/prisma/schema.prisma`
and created by the SQL migrations in `prisma/migrations/` (history in
`migration-strategy.md`). Table names are the `@@map` names below.
Quantities and money are `DECIMAL(18,4)`.

## Identity & access
| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `users` (User) | id, email, name, password_hash, active | email unique; `active` default true |
| `roles` (Role) | id, name (enum RoleName), description | name unique |
| `permissions` (Permission) | id, code (`action:resource`), description | code unique |
| `user_roles` (UserRole) | user_id, role_id | composite PK; cascade on delete |
| `role_permissions` (RolePermission) | role_id, permission_id | composite PK; cascade on delete |

`RoleName`: ADMIN, STORE_CONTROLLER, PROCUREMENT, APPROVER, TECHNICIAN, VIEWER.

## Master data
| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `materials` (Material) | id, sku, name, description, category, unit_of_measure, required_stock (default 0), unit_cost (nullable), active | sku unique; indexes on category, active |
| `locations` (Location) | id, name, code, type, active, address, description, contact_person, contact_phone, contact_email, notes, created_by_id, updated_by_id | name unique; code unique; indexes on type, active |
| `racks` (Rack) | id, code, name, description, location_id, project_number, capacity, status, notes | code unique; optional FKs to location and project; indexes on location_id, project_number, status |
| `suppliers` (Supplier) | id, name, contact_name, contact_email, contact_phone, notes, active | case-insensitive unique name via citext index `suppliers_name_ci_key`; plain index on name |
| `projects` (Project) | project_number (PK), name, code, status (text, default PLANNING), manager_id, client, start_date, end_date, notes, description, active | code unique; optional FK manager → users; indexes on status, active |
| `recipients` (Recipient) | id, name, type, notes, active | unique on `lower(btrim(name))` (`recipients_name_ci_key`); indexes on type, active |

Enums: `MaterialCategory` FASTENERS_SLUGS_INSULATION, TOOLING_PPE_ELECTRICAL,
PROJECT_MATERIAL, CONSUMABLES, TOOLS · `LocationType` RACK, STOREROOM,
SHOP_FLOOR_AREA, CONTAINER, OFF_SITE · `RackStatus` ACTIVE, INACTIVE, FULL ·
`RecipientType` WORKER, MACHINE, SITE, CONTRACTOR. Project status values
(PLANNING, ACTIVE, ON_HOLD, COMPLETED, CANCELLED) are checked in application
code only; the column is free text (TD-024).

## Procurement
| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `purchase_orders` (PurchaseOrder) | id, number, supplier_id, status, notes, created_by_id, expected_delivery_date, approved_*, delivered_*, cancelled_*, closed_*, shipped_*/tracking_number/carrier/shipment_notes (kept, no longer written) | number unique; indexes on status, supplier_id |
| `purchase_order_lines` | id, purchase_order_id, material_id, ordered_qty, received_qty (default 0) | cascade on PO delete; index on purchase_order_id; no price column |
| `goods_receipts` (GoodsReceipt) | id, number, purchase_order_id (nullable), supplier_id, delivery_ref, status, received_by_id, received_at | number unique; indexes on status, purchase_order_id |
| `goods_receipt_lines` | id, goods_receipt_id, material_id, location_id, quantity, purchase_order_line_id (no FK) | cascade on receipt delete |

`PurchaseOrderStatus`: DRAFT, PENDING_APPROVAL, APPROVED, PARTIALLY_RECEIVED,
RECEIVED, CLOSED, CANCELLED · `GoodsReceiptStatus`: DRAFT, SUBMITTED, POSTED
(DRAFT is never produced by current code).

## Inventory ledger
| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `inventory_transactions` (InventoryTransaction) | id, material_id, location_id, type, quantity (signed), reference_type, reference_id, recipient_id, reason_code, reason_note, project_number, actor_id, posted_at, paired_with_id, reverses_id | `paired_with_id` unique (transfer legs); `reverses_id` unique (a row can be reversed once); FKs to material, location, actor (users), project, recipient, paired and reversed rows; indexes on (material_id, location_id, posted_at), (reference_type, reference_id), posted_at, type, recipient_id |
| `inventory_balances` (InventoryBalance) | material_id, location_id, quantity, updated_at | composite PK; index on location_id. The schema declares FKs to materials and locations but no migration creates them (TD-005) |

`InventoryTransactionType`: RECEIPT, ISSUE, TRANSFER_OUT, TRANSFER_IN,
ADJUSTMENT, RETURN · `AdjustmentReasonCode`: COUNT_VARIANCE, DAMAGE, LOSS,
SCRAP, OTHER.

`reference_type` values written by the code: `GoodsReceipt` (receipts),
`PurchaseOrder` (receive-all on an order), `Project` (issues with a
project), `Return` (returns; `reference_id` = the issue), `StockCount`,
`InitialStock` (stock-item onboarding), `OpeningBalance` (workbook import).
It is a polymorphic text pair, not a foreign key.

## Settings and audit
| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `settings` (Setting) | key (PK), value (JSON), type, category, description, is_editable, enum_options, updated_by_id | index on category |
| `audit_log_entries` (AuditLogEntry) | id, actor_id (no FK), action, entity_type, entity_id, before, after (JSON), created_at | indexes on (entity_type, entity_id), created_at |

## Evidence
- `afrinov-platform/apps/backend/prisma/schema.prisma:19-531`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000002_supplier_name_uniqueness/migration.sql:16`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000005_recipients/migration.sql:24`
- `afrinov-platform/apps/backend/src/modules/operations/project.service.ts:14-20`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-count.service.ts:17`, `afrinov-platform/apps/backend/src/modules/migration/opening-balance.service.ts:19`, `afrinov-platform/apps/backend/src/modules/inventory/stock-item.service.ts:117` — reference types
