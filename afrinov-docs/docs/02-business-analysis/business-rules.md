# Business Rules

Rules inferred from the spreadsheet's structure and formulas, to be
confirmed with the business owner (see assumptions register).

| ID | Rule | Source |
|---|---|---|
| BR-001 | Current stock = brought-forward balance + total received - total issued, for a given material at a given location | `Current Stock`/`Brought Forward`/`IN`/`OUT` columns on every `*Main` sheet |
| BR-002 | A material has a required-stock threshold below which it should be reordered | `Required Stock` column |
| BR-003 | Every stock movement records a date/time, the item, the location/rack, the quantity, and the direction (IN/OUT) | `*Issued` sheet structure, consistent across categories |
| BR-004 | A stock issue may optionally reference a project number | `Project No.` column on `*Issued` sheets |
| BR-005 | A goods receipt may optionally reference a supplier name and a delivery/invoice number | `Supplier Name` / `Delivery/Invoice No.` columns |
| BR-006 | Tools are tracked individually as checked out to a person, not as a consumed quantity | `Tools Issued` `Check In/Out` column, distinct from other categories |
| BR-007 | A material belongs to exactly one of five categories | Sheet family structure |
| BR-008 | Stock value is computed and tracked at both category and overall level | `*Stock Summary` sheets and Dashboard "Stock Value" |
| BR-009 (proposed, not in AS-IS) | A stock issue must not take the balance below zero without an explicit override/reason | Not enforced today — recommended new rule |
| BR-010 (proposed) | Every inventory transaction must be attributable to an authenticated user | Not enforced today — recommended new rule |
| BR-011 (proposed) | Once posted, an inventory transaction is immutable; corrections are new adjustment transactions | Not enforced today — recommended new rule (see ADR-002) |

These become the seed for `functional-requirements.md` and validation
scenarios in `11-testing/acceptance-testing.md`.
