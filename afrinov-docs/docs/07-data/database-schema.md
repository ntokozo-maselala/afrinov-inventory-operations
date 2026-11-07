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

`RoleName`: ADMIN, STORE_CONTROLLER, PROCUREMENT, APPROVER, TECHNICIAN, VIEWER, PROCUREMENT_MANAGER, DIRECTOR, CEO, WORKSHOP_MANAGER, SALES.

## Master data
| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `materials` (Material) | id, sku, name, description, category, unit_of_measure, required_stock (default 0), unit_cost (nullable), active, track_use (default false, ADR-026) | sku unique; indexes on category, active |
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
| `purchase_order_signatures` (PurchaseOrderSignature) | id, purchase_order_id, step (MANAGER, DIRECTOR), signed_by_id, signed_at, stand_in | unique on purchase_order_id and step; cascade on PO delete; `purchase_orders.exchange_rate` holds the rate locked at submission (ADR-030) |
| `purchase_order_lines` | id, purchase_order_id, material_id, ordered_qty, received_qty (default 0) | cascade on PO delete; index on purchase_order_id; no price column |
| `goods_receipts` (GoodsReceipt) | id, number, purchase_order_id (nullable), supplier_id, delivery_ref, status, received_by_id, received_at | number unique; indexes on status, purchase_order_id |
| `goods_receipt_lines` | id, goods_receipt_id, material_id, location_id, quantity, purchase_order_line_id (no FK) | cascade on receipt delete |

`PurchaseOrderStatus`: DRAFT, PENDING_APPROVAL, APPROVED, PARTIALLY_RECEIVED,
RECEIVED, CLOSED, CANCELLED · `GoodsReceiptStatus`: DRAFT, SUBMITTED, POSTED
(DRAFT is never produced by current code).

## Sales requests for quotation
What Sales asks suppliers to price when costing a job. Apart from Procurement's RFQs, because who may see the prices differs and lines are typed rather than catalogue items. Nothing is awarded. `SalesRfqStatus`: DRAFT, SENT, CANCELLED.

| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `sales_rfqs` (SalesRfq) | number, status, project_number, description, notes, penalties_apply, issued_at, closing_date, created/sent/cancelled by and at, cancellation_reason | number unique; numbered per project as Procurement's, in its own sequence, so the same number can be on both |
| `sales_rfq_lines` (SalesRfqLine) | sales_rfq_id, line_no, description, unit_of_measure, quantity | (sales_rfq_id, line_no) unique; unit_of_measure references `units_of_measure`; cascade on delete |
| `sales_rfq_suppliers` (SalesRfqSupplier) | sales_rfq_id, supplier_id, quote_reference, quoted_at, valid_until, lead_time, notes, currency, declined | (sales_rfq_id, supplier_id) unique; cascade on delete |
| `sales_rfq_quote_prices` (SalesRfqQuotePrice) | sales_rfq_supplier_id, sales_rfq_line_id, unit_price | composite PK; excluding VAT, in the quote's currency |
| `sales_rfq_quote_files` (SalesRfqQuoteFile) | sales_rfq_supplier_id, file_name, size, data, uploaded_at, uploaded_by_id | one PDF per supplier, up to 10 MB |

A buyer matches a Procurement RFQ line to the Sales line it answers, for the savings report: `rfq_lines.sales_rfq_line_id`, optional and shared by as many lines as need it, set to null if the Sales line is deleted. It must be on a Sales RFQ sent for the same project. It follows its item when a draft's lines are edited, and is cleared when a draft moves to another project.

## Inventory ledger
| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `inventory_transactions` (InventoryTransaction) | id, material_id, location_id, type, quantity (signed), reference_type, reference_id, recipient_id, reason_code, reason_note, project_number, actor_id, posted_at, paired_with_id, reverses_id | `paired_with_id` unique (transfer legs); `reverses_id` unique (a row can be reversed once); FKs to material, location, actor (users), project, recipient, paired and reversed rows; indexes on (material_id, location_id, posted_at), (reference_type, reference_id), posted_at, type, recipient_id |
| `inventory_balances` (InventoryBalance) | material_id, location_id, quantity, updated_at | composite PK; index on location_id. The schema declares FKs to materials and locations but no migration creates them (TD-005) |

`InventoryTransactionType`: RECEIPT, ISSUE, TRANSFER_OUT, TRANSFER_IN,
ADJUSTMENT, RETURN · `AdjustmentReasonCode`: COUNT_VARIANCE, DAMAGE, LOSS,
SCRAP, OTHER.

`consumable_outcomes` (ConsumableOutcome, ADR-026): id, issue_transaction_id,
outcome (`ConsumableOutcomeKind` USED_UP, BROKEN), quantity, note,
withdraws_id, return_transaction_id, actor_id, created_at. `withdraws_id`
unique (an outcome is withdrawn once); `return_transaction_id` is the RETURN
booked in the same counter visit, if any, which shows it on Movements; FKs to
the issue, the return, the actor and the withdrawn outcome; indexes on
issue_transaction_id, return_transaction_id and created_at. Added to only; it
holds no stock.

`material_status_changes` (MaterialStatusChange, ADR-033): id, material_id,
active (the status it changed to), reason_code (`MaterialStatusReason`
OBSOLETE, SUPERSEDED, SUPPLIER_DISCONTINUED, CREATED_IN_ERROR, BACK_IN_USE,
STOCK_CAME_BACK, DEACTIVATED_IN_ERROR, OTHER), note, actor_id, created_at. FKs
to the material and the actor; indexes on (material_id, created_at) and
created_at. reason_code is null only on changes copied from the audit log. Added
to only; it holds no stock, so it is never in a ledger sum.

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
