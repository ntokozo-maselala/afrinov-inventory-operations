# TO-BE: Target State

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
| AS-IS | TO-BE |
|---|---|
| Current Stock is a hand-edited cell | InventoryBalance is derived from summed InventoryTransactions |
| Location is free text (6+ spellings of "stores") | Location is a foreign key to a normalised Location master |
| Supplier is free text per transaction | Supplier is a foreign key to a Supplier master |
| No PO exists; receipt just happens | PO created, tracked, matched at receipt (or receipt recorded as ad hoc with a reason) |
| Required Stock is a silent threshold nobody actively watches | System actively surfaces below-threshold materials |
| Five parallel sheet families per category | One Material table with a `category` attribute, one transaction ledger |
| Anyone with the file can edit anything | Role-based access: who can issue, receive, adjust, approve POs |
| No traceability of who changed a balance and why | Every transaction has an actor, timestamp, and reference |
| Tools tracked via a Check In/Out column | Tools have an explicit state machine: `In Store` ↔ `Checked Out (to person)` |

## What stays conceptually the same
Category structure (fasteners, consumables, tooling/PPE, project material,
tools), the rack/location concept, the project-number reference on
transactions, issued-by/issued-to as people, delivery/invoice number as a
reference field — these are proven concepts from the current system and
carry forward, just formalised.
