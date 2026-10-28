# Documentation index

This is the repository-wide starting point for Afrinov documentation. The
business and technical reference set remains in [`afrinov-docs/docs/`](../afrinov-docs/docs/README.md);
this page points to its component and cross-cutting sections, repository
audits, project entry points, and code-adjacent guides.

## Component ownership

| Area | Documentation | Implementation reference |
|---|---|---|
| Frontend | [`09-frontend`](../afrinov-docs/docs/09-frontend/) | [`Frontend-only development guide`](../afrinov-platform/apps/frontend/FRONTEND_ONLY.md) |
| Backend and API | [`08-api`](../afrinov-docs/docs/08-api/) | [`Backend README`](../afrinov-platform/apps/backend/README.md); [current architecture, configuration, operations, and audit reference](backend/README.md); the OpenAPI document and its test are in `afrinov-platform/apps/backend/src/openapi/` |
| Database | [`07-data`](../afrinov-docs/docs/07-data/) | Prisma schema and executable migrations are in `afrinov-platform/apps/backend/prisma/`; migration-specific notes stay beside their migrations |

## Cross-cutting references

- **Architecture:** [`06-system-architecture`](../afrinov-docs/docs/06-system-architecture/), with decisions in [`decision-log.md`](../afrinov-docs/docs/00-governance/decision-log.md).
- **Security:** [`10-security`](../afrinov-docs/docs/10-security/).
- **Testing and quality:** [`11-testing`](../afrinov-docs/docs/11-testing/) and the CI workflows in `.github/workflows/`.
- **Engineering assurance:** [`docs/engineering/`](engineering/README.md) — the verification controls, quality gates, security controls, database assurance, CI/CD architecture, risk register, exceptions, and roadmap that govern this repository. Start there to understand how a change is verified before it merges.
- **Infrastructure:** environment, deployment, and CI/CD references in [`12-operations`](../afrinov-docs/docs/12-operations/).
- **Operations:** monitoring, logging, alerting, backup and recovery, and incident management in [`12-operations`](../afrinov-docs/docs/12-operations/).

## Product, project, and validation

- Product, business analysis, domain, processes, and SAP study are indexed in
  the [detailed documentation index](../afrinov-docs/docs/README.md).
- Project governance and delivery guidance is in
  [`13-project-management`](../afrinov-docs/docs/13-project-management/),
  including specialist roadmaps in its `roadmaps/` subdirectory.
- Current specialist plans: [materials sections](../afrinov-docs/docs/13-project-management/roadmaps/materials-sections-roadmap.md),
  [procurement alignment](../afrinov-docs/docs/13-project-management/roadmaps/procurement-alignment-roadmap.md),
  and [procurement workflow](../afrinov-docs/docs/13-project-management/roadmaps/procurement-workflow-roadmap.md).
- UAT, acceptance, stakeholder review, and readiness records are in
  [`14-validation`](../afrinov-docs/docs/14-validation/).
- Repository orientation and the main workbook replacement plan remain at
  [`task_context.md`](../task_context.md) and
  [`workbook-replacement-roadmap.md`](../workbook-replacement-roadmap.md).

## Audits and history

- Current and point-in-time audit deliverables are grouped under
  [`docs/audits/`](audits/): backend, frontend, and system reports. The
  [documentation inventory](audits/documentation-inventory.md) records each
  original document's disposition; the
  [reorganization report](audits/documentation-reorganization-report.md)
  records changes and validation.
- Earlier reports retained for historical context are in
  [`docs/archive/`](archive/README.md). Archived reports describe their
  original point in time and are not current technical references.

## Adding or updating documentation

Classify a document by its primary purpose and component owner. Keep one
canonical copy and link to it from other areas. Keep executable schemas,
migrations, API generation sources, and tests beside the code and tooling that
consume them. Store dated audit findings under `docs/audits/`; move superseded
historical reports to `docs/archive/` only when their historical value is
clear. Update this index and relevant local indexes when paths change. Use
relative Markdown links and verify them after moving a document. Do not add
secrets, generated build output, or dependency documentation to this tree.
