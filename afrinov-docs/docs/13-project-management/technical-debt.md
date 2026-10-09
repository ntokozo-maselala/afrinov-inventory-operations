# Technical Debt Register

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Code/doc disagreements and code issues that block accurate documentation.
Paths are relative to `afrinov-platform/apps/backend/` unless stated.

| ID | Description | Impact | Status |
|---|---|---|---|
| TD-001 | Location/Supplier free-text cleansing during migration is manual review, not fully automatable — some ambiguous cases (e.g. "Blue Trunk (Stores)") need a business decision. The import tool now asks a person to map each location spelling in `mapping.xlsx` | Delays migration sign-off | Open |
| TD-002 | `Sheet1` (836 rows) and `Consumables Box`/`Consumables Tracking Main` overlap with `Consumables Main` is not yet understood — needs source clarification before migration mapping is finalised. The importer reads only the Main and Summary sheets | Blocks migration completeness | Open |
| TD-003 | No confirmed approval-rule requirement for Purchase Orders. The code now has a setting (`purchaseOrders.requireApprovalBeforeProcessing`, default on) but the business rule is unconfirmed | Blocks Procurement go-live | Open |
| TD-004 | Module boundaries are not enforced: `inventory` ↔ `procurement` import each other (`src/modules/procurement/goods-receipt.service.ts:4`, `src/modules/inventory/stock-receipt.service.ts:11`); `procurement.service.ts:324-335` writes ledger rows; `reporting` reads other modules' tables; `src/shared/inventory/stock-status.ts:11` imports a module. Docs claimed event/interface-only integration | Harder to split or change modules; docs were wrong | Open (docs corrected 2026-10-09) |
| TD-005 | `inventory_balances` foreign keys declared in `prisma/schema.prisma:469-470` are not created by any migration | Orphan balance rows possible; schema and database differ | Open |
| TD-006 | Ledger and audit immutability is application convention only: no GRANT/REVOKE/trigger in `prisma/migrations/`. Docs (threat model, coding standards) claimed DB grants | Direct SQL can edit history | Open (docs corrected) |
| TD-007 | Domain events are dispatched but no handler is registered (`src/shared/events.ts`); `SupplierCreated`, `PurchaseOrderCreated/Approved/Cancelled` are declared but never dispatched. Docs claimed goods receipts update POs via events | Dead code; misleading design | Open (docs corrected) |
| TD-008 | Audit gaps: issue, transfer, adjustment, PO creation, goods-receipt create/post write no audit entry; several services write the audit entry outside the business transaction (e.g. `src/modules/identity/identity.service.ts:115-149`, `src/modules/inventory/material.service.ts:62,87`) | FR-SEC-003 only partly met | Open |
| TD-009 | Three copies of the balance recompute: `src/shared/inventory/balances.ts:6-21`, `src/modules/inventory/balances.ts:15-26`, `src/modules/inventory/stock-item.service.ts:53-68` | Risk of divergence | Open |
| TD-010 | Settings stored and editable but not used: `security.sessionTimeoutMinutes` (tokens always last 12h, `src/server.ts:107`) and `notifications.*` | Admins may believe a control is active | Open |
| TD-011 | Unused model/permissions: `checkout:tool`, `checkin:tool`, `manage:roles` granted but never checked; `purchase_orders.shipped_*` columns kept unused; `GoodsReceiptStatus.DRAFT` never produced; `createPOSchema` accepts `unitPrice` (`src/modules/procurement/procurement.routes.ts:27`) which is silently dropped | Confusing contract | Open |
| TD-012 | Inventory report currency comes from env `REPORT_CURRENCY` (`src/modules/reporting/report.service.ts:138`); all other reports use the `general.defaultCurrency` setting | Reports can disagree on currency | Open |
| TD-013 | Supplier has `edit:supplier` permission and an `active` column but no update/deactivate endpoint | FR-PROC-001 only partly met | Open |
| TD-014 | Reads of materials, locations, racks, projects, recipients, suppliers, settings and the full ledger need authentication only, no permission; unit costs readable by every role | Weaker than deny-by-default design | Open (docs corrected) |
| TD-015 | Frontend navigation shows every item to every role (`apps/frontend/src/hooks/useNavGroups.tsx`); client role checks duplicate server permissions by role name (`apps/frontend/src/hooks/usePermissions.ts`) | UI and server can drift | Open |
| TD-016 | `prisma/migrations/20260101000000_initial/README.md` names `20260101000000_location_management`; the folder is `20260101000001_location_management` | Misleading operator note (migrations folder not edited in docs pass) | Open |
| TD-017 | `apps/frontend/e2e/login.spec.ts` hard-codes an admin password; the seed no longer uses a fixed one, so the test only passes if `SEED_ADMIN_PASSWORD` matches. E2E is not run in CI | Brittle test; credential literal in code | Open |
| TD-018 | Backend CI and Docker image use Node 20 (no longer receiving security updates); backend Vitest is ^5 while the frontend workflow notes Vitest 5 needs Node 22+. `actions/checkout@v4`, `setup-node@v4` need updating. CI outcome not verified in this pass | Possible CI failure; outdated runtime | Open |
| TD-019 | No idempotency keys on write endpoints; pagination only on `/reports/inventory`; other lists unbounded or `limit`-capped | Retried POSTs double-post; large lists | Open |
| TD-020 | `prisma/schema.prisma` comments say the schema is "derived from" the docs and that `inventory_balances` is "never written by application code" / refreshed by a trigger — the code upserts it and there is no trigger | Misleading in-code documentation | Open |
| TD-021 | `task_context.md` (repository root) says "Phase 1 … is next"; phases 1–3 are implemented per git history | Stale orientation doc (outside docs tree) | Open |
| TD-022 | The `afrinov-docs/docs` tree predated phases 0–3: claims about PO states, API list, roles, module layout, frontend structure and processes were outdated. Corrected in the 2026-10-09 reconciliation; see `00-governance/change-log.md` | Docs could not be trusted | Resolved 2026-10-09 (pending review) |
| TD-023 | Untested: `src/modules/inventory/material.service.ts`, `src/modules/audit/audit.routes.ts`, supplier creation rules (duplicate name); stock counts only by integration tests | Critical paths without fast tests | Open |
| TD-024 | `projects.status` is free text; allowed values exist only in `src/modules/operations/project.service.ts:14-20`, with no transition rules | Invalid values possible via direct SQL | Open |
| TD-025 | Dashboard tile notes hard-code "below 20%/40% of required" (`apps/frontend/src/pages/Dashboard.tsx:61-62`) although the bands are settings | UI text wrong after a settings change | Open |

Log here rather than silently deferring — this register is reviewed at each
milestone gate (`01-product/product-roadmap.md`).
