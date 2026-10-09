# Test Traceability

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Requirement → code → tests that exist today. Paths are under
`afrinov-platform/apps/backend/` unless they start with `frontend/`.
"Status" is the implementation status, not a sign-off.

| Business Req | Functional Req | Code | Tests | Status |
|---|---|---|---|---|
| BR-001 | FR-INV-001, FR-INV-006 | `src/modules/inventory/material.service.ts`, `src/shared/inventory/balances.ts` | `src/modules/inventory/balances.test.ts`, `src/modules/inventory/stock-item.service.test.ts`, integration `ledgerAndBalance` checks | Implemented |
| BR-002 | FR-REP-002 | `src/modules/inventory/inventory.service.ts` (`queryHistory`), `src/modules/reporting/reporting.service.ts` | `integration/inventory.real-http.test.ts` (history newest first) | Implemented |
| BR-003 | FR-INV-002, FR-PROC-003/004 | `src/modules/inventory/stock-receipt.service.ts`, `src/modules/procurement/goods-receipt.service.ts` | `src/modules/inventory/stock-receipt.service.test.ts`, `src/modules/procurement/goods-receipt.service.test.ts`, `integration/stock-receipts.real-http.test.ts`, `integration/procurement.real-http.test.ts`, `frontend/src/pages/ReceiveStock.test.tsx` | Implemented |
| BR-004 | FR-INV-003 | `src/modules/inventory/inventory.service.ts` (`issue`, `returnToStock`) | `src/modules/inventory/inventory.service.test.ts`, `src/modules/inventory/inventory.routes.test.ts`, `integration/inventory.real-http.test.ts`, `integration/returns.real-http.test.ts`, `frontend/src/pages/IssueStock.test.tsx` | Implemented |
| BR-005 | FR-INV-004 | `inventory.service.ts` (`transfer`) | `integration/inventory.real-http.test.ts` (two linked legs) | Implemented |
| BR-006 | FR-INV-005 | `inventory.service.ts` (`adjust`), `src/modules/inventory/stock-count.service.ts` | `src/modules/inventory/inventory.routes.test.ts`, `integration/stock-counts.real-http.test.ts`, `frontend/src/pages/StockCount.test.tsx` | Implemented |
| BR-007 | FR-INV-007 | `src/shared/inventory/stock-status.ts`, `src/modules/reporting/reporting.service.ts` | `src/shared/inventory/stock-status.test.ts`, `src/modules/reporting/reorder-export.test.ts`, `integration/reorder-list.real-http.test.ts`, `frontend/src/pages/StockStatus.test.tsx` | Implemented (as % bands) |
| BR-008 | FR-INV-008 | — | — | **Planned** |
| BR-009 | FR-REP-001, FR-REP-003 | `reporting.service.ts` (`currentStock`, `stockValue`), `src/modules/reporting/month-end.service.ts` | `src/modules/reporting/reporting.service.test.ts`, `src/modules/reporting/month-end.test.ts`, `integration/month-end.real-http.test.ts` | Implemented |
| BR-010 | FR-REP-004 | `src/modules/reporting/consumption.service.ts`, `reporting.service.ts` (`projectConsumption`) | `src/modules/reporting/consumption.test.ts`, `integration/consumption.real-http.test.ts`, `frontend/src/pages/Consumption.test.tsx` | Implemented |
| BR-011 | FR-SEC-002 | `src/shared/permissions.ts`, `src/shared/authorization.ts` | `src/shared/permissions.test.ts`, `src/shared/authorization.test.ts`, `integration/inventory.real-http.test.ts` (read-only user) | Implemented |
| BR-012 | FR-SEC-001, FR-SEC-003 | `src/server.ts` (`authenticate`), services' audit writes | `src/security.regression.test.ts`, `integration/auth.real-http.test.ts` | Partly implemented (audit gaps, TD-008) |
| BR-013 | FR-PROC-001 | `src/modules/procurement/procurement.service.ts` (`SupplierService`) | `src/server.procurement.test.ts` (route stays registered when procurement is off); no test of the duplicate-name rule (TD-023) | Create only; update **Planned** |
| BR-014 | FR-PROC-002/003 | `procurement.service.ts`, `goods-receipt.service.ts` | `src/modules/procurement/procurement.service.test.ts`, `integration/procurement.real-http.test.ts` | Implemented (behind `PROCUREMENT_ENABLED`) |

Update as each requirement is implemented and tested — this table links
`02-business-analysis/business-requirements.md` to the actual test suite.

## Evidence
- The files named in the table (all exist at commit 4e6d76f).
