# Requirements Traceability Matrix

| Business Req | Functional Req(s) | Primary Domain | Target Doc |
|---|---|---|---|
| BR-001 (current on-hand qty) | FR-INV-001, FR-INV-006, FR-REP-001 | Inventory | `03-domain/domain-model.md` |
| BR-002 (why the balance is what it is) | FR-INV-006, FR-REP-002 | Inventory | `03-domain/domain-events.md` |
| BR-003 (record goods receipt) | FR-INV-002, FR-PROC-003, FR-PROC-004 | Procurement/Inventory | `04-processes/goods-receiving.md` |
| BR-004 (record issue to employee/project) | FR-INV-003 | Inventory/Operations | `04-processes/stock-issuing.md` |
| BR-005 (transfer stock) | FR-INV-004 | Inventory | `04-processes/stock-transfer.md` |
| BR-006 (correct stock counts) | FR-INV-005 | Inventory | `04-processes/stock-adjustment.md` |
| BR-007 (low-stock alert) | FR-INV-007 | Inventory | `04-processes/reporting-and-controls.md` |
| BR-008 (tool check-out tracking) | FR-INV-008 | Inventory | `03-domain/state-machines.md` |
| BR-009 (stock value / movement reporting) | FR-REP-001, FR-REP-003 | Reporting | `04-processes/reporting-and-controls.md` |
| BR-010 (consumption per project) | FR-REP-004 | Reporting/Operations | `04-processes/reporting-and-controls.md` |
| BR-011 (role-based restriction) | FR-SEC-002 | Identity & Access | `10-security/access-control.md` |
| BR-012 (audit trail) | FR-SEC-001, FR-SEC-003 | Identity & Access | `07-data/audit-model.md` |
| BR-013 (supplier master) | FR-PROC-001 | Procurement | `03-domain/entity-catalog.md` |
| BR-014 (PO lifecycle) | FR-PROC-002, FR-PROC-003 | Procurement | `04-processes/purchase-order-lifecycle.md` |

Downstream: each Functional Requirement should map to an API endpoint
(`08-api/resource-model.md`), a UI page (`09-frontend/page-inventory.md`),
and at least one automated test (`11-testing/test-traceability.md`). That
mapping is populated as each module is implemented.
