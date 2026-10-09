# Audit Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Two records answer "who changed what, when":

1. **The stock ledger** (`inventory_transactions`). Every stock movement is
   a row with `actor_id` (the signed-in user), `posted_at`, type, signed
   quantity and a reference. Rows are never updated or deleted by any
   endpoint; mistakes are corrected by a reversal row pointing at the
   original through `reverses_id` (ADR-005). For stock, the ledger is the
   audit trail.
2. **The audit log** (`audit_log_entries`). A row per audited action:
   `actor_id`, `action`, `entity_type`, `entity_id`, optional `before` and
   `after` JSON, `created_at`.

## What writes an audit entry
| Area | Actions (`action` value) |
|---|---|
| Users | CREATE, UPDATE (name, active, roles; before and after) |
| Materials | CREATE (also via POST /stock-items), UPDATE |
| Locations | CREATE, UPDATE, ACTIVATE / DEACTIVATE, DELETE |
| Racks | CREATE, UPDATE, ARCHIVE |
| Projects | CREATE, UPDATE, ARCHIVE |
| Recipients | CREATE, UPDATE |
| Suppliers | CREATE |
| Purchase orders | UPDATE, PO_SUBMIT, PO_SUBMIT_AUTO_APPROVE, PO_APPROVE, PO_RECEIVE, PO_CANCEL, PO_CLOSE |
| Stock | RECEIVE_STOCK (counter receipt), STOCK_COUNT, RETURN, REVERSE |
| Import | IMPORT_OPENING_BALANCES |
| Settings | SETTING_UPDATE, SETTING_BULK_UPDATE, SETTING_RESET |

**Not written to the audit log** (the ledger row still records the actor
where stock moves): stock issues, transfers, adjustments, purchase-order
creation, goods-receipt creation and posting, and logins. Several services
(for example materials, users, suppliers, locations) write the audit entry
as a separate statement after the change, not inside the same database
transaction, so a failure between the two can leave a change unaudited
(TD-008).

## Reading the audit log
`GET /api/v1/audit` (permission `view:audit_log`, held only by ADMIN),
filterable by `entityType` and `entityId`, newest first, `limit` 1–500
(default 100). The Settings → History page reads the settings entries.
Purchase-order history is also served at
`GET /api/v1/purchase-orders/:id/history` (permission
`view:purchase_order`).

## Immutability
No endpoint updates or deletes audit entries or ledger rows. This is an
application convention: there are no database grants, triggers or row
rules preventing UPDATE/DELETE (TD-006). `audit_log_entries.actor_id` has
no foreign key to `users`.

## Evidence
- `afrinov-platform/apps/backend/prisma/schema.prisma:414-459,518-531`
- `afrinov-platform/apps/backend/src/modules/audit/audit.routes.ts:11-37`
- `afrinov-platform/apps/backend/src/shared/permissions.ts:30,42-45` — `view:audit_log` only via ADMIN's full list
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:268-276,415-423` — REVERSE, RETURN
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:289-364,434-536` — issue, transfer, adjust write no audit entry
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts:105-113`, `afrinov-platform/apps/backend/src/modules/inventory/stock-count.service.ts:101-109`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:138-167,186-195,220-248` — create (none), update, submit
- `afrinov-platform/apps/backend/src/modules/identity/identity.service.ts:87-95,115-149` — audit after the transaction
- `afrinov-platform/apps/frontend/src/pages/SettingsSections.tsx` — `GET /audit?entityType=Setting&limit=100`
- `afrinov-platform/apps/backend/prisma/migrations/` — no GRANT, REVOKE or TRIGGER statements
