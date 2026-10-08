# Archived reports

These are point-in-time audits, reports and plans written between 2026-09-17
and 2026-10-06. They describe the code as it was then. Several are now wrong:
for example `CURRENT-STATE.md` says the repository has no commits and no CI,
and several documents describe a purchase-order shipping stage that no longer
exists.

Kept for history only. For the current picture, read:

- `../../task_context.md` — orientation, layout and how to run the platform
- `../../workbook-replacement-roadmap.md` — the plan and what is done
- `../../decision-log.md` — architecture decisions (ADR-001 onwards)
- `../../afrinov-platform/apps/backend/README.md` — backend setup, scripts and API

Archived 2026-10-08 (Phase 0, step 8 of the roadmap).

| File | Originally in | What it was | Superseded by |
| --- | --- | --- | --- |
| `Production Readiness & Deployment Audit.md` | repo root | Production readiness and deployment audit | Roadmap Phase 4 |
| `System-Inspection.md` | repo root | System inspection of the platform | `task_context.md` |
| `frontend_vulnerability_and_static_analysis_report.md` | repo root | Frontend vulnerability and static analysis scan | Frontend CI (`.github/workflows/frontend-ci.yml`) |
| `AUDITOR_PERFORMANCE_REPORT.md` | `afrinov-platform/` | Performance and resource-efficiency audit | — |
| `CURRENT-STATE.md` | `afrinov-platform/` | Current-state baseline before changes | `task_context.md`, roadmap |
| `DARK_MODE_IMPLEMENTATION_REPORT.md` | `afrinov-platform/` | Dark mode implementation report | — |
| `DASHBOARD_IMPLEMENTATION_REPORT.md` | `afrinov-platform/` | Dashboard and frontend performance implementation report | — |
| `IMPLEMENTATION_REPORT.md` | `afrinov-platform/` | Executive summary delivered with the first build | `afrinov-platform/README.md` |
| `PERFORMANCE_AUDIT_REPORT.md` | `afrinov-platform/` | Performance and bottleneck audit | — |
| `PRODUCTION_READINESS_REPORT.md` | `afrinov-platform/` | Production readiness audit | Roadmap Phase 4 |
| `backend_vulnerability_and_static_analysis_report.md` | `afrinov-platform/` | Backend vulnerability and static analysis audit | Backend CI |
| `backend_vulnerability_and_static_analysis_remediation_report.md` | `afrinov-platform/` | Remediation of the backend audit | Backend CI |
| `architecture-audit.md` | `afrinov-platform/docs/engineering/` | Architecture audit | `decision-log.md` |
| `audit-production-readiness-2026-09-22.md` | `afrinov-platform/docs/engineering/` | Production readiness findings and remediation | Roadmap Phase 4 |
| `codebase-map.md` | `afrinov-platform/docs/engineering/` | Map of the codebase | `task_context.md`, backend README |
| `domain-gap-analysis.md` | `afrinov-platform/docs/engineering/` | Gap analysis against a target inventory domain | Roadmap |
| `engineering-decision-log.md` | `afrinov-platform/docs/engineering/decision-log.md` | Code-level decisions (its ADR-005 to ADR-007 are not the root log's ADR-005 to ADR-007) | `decision-log.md` |
| `inventory-operations-refactoring-plan.md` | `afrinov-platform/docs/engineering/` | Refactoring plan for inventory operations | Roadmap |
| `refactoring-plan.md` | `afrinov-platform/docs/engineering/` | General refactoring plan | Roadmap |
| `requirements-model.md` | `afrinov-platform/docs/engineering/` | Requirements model | `afrinov-docs/docs/02-business-analysis/` |
| `technical-debt.md` | `afrinov-platform/docs/engineering/` | Technical debt register (2026-09-17) | Roadmap follow-ups |
| `testing-strategy.md` | `afrinov-platform/docs/engineering/` | Testing strategy (2026-09-17, before integration tests and CI) | Backend README, CI workflows |
| `FRONTEND_AUDIT_REPORT.md` | `afrinov-platform/apps/frontend/` | Frontend audit and remediation | Frontend CI |
| `SIDEBAR_SHELL_AUDIT.md` | `afrinov-platform/apps/frontend/` | Sidebar and application shell audit | — |
