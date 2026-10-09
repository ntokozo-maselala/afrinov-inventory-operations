# Product Charter

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Product name
Afrinov Inventory & Operations Platform (working name — module 1: Inventory & Procurement)

## Problem statement
Afrinov's physical stock (fasteners, consumables, tooling, PPE, project
material) is tracked in Excel workbooks with no access control, no audit
trail, duplicated structure per category, and stock balances that can drift
from reality because they are hand-maintained rather than derived from
recorded movements.

## Objectives
1. Replace the spreadsheet system with a multi-user application without
   losing any capability the business currently relies on.
2. Model inventory as one domain within a broader operations structure
   (procurement → inventory → operations → reporting), per direction from
   the business owner.
3. Make every stock movement traceable: who, what, when, why, against which
   project or supplier document.
4. Reduce the five duplicated category workflows to one consistent model.

## Scope
See `product-scope.md` for the authoritative in/out/future boundary.

## Stakeholders
See `stakeholder-map.md`.

## Constraints
- Must be usable by workshop floor staff, not only office staff — the
  existing system is used directly by people issuing/receiving stock, not
  just by an inventory clerk (52 names in the `Employees` sheet, used as
  Issued By / Issued To across categories — *Unverified*).
- Must not require re-keying historical stock from scratch; migration must
  reconcile against the existing workbook (see `07-data/migration-strategy.md`).
  *Implemented:* a one-off import with dry run, reviewed mapping files and a
  reconciliation report.
- Small team, incremental delivery — architecture should support building
  Inventory first and adding modules later, not require all modules at once.

## Assumptions
See `00-governance/assumptions-register.md`.

## Success metrics
- 100% of current spreadsheet categories represented in the new system.
  *(Five categories exist; the import loads four — Tools are not imported.)*
- Zero un-traceable stock changes (every balance change has a transaction record).
- Time to answer "what's our current stock of X and where" reduced from
  "open the right workbook and find the row" to a direct query.
- Reorder points (`Required Stock`) actively surfaced, not manually noticed.

## Initial release
Inventory + Procurement core: Materials, Locations, Suppliers, Purchase
Orders, Goods Receipts, Stock Issues, Stock Transfers, Stock Adjustments,
Reporting. See `product-roadmap.md` for sequencing.

*Implementation status:* all of these exist in the platform; purchase
orders and goods receipts against them are switched off by default
(`PROCUREMENT_ENABLED`) and stock arrives through counter receipts. The
live delivery plan is `workbook-replacement-roadmap.md` at the repository
root.

## Future direction
Operations (project/workshop consumption context), Document Management,
eventual Finance/Sales integration — added as bounded contexts, not bolted
onto Inventory.
