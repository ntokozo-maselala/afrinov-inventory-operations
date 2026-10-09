# Process: Reporting & Controls

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Reports replacing the AS-IS Dashboard / *Stock Summary / *Stock Report sheets
All need `view:reports` (every role has it) and are computed on request from
the ledger, balances and material master — nothing is stored.

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
  settings (default below 20% and below 40%); re-order quantity = Required
  Stock − on hand (`GET /reports/stock-status`, `GET /reports/low-stock`;
  Excel re-order list `GET /reports/reorder-list/export`). Replaces the
  workbook's URGENCY column; an item without Required Stock is NOT_SET,
  not URGENT. Off when `inventory.enableStockAlerts` is false.
- **Stock used (consumption)** — issued minus returned over a date range,
  by item, project, recipient and category, at current unit price; one
  recipient's issues line by line (`GET /reports/consumption` and
  `/export`; Stock used page). Replaces the Stock Report sheets and the
  Consumable Box. Reversed issues and returns are left out with their
  reversals.
- **Project consumption** — net issued per item for one project
  (`GET /reports/project-consumption/:projectNumber`).
- **Month-end report** — per category, the workbook's Summary layout (stock
  on hand, value, % of Required Stock, re-order quantity, status) and Stock
  Report (stock used), as at the end of a chosen month
  (`GET /reports/month-end?month=YYYY-MM` and `/export`; Month-end report
  page). Stock is rebuilt from ledger rows posted before the first day of
  the next month (UTC), so a past month does not change later; prices are
  current unit prices. Future months are refused.
- **Inventory report** — filterable line-per-location report with KPIs,
  paging, and Excel/PDF export (`GET /reports/inventory`, `/export`).
- **Bottom-N stock quantity** (the Dashboard's "Bottom 10 Stock
  Quantity") — **Planned**; no such view exists.

## Controls
- Reports are read-only; the reporting module writes nothing (verified).
- Figures are derived from the ledger or the balance table recomputed from
  it — no parallel summary numbers are stored.
- Known inconsistency: the inventory report's currency comes from the
  `REPORT_CURRENCY` environment variable, the other reports' from the
  `general.defaultCurrency` setting (TD-012). The dashboard's tile notes
  say "below 20%/40% of required" even if the bands are changed (TD-025).

## Evidence
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts:26-198`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.service.ts:76-293`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.ts:1-54`
- `afrinov-platform/apps/backend/src/modules/reporting/consumption.service.ts:1-9`
- `afrinov-platform/apps/backend/src/modules/reporting/month-end.service.ts:1-84`
- `afrinov-platform/apps/backend/src/modules/reporting/report.service.ts:138`
- `afrinov-platform/apps/frontend/src/pages/Dashboard.tsx:61-62`
