<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-GEN-001</b></td>
<td align="center"><b><i>Afrinov Inventory &amp; Operations Platform</i></b><br><i>Repository Overview</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-GEN-001 updated=2026-11-26 by="Ntokozo Maselala" body=69f380a6e00c -->

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

- [Documentation index](docs/README.md) — repository-wide navigation and
  documentation maintenance guidance.
- [`afrinov-docs/docs/`](afrinov-docs/docs/README.md) — detailed product,
  domain, process, data, architecture, API, security, testing and operations
  references. Its recorded full code reconciliation is dated 2026-10-09.
- [Gap analysis](afrinov-docs/docs/02-business-analysis/gap-analysis.md) and
  [SAP lessons](afrinov-docs/docs/05-sap-study/sap-lessons-for-afrinov.md) —
  early analysis (the root-level copies now point there).
- [Project roadmaps](afrinov-docs/docs/13-project-management/roadmaps/) —
  materials and procurement implementation plans.
- [`docs/archive/`](docs/archive/README.md) — earlier audits and reports, kept
  for history.
