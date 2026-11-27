<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-ENG-012</b></td>
<td align="center"><b><i>Production readiness assessment</i></b><br><i>Engineering Assurance</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-ENG-012 updated=2026-11-27 by="Ntokozo Maselala" body=02a6c8fa2d71 -->

# Production readiness assessment

**Status:** DRAFT · **Owner:** Product/Engineering · **Baseline:** `71395dc`, 2026-11-27 · **Assessed:** branch `chore/production-readiness-review`

Whether the Afrinov Inventory & Operations Platform can responsibly go into
production, judged on evidence that was run, not on confidence. It rests on the
[production readiness audit](../audits/system/production-readiness-audit.md), and
its follow-up is the [remediation plan](REMEDIATION_PLAN.md). It does not replace
the go-live checklist in `workbook-replacement-roadmap.md` (Phase 4) or the steps in
`afrinov-docs/docs/12-operations/deployment.md`.

## Verdict

**NOT READY** for a production release today.

The software itself meets every gate the repository sets, and on the evidence of
this review the code holds no known critical or high defect. The release is blocked
by two things outside the code, each recorded as High or as a release gate:

1. **OPS-01:** there is no evidence from a production host: no installed instance,
   no restore test there, no agreed RPO/RTO, no proven alerting.
2. **SEC-07:** a real bootstrap admin password is in the public repository's
   history, and nobody has recorded that it was rotated wherever it was used.

A third, **GATE-02**, is closed: `main`, from which production is installed, is
protected and requires all eleven CI checks (2026-11-27; PRs #220 and #221). This
review's fixes are merged (PR #220).

It becomes **CONDITIONALLY READY** when both are done, leaving the P2 items in the remediation plan to be accepted or
scheduled by the owner. It becomes **READY FOR RELEASE** when the Phase 4 go-live
checklist (`workbook-replacement-roadmap.md`) is also complete: accounts, training,
the parallel run and the production import.

A READY verdict would not be a guarantee of defect-free software, nor proof that it
runs well in production.

## Dimensions

| Dimension | Assessment | Evidence | Outstanding | Residual risk | Release implication |
|---|---|---|---|---|---|
| Functional correctness | **Meets** | 1,464 backend and 1,672 frontend unit tests, 423 integration tests on real PostgreSQL, 1,223 Postman checks over every workflow: all pass. Browser tests passed in CI on `02e4146` | Phase 4 acceptance (parallel run against the workbook) not done | Business rules confirmed only against the workbook rehearsal still to come | None from the code; acceptance is part of go-live |
| Architectural integrity | **Meets, with recorded debt** | One ledger with a database floor (ADR-047); one error envelope; idempotent writes; 47 ADRs | TD-004, TD-007, TD-027 | A new stock path must follow the lock order by hand (TD-027) | None |
| Code quality | **Meets** | Lint and typecheck clean; no `@ts-ignore`, no `eslint-disable`; 6 `any` outside tests | PRR-05, PRR-06 (P3/P4) | Low | None |
| Security | **Conditional** | 183 endpoints 401 without a token; 5 low-privilege roles × 88 writes, none succeeded; record-level checks 403; bound SQL; no XSS sink; fail-closed configuration; 0 vulnerabilities; CodeQL alerts fixed | SEC-07 (High); SEC-03 rest, SEC-05, SEC-06, TD-006, TD-014 (Medium or conditional). GATE-02 closed: eleven required checks on `main` | A reused leaked password; an API compromise holding owner rights on the database | **Blocks** until SEC-07 is done |
| Data integrity | **Meets, with recorded debt** | 76 migrations apply cleanly; no drift; `CHECK (quantity >= 0)`; daily reconciliation; race tests pass | TD-006 immutability by convention | Direct SQL could edit history | None, if database access is limited to the operator |
| Test maturity | **Meets** | Four layers in CI; every regression test in this review failed on the old code first | No load test; browser tests not run locally | Behaviour under many simultaneous users unmeasured | None for the one store the business has (one store controller) |
| Performance | **Adequate for the expected load** | p50 10 ms, p95 56 ms, p99 290 ms over 426 requests; first load 147 kB + 258 kB, heavy libraries on demand | No load test; rate limits per process | Unknown beyond a handful of users | None |
| Reliability | **Meets in code** | Health and readiness separate; 503 for a lost database, 429 for throttling; idempotency on writes; no automatic retry of a mutation | Production behaviour unobserved | — | Shown only in production (OPS-01) |
| Configuration | **Meets** | `.env.example` matches the 17 variables read; production refuses insecure secrets, unknown `NODE_ENV` and `CORS_ALLOW_ANY`; loopback-only ports in both Compose files | `TRUST_PROXY` must be set at deployment (SEC-05) | A forgotten deployment setting | Covered by `deployment.md` Part 3 |
| Deployment readiness | **Not shown** | A step-by-step guide (`deployment.md`), Docker image on Node 24 as a non-root user | No deployment workflow, no tag, no installed host | Manual steps can be missed | **Blocks** (OPS-01) |
| Observability | **Partly** | Structured logs with request ids; refusal events to alert on (`stock-floor-refused`, `ledger-drift`); Dashboard cards for backups and stock checks | No alerting set up or proven | A failure noticed late | **Blocks** (OPS-01) |
| Documentation | **Meets** | Deployment, backup, reverse proxy and recovery procedures; registers kept current; this review's corrections | O4–O11 (standardisation) | Low | None |
| Operational recovery | **Built, not proven in production** | Backup service with encryption and off-site copy; restore test in CI; rollback and forward-recovery steps in `deployment.md` ("Installing a new version", "When something goes wrong") | A restore on the production host, signed off | Recovery untested where it matters | **Blocks** (OPS-01) |

## Before a production release

1. **Rotate SEC-07** wherever that password was ever used, and record it in
   `EXCEPTIONS.md` (EX-01).
2. ~~**Protect `main`**~~ **Done** 2026-11-27: eleven required checks, Backend and
   Frontend CI included (PR #221; `CI_CD_ARCHITECTURE.md`, "Branch protection").
3. ~~**Merge this review's fixes**~~ **Done** (PR #220, CI green). CodeQL's next
   scan of `main` marked alerts 1, 2, 3 and 5 fixed (2026-11-27T07:23Z); none open.
4. **Install on the production host** by `deployment.md` Parts 1–9, `TRUST_PROXY`
   set, and record the result.
5. **Prove recovery there**: a backup, an off-site copy and a restore test signed
   off (`deployment.md` Part 8; `backup-and-recovery.md`); agree RPO and RTO.
6. **Prove alerting**: someone is told when backups fail, the stock check fails or
   the API stops.
7. **Decide or accept the P2 items** in the remediation plan, writing down any risk
   accepted.
8. **Complete Phase 4** of the workbook roadmap: accounts, training, parallel run,
   stock count, the production import, cutover.

## Executive engineering report

1. **Initial condition.** A clean `main` at `71395dc`, every gate green, three
   editions of a defects report and a current risk register. One stash
   (`stash@{0}`) predates this work and was left alone.
2. **Stack.** Node 24; Fastify 5, Prisma 7, PostgreSQL 16, Zod 4; React 19,
   Vite 8, Tailwind 4; Vitest 5, Playwright; npm workspaces; Docker Compose; GitHub
   Actions.
3. **Findings.** Nine from this review: P1 one, P2 three, P3 two, P4 three. Fourteen
   items already in the registers stay open as recorded: no application code
   changed between `02e4146`, where the defects report checked them against the
   code, and `71395dc` (`git diff` empty), so those checks still hold.
4. **Security.** Branch protection off at the baseline (P1; now on, with all
   eleven checks required), four CodeQL alerts (fixed, and closed by CodeQL), the base
   Compose file open to the network (fixed); SEC-07 still to be done by the owner.
5. **Functional and reliability.** Eleven routes answered 500 to a bad filter
   (fixed). Nothing else gave a 5xx in 11,343 hostile calls.
6. **Changes implemented.** PRR-02, PRR-03, PRR-04, PRR-06 (part), PRR-07.
7. **Files affected.** 11 source files (9 changed, 2 new), 1 schema file (comments only), 1
   Compose file, 5 new test files and 1 changed test file; documents as listed in the
   remediation plan.
8. **Dependencies.** None added, removed or upgraded.
9. **Database.** No migration; `schema.prisma` comments only; drift check empty.
10. **Tests run.** Backend unit 1,464 / 1,464; frontend unit 1,672 / 1,672;
    integration 423 / 423 on a fresh database; Postman 1,223 / 1,223; probe 0 × 5xx in
    11,343 calls; authorisation sweep: no write by any of 5 roles. Browser tests not
    run on this machine.
11. **Build.** Backend and frontend production builds pass; `npm ci` clean;
    `npm audit` 0.
12. **Documentation.** New: this assessment, the audit, the remediation plan,
    `CHANGELOG.md`. Updated: the technical-debt register, risk register, security
    controls, verification evidence, the engineering and documentation indexes,
    `task_context.md`, `AGENTS.md`, the release process, deployment and backend
    README (one sentence each).
13. **Outstanding defects.** In the registers: see the remediation plan and
    `docs/audits/current-defects-report.md` (edition 4, baseline `a69749d`: 11 open
    in the code, 12 open outside it; TD-020, TD-021, TD-023, TD-029, SEC-08 and
    GATE-02 closed).
14. **Residual risks.** SEC-07, OPS-01 (blocking); SEC-03 rest, SEC-05,
    SEC-06, TD-006, TD-014 (decisions).
15. **Deferred.** TD-027, TD-004, TD-007, TD-011, TD-012, TD-015, ARCH-02, PRR-05,
    PRR-06 rest, PRR-08, dependency patches.
16. **Prerequisites.** The eight steps above.
17. **Recommendation.** Steps 2 and 3 are done; do steps 1 and 4–6. Do not go
    live before they are done.

| Work | State |
|---|---|
| Discovery, audit, dynamic testing, fixes PRR-02, -03, -04, -07, documentation | Completed |
| PRR-06 (fixture values) | Partly completed |
| Load test, penetration test, browser tests on this machine | Not attempted |
| OPS-01 evidence | Blocked: needs a production host |
| Branch protection on `main` (GATE-02) | Completed 2026-11-27: eleven required checks (PR #220, PR #221, then the setting) |
| SEC-07 | Waiting on the owner |
| Committing this branch and opening its pull request | Completed: PR #220 |
| Every P2 decision | Waiting on approval |
