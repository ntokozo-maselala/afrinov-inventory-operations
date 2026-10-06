# Bounded Contexts

```
+----------------------------+
| Procurement Context        |
|                            |
| Supplier                   |
| PurchaseOrder              |
| PurchaseOrderLine          |
+--------------+-------------+
               |
               | Goods Receipt (event)
               v
+----------------------------+
| Inventory Context          |
|                            |
| Material                  |
| Location                  |
| InventoryBalance           |
| InventoryTransaction       |
+--------------+-------------+
               |
               | Material Issue (event)
               v
+----------------------------+
| Operations Context         |
|                            |
| Project (reference only)   |
+----------------------------+

+----------------------------+      +----------------------------+
| Identity & Access Context  |      | Reporting Context          |
| User, Role, Permission,    |      | Read models composed from  |
| AuditLogEntry               |      | Inventory + Procurement    |
+----------------------------+      +----------------------------+
```

## Integration rules
- Contexts communicate through well-defined events/interfaces (e.g.
  "GoodsReceived" triggers an Inventory transaction), not by reaching into
  each other's tables directly.
- `Project` in the Operations context is a **reference value** (a project
  number, validated against `Project No.`) in v1, not a full aggregate —
  Afrinov's project management stays outside this system for now.
- Reporting is explicitly a read-only consumer of the other contexts; it
  owns no write operations and no source-of-truth data.

## Deployment note
These are logical boundaries within a single modular-monolith deployment
(ADR-001), enforced by module structure and code review, not by separate
services — see `06-system-architecture/module-architecture.md`.
