# Functional Requirements

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Traceable to Business Requirements (see `requirements-traceability-matrix.md`).

## Inventory
- **FR-INV-001** The system shall allow authorised users to create and edit
  Material master records (name, category, unit of measure, required-stock
  threshold). *(→ BR-001)*
  *Status:* Implemented (plus description, unit cost, active flag; category fixed after creation).
- **FR-INV-002** The system shall allow authorised users to record a Goods
  Receipt, creating an immutable inventory transaction. *(→ BR-003)*
  *Status:* Implemented (counter receipt or PO receipt).
- **FR-INV-003** The system shall allow authorised users to record a Stock
  Issue against a material, location, quantity, employee, and optional
  project reference. *(→ BR-004)*
  *Status:* Implemented, with a recipient from the Recipients list instead of an employee (ADR-008); several items per entry.
- **FR-INV-004** The system shall allow authorised users to record a Stock
  Transfer between two locations as a linked pair of transactions with no
  net quantity change. *(→ BR-005)*
  *Status:* Implemented.
- **FR-INV-005** The system shall allow authorised users to record a Stock
  Adjustment with a mandatory reason code. *(→ BR-006)*
  *Status:* Implemented; reason code required by request validation.
- **FR-INV-006** The system shall compute InventoryBalance as the sum of all
  posted transactions for a material/location, never as a directly editable
  field. *(→ BR-001, BR-012)*
  *Status:* Implemented: the balance row is recomputed from the ledger sum after every movement; no endpoint edits it.
- **FR-INV-007** The system shall flag any material whose balance is at or
  below its required-stock threshold. *(→ BR-007)*
  *Status:* Implemented differently: an item is flagged URGENT or WARNING when its total on hand is *below* 20% or 40% (configurable) of Required Stock, not "at or below" the threshold itself.
- **FR-INV-008** The system shall track tools as checked-out-to-person state,
  distinct from consumable quantity tracking. *(→ BR-008)*
  *Status:* **Planned** — not implemented.

## Procurement
- **FR-PROC-001** The system shall allow authorised users to maintain a
  Supplier master (name, contact details). *(→ BR-013)*
  *Status:* Partly implemented: create and list only; no edit or deactivate (TD-013).
- **FR-PROC-002** The system shall allow authorised users to create a
  Purchase Order against a supplier with one or more material lines and
  quantities. *(→ BR-014)*
  *Status:* Implemented behind `PROCUREMENT_ENABLED` (off by default).
- **FR-PROC-003** The system shall allow a Goods Receipt to be matched
  against an open Purchase Order, updating the PO's received quantity and
  status. *(→ BR-014)*
  *Status:* Implemented behind `PROCUREMENT_ENABLED`; only APPROVED or PARTIALLY_RECEIVED orders.
- **FR-PROC-004** The system shall allow a Goods Receipt to be recorded
  without a Purchase Order (ad hoc receipt), consistent with current
  practice, subject to permission. *(→ BR-003)*
  *Status:* Implemented as counter receipts (`receive:inventory`); always available.

## Reporting
- **FR-REP-001** The system shall provide a current-stock report filterable
  by category and location. *(→ BR-001, BR-009)*
  *Status:* Implemented (also by material).
- **FR-REP-002** The system shall provide a movement-history report
  filterable by material, date range, and transaction type. *(→ BR-002)*
  *Status:* Implemented (also by project).
- **FR-REP-003** The system shall provide a stock-value report by category
  and overall. *(→ BR-009)*
  *Status:* Implemented; plus month-end report by category.
- **FR-REP-004** The system shall provide a consumption report filterable by
  project number. *(→ BR-010)*
  *Status:* Implemented; also by recipient and date range.

## Identity & Access
- **FR-SEC-001** The system shall require authentication for any operation
  that creates or modifies inventory data. *(→ BR-011, BR-012)*
  *Status:* Implemented: every business endpoint requires a token.
- **FR-SEC-002** The system shall enforce role-based permissions for issue,
  receive, adjust, and PO-approval actions. *(→ BR-011)*
  *Status:* Implemented.
- **FR-SEC-003** The system shall record actor, timestamp, and action for
  every create/update/delete operation. *(→ BR-012)*
  *Status:* Partly implemented: the ledger records actor and time for every stock change; the audit log misses issues, transfers, adjustments, PO creation and goods receipts (TD-008).

## Evidence
Code and test links per requirement: `requirements-traceability-matrix.md`
and `11-testing/test-traceability.md`.
