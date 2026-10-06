# Functional Requirements

Traceable to Business Requirements (see `requirements-traceability-matrix.md`).

## Inventory
- **FR-INV-001** The system shall allow authorised users to create and edit
  Material master records (name, category, unit of measure, required-stock
  threshold). *(→ BR-001)*
- **FR-INV-002** The system shall allow authorised users to record a Goods
  Receipt, creating an immutable inventory transaction. *(→ BR-003)*
- **FR-INV-003** The system shall allow authorised users to record a Stock
  Issue against a material, location, quantity, employee, and optional
  project reference. *(→ BR-004)*
- **FR-INV-004** The system shall allow authorised users to record a Stock
  Transfer between two locations as a linked pair of transactions with no
  net quantity change. *(→ BR-005)*
- **FR-INV-005** The system shall allow authorised users to record a Stock
  Adjustment with a mandatory reason code. *(→ BR-006)*
- **FR-INV-006** The system shall compute InventoryBalance as the sum of all
  posted transactions for a material/location, never as a directly editable
  field. *(→ BR-001, BR-012)*
- **FR-INV-007** The system shall flag any material whose balance is at or
  below its required-stock threshold. *(→ BR-007)*
- **FR-INV-008** The system shall track tools as checked-out-to-person state,
  distinct from consumable quantity tracking. *(→ BR-008)*

## Procurement
- **FR-PROC-001** The system shall allow authorised users to maintain a
  Supplier master (name, contact details). *(→ BR-013)*
- **FR-PROC-002** The system shall allow authorised users to create a
  Purchase Order against a supplier with one or more material lines and
  quantities. *(→ BR-014)*
- **FR-PROC-003** The system shall allow a Goods Receipt to be matched
  against an open Purchase Order, updating the PO's received quantity and
  status. *(→ BR-014)*
- **FR-PROC-004** The system shall allow a Goods Receipt to be recorded
  without a Purchase Order (ad hoc receipt), consistent with current
  practice, subject to permission. *(→ BR-003)*

## Reporting
- **FR-REP-001** The system shall provide a current-stock report filterable
  by category and location. *(→ BR-001, BR-009)*
- **FR-REP-002** The system shall provide a movement-history report
  filterable by material, date range, and transaction type. *(→ BR-002)*
- **FR-REP-003** The system shall provide a stock-value report by category
  and overall. *(→ BR-009)*
- **FR-REP-004** The system shall provide a consumption report filterable by
  project number. *(→ BR-010)*

## Identity & Access
- **FR-SEC-001** The system shall require authentication for any operation
  that creates or modifies inventory data. *(→ BR-011, BR-012)*
- **FR-SEC-002** The system shall enforce role-based permissions for issue,
  receive, adjust, and PO-approval actions. *(→ BR-011)*
- **FR-SEC-003** The system shall record actor, timestamp, and action for
  every create/update/delete operation. *(→ BR-012)*
