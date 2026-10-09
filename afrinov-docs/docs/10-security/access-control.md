# Access Control

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

See `08-api/authorization.md` for the role table. Implementation notes:
- *Intended:* deny-by-default, so an endpoint with no explicit permission
  mapping is inaccessible. *As implemented:* every business route requires
  authentication (`preHandler: [app.authenticate]`), but a permission is
  required only where the route calls `requirePermission`. All mutating
  routes do; several read routes do not, so any signed-in user can read
  materials, locations, racks, projects, recipients, suppliers, settings
  and the full inventory ledger (TD-014).
- *Intended:* permission checks live in shared middleware so no route can
  forget one. *As implemented:* the check is a shared function
  (`shared/authorization.ts`) that each route handler calls itself; a new
  route without the call would be open to any signed-in user. Unit tests
  cover the check itself (`src/shared/authorization.test.ts`) and the
  role grants (`src/shared/permissions.test.ts`); no test asserts that
  every route calls it.
- Fine-grained permissions compose into roles. Codes have the form
  `action:resource`, e.g. `issue:inventory`, `approve:purchase_order`.
- The frontend hides actions by role, which is a convenience only.

## Evidence
- `afrinov-platform/apps/backend/src/shared/authorization.ts:52-82`
- `afrinov-platform/apps/backend/src/modules/inventory/material.routes.ts:28-40` — reads with authentication only
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:71-81`
- `afrinov-platform/apps/backend/src/shared/permissions.ts:3-36`
- `afrinov-platform/apps/backend/src/shared/authorization.test.ts:41-116`, `afrinov-platform/apps/backend/src/shared/permissions.test.ts:8-43`
