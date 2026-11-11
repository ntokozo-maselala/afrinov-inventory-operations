# Product Roadmap

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

This sequencing follows the document dependency chain in
`13-project-management/development-workflow.md`: understand the business
before designing the domain, design the domain before the architecture,
architecture before data/API/UI.

Delivery is now planned and tracked in `workbook-replacement-roadmap.md`
at the repository root (Phases 0–6). The milestones below are the original
sequence; each carries its implementation status at commit 4e6d76f.

## Milestone 0 — Business & System Understanding (this documentation set)
Business context, AS-IS/TO-BE, capability map, domain model, SAP study,
gap analysis, target system context. **Gate: review with business owner.**
*Status:* documentation exists; the business-owner review gate is *Unverified* (`14-validation/stakeholder-review.md`).

## Milestone 1 — Domain & Data Foundation
Finalise domain model, entity catalog, data model, migration strategy from
the existing `.xlsm` files. No UI yet.
*Status:* done — Prisma schema, migrations, workbook import tooling (`07-data/`).

## Milestone 2 — Inventory Core
Material master, Location master, InventoryTransaction ledger,
InventoryBalance views, basic issue/receipt/transfer/adjustment, category
reporting. This alone replaces the `*Main`/`*Issued`/`*Stock Report` sheets
for all five categories.
*Status:* done — plus stock counts, returns, reversals and recipients.

## Milestone 3 — Procurement
Supplier master, Purchase Orders, Goods Receipt matched to POs, reorder
alerting against `Required Stock`.
*Status:* built and on by default (ADR-019): supplier master aligned to the purchase order template's vendor list, with edit; POs with prices, VAT, approval by order value, template-style numbers and revisions, the order document; receiving against an order from its page; in-product re-order list. See the [Procurement Alignment Roadmap](../13-project-management/roadmaps/procurement-alignment-roadmap.md) and [Procurement Workflow Roadmap](../13-project-management/roadmaps/procurement-workflow-roadmap.md). Requests for quotation, aligned with the RFQ sheet of the Manhours and Material workbook, are built: raised and sent to suppliers as PDFs, their quotes recorded with their own PDFs, compared side by side, and awarded as a draft purchase order. See the [RFQ Roadmap](../13-project-management/roadmaps/rfq-roadmap.md). Ordering is split as Afrinov works (ADR-020, ADR-021): Procurement buys project items for one project, and the storeman orders, approves and receives Stores stock in Store → Order stock. Project material comes through the store too (ADR-027): the storeman receives a project order into stock held for its project and issues it to that project straight away; see the [Project Material Through the Store Roadmap](../13-project-management/roadmaps/project-material-through-the-store-roadmap.md). See the [Stores Ordering Roadmap](../13-project-management/roadmaps/stores-ordering-roadmap.md) and the [Stores and Procurement Separation Roadmap](../13-project-management/roadmaps/stores-procurement-separation-roadmap.md).

## Milestone 4 — Tools & Category-Specific Behaviour
Tool check-out/check-in state tracking, PPE/consumable distinctions if
required (pending A-06 in the assumptions register; A-05 is corrected).
*Status:* **Planned** (Phase 5 in the root roadmap).

## Milestone 5 — Reporting & Dashboard
Stock value, movement history, low-stock alerts, project-filtered
consumption — replacing the Dashboard and `*Stock Summary` sheets.
*Status:* done — stock value, stock status, stock used by project/recipient, month-end report, Excel/PDF exports.

## Milestone 6 — Identity, Access & Audit
Users, roles, permissions, audit trail — capability that doesn't exist at
all in the current spreadsheet system.
*Status:* done with gaps — users, fixed roles, permissions, audit log, idle sign-out (TD-006, TD-008; TD-010 resolved by ADR-035).

## Milestone 7 — Migration & Cutover
Import and reconcile historical data from `07__July_2026_Report.xlsm` and
prior monthly workbooks; parallel-run period; sign-off; retire the
spreadsheets.
*Status:* import, dry run and reconciliation tooling built; cutover not evidenced in the repository (Phase 4 in the root roadmap). The importer reads `AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm`, not `07__July_2026_Report.xlsm`.

## Job tracking
Each project's schedules of steps, with baseline, forecast and actual dates,
the user assigned, progress, a chart and a board of open jobs, replacing
ClickUp and the retired *03 Projects Tracking Schedule* workbook.
*Status:* planned, not started (ADR-032). Six phases in
`13-project-management/roadmaps/project-tracking-roadmap.md`.

## Future / candidate modules (not scheduled)
Document management, fixed-asset register (Office Device List), scrap
tracking, finance/GL integration, full project management (budgets, step
dependencies, resource levelling), sales/CRM.
