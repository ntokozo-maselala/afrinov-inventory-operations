# Process: Reporting & Controls

## Reports replacing the AS-IS Dashboard / *Stock Summary / *Stock Report sheets
- **Current stock** — by category, location, or material; replaces
  `*Stock Report` sheets and the Dashboard's rack/product selectors.
- **Movement history** — by material, date range, transaction type;
  new capability, not available at all today beyond scrolling an `Issued`
  sheet.
- **Stock value** — by category and overall; replaces `*Stock Summary`
  totals (e.g. the `73233.815...`/`128018.4625`/`243405.77...` figures seen
  atop the FS&I, TP&E, and combined Stock Summary sheets).
- **Low-stock / reorder** — materials at or below `requiredStock`; new
  active alerting, replacing passive observation.
- **Project consumption** — movements filtered by `Project No.`; new
  capability, since today's data is scattered across five `*Issued` sheets
  with no cross-category project view.
- **Bottom-N stock quantity** — replaces the Dashboard's "Bottom 10 Stock
  Quantity" view.

## Controls
- Reports are read-only views over Inventory and Procurement data; they do
  not write anything back (see `03-domain/bounded-contexts.md`).
- Figures shown must always be derivable from the transaction ledger — no
  parallel "summary" numbers that can drift from the detail, unlike the
  AS-IS Stock Summary sheets which store a rolled-up total independently of
  the detail rows.
