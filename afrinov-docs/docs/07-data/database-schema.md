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
How Sales prices one piece of equipment for the client, the "Costing: Sales Rep." step of the RFQ Process Flow: the production labour, each role's hours at its selling rate, plus the material, which is one supplier's whole quote on each of the project's Procurement RFQs Sales picks (the one Procurement recommends unless Sales picks another), with the job's markup on the whole. Delivery is priced on its own. Nothing goes to a supplier. Apart from Procurement's RFQs, because buyers and the store must not see the price or the margin. `SalesRfqStatus`: DRAFT, PENDING_APPROVAL, APPROVED, CANCELLED. The Director approves a submitted one, or sends it back to DRAFT with a reason; nobody approves one they raised or submitted.

| Table (model) | Key columns | Constraints and notes |
|---|---|---|
| `sales_rfqs` (SalesRfq) | number, quote_reference, status, project_number, description, notes, quote_notes, markup_percent, delivery_price, vat_rate, client_name, client_address, contact_name, client_reference, payment_terms, validity, delivery_duration, delivery_terms, signer_phone, signer_email, issued_at, closing_date, created/submitted/approved/returned/cancelled by and at, return_reason, cancellation_reason | number unique, in one sequence per project with Procurement's RFQs; quote_reference unique, AFRI-02A-<project>-04-<n>, given on approval; vat_rate fixed on submission; quote_notes printed on the quotation under the company's Notes, one per line (notes are remarks, not printed) |
| `sales_rfq_equipment_lines` (SalesRfqEquipmentLine) | sales_rfq_id, line_no, equipment, details, quantity, markup_percent | (sales_rfq_id, line_no) unique; one row per line of the quotation, at least one per Sales RFQ; details printed under it, one per line; quantity a whole number, the line's costs being for one unit, 0 for a line priced for the client to see but not charged (printed "R -"; at least one line charged to submit); markup_percent its own markup, null to take the job's (`sales_rfqs.markup_percent`), every line needing one or the other to submit; cascade on delete |
| `sales_rfq_labour_lines` (SalesRfqLabourLine) | sales_rfq_id, equipment_line_id, line_no, labour_rate_id, role, hours, hourly_rate | (sales_rfq_id, line_no) unique, numbered through the Sales RFQ; the role and rate as they were when the line was saved; cascade on delete of the Sales RFQ or its equipment line |
| `sales_rfq_materials` (SalesRfqMaterial) | sales_rfq_id, rfq_id, equipment_line_id, supplier_id, quote_total, currency, amount | composite PK (sales_rfq_id, rfq_id): one quote per Procurement RFQ, on one equipment line; quote_total in the quote's currency and amount in rand at the Settings exchange rate, both excl. VAT, refreshed on save and fixed on submission |
| `sales_rfq_other_costs` (SalesRfqOtherCost) | sales_rfq_id, equipment_line_id, line_no, description, quantity, unit_cost | (sales_rfq_id, line_no) unique, numbered through the Sales RFQ; accommodation, LOA, travel or hire on a line, for one unit, in rand excl. VAT, before markup; cascade on delete |
| `labour_rates` (LabourRate) | role, hourly_rate, active | role unique; the Manpower Rate list's selling rates, kept by the Workshop Manager; made inactive rather than deleted |

Procurement recommends a quote for costing on its RFQ: `rfqs.recommended_supplier_id`, `recommended_at`, `recommended_by_id`. It is not an award and raises no order; it changes only while the RFQ is sent, and is cleared when that supplier declines.

The migration `20260101000055_sales_rfq_costing` refuses to run while any supplier price or quotation PDF is recorded on a Sales RFQ, rather than drop it: those rows are exported and deleted first. A Sales RFQ that was sent becomes a draft.

The migration `20260101000058_sales_rfq_equipment_lines` gives every Sales RFQ one equipment line, quantity 1, named as its equipment was, and moves its labour and quotes onto it; `sales_rfqs.equipment` is then dropped. One line of quantity 1 with no other costs adds up exactly as before (`sales-costing.ts`), so no approved price moves.

The migration `20260101000061_sales_rfq_line_markup` adds `sales_rfq_equipment_lines.markup_percent`, null on every line kept so far, so each takes the job's markup and no price moves.

The migration `20260101000060_quotation_notes` adds `sales_rfqs.quote_notes`. An equipment line of quantity 0 needs no migration: the column already takes any whole number, and the service now allows 0.

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

`receipt_confirmations` (ReceiptConfirmation, ADR-034): id, slip_id (the
issue's or tool loan's issue_id), slip_kind (`ReceiptSlipKind` ISSUE, LOAN),
method (`ReceiptMethod` PIN, SIGNATURE, PAPER, NONE), signer_id (the recipient
who confirmed, or who collected for a machine or site), reason
(`ReceiptSkipReason` LEFT, CANNOT, NO_SCREEN, DISPUTED, OTHER; NONE only), note,
lines_fingerprint (SHA-256 of the slip's unreversed lines when confirmed),
captured_by_id, confirmed_at, image_removed_at. A partial unique index allows one
row that is not NONE per slip; CHECKs make a confirmation name its signer and
fingerprint and a NONE row its reason and no signer. FKs to the signer and the
user who captured it; indexes on slip_id and confirmed_at. Added to only; it holds
no stock. `receipt_images` holds a confirmation's signature or photo (content
type, size, bytes), removed on its own when its time is up.
`recipients` gained pin_hash (bcrypt, never returned), pin_set_at,
pin_failed_tries and pin_locked_at.

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
