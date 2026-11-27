<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-AUD-022</b></td>
<td align="center"><b><i>Production Readiness Audit</i></b><br><i>Audit Report</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-AUD-022 updated=2026-11-27 by="Ntokozo Maselala" body=ddb80990e5de -->

# Production Readiness Audit

**Status:** DRAFT · **Owner:** Product/Engineering · **Baseline:** `71395dc`, 2026-11-27

## Summary

A full review of the repository for a production release: architecture, code,
dependencies, database, API, security, tests, performance, configuration and the
delivery pipeline. It ran every gate from a clean install at `71395dc`, then tested
the running API with hostile input, an authorisation sweep and the 426-request
Postman collection against a throwaway database.

The code is in good order. Every gate passes, all 426 Postman requests pass, no
write by a low-privilege account succeeded (a VIEWER's were all refused, valid
requests on real records included), and `npm audit` reports nothing. The review found **one defect not in any register**: eleven list routes
answered 500 to an unknown `?category=` or `?type=` value (PRR-02, now TD-029). It
also found **two process gaps**: `main` is not protected (PRR-01), and four High-rated
CodeQL alerts were open (PRR-03, now SEC-08). The defect and the alerts are fixed on
this branch with regression tests.

What stands between this code and a production release is not code. It is the
operational evidence (OPS-01), the rotation of a credential in public history
(SEC-07), and branch protection (PRR-01; since done: `main` requires all eleven
CI checks, GATE-02 closed 2026-11-27). The verdict and its conditions are in
[`PRODUCTION_READINESS_ASSESSMENT.md`](../../engineering/PRODUCTION_READINESS_ASSESSMENT.md);
the plan for each finding is in
[`REMEDIATION_PLAN.md`](../../engineering/REMEDIATION_PLAN.md).

## Scope and method

- **Examined:** the whole repository at `71395dc` (a clean `main`, the merge of PR
  #219); the five GitHub Actions workflows and their latest runs; the repository's
  GitHub settings (branch protection, rulesets, code-scanning, secret-scanning and
  Dependabot alerts) through `gh api`, read only; a throwaway API started from the
  branch on `127.0.0.1:4710`, against its own database `afrinov_prr_api_test`.
- **Not examined:** any production host, production data or deployed instance (none
  can be reached from this machine); the stock workbook; the reverse proxy and host
  CSP (SEC-06); the browser tests on this machine (Playwright would take the port the
  developer's own Vite server uses, so their evidence is the CI run on `02e4146`, the
  last commit that changed code); a penetration test, DAST or load test.
- **Method:** each area below was read against the code, not against earlier
  reports, and every claim was checked by a command whose result is in
  [`VERIFICATION_EVIDENCE.md`](../../engineering/VERIFICATION_EVIDENCE.md), section
  "Production readiness review, 2026-11-27". Earlier registers were taken as leads to
  check, not as findings.

### Dynamic tests of the running API

| Test | What it does | Before the fixes | After |
|---|---|---|---|
| Hostile-input probe | Every GET in the OpenAPI document (187 operations), each documented query parameter and 14 common filter names (`type`, `category`, `status`, `from`, `to`, `limit`, ids, cursors), each set to 8 bad values: `abc`, `-1`, `1e400`, a non-UUID, an impossible date, a SQL fragment, `%00`, 5,000 characters | 11,343 calls, **88 answered 5xx** (11 routes, 3 parameters) | 11,343 calls, **0 answered 5xx** |
| Authorisation sweep | An Admin makes one account per low-privilege role; each sends every write operation (88, not counting `/auth/*`) with an empty body and a made-up id, then reads every GET | VIEWER, APPROVER, TECHNICIAN: **no write succeeded**, no 5xx | VIEWER, APPROVER, TECHNICIAN, SALES, PROCUREMENT: **no write succeeded**, no 5xx. Only a 403 proves refusal: a VIEWER got 403 on 80 of 88; the other 8 validated or looked up first, and are the next row |
| Record-level checks, valid requests | A VIEWER who is not the project's manager sends **valid bodies to real records** on the 8 routes that did not answer 403: rename a schedule, add, change and delete a step, confirm someone else's slip, create a schedule, start next month, re-plan | The first five **403**; the schedule unchanged | All eight **403**; the schedules unchanged. TECHNICIAN, SALES and PROCUREMENT routes that answered 400 or 404 were not re-sent with valid bodies |
| Postman collection | 426 requests, 1,223 checks, every workflow end to end (`system-knowledge/22-api-postman`) | **1,223 / 1,223** | **1,223 / 1,223** |

The probe and the sweeps send only to `127.0.0.1:47nn` and refuse any other address.
The probe also proved itself: its first run hit the default limit of 1,000 requests
a minute, so it now refuses to report when any call was answered 429.

## Findings by area

### Architecture

A modular monolith: one Fastify API (`apps/backend`, 27,808 lines of TypeScript
outside tests, one module per area under `src/modules/`) and one React SPA (`apps/frontend`, 38,793 lines). The
application routes are under `/api/v1` and registered in one place
(`src/server.ts:345-387`); `/`, `/health`, `/health/ready` and the optional
`/api/docs` are registered outside that prefix.
Errors leave through one envelope (`toErrorEnvelope`), stock moves through the
ledger with a database floor (ADR-047), and inventory writes are retry-safe through
an idempotency key. Each of these was confirmed in the code.

The recorded weaknesses still stand and need no new evidence: modules import each
other (TD-004), domain events have no handler (TD-007), and the stock floor's lock
order is a convention repeated in 14 paths (TD-027). None is a release blocker; each
needs a design decision, not a fix (see the remediation plan).

### Code quality

Lint and typecheck pass with no warnings; there is no `@ts-ignore` and no
`eslint-disable` in the backend, and 6 uses of `any` outside tests. The review looked
for the two patterns `AGENTS.md` forbids:

- **A query parameter reaching Prisma unchecked.** Found: six places cast a raw
  string into an enum (`as Prisma.…WhereInput['category']`), plus one route cast
  (`/locations?type`). This is PRR-02.
- **`Number(q['limit'])`.** One remains, in `/reports/movement-history`
  (`reporting.routes.ts:69`). The service already falls back to 200 for a value that
  is not a positive number, so it gives no 5xx (the probe confirms); it differs from
  `pageLimit` only in answering 200 instead of 400 to `limit=abc`. Recorded as
  PRR-05 (P4); not changed, since changing it would change the route's answer.

One test fixture was found wrong while fixing PRR-02:
`reporting.service.test.ts` used the categories `FASTENERS` and `ELECTRICAL`, which
the schema does not have. The in-memory fake accepted them; PostgreSQL would not.
The one test that filtered by such a value now uses a real category (PRR-06).

### Dependencies

| Check | Result |
|---|---|
| `npm ci` from the lockfile | 809 packages in 18 s, exit 0 |
| `npm install-scripts ls` | No unreviewed install scripts (the `allowScripts` pins are current) |
| `npm audit` (all, including development) | **0 vulnerabilities** |
| GitHub Dependabot alerts | 0 open |
| `npm outdated --workspaces` | In-range patches only (`react-router-dom` 7.18.7, `vite` 8.4.0, `vitest` 5.1.2, `@types/*`); majors held back as `AGENTS.md` records |
| Held-back majors re-checked | Still blocked: `eslint-plugin-react@7.37.5` peers `eslint` ≤ 9; `typescript-eslint@8.74.0` peers `typescript` < 6.1; Prisma 8 is still `rc`; `@prisma/config` still pins `effect` 3.20.0, so the override stays |
| Deprecation notices | ESLint 9 is out of support upstream (SUPPLY-02, development only) |

No upgrade was made: none of the available updates fixes a vulnerability or a defect.

### Database

76 migrations apply cleanly to an empty PostgreSQL 16 database, and
`prisma migrate diff` between the migrated database and `schema.prisma` is empty.
Balances are guarded by `CHECK (quantity >= 0)` and checked daily against the ledger
(ADR-047). The integration suite, which runs on real PostgreSQL, passes 422 of 422,
the stock-floor race tests among them.

Still open, as recorded: ledger and audit rows are immutable by convention only, with
no grant, revoke or trigger (TD-006); the API connects as the database owner
(SEC-03); `purchase_orders.shipped_*` and `GoodsReceiptStatus.DRAFT` are unused
(TD-011). Each needs a migration and a decision; none was attempted.

Two schema comments said the balances table is never written by the application and
is refreshed by a trigger; neither is true (TD-020). Corrected (comment only, no
drift).

### API

187 operations, 92 of them writes. Bodies are validated by Zod schemas; ids,
dates, months, cursors and limits all answered 4xx to bad values in the probe. The
eleven exceptions were the enum filters:

| Parameter | Routes that answered 500 |
|---|---|
| `category` (MaterialCategory) | `/materials`, `/reports/current-stock`, `/reports/stock-status`, `/reports/consumption`, `/reports/consumption/export`, `/reports/reorder-list/export` |
| `type` (LocationType) | `/locations` |
| `type` (InventoryTransactionType) | `/inventory-transactions`, `/inventory-transactions/summary`, `/inventory-transactions/export`, `/reports/movement-history` |

The response body carried only the generic message and a request id, so nothing
leaked; the SQL fragment was refused by Prisma's enum validation, not run. The harm is
that a typed filter or a stale link was logged as "Unhandled error", at error
severity: a false alarm for whoever watches the logs.

### Security

| Control | Evidence | Result |
|---|---|---|
| Authentication | 183 protected endpoints called with no token | All 401 |
| Authorisation | The sweep above: five low-privilege roles, 88 writes each; then valid requests on real records for every VIEWER route that did not answer 403 | No write succeeded; all eight valid VIEWER requests 403. Not re-sent with valid bodies: the other roles' 400/404 routes |
| Injection | Raw SQL uses `Prisma.sql` with bound values; no `$queryRawUnsafe` or `$executeRawUnsafe` anywhere | New test pins `/audit`'s filters as bound values |
| Output encoding (frontend) | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `document.write`; no `target="_blank"` without `rel`; `ErrorBoundary` renders `presentError`, not a raw message | Clean |
| Secrets | `.env*` git-ignored; `.env.example` lists exactly the 17 variables the code reads, with placeholders | Consistent |
| Configuration | Production refuses a known-insecure `JWT_SECRET`, an unknown `NODE_ENV` and `CORS_ALLOW_ANY` (`config.ts`); the container defaults to `NODE_ENV=production` | Fail-closed |
| Network exposure | The production overlay binds the database and API to `127.0.0.1`; the base `docker-compose.yml` did not, and on this machine the dev database listened on `0.0.0.0:5432` and `[::]:5432` | Base file fixed (PRR-04) |
| Static analysis | 4 open CodeQL alerts rated High: a polynomial regex in `cleanWebsite`, incomplete Markdown escaping in three import reports | Fixed (PRR-03); real severity Low, see below |
| Repository | `main` unprotected; the one ruleset disabled | Open (PRR-01) |
| Credential in history | SEC-07 / TD-026 | Open; can't be confirmed from the repository |

The ReDoS was not reachable from the API: `website` is capped at 200 characters
(`procurement.routes.ts:31`), and 200² steps is nothing. The vendor-list import, an
operator tool run on a trusted file, had no cap. The old regex was measured at 11, 46,
182 and 720 ms for 5,000 to 40,000 separators, doubling the length quadrupling the
time; the replacement stays under 0.2 ms.

A VIEWER, holding only `view:reports`, can read 38 GET routes, settings and suppliers
among them, with unit costs. This is TD-014, a deny-by-default question for the
owner, not a new finding.

### Tests

| Layer | Baseline `71395dc` | This branch |
|---|---|---|
| Backend unit | 1,429 / 1,429 (89 files) | 1,464 / 1,464 (93 files) |
| Frontend unit | 1,672 / 1,672 (145 files) | 1,672 / 1,672 |
| Backend integration, real PostgreSQL | 400 / 400 (41 files) | 423 / 423 (42 files) |
| Browser (Playwright) | Not run here; passed in CI on `02e4146` (run 45782684614) | Not run here |
| Postman, real API | 1,223 / 1,223 | 1,223 / 1,223 |

Each new regression test was run against the old code and failed there:
`query-filters.real-http.test.ts` fails 11 of 23 on the old code (all 11 refusals),
and the linear-time check in `supplier-fields.test.ts` would take about 18 s on the
old regex against a 500 ms limit. `audit.routes.test.ts` closes TD-023.

### Performance and reliability

Across the 426 Postman requests the API answered in 10 ms at the median, 56 ms at the
95th percentile and 290 ms at the 99th; the slowest were the two password changes
(812 and 844 ms), which hash with bcrypt by design. The SPA's first load is the
`index` and `vendor-react` chunks (147 kB and 258 kB, 45 kB and 82 kB gzipped);
`exceljs`, `jspdf` and `html2canvas` load only when a download is asked for. Health
(`/health`) and readiness (`/health/ready`, a `SELECT 1`) are separate; rate limits
answer 429, not 500; a lost database is a 503. No load test was run, and the
rate-limit counters are per process (SEC-05).

### Configuration and delivery

Five workflows run on pull requests and `main`: backend (typecheck, lint, unit,
build, migration drift, integration), frontend (the same plus Playwright on a real
backend), security (production `npm audit` blocking, full audit informational,
gitleaks over full history, no workbooks), CodeQL, and document control. All Actions
are pinned to commit SHAs. All passed on the latest runs: `02e4146` for backend and
frontend, `71395dc` for the others.

There is no deployment workflow and no release tag; production is installed by hand
from `deployment.md`. Nothing requires the gates to pass before a change reaches
`main` (PRR-01).

## Findings

| ID | Finding | Priority | Evidence | Recommendation |
|---|---|---|---|---|
| PRR-01 | `main` has no branch protection; the "Restrictions" ruleset is disabled | P1 | `gh api …/branches/main/protection` → 404; `…/rulesets` → `enforcement: disabled` | Owner enables required checks on `main` (GATE-02) |
| PRR-02 | Eleven routes answered 500 to an unknown enum filter | P2 | Probe: 88 of 11,343 calls; log "Invalid value for argument `category`" | Check the value before Prisma (TD-029). **Fixed** |
| PRR-03 | Four High-rated CodeQL alerts open: polynomial regex, incomplete escaping | P2 | `gh api …/code-scanning/alerts?state=open`; timings above | Linear trim; escape backslashes (SEC-08). **Fixed in code** |
| PRR-04 | The base Compose file published the database and API on every interface | P2 | `docker-compose.yml:12`, `:78` at the baseline; `netstat` on this machine | Bind to `127.0.0.1` (SEC-03, part). **Fixed** |
| PRR-05 | `/reports/movement-history` reads `limit` with `Number()`, not `pageLimit` | P4 | `reporting.routes.ts:69`; no 5xx in the probe | Change with the next edit to that route; it changes `limit=abc` from 200 to 400 |
| PRR-06 | Test fixtures used category values the schema does not have | P3 | `reporting.service.test.ts:164-165`, `:509-510` | The filter test fixed; rename the remaining fixture values in a later change |
| PRR-07 | Three open register items needed no decision: misleading schema comments (TD-020), a stale `task_context.md` (TD-021), `audit.routes.ts` untested (TD-023) | P3 | The registers; the files | **Fixed** |
| PRR-08 | ESLint 9 is out of support; ESLint 10 blocked upstream | P4 | `npm ci` deprecation notice; `npm view` | Accept until the plugin supports 10 (SUPPLY-02) |
| PRR-09 | `GET /` answers without sign-in with the environment name and version | P4 | `server.ts:301` | Informational: no secret, and it helps operators; review with the proxy setup |

Findings already in a register and still open (SEC-03 in part, SEC-05, SEC-06,
SEC-07, OPS-01, TD-004, TD-006, TD-007, TD-011, TD-012, TD-014, TD-015, TD-027,
ARCH-02) are carried in the remediation plan with their register IDs. No application
code changed between `02e4146`, where edition 3 of the defects report checked each
against the code, and `71395dc` (`git diff 02e4146 71395dc -- afrinov-platform/apps`
is empty), so those checks still hold; the ones this review touched are SEC-03
(narrowed) and TD-014 (a VIEWER reads 38 GET routes).

## Outstanding questions

- Has the bootstrap password in history (SEC-07) been rotated wherever it was used?
- Which production host, backup target and alerting will be used (OPS-01)?
- Should reads be permission-gated by default, unit costs included (TD-014)?
- Which currency should the inventory report use, the environment variable or the
  setting (TD-012)?
- Should the API get its own database role without owner rights (SEC-03)?

## Evidence

Commands, exit codes and results are in
[`VERIFICATION_EVIDENCE.md`](../../engineering/VERIFICATION_EVIDENCE.md), section
"Production readiness review, 2026-11-27". The probe and sweep scripts were run from
outside the repository and are not committed; their method is the table above.
