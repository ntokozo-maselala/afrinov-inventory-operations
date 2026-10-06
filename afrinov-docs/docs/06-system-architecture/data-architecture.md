# Data Architecture

## Data classes
| Class | Examples | Characteristics |
|---|---|---|
| Master data | Material, Location, Supplier, User | Changes rarely, referenced everywhere |
| Transactional data | InventoryTransaction, PurchaseOrder, GoodsReceipt | Created continuously, immutable once posted |
| Reference data | MaterialCategory, TransactionType, Role, AdjustmentReasonCode | Small, mostly static enumerations |
| Derived data | InventoryBalance, stock-value figures | Computed from transactional data, never a separate source of truth |
| Audit data | AuditLogEntry | Append-only, system-generated |

## Storage
Single relational database (PostgreSQL — see `07-data/database-schema.md`).
Relational fits well because the domain is fundamentally about consistent
sums and referential integrity (a balance must always equal the sum of its
transactions) — the exact guarantee a relational database with proper
constraints and transactions gives for free, which the current spreadsheet
gives nowhere.

## System of record
This platform becomes the system of record for inventory going forward. The
existing `.xlsm` workbooks remain the historical record for anything pre-
migration (see `07-data/migration-strategy.md`) and should not be edited
after cutover.
