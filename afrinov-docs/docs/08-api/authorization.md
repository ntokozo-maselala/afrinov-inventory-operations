<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-08-006</b></td>
<td align="center"><b><i>Authorization</i></b><br><i>API Reference</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-08-006 updated=2026-11-26 by="Ntokozo Maselala" body=3cfb19a49e03 -->

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
| ADMIN | All 42 permission codes; signs purchase orders, and approves project issues, only by also holding the role that does (ADR-030, ADR-043) |
| STORE_CONTROLLER | create/edit material; create/edit/delete location, manage location status; receive, issue, transfer, adjust inventory; reverse inventory transaction; manage racks, projects, recipients; order Stores stock: see, raise, edit, submit, approve (within his approval limit), cancel, close and receive orders without a project (ADR-020, ADR-021), but not project orders or RFQs; receive project orders through a receiving view with no prices, into stock held for the project (ADR-027); view goods receipts; view reports; view users (lookup); check out/in tool; change a tool loan's due date |
| PROCUREMENT | create/edit supplier; view, create, submit, cancel, close project orders (those with a project, ADR-020), whose delivery the store receives (ADR-027), and requests for quotation, recommending one supplier's quote on each for Sales to cost from (not an award); no Stores orders; receive inventory; view goods receipts; manage projects; view reports |
| APPROVER | view project orders; view reports. Signs nothing since ADR-030 |
| PROCUREMENT_MANAGER | sign project and Stores orders (ADR-030), and see them; view Sales RFQs and labour rates; view reports |
| DIRECTOR | sign project orders at or above the threshold (ADR-030), and see project orders; stand in for the Workshop Manager approving project issues (`approve:project_issue`, ADR-043); view Sales RFQs and approve their price or send them back (`approve:sales_rfq`), never one they raised or submitted; view labour rates; view reports |
| CEO | stand in on project orders (ADR-030), and see them; view Sales RFQs and labour rates; view reports |
| WORKSHOP_MANAGER | stand in on project and Stores orders (ADR-030), and see them; approve or reject the storeman's issues of project material, possibly for less (`approve:project_issue`, ADR-043); keep the labour rates Sales prices labour at (`manage:labour_rates`); view reports |
| SALES | view and manage Sales RFQs, whose price and margin buyers and the store can't see (`view:sales_rfq`, `manage:sales_rfq`): raise, edit, submit to the Director and cancel, choosing one supplier's quote on each of the project's sent Procurement RFQs (supplier names and quote totals only, with Procurement's recommendation; no line prices, and no Procurement RFQ to open or change) and reading the labour rates; the Procurement savings report, which needs `view:sales_rfq`; manage projects; view reports. No suppliers, purchase orders or Procurement RFQs |
| TECHNICIAN | issue inventory; view reports; view users (lookup); check out/in tool |
| VIEWER | view reports |

Notes on the table, against the original proposal:
- The proposal's "Technician: issue to self, view own history" is not
  implemented: a technician issues to any recipient and reads the whole
  ledger like every signed-in user.
- Only ADMIN holds `manage:users`, `manage:settings` and `view:audit_log`.
  Settings changes additionally check for the ADMIN role in the route.
- `edit:supplier` is granted but no endpoint checks it (TD-013).
  `manage:roles` is retired (ADR-042): roles are fixed in code. `checkout:tool` and `checkin:tool` are checked by the
  Tools endpoints; `extend:tool_loan` by `POST /tools/loans/:id/due-date` (the code keeps its first name; it allows a later or earlier date).
- Marking an issue used up or broken is checked as `issue:inventory`;
  withdrawing that mark as `reverse:inventory_transaction` (ADR-026).
- A tool loan due date more than `inventory.toolMaxLoanDays` after check-out
  needs `manage:settings` (ADMIN), on check-out and on extension.
- Reads of materials, locations, racks, projects, recipients, suppliers and
  settings need authentication only, not a permission (TD-014). Reports need
  `view:reports`, which every role has; so do the ledger (Movements, its
  summary and export), the tool list and a loan's history (system audit F6).
  Write-offs by the person responsible also need `adjust:inventory` or
  `approve:write_off`.
- Setting an item's unit cost needs `edit:unit_cost` (Admin, Procurement), and
  a change needs a reason (system audit C1, C3).
- Completing, cancelling or archiving a project, or changing its manager,
  needs `close:project` (Admin) or being its manager (system audit E3).
- `POST /stock-items` and `POST /purchase-orders/:id/receive` are retired and
  refuse every request (system audit D3).
- A tool held for repair is marked repaired or written off with
  `adjust:inventory`; goods go back to the supplier with `receive:inventory`
  and the right to receive that order's kind; a count sheet needs
  `adjust:inventory` (ADR-040).
- Closing a month, and opening one again, needs `manage:settings` (Admin);
  the list of closed months, `view:reports`. The waiting write-offs summary
  needs what the list does: `approve:write_off` or `adjust:inventory`
  (ADR-041).
- Asking to issue project material needs `issue:inventory`, as does
  cancelling one's own request; approving or rejecting one needs
  `approve:project_issue` and the Workshop Manager or Director role, and never
  one's own. The list and its summary need either permission (ADR-043).
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
