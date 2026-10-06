# Product Roadmap

This sequencing follows the document dependency chain in
`13-project-management/development-workflow.md`: understand the business
before designing the domain, design the domain before the architecture,
architecture before data/API/UI.

## Milestone 0 — Business & System Understanding (this documentation set)
Business context, AS-IS/TO-BE, capability map, domain model, SAP study,
gap analysis, target system context. **Gate: review with business owner.**

## Milestone 1 — Domain & Data Foundation
Finalise domain model, entity catalog, data model, migration strategy from
the existing `.xlsm` files. No UI yet.

## Milestone 2 — Inventory Core
Material master, Location master, InventoryTransaction ledger,
InventoryBalance views, basic issue/receipt/transfer/adjustment, category
reporting. This alone replaces the `*Main`/`*Issued`/`*Stock Report` sheets
for all five categories.

## Milestone 3 — Procurement
Supplier master, Purchase Orders, Goods Receipt matched to POs, reorder
alerting against `Required Stock`.

## Milestone 4 — Tools & Category-Specific Behaviour
Tool check-out/check-in state tracking, PPE/consumable distinctions if
required (pending A-05, A-06 in the assumptions register).

## Milestone 5 — Reporting & Dashboard
Stock value, movement history, low-stock alerts, project-filtered
consumption — replacing the Dashboard and `*Stock Summary` sheets.

## Milestone 6 — Identity, Access & Audit
Users, roles, permissions, audit trail — capability that doesn't exist at
all in the current spreadsheet system.

## Milestone 7 — Migration & Cutover
Import and reconcile historical data from `07__July_2026_Report.xlsm` and
prior monthly workbooks; parallel-run period; sign-off; retire the
spreadsheets.

## Future / candidate modules (not scheduled)
Document management, fixed-asset register (Office Device List), scrap
tracking, finance/GL integration, full project management, sales/CRM.
