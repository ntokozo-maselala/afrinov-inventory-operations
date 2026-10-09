# Assumptions Register

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

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
| A-10 | The workbook in the repository root (`AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm`, read by the import tool) is the same dataset as `07__July_2026_Report.xlsm`, on which `02-business-analysis/current-state-as-is.md` and the sheet/row figures across the docs are based | The import reads four Main/Summary category pairs (not Tools); the root roadmap describes four categories; the AS-IS doc describes five category families and 31 sheets | Medium — AS-IS figures and scope (Tools) may be wrong | Unconfirmed — confirm with the store controller |
| A-11 | Hosting target, TLS termination, staging and production environments, and how the frontend is served | Not defined in the repository (`06-system-architecture/deployment-architecture.md`) | High for go-live | Unconfirmed — confirm with IT/engineering |
| A-12 | The role grants in `shared/permissions.ts` match how staff should work (e.g. technicians may issue to any recipient; every role can read all reports, unit costs and the full ledger) | Code; no business sign-off recorded | Medium — access too wide or too narrow | Unconfirmed — confirm with the business owner |
| A-13 | Purchase orders need approval before processing (setting default on) and only approvers approve | Setting default in code; TD-003 | Medium — procurement flow | Unconfirmed — confirm with the business owner |
| A-14 | Cut-over date, who signs off the reconciliation, and that the workbook is frozen after go-live | `07-data/migration-strategy.md`; root roadmap "Cutover and go-live" | High — data authority at go-live | Unconfirmed — business owner |
| A-15 | Recovery targets RPO ≤ 24h and RTO ≤ 1 business day | Proposed default in `12-operations/disaster-recovery.md` | Medium | Unconfirmed — business owner and IT |
| A-16 | The issue and receive screens are usable on shop-floor devices (touch, shared terminals) | `09-frontend/interaction-model.md`; no device testing recorded | Medium — adoption | Unconfirmed — store controller, UAT |
| A-17 | Incidents that could affect a stock balance are treated as high severity | `12-operations/incident-management.md`; no runbook | Low | Unconfirmed — engineering |
| A-18 | The Milestone 0 stakeholder review took place and its outcome is as the implementation assumes | No record in the repository (`14-validation/stakeholder-review.md`) | Medium — scope | Unconfirmed — business owner |
| A-19 | Handling advice for wrong-material and damaged deliveries in `04-processes/procure-to-stock.md` matches store practice | Process text, not enforced by code | Low | Unconfirmed — store controller |
| A-20 | HTTPS-only transport in production | `10-security/security-requirements.md`; TLS not in the repository | High | Unconfirmed — IT |

**Process:** when an assumption is confirmed or corrected, move it to
`decision-log.md` as an ADR (if it affects architecture) and mark it
`Confirmed`/`Corrected` here rather than deleting the row.
