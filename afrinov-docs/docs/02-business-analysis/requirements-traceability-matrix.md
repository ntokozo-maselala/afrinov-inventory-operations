# Requirements Traceability Matrix

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Paths in the Code column are under `afrinov-platform/apps/backend/src/`.
Tests are listed in `11-testing/test-traceability.md`.

| Business Req | Functional Req(s) | Primary Domain | Target Doc | API | Code | Status |
|---|---|---|---|---|---|---|
| BR-001 (current on-hand qty) | FR-INV-001, FR-INV-006, FR-REP-001 | Inventory | `03-domain/domain-model.md` | `/materials`, `/reports/current-stock` | `modules/inventory/material.service.ts`, `shared/inventory/balances.ts`, `modules/reporting/reporting.service.ts` | Implemented |
| BR-002 (why the balance is what it is) | FR-INV-006, FR-REP-002 | Inventory | `03-domain/domain-events.md` | `/inventory-transactions`, `/reports/movement-history` | `modules/inventory/inventory.service.ts` | Implemented |
| BR-003 (record goods receipt) | FR-INV-002, FR-PROC-003, FR-PROC-004 | Procurement/Inventory | `04-processes/goods-receiving.md` | `/stock-receipts`, `/goods-receipts` | `modules/inventory/stock-receipt.service.ts`, `modules/procurement/goods-receipt.service.ts` | Implemented |
| BR-004 (record issue to employee/project) | FR-INV-003 | Inventory/Operations | `04-processes/stock-issuing.md` | `/inventory-issues`, `/inventory-transactions/:id/returns` | `modules/inventory/inventory.service.ts` | Implemented (to a recipient) |
| BR-005 (transfer stock) | FR-INV-004 | Inventory | `04-processes/stock-transfer.md` | `/inventory-transfers` | `modules/inventory/inventory.service.ts` | Implemented |
| BR-006 (correct stock counts) | FR-INV-005 | Inventory | `04-processes/stock-adjustment.md` | `/inventory-adjustments`, `/stock-counts`, `/inventory-transactions/:id/reversal` | `modules/inventory/inventory.service.ts`, `modules/inventory/stock-count.service.ts` | Implemented |
| BR-007 (low-stock alert) | FR-INV-007 | Inventory | `04-processes/reporting-and-controls.md` | `/reports/stock-status`, `/reports/low-stock`, `/reports/reorder-list/export` | `shared/inventory/stock-status.ts` | Implemented (% bands) |
| BR-008 (tool check-out tracking) | FR-INV-008 | Inventory | `03-domain/state-machines.md` | — | — | **Planned** |
| BR-009 (stock value / movement reporting) | FR-REP-001, FR-REP-003 | Reporting | `04-processes/reporting-and-controls.md` | `/reports/stock-value`, `/reports/month-end`, `/reports/inventory` | `modules/reporting/` | Implemented |
| BR-010 (consumption per project) | FR-REP-004 | Reporting/Operations | `04-processes/reporting-and-controls.md` | `/reports/consumption`, `/reports/project-consumption/:projectNumber` | `modules/reporting/consumption.service.ts` | Implemented |
| BR-011 (role-based restriction) | FR-SEC-002 | Identity & Access | `10-security/access-control.md` | all mutating routes | `shared/permissions.ts`, `shared/authorization.ts` | Implemented |
| BR-012 (audit trail) | FR-SEC-001, FR-SEC-003 | Identity & Access | `07-data/audit-model.md` | `/audit` | services' audit writes, `modules/audit/audit.routes.ts` | Partly (TD-006, TD-008) |
| BR-013 (supplier master) | FR-PROC-001 | Procurement | `03-domain/entity-catalog.md` | `/suppliers` | `modules/procurement/procurement.service.ts` | Partly (no edit; TD-013) |
| BR-014 (PO lifecycle) | FR-PROC-002, FR-PROC-003 | Procurement | `04-processes/purchase-order-lifecycle.md` | `/purchase-orders` | `modules/procurement/procurement.service.ts` | Implemented, off by default |

Downstream: each Functional Requirement maps to an API endpoint
(`08-api/resource-model.md`), a UI page (`09-frontend/page-inventory.md`),
and automated tests (`11-testing/test-traceability.md`).

## Evidence
- The files and routes named in the table, at commit 4e6d76f.
