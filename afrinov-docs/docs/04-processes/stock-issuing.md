# Process: Stock Issuing (and Tool Check-Out)

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Inputs
A request for material or a tool by a worker (or for a machine, site or
contractor), optionally for a specific project.

## Actors
The storeman issuing (`issue:inventory`: STORE_CONTROLLER, TECHNICIAN,
ADMIN), recorded as the transaction's actor ("Issued By"), and the
recipient ("Issued To"), chosen from the Recipients list (ADR-008).
Recipients are not user accounts.

## Steps — material issue
1. Issue stock page (`/stock/issue`): choose the recipient (required) and
   optionally an active project.
2. Add one to 50 lines; find each item by name, code or location; enter
   location and quantity.
3. `POST /api/v1/inventory-issues` → `InventoryService.issue`, all or
   nothing: recipient, project, items and locations must exist and be
   active; lines for the same item and location are added together and
   checked against the current balance.
4. One ISSUE row (negative quantity) per line, carrying recipient and
   project; balances recomputed. If stock alerts are on and an item is now
   URGENT or WARNING, a `StockThresholdReached` event is dispatched (no
   handler, TD-007). No audit-log entry is written.

A single-item issue is also available from the Stock page.

## Steps — return of unused stock (implemented)
1. Movements page → open the issue → Return: quantity, optional location
   (defaults to where it was issued from), optional reason.
2. `POST /api/v1/inventory-transactions/:id/returns` (`issue:inventory`):
   only against an ISSUE that is not reversed; at most the issued quantity
   less what has already come back.
3. One RETURN row (positive) referencing the issue, keeping its recipient
   and project, so consumption reports net it out; balance recomputed;
   `RETURN` audit entry.

## Tools
Tools are not issued: they are checked out and back in on the Tools page
(`tool-loans.md`). Issuing a tool is refused.

## Business rules
- Stock can never go below zero. This is a fixed rule with **no override**
  (the earlier proposal of an authorised override with a reason was not
  adopted).
- Every issue names an active recipient (ADR-008).
- An issue with returns against it cannot be reversed until the returns are
  reversed.
- A tool cannot be checked out beyond what is on the shelf (`tool-loans.md`).

## Exceptions
- Urgent need exceeding available stock → refused with
  `422 INSUFFICIENT_BALANCE`. Logging these refusals as stock-out events is
  **Planned**.

## Outputs
InventoryTransaction(s), updated InventoryBalance.

## Evidence
- `afrinov-platform/apps/frontend/src/pages/IssueStock.tsx`, `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx:254`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:10-18,56-60,83-93,145-157`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:204-206,289-432`
- `afrinov-platform/apps/backend/src/shared/permissions.ts:46-90`
