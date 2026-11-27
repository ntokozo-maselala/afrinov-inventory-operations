<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-ENG-005</b></td>
<td align="center"><b><i>Implementation roadmap</i></b><br><i>Engineering Assurance</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-ENG-005 updated=2026-11-27 by="Ntokozo Maselala" body=a709a55644aa -->

# Implementation roadmap

What was completed in this workstream, what remains, and the conditions under
which the remaining work becomes worth doing. Work is ordered by value, not by
tool count.

## Completed (verified — see `VERIFICATION_EVIDENCE.md`)

### Phase 1 — Baseline

Inspected the repository, ran every existing check, and recorded the results.
Found two open defects (DATA-03, AUD-01), one committed credential (SEC-07), and
three missing controls (dependency audit, secret scan, migration drift) plus
unpinned actions.

### Phase 2 — Minimum trustworthy verification

Already largely present: install, typecheck, lint, unit tests, build,
integration tests and PR CI all worked. Added the missing automated gates:

- **Dependency audit** (production, blocking; full, informational) —
  `.github/workflows/security-ci.yml`.
- **Secret scanning** over full history with a redacted baseline —
  same workflow; proven non-vacuous with a negative test.
- **Migration drift detection** — `backend-ci.yml`, `migration-drift` job.

### Phase 3 — Secure critical business paths

- **AUD-01 fixed:** the business mutation and its audit record now commit in one
  transaction across identity, material, project and settings. Failure-injection
  regression tests cover all four services; each case was shown to fail against
  the unfixed code.
- **DATA-03 fixed:** the missing `inventory_balances` foreign keys are added by a
  forward migration that refuses to run on orphan rows. Refusal, recovery and
  enforcement all verified on real PostgreSQL.
- **ARCH-01 fixed (2026-11-11, ADR-036):** no change may leave no active Admin,
  and once two exist two are kept, under the `afrinov:admins` lock; nobody
  deactivates themselves or removes their own Admin role
  (`identity.service.test.ts`).

### Phase 4 — Supply chain

All GitHub Actions pinned to commit SHAs; least-privilege permissions; security
jobs on a weekly schedule.

### Phase 5 — Documentation

`docs/engineering/` — baseline, evidence, gates, security, database assurance,
CI/CD, risk register, exceptions, roadmap, and this file's siblings.

## Outstanding work

### Priority 1 — Immediate, owner action required

| Item | Why | Acceptance criteria |
|---|---|---|
| **SEC-07** rotate the committed admin password | The value is in public history | Account rotated or deleted; no reuse; outcome recorded in `EXCEPTIONS.md` |
| **An approving review** on `main` | Branch protection is in force (GATE-02, done 2026-11-27: eleven required checks, `CI_CD_ARCHITECTURE.md`), but with one maintainer no review can be required: an author can't approve their own pull request | Require one approving review once there is a second maintainer |
| **CODEOWNERS** | Route auth/authz/migration/ledger paths to the right reviewers | File added once owning teams are named; those paths require an owner review |

### Priority 2 — Before any production release (OPS-01)

These are evidence and environment work, not code, and cannot be completed from
this repository alone:

- A deployment workflow with environment protection and least-privilege
  credentials.
- A backup and restore runbook, with at least one verified restore in an
  isolated environment, and agreed RPO/RTO.
- Alerting and dashboards for availability, error rate and latency.
- A migration rehearsal against a copy of production-shaped data.
- A rollback or forward-recovery procedure, tested.

### Priority 3 — Conditional, do when the prerequisite exists

| Item | Add it when… |
|---|---|
| DAST (e.g. ZAP baseline) | A staging environment is reachable from CI |
| SBOM + artifact signing | There is an artifact registry and a promotion step |
| Canary / feature-flag rollout | There is a deployment platform that supports it and the risk profile justifies it |
| Mutation testing | The suite is stable in CI and critical-rule coverage needs strengthening; start with `authorization.ts` and the inventory service |
| Coverage of critical paths as a gate | A meaningful, stable coverage baseline exists; gate only on critical modules, not a global percentage |
| Idempotency contract (ARCH-02) | The product decides at-most-once semantics per operation |
| `trustProxy` / shared rate-limit store (SEC-05) | The real proxy/replica topology is known |
| Host CSP (SEC-06) | The static-host owner is identified |

### Priority 4 — Continuous improvement

- Track DORA-style signals (change lead time, deployment frequency, change
  failure rate, time to restore) once a deployment pipeline exists. No such
  pipeline exists today, so these cannot be measured yet.
- Review gate false positives and flaky tests each quarter; retire controls that
  no longer earn their cost.
- Keep `AGENTS.md` and `docs/engineering/` current as controls change.

## Definition of done for this workstream

- The repository was inspected; the baseline is documented.
- The agreed controls are implemented and execute automatically.
- Critical business and security behaviour (audit atomicity, referential
  integrity) has tests that were shown to fail against the unfixed code.
- Database changes are validated (apply, drift, refusal, recovery, enforcement).
- Test and scan results are backed by executed evidence.
- Known failures, exceptions and limitations are disclosed.
- Documentation matches the implementation.

## What is explicitly **not** claimed

- **Not** production-ready. Pipeline implementation is complete and verification
  passes, but the operational evidence (OPS-01) does not exist.
- **Not** a complete security assessment. It is a repository-scoped review; no
  DAST, penetration test, or infrastructure assessment was performed.
- **Not** proof that the system is free of defects. It is proof that the
  controls listed in `QUALITY_GATES.md` pass, and that two specific defects were
  found, fixed and verified.
