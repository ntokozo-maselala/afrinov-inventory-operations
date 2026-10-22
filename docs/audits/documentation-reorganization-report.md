# Documentation reorganization report

**Date:** 2026-10-22  
**Repository baseline:** `bc59b6a`  
**Scope:** Documentation governance and path organization only.

## Executive summary

The repository contained 168 Markdown documents in scope. The existing
numbered reference tree under `afrinov-docs/docs/` is established and already
separates frontend, API, data, architecture, security, testing, operations,
project management, and validation. It was retained. Eight audit reports were
grouped under `docs/audits/`, and three specialist implementation roadmaps
were grouped under `afrinov-docs/docs/13-project-management/roadmaps/`.

The work moved 11 documents and retained 157 at their existing paths. No
documents were renamed, consolidated, deleted, or newly archived. Three
navigation and governance documents were added: `docs/README.md`, the
documentation inventory, and this report. Application source, tests,
migrations, schemas, dependencies, and runtime configuration were not changed.

## Areas inspected

- Repository root, Git status, README entry points, and the root-level audit,
  roadmap, and orientation documents.
- The `afrinov-docs/docs/` reference tree, its documentation guide, index,
  category files, status metadata, and known root-level compatibility stubs.
- `docs/archive/` and its archive index.
- Platform and app README files, package manifests, Prisma schema and migration
  directory layout, migration-adjacent READMEs, and the backend OpenAPI source
  and test locations.
- GitHub Actions workflow files and the Dockerfile/Compose service layout,
  build context, startup command, ports, and database volume. The application
  runtime configuration was not changed.

Generated output, dependency trees, caches, coverage, and `.git` were excluded
from the documentation inventory. The IDE-visible `apps/backend/dist/` files
are generated output and were not treated as documentation sources.

## Inventory totals

| Measure | Count |
|---|---:|
| Existing documents discovered before changes | 168 |
| Existing documents after reorganization | 168 |
| Moved | 11 |
| Retained at the same path | 157 |
| Renamed | 0 |
| Consolidated or deleted | 0 |
| Newly archived | 0 |
| Existing archived records retained unchanged | 25 |
| New documentation index and audit deliverables | 3 |
| Final in-scope Markdown documents, including new deliverables | 171 |

The full original-path inventory, classification, status/evidence metadata,
disposition, and rationale are in
[`documentation-inventory.md`](documentation-inventory.md).

## Path changes

Eight audit reports moved into component-specific audit folders:

| Original path | Final path |
|---|---|
| `backend-audit.md` | `docs/audits/backend/backend-audit.md` |
| `ROOT_CAUSE_ANALYSIS.md` | `docs/audits/backend/ROOT_CAUSE_ANALYSIS.md` |
| `build-errors.md` | `docs/audits/frontend/build-errors.md` |
| `docs/theme-default-audit.md` | `docs/audits/frontend/theme-default-audit.md` |
| `CODEBASE_AUDIT_REPORT.md` | `docs/audits/system/CODEBASE_AUDIT_REPORT.md` |
| `FAILURE_REGISTER.md` | `docs/audits/system/FAILURE_REGISTER.md` |
| `RECOVERY_PLAN.md` | `docs/audits/system/RECOVERY_PLAN.md` |
| `VERIFICATION_REPORT.md` | `docs/audits/system/VERIFICATION_REPORT.md` |

Three specialist roadmaps moved into project management:

| Original path | Final path |
|---|---|
| `materials-sections-roadmap.md` | `afrinov-docs/docs/13-project-management/roadmaps/materials-sections-roadmap.md` |
| `procurement-alignment-roadmap.md` | `afrinov-docs/docs/13-project-management/roadmaps/procurement-alignment-roadmap.md` |
| `procurement-workflow-roadmap.md` | `afrinov-docs/docs/13-project-management/roadmaps/procurement-workflow-roadmap.md` |

The main `workbook-replacement-roadmap.md` remains at the repository root as
the primary delivery entry point. The root `decision-log.md`, `gap-analysis.md`,
and `sap-lessons-for-afrinov.md` remain as compatibility pointers to their
canonical documents. The 25 documents under `docs/archive/` remain in place.

## Documentation navigation and ownership

`docs/README.md` is now the repository-wide navigation entry point. It
identifies frontend (`09-frontend`), backend API (`08-api`), and database/data
(`07-data`) ownership, then points to cross-cutting architecture, security,
testing, infrastructure/operations, project, validation, and audit references.
The existing `afrinov-docs/docs/README.md` remains the detailed index for that
reference tree and links back to the repository-wide index.

The backend README and OpenAPI TypeScript source/test remain beside the backend
implementation. Prisma schema, executable migrations, and the two
migration-specific READMEs remain under the backend Prisma tree. No OpenAPI
artifact consumed by tooling or executable database artifact was moved.

## Duplicates, overlap, and historical records

- The three root-level decision/gap/SAP files are short pointers to maintained
  copies, not duplicate report bodies. They were retained for compatibility.
- The archive contains older point-in-time assessments and plans. Its README
  identifies historical documents and known superseded material; none were
  deleted or merged into current references.
- API authentication/authorization and system security documents cover
  different scopes. Deployment architecture and deployment procedure are also
  distinct. These documents were kept separate; no content consolidation was
  performed.

## Documentation quality findings

- Corrected the initial migration README to name the actual
  `20260101000001_location_management` directory (it previously said
  `20260101000000_location_management`).
- The detailed documentation index records a full code reconciliation at
  `4e6d76f` on 2026-10-09, while the checkout baseline is `bc59b6a`. Treat the
  recorded verification date as a historical baseline and recheck claims as
  their owning areas change.
- The 2026-10-21 system audit records a commit different from the current
  checkout. It remains a dated assessment; applicability to the current code
  should be confirmed before relying on its findings as current.
- The procurement and materials roadmaps record status in phase tables or
  body text rather than a common status header. Their owners should refresh
  those statuses on the next roadmap update.

## References updated outside `docs/`

- Root `README.md` now links to the repository-wide documentation index and
  the relocated specialist roadmaps.
- `afrinov-docs/docs/README.md` links to the top-level index and describes the
  project-management roadmap location and the date of its last full code
  reconciliation.
- `afrinov-docs/docs/00-governance/documentation-guide.md` points to the
  repository-wide index and the specialist roadmap directory.
- `afrinov-docs/docs/01-product/product-roadmap.md` links to the new roadmap
  paths; `workbook-replacement-roadmap.md` names those paths.
- `afrinov-docs/docs/00-governance/change-log.md` records the documentation
  reorganization as a meaningful repository-maintenance revision.
- The migration-specific README correction is in the backend Prisma tree.

## Validation

- Initial Git working tree was clean at `bc59b6a`.
- `rg --files -g '*.md'` with exclusions for generated output, dependencies,
  caches, and version-control internals found 168 original documents and 171
  Markdown documents after adding the three governance documents. Every
  original document has a disposition in the inventory.
- The PowerShell local-link scan for Markdown destinations (`]\((<[^>]+>|[^)]*)\)`)
  checked 25 relative links before the moves and 55 across the final set; both
  scans found zero missing targets. External URLs and heading anchors were
  not network-validated.
- `git diff --check` completed with exit code 0.
- For each of the 11 moved files, `git rev-parse HEAD:<original>` matched
  `git hash-object <destination>`, confirming the move preserved its contents.
- Final `git status --short` and the tracked-file diff were reviewed. Changes
  are limited to documentation paths/content and the migration README typo.
  No application source, tests, executable migration SQL, Prisma schema, or
  runtime configuration changes were made.
- Application tests and type checks were not run because the changes are
  documentation-only. No dependencies were added.

## Limitations and follow-up

- Status and code-verification markers were inventoried, not treated as proof
  of current accuracy. Reverify technical references against their owning
  implementation before using them as current operational instructions.
- External links, deployment behavior, and production procedures were not
  network- or environment-validated.
- Confirm the applicability of the 2026-10-21 system audit to the current
  checkout and refresh phase statuses in the moved implementation roadmaps
  when their owners next review them.
