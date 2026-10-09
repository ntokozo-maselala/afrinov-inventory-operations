# Afrinov Inventory & Operations Platform

A multi-user platform to replace Afrinov's stock workbook: receiving and
issuing stock, locations and racks, projects, valuation and reports, with
every stock change recorded in a ledger that can be audited.

## Start here

- [Developer onboarding](afrinov-docs/docs/13-project-management/onboarding.md)
  — set up, run, lint, typecheck, test and deploy.
- [`task_context.md`](task_context.md) — orientation: layout, how to run it,
  key facts and known follow-ups.
- [`workbook-replacement-roadmap.md`](workbook-replacement-roadmap.md) — the
  plan for replacing the workbook, phase by phase, with what is done.
- [`afrinov-docs/docs/00-governance/decision-log.md`](afrinov-docs/docs/00-governance/decision-log.md)
  — architecture decisions (ADR-001 onwards).

## Code

- [`afrinov-platform/`](afrinov-platform/) — the monorepo
  ([README](afrinov-platform/README.md)).
- Backend setup, scripts and API:
  [`afrinov-platform/apps/backend/README.md`](afrinov-platform/apps/backend/README.md).

## Documentation

- [`afrinov-docs/docs/`](afrinov-docs/docs/README.md) — product, domain,
  processes, data, architecture, API, security, testing and operations.
  Reconciled with the code on 2026-10-09; each system document cites the
  files it relies on.
- [Gap analysis](afrinov-docs/docs/02-business-analysis/gap-analysis.md) and
  [SAP lessons](afrinov-docs/docs/05-sap-study/sap-lessons-for-afrinov.md) —
  early analysis (the root-level copies now point there).
- [`docs/archive/`](docs/archive/README.md) — earlier audits and reports, kept
  for history.
