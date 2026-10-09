# Data Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Data classes
| Class | Examples (Prisma models) | Characteristics |
|---|---|---|
| Master data | Material, Location, Rack, Supplier, Project, Recipient, User | Changes rarely, referenced everywhere |
| Transactional data | InventoryTransaction, PurchaseOrder (+lines), GoodsReceipt (+lines) | Created continuously; ledger rows are never updated or deleted by any endpoint |
| Reference data | Enums: MaterialCategory, LocationType, InventoryTransactionType, AdjustmentReasonCode, RecipientType, RackStatus, RoleName; tables: Role, Permission | Small, mostly static |
| Configuration | Setting (typed key/value, catalog in `settings.service.ts`) | Edited by administrators, audited |
| Derived data | InventoryBalance; report figures (stock value, stock status, month-end, consumption) | Computed from the ledger; never a separate source of truth |
| Audit data | AuditLogEntry | Written by services; no endpoint updates or deletes it |

`InventoryBalance` is an ordinary table, not a database view. After every
stock movement the service recomputes the row for each affected
(material, location) pair as the sum of its ledger quantities and upserts
it, in the same database transaction as the movement. Reports that need
stock at a past date (month-end) rebuild it from the ledger instead of
reading this table.

## Storage
Single relational database: PostgreSQL 16 accessed through Prisma 5 (see
`07-data/database-schema.md`). Relational fits well because the domain is
fundamentally about consistent sums and referential integrity — a balance
must always equal the sum of its transactions.

## System of record
This platform is intended to become the system of record for inventory.
The stock workbook stays authoritative until the opening balances are
imported and reconciled (`07-data/migration-strategy.md`). *Unverified:*
the cut-over date and whether the workbook will be frozen afterwards are
business decisions not recorded in the repository.

## Evidence
- `afrinov-platform/apps/backend/prisma/schema.prisma` — all models and enums
- `afrinov-platform/apps/backend/src/shared/inventory/balances.ts:6-21` — balance recompute
- `afrinov-platform/apps/backend/src/modules/reporting/month-end.service.ts:5-9,78-79` — month-end rebuilds stock from the ledger
- `afrinov-platform/apps/backend/src/modules/settings/settings.service.ts:161-193` — settings catalog
- `afrinov-platform/apps/backend/docker-compose.yml` — `postgres:16-alpine`
