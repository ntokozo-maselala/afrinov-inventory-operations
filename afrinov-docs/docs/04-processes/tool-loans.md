# Process: Tool Check-out and Check-in

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

A tool is lent, not used up. It is checked out to a person and checked back
in when it returns, so the store knows what is on the shelf, what is out and
with whom. Consumables are issued instead (`stock-issuing.md`).

## Inputs
A tool (an item in the `TOOLS` category) leaving the store with someone, or
coming back.

## Steps
1. **See what is out** on the Tools page (`/tools`, `GET /tools`): every
   active tool with how many are in store and how many are out, each loan
   with its recipient, project and date, and overdue loans flagged.
2. **Check out** (`POST /tools/check-out`, `checkout:tool`): who the tools go
   to (a recipient, required), an optional project and note, and one or more
   tools with the location they come from and the quantity. Several tools
   lent to one person at once share a slip, as an issue does. Each line is a
   `LOAN` movement that takes the tool off its location's balance.
3. **Check in** (`POST /tools/check-in`, `checkin:tool`): for each loan, how
   many came back and in what condition:
   - `GOOD` — back on the shelf at the location it came from (`LOAN_RETURN`).
   - `DAMAGED` — back on the shelf, recorded as damaged.
   - `LOST` — a note saying what happened is required. The tool comes back
     on paper (`LOAN_RETURN`) and is written off at once (`ADJUSTMENT`,
     reason `LOSS`), so it is neither out nor owned any more.

## Business rules
- Only items in the `TOOLS` category can be checked out; anything else is
  refused with "issue it on Issue stock instead".
- A check-out cannot take more than the location holds (no negative stock,
  ADR-013).
- A check-in cannot return more than is still out on that loan; part of a
  loan can come back at a time.
- Stock on hand is what is on the shelf; owned = on hand + out on loan.
- A loan older than `inventory.toolOverdueDays` (default 7) is overdue:
  flagged on the Tools page and counted on the Dashboard's "Tools checked
  out" card.
- Loans are corrected by checking the tool in or out again, not by reversing
  the movement.
- Tools come in through Receive stock and are counted on Count stock like any
  other item; they are not issued.
- Check-outs and check-ins are written to the audit log (`TOOL_CHECK_OUT`,
  `TOOL_CHECK_IN`).

## Roles
STORE_CONTROLLER, TECHNICIAN and ADMIN may check tools out and in.

## Outputs
`LOAN` and `LOAN_RETURN` movements in the ledger (and an `ADJUSTMENT` for a
lost tool), visible on Movements.

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/tool.routes.ts`
- `afrinov-platform/apps/backend/src/modules/inventory/tool-loan.service.ts`
- `afrinov-platform/apps/backend/src/shared/inventory/tool-loans.ts`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000011_tool_loans/migration.sql`, `20260101000012_tool_overdue_days/migration.sql`
- `afrinov-platform/apps/frontend/src/pages/Tools.tsx`, `components/ToolLoanForms.tsx`
- `afrinov-platform/apps/backend/integration/tool-loans.real-http.test.ts`
