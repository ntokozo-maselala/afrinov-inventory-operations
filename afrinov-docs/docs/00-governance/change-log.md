# Documentation Change Log

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Date | Document(s) | Change | Author |
|---|---|---|---|
| 2026-09-01 | All (`00`–`14`) | Initial documentation set created from AS-IS analysis of `07__July_2026_Report.xlsm` and product-scope discussion with business owner | Engineering |
| 2026-10-09 | `00-governance/assumptions-register.md` | Extended: A-10 to A-20 for claims that cannot be verified in the repository | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `00-governance/change-log.md` | This set of entries | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `00-governance/decision-log.md` | Extended: merged ADR-005 to ADR-008 from the root copy; added ADR-009 to ADR-017 marked Inferred from code | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `00-governance/documentation-guide.md` | Annotated: status line, evidence and Planned/Unverified conventions; related material outside the tree | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `00-governance/glossary.md` | Extended: Recipient, Return, Reversal, Counter receipt, Stock count, Stock status, Opening balance, Month-end report; corrected Issued To and transaction types | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/capability-map.md` | Annotated: implementation status column | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/product-charter.md` | Annotated: procurement off by default, import built, Tools not imported | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/product-principles.md` | Annotated: corrections by reversal (ADR-005); audit gaps | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/product-roadmap.md` | Annotated: status per milestone; pointer to the root roadmap | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/product-scope.md` | Annotated: tools Planned, projects built as a master, procurement off by default | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/product-vision.md` | Status line only | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/stakeholder-map.md` | Status line; marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/user-journeys.md` | Annotated: recipients, no SENT status, tool journey Planned, month-end | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `01-product/user-personas.md` | Annotated: merge tooling Planned; marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/business-context.md` | Status line; marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/business-process-model.md` | Extended: implemented sub-processes (count, return, reversal, counter receipt, month-end); tools Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/business-requirements.md` | Annotated: implementation status per BR | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/business-rules.md` | Annotated: "Implemented as" column; the no-negative rule has no override | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/current-state-as-is.md` | Marked Unverified; workbook name and category count conflict (A-10) | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/functional-requirements.md` | Annotated: status per FR (FR-INV-007 uses % bands; FR-INV-008 Planned) | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/gap-analysis.md` | Annotated: status column; 07-data link target now exists | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/non-functional-requirements.md` | Annotated: idempotency Planned, audit immutability not enforced | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/requirements-traceability-matrix.md` | Corrected: added API, code and status columns | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `02-business-analysis/target-state-to-be.md` | Annotated: status column; recipients | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `03-domain/aggregate-model.md` | Corrected: goods receipts update the PO directly in one transaction; added aggregates | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `03-domain/bounded-contexts.md` | Corrected: Project is a master record; recipients; cross-context table access | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `03-domain/business-transactions.md` | Corrected and extended: every transaction mapped to its API or marked Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `03-domain/domain-events.md` | Corrected: events dispatched with no handlers; four declared, never dispatched | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `03-domain/domain-model.md` | Corrected: six transaction types, Recipient, Rack, reversal link; Tool Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `03-domain/domain-overview.md` | Corrected: module mapping and status | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `03-domain/entity-catalog.md` | Corrected and extended: attributes and lifecycles from the schema; Rack, Recipient, User; Tool Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `03-domain/state-machines.md` | Corrected: 7-state PO lifecycle (ADR-007), goods receipt states, reversal rules; Tool Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `04-processes/goods-receiving.md` | Corrected: counter receipt and PO receipt flows traced to code | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `04-processes/procure-to-stock.md` | Corrected: status-band trigger, PO states, procurement off by default | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `04-processes/purchase-order-lifecycle.md` | Corrected: states and steps per ADR-007; over-receipt override not built | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `04-processes/reporting-and-controls.md` | Extended: stock status, consumption, month-end, exports; Bottom-N Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `04-processes/stock-adjustment.md` | Extended: stock count and reversal flows | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `04-processes/stock-issuing.md` | Corrected: recipient required, no override, returns; tool check-out Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `04-processes/stock-transfer.md` | Corrected: legs linked by paired_with_id | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `04-processes/supplier-management.md` | Annotated: update/deactivate Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-business-processes.md` | Annotated: six transaction types in code | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-document-flow.md` | Annotated: polymorphic reference, not a foreign key | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-inventory-model.md` | Annotated: six transaction types in code | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-lessons-for-afrinov.md` | Annotated: six transaction types in code | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-not-to-copy.md` | Annotated: transaction types; currency setting | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-organizational-model.md` | Status line only | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-procurement-model.md` | Status line only | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-study-plan.md` | Status line; 07-data link now resolves | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `05-sap-study/sap-terminology.md` | Status line only | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/architecture-overview.md` | Corrected: actual modules and layers (no domain or repository layer) | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/architecture-principles.md` | Annotated: status per principle | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/component-architecture.md` | Corrected: replaced the hypothetical folder tree with the real inventory module | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/data-architecture.md` | Corrected: balances are a recomputed table; data classes from the schema | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/deployment-architecture.md` | Corrected: Docker/compose as built; CD and staging Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/integration-architecture.md` | Corrected: direct cross-module calls; file exports and workbook import | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/module-architecture.md` | Corrected: real module tree; boundary violations table | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/observability-architecture.md` | Corrected: request logging and health checks; metrics Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/security-architecture.md` | Corrected: JWT, per-route checks, audit gaps, HTTP hardening | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `06-system-architecture/system-context.md` | Extended: SPA, procurement flag, workbook import, exports | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `07-data/audit-model.md` | Created: ledger and audit log, what is and is not audited | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `07-data/database-schema.md` | Created: tables, enums, constraints and indexes from schema.prisma and the migrations | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `07-data/migration-strategy.md` | Created: Prisma migration history and the workbook import (dry run, apply, reconcile) | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `08-api/api-architecture.md` | Corrected: real endpoint list; tools and roles endpoints Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `08-api/api-conventions.md` | Corrected: camelCase filters, limit/page paging, decimals as strings | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `08-api/api-principles.md` | Annotated: idempotency Planned; paging partial | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `08-api/api-versioning.md` | Added evidence | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `08-api/authentication.md` | Extended: JWT details, database active check, rate limit; refresh and revocation Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `08-api/authorization.md` | Corrected: role table from permissions.ts; unused permissions | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `08-api/error-model.md` | Corrected: INVALID_STATE, TOO_MANY_REQUESTS; actual message format | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `08-api/resource-model.md` | Corrected: every route with method and permission | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `09-frontend/accessibility.md` | Annotated: evidence per requirement | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `09-frontend/design-system.md` | Corrected: replaced the pointer to a non-existent skill with the real tokens and components | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `09-frontend/frontend-architecture.md` | Corrected: real folder structure and data-fetching approach | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `09-frontend/information-architecture.md` | Corrected: real sidebar groups and routes | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `09-frontend/interaction-model.md` | Annotated: implemented interactions; near-duplicate prompt Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `09-frontend/navigation-model.md` | Corrected: real navigation model | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `09-frontend/page-inventory.md` | Corrected: every route with purpose and API | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `10-security/access-control.md` | Corrected: per-route checks; reads open to any signed-in user | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `10-security/audit-and-accountability.md` | Corrected: audit gaps; immutability not enforced in the database | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `10-security/authentication-model.md` | Corrected: intended vs implemented table | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `10-security/authorization-model.md` | Corrected: permission loading and code-defined roles | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `10-security/secrets-management.md` | Extended: secret variables and their handling | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `10-security/security-requirements.md` | Annotated: status per requirement | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `10-security/security-testing.md` | Corrected: existing security tests; dependency scanning Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `10-security/threat-model.md` | Corrected: status per mitigation; no database grants | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/acceptance-testing.md` | Annotated: automated test per scenario | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/api-testing.md` | Annotated: existing route tests | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/contract-testing.md` | Corrected: OpenAPI route-match test; response contracts Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/e2e-testing.md` | Corrected: one login E2E test; journeys Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/integration-testing.md` | Extended: suite list | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/performance-testing.md` | Labelled Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/test-pyramid.md` | Extended: actual test counts | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/test-traceability.md` | Corrected: requirement to code to test links | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/testing-strategy.md` | Extended: layers as implemented; invariant helper | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `11-testing/unit-testing.md` | Corrected: unit tests use Prisma fakes; untested files | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/alerting.md` | Labelled Planned; in-product business alerts | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/backup-and-recovery.md` | Labelled Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/ci-cd.md` | Corrected: real CI jobs; CD Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/deployment.md` | Corrected: compose start sequence; rollback limits | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/disaster-recovery.md` | Labelled Planned; RPO/RTO Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/environments.md` | Corrected: local, frontend-only and CI evidenced; staging and production Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/incident-management.md` | Annotated: available checks; data-quality link retargeted to migration-strategy | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/logging.md` | Corrected: request logs; per-event logs Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `12-operations/monitoring.md` | Corrected: health checks only; metrics Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/branching-strategy.md` | Annotated: branch naming as practised | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/coding-standards.md` | Corrected: enforcement and current state per standard | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/definition-of-done.md` | Status line; marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/definition-of-ready.md` | Status line; marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/development-workflow.md` | Status line; marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/pull-request-guidelines.md` | Status line; marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/release-process.md` | Labelled Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/technical-debt.md` | Extended: TD-004 to TD-025 (code/doc disagreements and code issues) | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `13-project-management/onboarding.md` | Created: developer onboarding — prerequisites, setup, run, flags, lint/typecheck/test/build, integration and E2E tests, deploy, troubleshooting | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `14-validation/acceptance-criteria.md` | Annotated: status at 4e6d76f | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `14-validation/production-readiness.md` | Annotated; 07-data link now resolves | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `14-validation/prototype-validation.md` | Marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `14-validation/readiness-checklist.md` | Annotated: evidence per item (no boxes ticked) | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `14-validation/stakeholder-review.md` | Marked Unverified | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `14-validation/uat-plan.md` | Marked Unverified/Planned | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `README.md` | Corrected: ADR range, grounding note, 07-data index | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `README.md` (repository root) | Links to the tree decision log, gap analysis and SAP lessons | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `decision-log.md`, `gap-analysis.md`, `sap-lessons-for-afrinov.md` (repository root) | Replaced with pointers to the tree copies (approved 2026-10-09) | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `afrinov-platform/README.md` | Corrected: modules, tests, quick start; removed a default admin password the seed no longer uses | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `afrinov-platform/apps/backend/README.md` | Corrected: removed /auth/register and self-registration; endpoint table, module list, Node versions, REPORT_CURRENCY scope | Engineering (reconciliation against code at 4e6d76f) |
| 2026-10-09 | `afrinov-platform/apps/frontend/FRONTEND_ONLY.md` | Corrected: projects are emulated; auth file paths; mock seed contents | Engineering (reconciliation against code at 4e6d76f) |

Add one row per meaningful revision (not typo fixes). For architecture-level
changes, also add an ADR in `decision-log.md` and reference its ID here.
The 2026-10-09 rows record a reconciliation of every document with the code;
the new ADRs from it are ADR-009 to ADR-017 (marked Inferred from code), and
the disagreements found are TD-004 to TD-025 in
`13-project-management/technical-debt.md`.
