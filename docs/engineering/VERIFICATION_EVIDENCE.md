<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-ENG-011</b></td>
<td align="center"><b><i>Verification evidence</i></b><br><i>Engineering Assurance</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-ENG-011 updated=2026-11-27 by="Ntokozo Maselala" body=39eb21a0a648 -->

# Verification evidence

Raw command output backing every claim in `BASELINE_ASSESSMENT.md` and the
final report. Each entry records the exact command, the exit status, and the
key result. Nothing here is marked passing unless it was run and its output
inspected.

Environment: Node v24.21.0, npm 11.21.0, PostgreSQL 16 (Docker), worktree at
`59e30ad` plus the changes described in the final report.

## Static and build checks

| Check | Command | Exit | Result |
|---|---|---|---|
| Install | `npm ci` (from `afrinov-platform/`) | 0 | Lockfile resolved, no audit failures |
| Typecheck | `npm run typecheck` | 0 | Backend + frontend clean |
| Lint | `npm run lint` | 0 | ESLint clean, both workspaces |
| Unit tests | `npm test` | 0 | Backend 60 files / 852 tests; frontend 82 files / 856 tests |
| Build | `npm run build` | 0 | Backend `tsc`; frontend Vite build (chunk-size warning only) |
| Workflow lint | `actionlint .github/workflows/*.yml` | 0 | No findings |

## Dependency security

| Check | Command | Exit | Result |
|---|---|---|---|
| Production audit | `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilities |
| Full audit | `npm audit` | 0 | 0 vulnerabilities (dev included) |

## Database

| Check | Command | Exit | Result |
|---|---|---|---|
| Migrate clean DB | `npx prisma migrate deploy` | 0 | 27 migrations applied to an empty database |
| Drift detection (before fix) | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | 0 | Non-empty: two `AddForeignKey` statements for `inventory_balances` (DATA-03) |
| Drift detection (after fix) | same | 0 | `-- This is an empty migration.` — schema and migrations agree |
| Drift exit-code semantics | `... --script --exit-code` | 2 | Confirms a non-empty diff is a failing gate; 0 when empty, 1 on error |
| FK enforcement | `INSERT INTO inventory_balances(...) VALUES ('ghost','ghost2',...)` | 1 | Rejected: `violates foreign key constraint "inventory_balances_material_id_fkey"` |
| Orphan refusal | migrate against a DB seeded with an orphan row | 1 | `ERROR: inventory_balances has 1 orphan material row(s) and 1 orphan location row(s)...`; no partial DDL left (FKs absent) |
| Failed-migration state | `prisma migrate deploy` again after the refusal | 1 | `Error: P3009 — migrate found failed migrations in the target database`; the row in `_prisma_migrations` has `finished_at` NULL |
| Orphan recovery | delete orphan, `prisma migrate resolve --rolled-back 20260101000027_inventory_balance_foreign_keys`, redeploy | 0 | `All migrations have been successfully applied` |

## Integration tests (real HTTP + real PostgreSQL)

| Run | Command | Exit | Result |
|---|---|---|---|
| Full suite, fresh database | `npm run test:integration` | 0 | 17 files / 124 tests passing, 0 skipped |
| Full suite, reused database | `npm run test:integration` | 0 | 17 files / 121 passing, 3 skipped (opening-balance import is once-per-database, by design) |
| AUD-01 regression only | `npx vitest run --config vitest.integration.config.ts integration/identity-audit-atomicity.real-http.test.ts` | 0 | 5/5 passing (user, material, project, settings, plus the successful-update case) |

## Secret scanning

| Check | Command | Exit | Result |
|---|---|---|---|
| Scan (before config) | `gitleaks detect --source . --redact --exit-code 1` | 1 | 7 findings across 296 commits |
| Scan (with placeholder allowlist) | `... --config .gitleaks.toml ...` | 1 | 1 finding — the real historical credential only |
| Scan (with baseline) | `... --config .gitleaks.toml --baseline-path .gitleaks-baseline.json ...` | 0 | No new leaks |
| Negative test | plant a synthetic `ghp_…` token, rescan | 1 | Detected — the gate is not vacuous |
| Baseline content | `grep -c '<secret value>' .gitleaks-baseline.json` | 1 | 0 matches — the baseline stores no secret value |

## Test-first evidence for the fixes

**AUD-01** — with a fix reverted (the project `create` method restored to its
non-transactional shape), the matching failure-injection case fails:

```
AssertionError: expected { …(13) } to be null
 FAIL  … > rolls a project create back when the audit insert fails
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

With the fix restored, the same file passes 5/5. This demonstrates the test
detects the defect rather than merely executing the code path.

**DATA-03** — the drift check output before the migration is the two
`AddForeignKey` statements quoted above; after the migration it is empty.

## Production readiness review, 2026-11-27

Backs [`PRODUCTION_READINESS_ASSESSMENT.md`](PRODUCTION_READINESS_ASSESSMENT.md)
and [`REMEDIATION_PLAN.md`](REMEDIATION_PLAN.md). Environment: Windows 11, Node
v24.21.0, npm 11.19.0, PostgreSQL 16 (Docker, `backend-test-db-1`), Docker Compose
v5.5.1. A separate git worktree at `71395dc`, branch
`chore/production-readiness-review`, so the developer's own checkout and running
servers were not touched. Throwaway databases `afrinov_prr_test` (integration) and
`afrinov_prr_api_test` (the API on `127.0.0.1:4710`), each dropped and rebuilt
before use.

### Gates, baseline and after

| Check | Command (from `afrinov-platform/`) | Baseline `71395dc` | After the changes |
|---|---|---|---|
| Install | `npm ci` | exit 0; 809 packages, 18 s; "found 0 vulnerabilities" | not re-run (no dependency changed) |
| Install scripts | `npm install-scripts ls` | "No packages with unreviewed install scripts." | — |
| Typecheck | `npm run typecheck` | exit 0 | exit 0 |
| Lint | `npm run lint` | exit 0 | exit 0 |
| Unit tests | `npm test` | exit 0; backend 89 files / 1,429; frontend 145 files / 1,672 | exit 0; backend 93 files / 1,464; frontend 145 files / 1,672 |
| Build | `npm run build` | exit 0 | exit 0 |
| Document control | `npm run docs:test`, `docs:check`, `docs:links` | exit 0 each | exit 0 each; "223 documents, every header current"; "0 relative link(s) lead nowhere" |
| Integration | `npm run test:integration --workspace=@afrinov/backend` | exit 0; 41 files / 400 | exit 0; 42 files / 423, on a database rebuilt for the run |
| Migrate empty database | `npm run db:test:migrate` | 76 migrations applied | 76 applied |
| Drift | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code` | — | exit 0, `-- This is an empty migration.` |
| Production audit | `npm audit --omit=dev --audit-level=high` | — | exit 0, 0 vulnerabilities |
| Outdated | `npm outdated --workspaces --long` | patches and held-back majors only | — |
| Compose | `docker compose [-f docker-compose.yml] [-f docker-compose.prod.yml] [--profile test] config` | `db` `0.0.0.0:5432`, `backend` `0.0.0.0:4000` (file alone) | `127.0.0.1` for `db`, `backend` and `test-db`, alone and with the overlay |

The first full unit run after the changes failed one test,
`reporting.service.test.ts > stockStatus > filters by category`, with
`ApiError: category must be one of …`: the fixture asked for `ELECTRICAL`, which
the schema does not have (PRR-06). With the test asking for a real category and
checking the refusal, the backend suite passed 1,462 / 1,462; after the cubic fixes on PR #220 (the `?report=` case below), 1,464 / 1,464, and integration 423 / 423.

### Continuous integration

| Workflow | Last run on `main` | Commit | Result |
|---|---|---|---|
| Backend CI (checks, migration drift, integration) | 45782684666 | `02e4146` | success, all three jobs |
| Frontend CI (checks, Playwright on a real backend) | 45782684614 | `02e4146` | success, both jobs |
| Security CI, CodeQL, Docs CI | on `71395dc` | `71395dc` | success |

`git diff --stat 02e4146 71395dc -- afrinov-platform/apps` is empty: the
backend and frontend runs on `02e4146` cover the baseline's code.

### GitHub settings (read only)

| Read | Result |
|---|---|
| `gh api repos/…/branches/main/protection` | 404 "Branch not protected" |
| `gh api repos/…/rulesets` | one ruleset, "Restrictions", `enforcement: disabled` |
| `gh api repos/…/code-scanning/alerts?state=open` | 4: `js/polynomial-redos` (`supplier-fields.ts:40`), `js/incomplete-sanitization` ×3 (`workbook-report.ts:9`, `vendor-list.ts:228`, `reconciliation.ts:160`) |
| `gh api repos/…/dependabot/alerts?state=open` | 0 |
| `gh api repos/…/secret-scanning/alerts?state=open` | 0 |

The table above is the baseline. After PRs #220 and #221, at the owner's request:

| Read | Result |
|---|---|
| `gh api repos/…/branches/main/protection` | `enforce_admins` true; pull request required (0 approvals); force pushes and deletion off; `required_status_checks.strict` true; 11 checks, each `app_id` 15368: the 6 of Security CI, Docs CI and CodeQL, and `Backend: typecheck, lint, unit tests, build`, `Backend: migration drift and database integrity`, `Backend: integration tests (real Postgres)`, `Frontend: typecheck, lint, unit tests, build`, `Frontend: browser tests (Playwright, real backend)` (GATE-02) |
| `for n in 1 2 3 5; do gh api "repos/…/code-scanning/alerts/$n"; done` and `gh api 'repos/…/code-scanning/alerts?state=open'` | each of the four `fixed`, `fixed_at` 2026-11-27T07:23:24Z, the first scan of `main` after PR #220; the open-alert query returns 0 (SEC-08) |
| `gh pr checks 221` at `7c96c86` | 16 checks; every Backend and Frontend job ran and passed, CodeQL, Security CI and Docs CI passed |
| `gh pr checks 222` and `gh pr view 222 --json mergeStateStatus` (documentation only), with the eleven checks required | `Backend: what changed` and `Frontend: what changed` success; the five Backend and Frontend test jobs `skipped`; Security CI, Docs CI and CodeQL passed; `mergeStateStatus` CLEAN. A docs-only pull request is not blocked by the required Backend and Frontend checks |

### The running API

| Test | Result before the changes | After |
|---|---|---|
| Hostile-input probe: every GET, documented and common query parameters, 8 bad values each | 11,343 calls; 88 × 500 on `category` (6 routes) and `type` (5 routes); no 429 | 11,343 calls; **0 × 5xx**; no 429 |
| Authorisation sweep: 88 writes and every GET per low-privilege account | VIEWER 403 ×80, 400 ×3, 404 ×5; APPROVER the same; TECHNICIAN 403 ×72, 400 ×11, 404 ×5; **no 2xx write**, no 5xx | VIEWER, APPROVER, TECHNICIAN as before; SALES 403 ×73, 400 ×6, 404 ×9; PROCUREMENT 403 ×53, 400 ×18, 404 ×16, 415 ×1; **no 2xx write**, no 5xx |
| Record-level: a non-manager VIEWER on a real schedule, step and slip | 403 on all five; schedule unchanged | the same |
| Valid bodies on real records (after cubic, PR #220): a non-manager VIEWER creates a schedule on an Admin's project, starts next month, re-plans | — | 403, 403, 403; the project's schedules read back identical. With the five above, all 8 VIEWER routes that did not answer 403 in the sweep refuse a valid request. The probe rerun on the same code: 11,343 calls, 0 × 5xx |
| Postman, 426 requests | 1,223 / 1,223; 183 no-token calls all 401 | 1,223 / 1,223; 183 all 401; p50 10 ms, p95 56 ms, p99 290 ms |

A first probe run reached the global limit of 1,000 requests a minute, and most of
its calls were answered 429; it was discarded, the throwaway API restarted with
`RATE_LIMIT_GLOBAL=100000`, and the probe changed to refuse to report when any call
is throttled.

### Test-first evidence for the fixes

**PRR-02 / TD-029.** `integration/query-filters.real-http.test.ts` with the five
changed service and route files put back as they were at `71395dc`:

```
 Test Files  1 failed (1)
      Tests  11 failed | 11 passed (22)
```

The 11 failures are the 11 "refuses a value the enum does not have" tests; the 11
passing are "still lists for a real value and for an empty one". With the changes:
22 / 22. After the cubic fix on PR #220 the file has a 23rd case, a Movements report
with an unknown `?type=`, which passes on the old code too (it ignored the type) and
on the new: 23 / 23.

**PRR-03 / SEC-08.** The old `cleanWebsite` regex against `a` + n × `|` + `a`:

```
n=5000  old 11.3ms  new 0.11ms
n=10000 old 46.0ms  new 0.01ms
n=20000 old 181.7ms new 0.01ms
n=40000 old 720.5ms new 0.01ms
```

Doubling the length quadruples the time. `supplier-fields.test.ts` gives
`cleanWebsite` 200,000 separators and allows 500 ms; on that curve the old regex
would take about 18 s, so the test fails on the old code.
