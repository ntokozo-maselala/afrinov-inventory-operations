# Documentation Guide

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Purpose
This `docs/` tree is the single source of truth for the Afrinov Inventory &
Operations Platform: why it exists, what it must do, how it is modelled, and
how it is built and run. It exists because the current system (a set of
`.xlsm` workbooks — see `02-business-analysis/current-state-as-is.md`) has no
equivalent record: business rules live in cell formulas, tribal knowledge,
and rack labels, and are not written down anywhere.

## Structure
| Folder | Answers |
|---|---|
| `00-governance` | How is this documentation itself managed? |
| `01-product` | Why are we building this, for whom? |
| `02-business-analysis` | What does the business need, today and going forward? |
| `03-domain` | What are the core concepts and how do they relate? |
| `04-processes` | How does work actually flow end to end? |
| `05-sap-study` | What can a mature ERP teach us, and what should we ignore? |
| `06-system-architecture` | How is the software structured? |
| `07-data` | How is data modelled, stored, and governed? |
| `08-api` | How do clients talk to the system? |
| `09-frontend` | How is the UI organised? |
| `10-security` | How do we protect data, access, and integrity? |
| `11-testing` | How do we know it works? |
| `12-operations` | How do we run it in production? |
| `13-project-management` | How do we build it, day to day? |
| `14-validation` | How do we know it's ready, and who signs off? |

## Status convention
Every document starts with a status line:
`DRAFT` (being written) → `IN REVIEW` (circulated for feedback) →
`APPROVED` (signed off, drives implementation) → `SUPERSEDED` (replaced by a
newer document, kept for history) → `ARCHIVED` (no longer relevant).

The status line also names the **Owner** and, for any document checked
against the code, `Last verified against code: <commit>, <date>`. Documents
that describe the system (`06`–`12`) carry an **Evidence** section listing
the files they rely on. Claims that cannot be checked in the repository are
marked *Unverified* and listed in `assumptions-register.md`; capabilities
described but not built are marked **Planned**.

## Ownership and review
- Each document has a named **Owner** who is accountable for it staying accurate.
- Architecture and domain documents (`03`–`08`) should be reviewed whenever a
  new business process is discovered that doesn't fit the existing model —
  that's a signal the model is wrong or incomplete, not that the process is.
- Documents in `02-business-analysis` should be re-validated with the business
  owner (currently: your boss) before `06-system-architecture` is finalised.
- Documents that describe the system (`06`–`12`) are re-verified against the
  code when the code changes; intent documents (`01`, `02`, `05`) keep their
  intent and carry implementation-status notes.

## Source of truth rule
If code and documentation disagree, that is a defect in one of them — file it
in `13-project-management/technical-debt.md` rather than silently trusting
either. The spreadsheets remain the authoritative record of current stock
until the migration in `07-data/migration-strategy.md` is signed off.

## Related material outside this tree
- `workbook-replacement-roadmap.md` (repository root) — the live delivery
  plan, phase by phase.
- `afrinov-platform/apps/backend/README.md` — running the backend, scripts,
  environment variables.
- `docs/archive/` (repository root) — earlier audits and reports, kept for
  history and not maintained.
