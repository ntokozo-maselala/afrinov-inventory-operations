# Assumptions Register

Assumptions made while producing this documentation set, in the absence of
direct confirmation from the business owner. Each must be validated in the
Milestone 0 review (`14-validation/stakeholder-review.md`) before it's relied
on for implementation.

| ID | Assumption | Basis | Risk if wrong | Status |
|---|---|---|---|---|
| A-01 | "Afrinov" is the operating company name and `AFRI-####` is its project numbering scheme | Seen throughout `Project No.` columns and Delivery/Invoice references | Low — cosmetic only | Unconfirmed |
| A-02 | The business is a metal fabrication / engineering workshop (boiler shop, machine shop, blasting, paint shop) that runs client projects and sells scrap metal by-product | Sheet names (`Boiler Shop`, `Machine Shop`, `Blasting`, `Paint shop`), `Scrap Material` sheet tracking Mild Steel, Stainless Steel, Copper, Brass, Aluminium | Medium — shapes the Operations domain model | Unconfirmed |
| A-03 | "Stock Issued", "Check Out", and "Dispatched" are synonyms for the same business event (material/tool leaving stores) | Inconsistent column naming across `*Issued` sheets | Low — naming only | Unconfirmed |
| A-04 | Tools (`Tools Main`/`Tools Issued`) are check-in/check-out assets, not consumed stock — unlike Consumables/Fasteners | `Tools Issued` has a `Check In/Out` column instead of a running quantity balance | Medium — affects whether Tools needs its own state machine | Unconfirmed |
| A-05 | "Required Stock" on `*Main` sheets is a reorder threshold, not a demand forecast | Column sits beside Current Stock with no formula link to future demand | Medium — affects reorder-alert logic | Unconfirmed |
| A-06 | Office equipment (`Office Device List`) is a fixed-asset register, not inventory stock, and is out of scope for v1 | No IN/OUT movement columns, has `Employee Assigned` and `Insured?` instead | Medium — scope boundary | Unconfirmed |
| A-07 | One user (or a small number) currently maintains all workbooks; there is no existing multi-user access control | Single-workbook, single-owner Excel file structure | Low — expected for the AS-IS state | Unconfirmed |
| A-08 | Suppliers are not currently a managed master list — supplier name is free text entered per transaction | `Supplier Name` appears only in `*Issued` sheets, not as its own sheet | Medium — affects Supplier Master design | Unconfirmed |
| A-09 | The 52 names on the `Employees` sheet are the current, complete workforce eligible to issue/receive/check out stock | No hire/termination dates on the sheet | Low–Medium — affects Identity & Access seed data | Unconfirmed |

**Process:** when an assumption is confirmed or corrected, move it to
`decision-log.md` as an ADR (if it affects architecture) and mark it
`Confirmed`/`Corrected` here rather than deleting the row.
