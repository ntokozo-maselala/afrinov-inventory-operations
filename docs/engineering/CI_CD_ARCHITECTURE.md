<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-ENG-002</b></td>
<td align="center"><b><i>CI/CD architecture</i></b><br><i>Engineering Assurance</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-ENG-002 updated=2026-11-27 by="Ntokozo Maselala" body=3167daa174e0 -->

# CI/CD architecture

How changes are verified, from a push to the merge of a reviewed commit. The
existing platform (GitHub Actions) is reused; no new CI system was introduced.

## Workflows

| Workflow | File | Trigger | Jobs |
|---|---|---|---|
| Backend CI | `.github/workflows/backend-ci.yml` | PR and push to `main`, on backend/root paths | `checks` (typecheck, lint, unit tests, build), `migration-drift`, `integration` (real PostgreSQL) |
| Frontend CI | `.github/workflows/frontend-ci.yml` | PR and push to `main`, on frontend, backend and root paths | `checks` (typecheck, lint, unit tests, build), `e2e` (Playwright in Chromium against the real backend and a throwaway PostgreSQL; system audit H5) |
| Security CI | `.github/workflows/security-ci.yml` | Every PR and push to `main`; weekly schedule | `dependency-audit`, `secret-scan` |
| CodeQL | `.github/workflows/codeql.yml` | PR and push to `main`; weekly schedule | `analyze` (`javascript-typescript`, `actions`) |
| Docs CI | `.github/workflows/docs-ci.yml` | Every PR and push to `main` | `document-control` (the tool's tests, every document's Afrinov header current, relative links listed) |

## Staging model

The workstream maps onto the staged pipeline model as follows.

- **Stage A — change validation.** Every relevant push/PR runs install,
  typecheck, lint, unit tests, and build. These are fast, deterministic, and
  run first.
- **Stage B — pull request assurance.** Before merge: the Stage A checks plus
  integration tests against a real PostgreSQL service, the browser tests
  (`frontend-ci.yml` `e2e`), migration apply and drift detection, the production dependency audit, the secret scan, and CodeQL. All
  are required checks (see "Branch protection" below).
- **Stage C — main-branch verification.** The same workflows re-run on `push`
  to `main`, so the merged commit is verified, not just the PR head.
- **Stages D–F — staging, production, post-deployment.** **Not implemented.**
  There is no deployment workflow, no staging environment, and no artifact
  registry in this repository. These are recorded as OPS-01 and are the reason
  the system is not claimed to be production-ready. See
  `IMPLEMENTATION_ROADMAP.md` for what each would require.

## Design choices

- **Reuse the existing platform.** GitHub Actions is already in place and
  adequate. Introducing another CI system would add cost without adding control.
- **Security checks are repo-wide, not path-filtered.** `security-ci.yml` runs
  on every PR regardless of which paths changed, because a secret or a
  vulnerable lockfile can enter from anywhere. The backend/frontend path filters
  are kept for the language-specific jobs to avoid needless work.
- **A weekly schedule on security jobs.** A new advisory or a new CodeQL query
  should fail even when no code changed.
- **Least privilege.** Every workflow declares `permissions: contents: read`;
  CodeQL adds only `security-events: write` and `packages: read`.
- **Pinned actions.** Every `uses:` reference is a commit SHA with the tag in a
  comment, so an upstream tag move cannot change what runs.
- **Deterministic integration environment.** The integration and drift jobs use
  a real `postgres:16-alpine` service with a throwaway database and per-run
  generated secrets, matching what the production container runs on start.

## Branch protection (configuration, not code)

The workflows above become enforcing gates only when branch protection requires
them. This is a repository setting, not something a commit can guarantee.

**In force since 2026-11-27** (GATE-02), read back with
`gh api repos/ntokozo-maselala/afrinov-inventory-operations/branches/main/protection`:

| Setting | Value |
|---|---|
| Pull request before merging | Required; 0 approving reviews (one maintainer: an author can't approve their own pull request); stale approvals dismissed |
| Required checks (GitHub Actions app only) | `Dependency security audit (production)`, `Secret scanning`, `No spreadsheets in the tree` (Security CI); `Document control` (Docs CI); `Analyze (javascript-typescript)`, `Analyze (actions)` (CodeQL) |
| Branch up to date before merging | Required |
| Applies to administrators | Yes |
| Force pushes, deletion | Blocked |

These six run on every pull request. **Not yet required:** Backend CI
(`Typecheck, lint, unit tests, build`, `Migration drift and database integrity`,
`Integration tests (real Postgres)`) and Frontend CI (`Typecheck, lint, unit
tests, build`, `Browser tests (Playwright, real backend)`). Two things stop them:

- Their `paths:` filters are on the workflow, so a pull request outside those
  paths (any documentation change) gets no check at all, and a required check
  that never reports blocks the merge.
- Both workflows call their first job `Typecheck, lint, unit tests, build`, and a
  required check is matched by name.

To require them: give each job a distinct name, and make each workflow run on
every pull request, deciding inside it whether there is anything to do (a job
that skips still reports success). Then add the five checks here.

The target, once those exist, is all eleven checks above. With a second
maintainer, require one approving review as well. For changes touching authentication, authorization, migrations,
or the ledger, an independent reviewer who did not author the change should be
required. A `CODEOWNERS` file is the mechanism to route those paths to the right
reviewers; it is recommended but not added here because the owning teams are not
identified in this repository.

## What the pipeline does not do

- It does not deploy. There is no deployment target configured.
- It does not publish artifacts or an SBOM. There is no registry to publish to.
- It does not run DAST. There is no running environment to scan.
- It does not enforce a coverage threshold. See `QUALITY_GATES.md` for why.
