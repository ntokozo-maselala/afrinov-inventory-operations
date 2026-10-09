# Bounded Contexts

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

```
+----------------------------+
| Procurement Context        |   backend module: procurement/
|                            |   (purchase orders and goods receipts are off
| Supplier                   |    unless PROCUREMENT_ENABLED=true)
| PurchaseOrder (+lines)     |
| GoodsReceipt (+lines)      |
+--------------+-------------+
               |
               | goods receipt posting (direct call, same transaction)
               v
+----------------------------+
| Inventory Context          |   backend module: inventory/
|                            |
| Material, Location, Rack   |
| InventoryTransaction       |
| InventoryBalance           |
| Stock count (no own table) |
+--------------+-------------+
               |
               | issue / return carry projectNumber and recipientId
               v
+----------------------------+
| Operations Context         |   backend module: operations/
|                            |
| Project (master record)    |
| Recipient ("Issued To")    |
+----------------------------+

+----------------------------+      +----------------------------+
| Identity & Access Context  |      | Reporting Context          |
| User, Role, Permission     |      | Read-only; reports and     |
| (module identity/)         |      | Excel/PDF exports          |
| AuditLogEntry (module      |      | (module reporting/)        |
|  audit/, read endpoint)    |      +----------------------------+
+----------------------------+
```

Supporting modules outside these contexts: `settings/` (typed
configuration), `migration/` (one-off workbook import), `health/`.

## Integration rules
- *Intended:* contexts communicate through events or public interfaces, not
  by reaching into each other's tables. *As implemented:* they call each
  other's services and read each other's tables directly (see
  `06-system-architecture/module-architecture.md`, TD-004).
- `Project` in the Operations context was planned as a **reference value**
  only. *As implemented:* it is a master record with its own CRUD API and
  page: name, code, status, manager, client, dates, notes, active flag.
  Issues and returns reference it by `projectNumber`, and an issue is
  refused for an unknown or inactive project.
- `Recipient` (ADR-008) belongs to Operations: the people and places stock
  is issued to. Recipients are not users.
- Reporting is a read-only consumer of the other contexts; it owns no write
  operations and no source-of-truth data (verified).

## Deployment note
These are logical boundaries within a single modular-monolith deployment
(ADR-001), held only by module folders and code review — see
`06-system-architecture/module-architecture.md`.

## Evidence
- `afrinov-platform/apps/backend/src/server.ts:246-278`
- `afrinov-platform/apps/backend/src/modules/operations/project.routes.ts:40-85`, `afrinov-platform/apps/backend/src/modules/operations/project.service.ts:1-20`
- `afrinov-platform/apps/backend/src/modules/operations/recipient.service.ts:1-3`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:72-76,306` — project must exist and be active
- `afrinov-platform/apps/backend/src/modules/reporting/` — no create/update/delete calls
