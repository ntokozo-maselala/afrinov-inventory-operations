<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-10-001</b></td>
<td align="center"><b><i>Access Control</i></b><br><i>Security</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-10-001 updated=2026-11-26 by="Ntokozo Maselala" body=82bfc9180cd6 -->

# Access Control

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

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
- The frontend shows each role only what the server lets it do: menu
  entries carry the permissions they need, action buttons are hidden
  without the matching permission, and an action page reached by a typed or
  old link shows a "no access" message instead of a form the server would
  refuse. A user who signs only project orders lands on the orders waiting
  for them. This is a convenience only; the server's checks enforce access.
- Signing a purchase order also depends on the order: its value, the signatures
  it has, and whether this person has already signed (ADR-030,
  `04-processes/purchase-order-lifecycle.md`).

## Evidence
- `afrinov-platform/apps/backend/src/shared/authorization.ts`
- `afrinov-platform/apps/backend/src/modules/inventory/material.routes.ts` — reads with authentication only
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts`
- `afrinov-platform/apps/backend/src/shared/permissions.ts`
- `afrinov-platform/apps/backend/src/modules/procurement/po-approval.ts`
- `afrinov-platform/apps/frontend/src/hooks/usePermissions.ts`, `hooks/useNavGroups.tsx`, `components/NoAccess.tsx`, `api/landingPath.ts`
- `afrinov-platform/apps/backend/src/shared/authorization.test.ts:41-116`, `afrinov-platform/apps/backend/src/shared/permissions.test.ts:8-43`
