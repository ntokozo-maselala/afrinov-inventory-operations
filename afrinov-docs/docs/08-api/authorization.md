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
| ADMIN | All 37 permission codes; signs purchase orders only by also holding a signing role (ADR-030) |
| STORE_CONTROLLER | create/edit material; create/edit/delete location, manage location status; receive, issue, transfer, adjust inventory; reverse inventory transaction; manage racks, projects, recipients; order Stores stock: see, raise, edit, submit, approve (within his approval limit), cancel, close and receive orders without a project (ADR-020, ADR-021), but not project orders or RFQs; receive project orders through a receiving view with no prices, into stock held for the project (ADR-027); view goods receipts; view reports; view users (lookup); check out/in tool; change a tool loan's due date |
| PROCUREMENT | create/edit supplier; view, create, submit, cancel, close project orders (those with a project, ADR-020), whose delivery the store receives (ADR-027), and requests for quotation, linking their lines to what Sales asked for without seeing Sales' prices or suppliers; no Stores orders; receive inventory; view goods receipts; manage projects; view reports |
| APPROVER | view project orders; view reports. Signs nothing since ADR-030 |
| PROCUREMENT_MANAGER | sign project and Stores orders (ADR-030), and see them; view Sales RFQs; view reports |
| DIRECTOR | sign project orders at or above the threshold (ADR-030), and see project orders; view Sales RFQs; view reports |
| CEO | stand in on project orders (ADR-030), and see them; view Sales RFQs; view reports |
| WORKSHOP_MANAGER | stand in on project and Stores orders (ADR-030), and see them; view reports |
| SALES | view and manage Sales RFQs, whose prices buyers and the store can't see (`view:sales_rfq`, `manage:sales_rfq`); manage projects; create/edit supplier; view reports. No purchase orders or Procurement RFQs |
| TECHNICIAN | issue inventory; view reports; view users (lookup); check out/in tool |
| VIEWER | view reports |

Notes on the table, against the original proposal:
- The proposal's "Technician: issue to self, view own history" is not
  implemented: a technician issues to any recipient and reads the whole
  ledger like every signed-in user.
- Only ADMIN holds `manage:users`, `manage:settings` and `view:audit_log`.
  Settings changes additionally check for the ADMIN role in the route.
- `edit:supplier` and `manage:roles` are granted but no endpoint checks them
  (TD-011, TD-013). `checkout:tool` and `checkin:tool` are checked by the
  Tools endpoints; `extend:tool_loan` by `POST /tools/loans/:id/due-date` (the code keeps its first name; it allows a later or earlier date).
- Marking an issue used up or broken is checked as `issue:inventory`;
  withdrawing that mark as `reverse:inventory_transaction` (ADR-026).
- A tool loan due date more than `inventory.toolMaxLoanDays` after check-out
  needs `manage:settings` (ADMIN), on check-out and on extension.
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
