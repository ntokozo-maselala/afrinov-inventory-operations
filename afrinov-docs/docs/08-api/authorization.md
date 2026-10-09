# Authorization

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Role-based, checked server-side. Each mutating route (and some sensitive
reads) calls `requirePermission(req, <code>)`; the user's permissions are
loaded from the `role_permissions` table once per request. The seed writes
those rows from `RolePermissions` in `shared/permissions.ts`, replacing a
role's grants each time it runs.

## Roles as implemented
| Role | Permissions |
|---|---|
| ADMIN | All 32 permission codes |
| STORE_CONTROLLER | create/edit material; create/edit/delete location, manage location status; receive, issue, transfer, adjust inventory; reverse inventory transaction; manage racks, projects, recipients; view and receive purchase orders; view goods receipts; view reports; view users (lookup); check out/in tool |
| PROCUREMENT | create/edit supplier; view, create, submit, cancel, close purchase orders; receive inventory; view goods receipts; manage projects; view reports |
| APPROVER | approve purchase orders; view reports |
| TECHNICIAN | issue inventory; view reports; view users (lookup); check out/in tool |
| VIEWER | view reports |

Notes on the table, against the original proposal:
- The proposal's "Technician: issue to self, view own history" is not
  implemented: a technician issues to any recipient and reads the whole
  ledger like every signed-in user.
- Only ADMIN holds `manage:users`, `manage:settings` and `view:audit_log`.
  Settings changes additionally check for the ADMIN role in the route.
- `checkout:tool`, `checkin:tool`, `edit:supplier` and `manage:roles` are
  granted but no endpoint checks them (TD-011, TD-013).
- Reads of materials, locations, racks, projects, recipients, suppliers,
  settings and the inventory ledger need authentication only, not a
  permission (TD-014). Reports need `view:reports`, which every role has.
- `POST /stock-items` needs both `create:material` and `receive:inventory`.
- Approvers cannot reject an order (no reject transition; they lack
  `cancel:purchase_order`) — see ADR-007.

A single person may hold several roles; permissions are the union of the
roles' grants. *Unverified:* whether these role assignments match how
Afrinov staff should work (confirm with the business owner).

The frontend separately hides actions by role (`usePermissions.ts`); that
is a convenience only, not enforcement.

## Evidence
- `afrinov-platform/apps/backend/src/shared/permissions.ts:3-91`
- `afrinov-platform/apps/backend/src/shared/authorization.ts:32-71`
- `afrinov-platform/apps/backend/src/db/seed.ts:120-145`
- `afrinov-platform/apps/backend/src/modules/settings/settings.routes.ts:49-74`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-item.routes.ts:42-43`
- `afrinov-platform/apps/frontend/src/hooks/usePermissions.ts`
