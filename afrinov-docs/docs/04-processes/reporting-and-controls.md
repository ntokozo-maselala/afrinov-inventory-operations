<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-04-004</b></td>
<td align="center"><b><i>Process: Reporting &amp; Controls</i></b><br><i>Business Process</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-04-004 updated=2026-11-26 by="Ntokozo Maselala" body=2d0c56a91066 -->

# Process: Reporting & Controls

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Reports replacing the AS-IS Dashboard / *Stock Summary / *Stock Report sheets
All need `view:reports` (every role has it) and are computed on request from
the ledger, balances and material master — except a closed month, whose
report is kept (ADR-041). Days and months are South African (UTC+2, no
daylight saving): a movement at 00:30 on the 1st belongs to the new month.

- **Current stock** — by category, location or material
  (`GET /reports/current-stock`; Stock page). Replaces `*Stock Report`
  sheets and the Dashboard's rack/product selectors.
- **Movement history** — by material, date range, type, project
  (`GET /reports/movement-history`; Movements page).
- **Stock value** — by category and overall, on-hand × unit price
  (`GET /reports/stock-value`; Dashboard). Replaces `*Stock Summary`
  totals. *Unverified:* the specific totals quoted in earlier drafts from
  the July workbook.
- **Stock status / re-order** — each item URGENT, WARNING, OK or NOT_SET by
  on hand (all locations) as a share of Required Stock, with bands from
  settings (default below 20% and below 40%); on order = still to come on
  approved or partly received Stores orders, each with its due date (the
  line's, or the order's expected delivery); re-order quantity = Required
  Stock − on hand − on order, so what is already coming isn't ordered twice.
  The status itself is what is owned now. The Stock status page lists what
  still needs re-ordering after what is on order, what is short but on order,
  everything with an order still to come (pending orders, in transit), and
  what is on an overdue order. The re-order list download holds only what is
  still to order. Orders are counted only with procurement on, and the order
  numbers are shown only to those who can open Stores orders (`GET /reports/stock-status`, `GET /reports/low-stock`;
  Excel re-order list `GET /reports/reorder-list/export`). Replaces the
  workbook's URGENCY column; an item without Required Stock is NOT_SET,
  not URGENT. Off when `inventory.enableStockAlerts` is false.
- **Stock used (consumption)** — issued minus returned over a date range,
  by item, project, recipient and category, at current unit price; one
  recipient's issues line by line (`GET /reports/consumption` and
  `/export`; Stock used page). Replaces the Stock Report sheets and the
  Consumable Box. Reversed issues and returns are left out with their
  reversals. For items that track use, also used up, broken and still out
  (as of now) per recipient and per issue (ADR-026).
- **Project consumption** — net issued per item for one project
  (`GET /reports/project-consumption/:projectNumber`).
- **Month-end report** — per category, the workbook's Summary layout (stock
  on hand, value, % of Required Stock, re-order quantity, status) and Stock
  Report (stock used), as at the end of a chosen month
  (`GET /reports/month-end?month=YYYY-MM` and `/export`; Month-end report
  page). Stock is rebuilt from ledger rows posted before the first day of
  the next month (South African time), so a past month's quantities do not
  change later. Until the month is closed it is valued at current unit
  prices and says so (`valuedAt: TODAY`). Future months are refused.
- **Closing a month** (ADR-041) — an Admin (`manage:settings`) closes a month
  that is over (`POST /month-closes`; the Close button on the stock report).
  Its report is kept as it stands with every item's unit cost then; the
  month's report then returns what was kept (`valuedAt: CLOSED`) and stock
  used in it is valued at those prices. Opening it again needs a reason
  (`POST /month-closes/:month/reopen`); both are in Activity. `GET
  /month-closes` lists closed months.
- **Inventory report** — filterable line-per-location report with KPIs,
  paging, and Excel/PDF export (`GET /reports/inventory`, `/export`).
- **Bottom-N stock quantity** (the Dashboard's "Bottom 10 Stock
  Quantity") — **Planned**; no such view exists.

## Controls
- Reports are read-only; the reporting module writes only a month's close
  and its reopening (ADR-041).
- Waiting write-offs show on the Dashboard with the oldest's days waited
  (`GET /adjustment-requests/summary`), and each says how long it has waited
  (ADR-041).
- An approver may send a waiting write-off back for changes; whoever asked
  sees it on the Dashboard, amends it and sends it again, and each request
  keeps its history of submissions, changes and decisions (ADR-044).
- A tool written off (lost on loan, or held for repair) goes through the same
  workflow; the Tools page shows whether its write-off waits or was sent
  back, and an approved request's history shows its posting as a step of its
  own (ADR-045).
- Figures are derived from the ledger or the balance table recomputed from
  it — no parallel summary numbers are stored.
- Known inconsistency: the inventory report's currency comes from the
  `REPORT_CURRENCY` environment variable, the other reports' from the
  `general.defaultCurrency` setting (TD-012). (The dashboard's tile notes
  now show the stock status bands as set; TD-025 is resolved, checked against the code at `f659e5d`, 2026-11-26.)

## Evidence
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts:26-198`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.service.ts:76-293`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.ts:1-54`
- `afrinov-platform/apps/backend/src/modules/reporting/consumption.service.ts:1-9`
- `afrinov-platform/apps/backend/src/modules/reporting/month-end.service.ts:1-84`
- `afrinov-platform/apps/backend/src/modules/reporting/report.service.ts:168` (checked against the code at `f659e5d`, 2026-11-26)
- `afrinov-platform/apps/frontend/src/pages/Dashboard.tsx:295-296` (checked against the code at `f659e5d`, 2026-11-26)
