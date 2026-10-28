# CI/CD architecture

How changes are verified, from a push to the merge of a reviewed commit. The
existing platform (GitHub Actions) is reused; no new CI system was introduced.

## Workflows

| Workflow | File | Trigger | Jobs |
|---|---|---|---|
| Backend CI | `.github/workflows/backend-ci.yml` | PR and push to `main`, on backend/root paths | `checks` (typecheck, lint, unit tests, build), `migration-drift`, `integration` (real PostgreSQL) |
| Frontend CI | `.github/workflows/frontend-ci.yml` | PR and push to `main`, on frontend/root paths | `checks` (typecheck, lint, unit tests, build) |
| Security CI | `.github/workflows/security-ci.yml` | Every PR and push to `main`; weekly schedule | `dependency-audit`, `secret-scan` |
| CodeQL | `.github/workflows/codeql.yml` | PR and push to `main`; weekly schedule | `analyze` (`javascript-typescript`, `actions`) |

## Staging model

The workstream maps onto the staged pipeline model as follows.

- **Stage A — change validation.** Every relevant push/PR runs install,
  typecheck, lint, unit tests, and build. These are fast, deterministic, and
  run first.
- **Stage B — pull request assurance.** Before merge: the Stage A checks plus
  integration tests against a real PostgreSQL service, migration apply and drift
  detection, the production dependency audit, the secret scan, and CodeQL. All
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
them. This is a repository setting, not something a commit can guarantee, so it
is recorded as an action item rather than assumed. The required checks should be:

- Backend CI: `checks`, `migration-drift`, `integration`
- Frontend CI: `checks`
- Security CI: `dependency-audit`, `secret-scan`
- CodeQL: `analyze (javascript-typescript)`, `analyze (actions)`

Also required: at least one approving review, and dismissal of stale approvals
on new commits. For changes touching authentication, authorization, migrations,
or the ledger, an independent reviewer who did not author the change should be
required. A `CODEOWNERS` file is the mechanism to route those paths to the right
reviewers; it is recommended but not added here because the owning teams are not
identified in this repository.

## What the pipeline does not do

- It does not deploy. There is no deployment target configured.
- It does not publish artifacts or an SBOM. There is no registry to publish to.
- It does not run DAST. There is no running environment to scan.
- It does not enforce a coverage threshold. See `QUALITY_GATES.md` for why.
