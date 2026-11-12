# Process: Tool Check-out and Check-in

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** feat/loan-events-on-movements, 2026-11-02

A tool is lent, not used up. It is checked out to a person until a due date
and checked back in when it returns, so the store knows what is on the shelf,
what is out, with whom, and what should already be back. Consumables are
issued instead (`stock-issuing.md`); they are used up, so they have no due date.

## Inputs
A tool (an item in the `TOOLS` category) leaving the store with someone, or
coming back, or needed for longer.

## Steps
1. **See what is out** on the Tools page (`/tools`, `GET /tools`): every
   active tool with how many are in store and how many are out, and each loan
   with its recipient, project, check-out date, due date and state. The views
   Due soon, Overdue and Needs a decision list the most overdue first.
2. **Check out** (`POST /tools/check-out`, `checkout:tool`): who the tools go
   to (a recipient, required), an optional project and note, the due date, and
   one or more tools with the location they come from and the quantity.
   Several tools lent to one person at once share a slip, as an issue does, and
   one due date. Each line is a `LOAN` movement that takes the tool off its
   location's balance and keeps the due date (`dueOn`).
3. **Change due date** (`POST /tools/loans/:id/due-date`, `extend:tool_loan`):
   a later or earlier due date for one loan, with a reason. It is recorded as
   a change (`tool_loan_extensions`); the loan keeps the date agreed at
   check-out, and every change stays in its history. A wrong date is put right
   by changing it again, not by deleting anything.
4. **Check in** (`POST /tools/check-in`, `checkin:tool`): for each loan, how
   many came back and in what condition:
   - `GOOD` — back on the shelf at the location it came from (`LOAN_RETURN`).
   - `DAMAGED` — back on the shelf, recorded as damaged, and **held for
     repair**: it isn't lent until the store marks it repaired
     (`POST /tools/repairs/:id/repaired`) or writes it off as damaged
     (`POST /tools/repairs/:id/write-off`, which waits for approval over the
     write-off limit). Moving it to another location moves the hold too (ADR-040).
   - `LOST` — a note saying what happened is required. The tool comes back
     on paper (`LOAN_RETURN`) and is written off at once (`ADJUSTMENT`,
     reason `LOSS`), so it is neither out nor owned any more.

## Due dates
- **The due date is agreed at check-out.** The form suggests the default loan
  period (`inventory.toolOverdueDays`, default 7) from today, but never after
  the project's end date when the loan is for a project with one. The person
  checking out can choose another date.
- **A due date is refused** (400) when it is before today, after the
  project's end date, or more than `inventory.toolMaxLoanDays` (default 30)
  after check-out. That last limit counts changed dates too; an administrator
  (`manage:settings`) may go past it. The project's end date holds for
  everyone; to lend for longer, move the project's end date.
- **A due date change** may move the date later or earlier, but must differ
  from the current date and not be before today, within the same limits. The
  most recent change wins, even when an earlier one gave a later date. It is
  retry-safe with an `Idempotency-Key`.
- **The loan's state is worked out, never stored**, from its due date (the
  most recent change's, else the one agreed at check-out) and today, in
  calendar days as purchase order due dates are:

  | State | When |
  |---|---|
  | `ON_LOAN` | Due in two days or more |
  | `DUE_SOON` | Due tomorrow or today |
  | `OVERDUE` | Past its due date |
  | `NEEDS_DECISION` | `inventory.toolEscalateDays` (default 14) or more past due |

  A loan that needs a decision stays so until it is checked in, given a new
  due date or written off as lost. Nothing is ever written off automatically.
- **Loans from before due dates** have none recorded (`dueOn` null) and fall
  due the default loan period after they went out, as the overdue flag
  worked before.
- **Lending to someone with an overdue tool.** The form names their overdue
  tools. What happens next is `inventory.toolOverdueCheckout`:
  - `warn` (default): the tools can be lent with a reason, which is kept on
    the check-out (`overdueOverrideReason`) and in the audit log. Without one the server refuses with
    400 and lists the overdue loans (`details.overdueLoans`).
  - `block-contractors`: contractors are refused (409) until their overdue
    tools are checked in or given a new due date; everyone else as `warn`.
  - `block`: everyone is refused (409) until then.
- **Closing a project does not bring its tools back.** The project form lists
  the tools still out on a project when it is set to Completed or Cancelled,
  and the Projects page lists closed projects with tools still out. Closing is
  still allowed.
- A late tool is always accepted back. Check-in never refuses a late return.

## Business rules
- Only items in the `TOOLS` category can be checked out; anything else is
  refused with "issue it on Issue stock instead".
- A check-out cannot take more than the location holds (no negative stock,
  ADR-013).
- A check-in cannot return more than is still out on that loan; part of a
  loan can come back at a time. A partial return does not change the due date
  of what is still out.
- Stock on hand is what is on the shelf; owned = on hand + out on loan.
- Loans are corrected by checking the tool in or out again, not by reversing
  the movement. The `LOAN` row, due date included, is never changed.
- Tools come in through Receive stock and are counted on Count stock like any
  other item; they are not issued.
- Check-outs, check-ins and due date changes are written to the audit log
  (`TOOL_CHECK_OUT` with the due date and any overdue override,
  `TOOL_CHECK_IN`, `TOOL_LOAN_EXTEND` with the old and new date and the
  reason; the action keeps its first name for changes that move a date earlier).

## Where it shows
- **Movements** (the store's record of what happened, ADR-025): the Tools
  check in/out report and All movements list each due date change among the
  check-outs and check-ins, by when it was made, as "Due date moved" with the
  old and new date, the reason and who made it. It has no quantity ("No stock
  moved"), so it never changes a stock total. The Tools check in/out report
  has a Due back column: the agreed date on a check-out (and the date now, if
  it changed), and on a check-in the date as it stood then and whether it came
  back on time or how many days late. A check-out lent to someone with an
  overdue tool shows the reason. The downloads (Excel and PDF) carry the same.
  Opening any row of a loan shows the whole loan in order
  (`GET /tools/loans/:id/history`), with the day it went overdue worked out
  from the dates; nothing is recorded for going overdue.
- **Tools page:** each loan's state and due date, the Due soon, Overdue and
  Needs a decision views, and Change due date for those who may change it.
- **Dashboard:** the Tools checked out card counts overdue tools and those
  that need a decision, and links to them.
- **Recipients:** tools each recipient has out, and how many are overdue.
- **Projects:** closed projects with tools still out, and the project form's
  list when closing one.

## Roles
STORE_CONTROLLER, TECHNICIAN and ADMIN may check tools out and in.
STORE_CONTROLLER and ADMIN may change a loan's due date. Only ADMIN may set a due date
past `inventory.toolMaxLoanDays`. Only ADMIN changes the loan settings.

## Settings (Settings › Inventory)
| Key | Default | Meaning |
|---|---|---|
| `inventory.toolOverdueDays` | 7 | Default loan period, in days. The key predates due dates. |
| `inventory.toolMaxLoanDays` | 30 | Longest loan from check-out, changed dates included, short of an administrator. |
| `inventory.toolEscalateDays` | 14 | Days past due before a loan needs a decision. |
| `inventory.toolOverdueCheckout` | `warn` | `warn`, `block-contractors` or `block`. |

## Outputs
`LOAN` and `LOAN_RETURN` movements in the ledger (and an `ADJUSTMENT` for a
lost tool); `tool_loan_extensions` rows for due date changes, which are not
movements. All of them are listed on Movements.

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/tool.routes.ts`
- `afrinov-platform/apps/backend/src/modules/inventory/tool-loan.service.ts`
- `afrinov-platform/apps/backend/src/modules/inventory/tool-loan-terms.ts` (the due date and state rules), `tool-loan-dates.ts`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts` (`queryHistory`: due date changes among the movements)
- `afrinov-platform/apps/backend/src/shared/inventory/tool-loans.ts`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000011_tool_loans/migration.sql`, `20260101000012_tool_overdue_days/migration.sql`, `20260101000033_tool_loan_due_dates/migration.sql`, `20260101000034_loan_events_on_movements/migration.sql`
- `afrinov-platform/apps/frontend/src/pages/Tools.tsx`, `components/ToolLoanForms.tsx`, `components/ProjectToolsNotice.tsx`, `lib/toolLoans.ts`
- `afrinov-platform/apps/frontend/src/components/reports/LedgerReport.tsx`, `components/TransactionDrawer.tsx`, `components/LoanHistory.tsx`
- `afrinov-platform/apps/backend/integration/tool-loans.real-http.test.ts`
