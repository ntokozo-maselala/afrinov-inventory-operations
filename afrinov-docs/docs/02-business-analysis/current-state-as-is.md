# AS-IS: Current State (Excel System)

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Source:** `07__July_2026_Report.xlsm` (31 sheets), a monthly snapshot in a
recurring series of workbooks.

*Unverified:* every figure and sheet name below comes from that workbook,
which is not in the repository. The workbook in the repository root is
`AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm`; the import tool reads four
Main/Summary category pairs from it (Consumables, Fasteners/Slugs/Insulation,
Tooling/PPE/Electrical, Project Material) — not Tools — and
`workbook-replacement-roadmap.md` describes four stock categories. Whether
the two workbooks are the same dataset needs confirming (assumption A-10).

## Structure
Five material categories, each duplicating the same four-sheet pattern:

| Category | Main | Issued (transactions) | Stock Report | Stock Summary |
|---|---|---|---|---|
| Fasteners, Slugs & Insulation | `Fasteners, Slugs & Insluation M` (774 rows) | `FS&I Issued` (186 rows) | `FS&I Stock Report` | `FS&I Stock Summary` |
| Tooling, PPE & Electrical | `Tooling, PPE & Electrical Main` (217 rows) | `TP & E Issued` (1718 rows) | `TP & E Stock Report` | `TP&E Stock Summary` |
| Project Material | `Project Material Main` (204 rows) | `Project Material Issued` (4514 rows) | `Project Stock Report` | `Project Stock Summary` |
| Consumables | `Consumables Main` (412 rows) | `Consumables Issued` (709 rows) | `Consumables Stock Report` | (rolled into `Stock Summary`) |
| Tools | `Tools Main` (1370 rows) | `Tools Issued` (215 rows) | — | — |

Plus: `Dashboard` (cross-category KPIs, product/rack selectors), `Stock
Summary` (523 rows, cross-category value roll-up), `Transactions` (simple
Product ID / IN / OUT roll-up), `Employees` (52 names), `Project No.`
(project number register), `Scrap Material`, `Office Device List`,
`Consumables Box`/`Consumables Tracking Main` (secondary consumables views),
and `Sheet1` (836 rows, unclassified working data).

## Core mechanics (as implemented in formulas)
- **Current Stock** on each `Main` sheet = `Brought Forward + IN - OUT`,
  where `IN`/`OUT` are period totals, apparently summed or hand-updated from
  the corresponding `Issued` sheet.
- **Required Stock** sits beside Current Stock as a static reorder threshold
  with no automated alerting — a human has to look.
- **Issued sheets** are the real transaction log: one row per movement, with
  `Time & Date`, item, `Rack`, `Current Stock` (snapshot at time of entry),
  `Stock Issued` (quantity), `In/Out`, `Supplier Name`, `Issued By:`,
  `Issued To:`, `Delivery/Invoice No.`, `Project No.`.
- **Tools** differ: `Tools Issued` uses a `Check In/Out` column instead of a
  running quantity, i.e. tools are tracked as discrete checked-out assets,
  not consumed stock.
- **Dashboard** aggregates Total Received / Total Dispatched / Stock Value
  and a "Bottom 10 Stock Quantity" view, driven by rack and product
  selectors (dropdowns), i.e. a manually-refreshed pivot-style view.

## Data quality observations
- **Location is free text and inconsistent**: `Store`, `Stores`, `STOREROOM`,
  `Storeroom`, `Store room `, `store room` all appear as separate values for
  what is almost certainly one place. Similarly `Boiler Shop` / `boilershop`,
  `Machine Shop` / `machine shop`.
- **Supplier is free text**, no master list — `Hydroscand`, `JHB Bolts`,
  `SIEVERT` appear only inside transaction rows.
- **No user identity system** — `Issued By`/`Issued To` are free-text names
  matched loosely against the `Employees` list; nothing prevents a typo or
  an unlisted name.
- **No formal purchase order** — goods receipt (`In/Out = IN`) references a
  `Delivery/Invoice No.` but there's no prior PO row to match it against.
- **Balance can drift from movement history** — because `Current Stock` is a
  cell that can be typed into directly, not strictly a computed rollup of
  every `Issued` row.

## Actors observed
52 employees performing issue/receive actions (`Employees` sheet); no
distinct supplier, procurement, or admin roles exist in the file structure —
one workbook owner effectively performs all roles.
