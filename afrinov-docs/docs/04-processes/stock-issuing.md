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
   only against an ISSUE that is not reversed; at most what is still out:
   the issued quantity less what has already come back and, for an item that
   tracks use, what was marked used up or broken.
3. One RETURN row (positive) referencing the issue, keeping its recipient
   and project, so consumption reports net it out; balance recomputed;
   `RETURN` audit entry.

## Steps — used up or broken (items that track use, ADR-026)
An item can be set to **track use after issue** (Materials → the item →
Edit, "Track use after issue"; off by default; never on a tool). It suits
costly consumables such as grinding and cutting discs, where the store wants
to know what was worn out, what broke early and what is still with the
person. Stock is still counted as used at the issue; nothing here moves stock.

1. When the person comes back to the counter: **Return stock**
   (`/stock/return`) → Returned by → their issues still out. On each line:
   **Back on the shelf**, and for an item that tracks use, **Used up** and
   **Broken**. Still out after is shown as it is typed. One optional note is
   kept with every line. **Book** books the whole visit.
2. `POST /api/v1/inventory-returns` (`issue:inventory`), all lines or
   none: each line takes `quantity`, `usedUp` and `broken`, at least one.
   Used up and broken only against an unreversed ISSUE of an item that tracks
   use; the three together at most what is still out (issued − returned −
   used up − broken). Returns and outcomes take the same balance lock, so
   they cannot both spend it.
3. What goes back on the shelf is a RETURN, as below. Each used up or broken
   is one `consumable_outcomes` row against the issue with a
   `CONSUMABLE_OUTCOME` audit entry: no ledger row, no balance change.

Movements shows the result on the issue (used up, broken, still out and each
mark) and books nothing new there. Every visit is in its history at the time
it was booked: the return's row lists what came back in that visit, back on
the shelf, used up and broken; a visit with nothing back on the shelf lists
each mark as a row of its own (Used up, Broken; no stock moved); a withdrawal
is a row too, with its reason. The issue's row says who it went to and how
much is still out. `POST
/api/v1/inventory-transactions/:id/outcomes` records one outcome against one
issue, for API clients; the app does not use it.
4. A mistake is **withdrawn** from the issue on Movements, under Correct a
   mistake, with a reason (`POST
   /api/v1/consumable-outcomes/:id/withdrawal`,
   `reverse:inventory_transaction`): a second row naming the first. Both are
   kept, both count for nothing; `CONSUMABLE_OUTCOME_WITHDRAW` audit entry.
   A withdrawal cannot itself be withdrawn.

The issue's row on Movements, the Stock used report (by recipient and line by
line) and their Excel and PDF downloads show Used up, Broken and Still out for
these items. Still out is as of now, for what was issued in the period.

## Tools
Tools are not issued: they are checked out and back in on the Tools page
(`tool-loans.md`). Issuing a tool is refused.

## Business rules
- Stock can never go below zero. This is a fixed rule with **no override**
  (the earlier proposal of an authorised override with a reason was not
  adopted).
- Every issue names an active recipient (ADR-008).
- An issue with returns against it cannot be reversed until the returns are
  reversed; one marked used up or broken, until those are withdrawn.
- A return booked together with used up or broken cannot be reversed until
  those marks are withdrawn, so they never keep counting against an undone
  return.
- Returns, used up and broken together never exceed what was issued.
- Quantities are kept to four decimal places; a finer one (0.00001) is refused
  rather than stored rounded, possibly as zero.
- A reversal of an issue, and a return or a used up or broken mark against it,
  check each other under the same lock, so two booked at the same moment
  cannot both go through.
- A tool cannot be checked out beyond what is on the shelf (`tool-loans.md`).

## Exceptions
- Urgent need exceeding available stock → refused with
  `422 INSUFFICIENT_BALANCE`. Logging these refusals as stock-out events is
  **Planned**.

## Outputs
InventoryTransaction(s), updated InventoryBalance; for tracked items,
ConsumableOutcome rows (no balance change).

## Evidence
- `afrinov-platform/apps/frontend/src/pages/IssueStock.tsx`, `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx:254`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:10-18,56-60,83-93,145-157`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:204-206,289-432`
- `afrinov-platform/apps/backend/src/shared/permissions.ts:46-90`
- `afrinov-platform/apps/backend/src/modules/inventory/consumable-outcome.service.ts`, `consumable-outcomes.ts`
- `afrinov-platform/apps/frontend/src/components/ConsumableOutcomes.tsx`
