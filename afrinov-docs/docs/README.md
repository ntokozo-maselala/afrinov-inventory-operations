# Afrinov Inventory & Operations Platform — Documentation

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

This is the full documentation set for moving Afrinov from a family of
`.xlsm` spreadsheets to a proper multi-user inventory & operations system,
per the direction to treat inventory as one piece of a larger business
system (studying SAP as a reference model) rather than a standalone app.

**Start here, in order:**

1. `00-governance/documentation-guide.md` — how this tree is organised.
2. `01-product/product-vision.md` and `product-scope.md` — why, and the
   boundary of what's being built.
3. `02-business-analysis/current-state-as-is.md` and `gap-analysis.md` —
   what's actually in the existing spreadsheets, and what's wrong with it.
4. `03-domain/bounded-contexts.md` — the "piece of the puzzle" architecture.
5. `05-sap-study/sap-lessons-for-afrinov.md` and `sap-not-to-copy.md` — what
   was learned from SAP and, just as importantly, what was deliberately
   rejected.
6. `00-governance/decision-log.md` — the key architecture decisions (ADR-001
   through ADR-017; ADR-009 onwards are inferred from the code and await
   confirmation) and why they were made.
7. `00-governance/assumptions-register.md` — everything that still needs
   confirmation from the business owner before this goes further.

**Grounding:** every document that references specific data (sheet names,
column names, row counts, example values like `AFRI-1325`, `Hydroscand`,
rack codes like `D-1`) was written by directly inspecting
`07__July_2026_Report.xlsm` — not invented. That workbook is not in the
repository; whether it matches the workbook the import reads is assumption
A-10. Where something is inferred rather than confirmed, it's flagged in
`00-governance/assumptions-register.md`.

**Code:** documents in `06`–`12` were reconciled with the code at commit
4e6d76f on 2026-10-09 and cite their evidence; intent documents (`01`,
`02`, `05`) carry implementation-status notes. The delivery plan now lives in
`workbook-replacement-roadmap.md` at the repository root.

**Next action:** review Milestone 0 (`01-product/product-roadmap.md`) with
the business owner — see `14-validation/stakeholder-review.md` for what
that review should cover. *Unverified:* whether that review has happened;
implementation has continued (Phases 0–3 of the root roadmap).

## Folder index
| Folder | Contents |
|---|---|
| `00-governance` | Documentation guide, decision log, assumptions, glossary, change log |
| `01-product` | Vision, charter, scope, principles, stakeholders, personas, journeys, capability map, roadmap |
| `02-business-analysis` | Business context, process model, AS-IS/TO-BE, rules, requirements, traceability, gap analysis |
| `03-domain` | Domain overview, bounded contexts, domain model, entity catalog, aggregates, events, state machines, transactions |
| `04-processes` | Procure-to-stock, receiving, issuing, transfer, adjustment, supplier mgmt, PO lifecycle, reporting |
| `05-sap-study` | Study plan, terminology, processes, inventory/procurement/document/org models, lessons, what NOT to copy |
| `06-system-architecture` | System context, architecture overview & principles, module/component/integration/data/security/observability/deployment architecture |
| `07-data` | Database schema, migration strategy (schema migrations and workbook import, incl. reconciliation), audit model |
| `08-api` | Principles, architecture, conventions, resource model, error model, auth, versioning |
| `09-frontend` | Frontend architecture, information architecture, navigation, page inventory, interaction model, design system, accessibility |
| `10-security` | Requirements, threat model, access control, authn/authz model, audit & accountability, secrets, security testing |
| `11-testing` | Strategy, pyramid, unit/integration/API/contract/E2E/acceptance/performance testing, traceability |
| `12-operations` | Environments, deployment, CI/CD, monitoring, logging, alerting, backup/DR, incident management |
| `13-project-management` | Developer onboarding (run, test, deploy), workflow, branching, coding standards, PR guidelines, DoR/DoD, release process, tech debt |
| `14-validation` | Prototype validation, stakeholder review, UAT plan, acceptance criteria, readiness checklist, production readiness |
