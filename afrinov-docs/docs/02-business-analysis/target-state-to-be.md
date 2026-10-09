# TO-BE: Target State

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Target process (Procure-to-Stock, simplified)
```
Reorder threshold breached (Required Stock)
        |
        v
Purchase Order created against a Supplier
        |
        v
Supplier delivers
        |
        v
Goods Receipt posted (matched to PO where one exists)
        |
        v
InventoryTransaction (Receipt) created  --->  InventoryBalance updated
        |
        v
Stock available for Issue / Transfer
        |
        v
Stock Issue to a person, optionally against a Project
        |
        v
InventoryTransaction (Issue) created  --->  InventoryBalance updated
```

## What changes from AS-IS
| AS-IS | TO-BE | Status in platform |
|---|---|---|
| Current Stock is a hand-edited cell | InventoryBalance is derived from summed InventoryTransactions | Implemented |
| Location is free text (6+ spellings of "stores") | Location is a foreign key to a normalised Location master | Implemented |
| Supplier is free text per transaction | Supplier is a foreign key to a Supplier master | Implemented for goods receipts and POs |
| No PO exists; receipt just happens | PO created, tracked, matched at receipt (or receipt recorded as ad hoc with a reason) | PO implemented behind `PROCUREMENT_ENABLED`; ad hoc (counter) receipts require a supplier and delivery/invoice number, not a reason |
| Required Stock is a silent threshold nobody actively watches | System actively surfaces below-threshold materials | Implemented (stock status, re-order list) |
| Five parallel sheet families per category | One Material table with a `category` attribute, one transaction ledger | Implemented |
| Anyone with the file can edit anything | Role-based access: who can issue, receive, adjust, approve POs | Implemented |
| No traceability of who changed a balance and why | Every transaction has an actor, timestamp, and reference | Implemented (reference optional on some types) |
| Tools tracked via a Check In/Out column | Tools have an explicit state machine: `In Store` ↔ `Checked Out (to person)` | **Planned** |

## What stays conceptually the same
Category structure (fasteners, consumables, tooling/PPE, project material,
tools), the rack/location concept, the project-number reference on
transactions, issued-by/issued-to (issued-to is now a recipient that may be
a worker, machine, site or contractor — ADR-008), delivery/invoice number as
a reference field — these are proven concepts from the current system and
carry forward, just formalised.

## Evidence
- `afrinov-platform/apps/backend/prisma/schema.prisma:102-475`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:35-44`
- `afrinov-platform/apps/backend/src/shared/config.ts:84-86`
