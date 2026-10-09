# Product Scope

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09 · validate with business owner before architecture sign-off

## In scope (v1)
- **Material master** — one record per trackable item, with category
  (Fasteners/Slugs/Insulation, Tooling/PPE/Electrical, Project Material,
  Consumables, Tools), unit of measure, required-stock threshold.
- **Location master** — normalised racks, storerooms, shop-floor areas,
  containers (replacing free-text location strings).
- **Supplier master** — replacing free-text supplier names on transactions.
- **Inventory transactions** — receipts, issues, transfers, adjustments, as
  an immutable ledger.
- **Inventory balances** — current on-hand quantity per material per
  location, derived from transactions.
- **Purchase orders** — creation and tracking through to goods receipt.
  *Built; switched off by default (`PROCUREMENT_ENABLED`).*
- **Goods receipt** — recording delivery against a PO or ad hoc, updating stock.
- **Stock issue** — recording material/tool leaving stores to a person and,
  where applicable, a project. *Built: to a recipient (worker, machine, site
  or contractor), with returns.*
- **Tool check-out/check-in** — distinct from consumable issue, tracking
  which tool is with which person. ***Planned** — not built.*
- **Project reference** — recording which project (`AFRI-####`) a movement
  relates to, without building full project management. *Built as a project
  master (name, status, manager, client, dates) with CRUD — more than a
  reference, still no planning or budgeting.*
- **Reporting** — current stock, movement history, low-stock/reorder alerts,
  stock value, category summaries (replacing `*Stock Summary`/`*Stock
  Report` sheets and the Dashboard).
- **User accounts & roles** — replacing "whoever has the file" access.
- **Audit trail** — who changed what, when.

## Out of scope (v1) — explicitly deferred
- **Finance/accounting integration** (GL postings, costing methods beyond
  simple stock value).
- **Payroll / HR** — the Employees list is used only as an issue/receive
  actor reference, not an HR record.
- **CRM / sales order management.**
- **Manufacturing execution / production scheduling.**
- **Full project management** — projects are referenced by number, not
  planned or budgeted in this system.
- **Office/fixed-asset register** (`Office Device List`) — different lifecycle
  (insurance, employee assignment, depreciation) from consumable stock;
  candidate for a later Asset Management module, not v1.
- **Scrap sales tracking** (`Scrap Material` sheet) — revenue-side event, not
  inventory; candidate for Finance/Operations integration later.
- **Advanced MRP / demand forecasting** — `Required Stock` is a static
  threshold in v1, not a forecast.
- **Multi-site / multi-currency.** *(A single currency is chosen in
  settings, `general.defaultCurrency`; there is no conversion.)*

## Unknown / needs business input
- Whether Tools should have full lifecycle tracking (maintenance, condition,
  calibration) beyond check-out/check-in.
- Whether PPE needs expiry or certification tracking (safety-relevant, not
  currently in the sheet).
- Whether scrap sales should eventually post as inventory write-off + revenue
  event.

## Boundary discipline
Any feature request should be checked against this table before being added
to a sprint. If it doesn't fit "in scope", it goes into `product-roadmap.md`
as a future candidate or is explicitly rejected — it does not get added
silently.

## Evidence
- `afrinov-platform/apps/backend/src/shared/config.ts:84-86`
- `afrinov-platform/apps/backend/src/modules/operations/project.service.ts:1-20`
- `afrinov-platform/apps/backend/src/modules/settings/settings.service.ts:165`
