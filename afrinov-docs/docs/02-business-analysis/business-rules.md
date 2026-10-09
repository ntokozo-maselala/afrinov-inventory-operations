# Business Rules

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Rules inferred from the spreadsheet's structure and formulas, to be
confirmed with the business owner (see assumptions register). The last
column says how the platform implements each rule today.

| ID | Rule | Source | Implemented as |
|---|---|---|---|
| BR-001 | Current stock = brought-forward balance + total received - total issued, for a given material at a given location | `Current Stock`/`Brought Forward`/`IN`/`OUT` columns on every `*Main` sheet | Balance = sum of all signed ledger rows for the material and location; the workbook's current stock enters once as a dated opening-balance receipt |
| BR-002 | A material has a required-stock threshold below which it should be reordered | `Required Stock` column | `requiredStock` per item (not per location); status URGENT/WARNING when total on hand is below 20%/40% of it (configurable) |
| BR-003 | Every stock movement records a date/time, the item, the location/rack, the quantity, and the direction (IN/OUT) | `*Issued` sheet structure, consistent across categories | Every ledger row: postedAt, material, location, signed quantity, type, actor |
| BR-004 | A stock issue may optionally reference a project number | `Project No.` column on `*Issued` sheets | Optional project on issues (must exist and be active) |
| BR-005 | A goods receipt may optionally reference a supplier name and a delivery/invoice number | `Supplier Name` / `Delivery/Invoice No.` columns | Stricter: a counter receipt **requires** a supplier and a delivery/invoice number |
| BR-006 | Tools are tracked individually as checked out to a person, not as a consumed quantity | `Tools Issued` `Check In/Out` column, distinct from other categories | **Planned** — tools are tracked as quantities like other material |
| BR-007 | A material belongs to exactly one of five categories | Sheet family structure | `Material.category`, five enum values; fixed after creation |
| BR-008 | Stock value is computed and tracked at both category and overall level | `*Stock Summary` sheets and Dashboard "Stock Value" | Computed on request: on hand × current unit price, per category and total |
| BR-009 (proposed, not in AS-IS) | A stock issue must not take the balance below zero without an explicit override/reason | Not enforced today — recommended new rule | Stricter: no movement may take any balance below zero, with **no override** (fixed rule, not a setting) |
| BR-010 (proposed) | Every inventory transaction must be attributable to an authenticated user | Not enforced today — recommended new rule | Every ledger row has the signed-in user as actor |
| BR-011 (proposed) | Once posted, an inventory transaction is immutable; corrections are new adjustment transactions | Not enforced today — recommended new rule (see ADR-002) | Immutable via the API; corrections are reversals linked to the original (ADR-005) or adjustments |
| (new, no ID) | Every issue names who received the stock | ADR-008 | Required active recipient on every issue |
| (new, no ID) | Returned stock cannot exceed what is still out on the issue | Platform rule (no workbook source) | Return quantity ≤ issued − already returned |

*Unverified:* the "Source" column describes the July workbook, which is not
in the repository. These rules seed `functional-requirements.md` and
`11-testing/acceptance-testing.md`.

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:289-432,497-536`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.ts:22-43`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:35-44` — receipt requires `deliveryRef`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.service.ts:229-261`
- `afrinov-platform/apps/backend/src/modules/migration/opening-balance.service.ts:1-9`
