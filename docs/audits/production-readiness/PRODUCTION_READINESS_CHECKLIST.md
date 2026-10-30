# Production readiness checklist

**Assessed:** 2026-10-30 at commit `60a1432`; rows marked *(remediated)* were re-verified on branch `feature/production-readiness-remediation` the same day. Findings (`PRA-xx`) and
verification steps (`Vx`) are defined in
[PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md).

Status key: **PASS** verified · **FAIL** verified as not met · **PARTIAL** some
of it verified · **NOT VERIFIED** no evidence available · **N/A** not relevant.

Responsible areas are roles; assign named people before go-live.

## Build and quality gates

| # | Criterion | Status | Evidence | Responsible | Outstanding action |
|---|---|---|---|---|---|
| Q-1 | Install is reproducible from the lockfile | PARTIAL | V2 repaired install from the unchanged lockfile. V1 clean `npm ci` was blocked locally by file locks from running dev servers; CI runs `npm ci` on every PR | Engineering | Run `npm ci` with the dev servers stopped, or rely on the CI record |
| Q-2 | Typecheck passes | PASS | V3, both workspaces exit 0 | Engineering | — |
| Q-3 | Lint passes | PASS | V4 | Engineering | — |
| Q-4 | Unit tests pass, none skipped | PASS | V5: 898 backend and 1,029 frontend; 929 and 1,044 after remediation | Engineering | — |
| Q-5 | Integration tests pass on real PostgreSQL | PASS | V12: 18 files / 173 tests; 20 files / 181 after remediation | Engineering | — |
| Q-6 | E2E tests pass and run in CI | FAIL | Not in `frontend-ci.yml`; 7 tests; not run (V13) | QA / Engineering | PRA-15 |
| Q-7 | Production builds succeed | PASS | V6 | Engineering | — |
| Q-8 | Production dependency audit is clean | PASS | V7: 0 vulnerabilities | Engineering | — |
| Q-9 | Secret scan is clean apart from reviewed exceptions | PARTIAL | gitleaks gate exists. EX-01 (SEC-07) is still open | Security owner | PRA-04 |
| Q-10 | Gates are enforced by branch protection | NOT VERIFIED | Documented in `CI_CD_ARCHITECTURE.md`; settings not readable (V14) | Repo admin | Screenshot or export the protection rule into `docs/engineering/` |
| Q-11 | Accessibility checks | FAIL | No axe or a11y tooling | Frontend | PRA-25 |
| Q-12 | Performance baseline | FAIL | None exists | Engineering | PRA-18 |

## Business correctness

| # | Criterion | Status | Evidence | Responsible | Outstanding action |
|---|---|---|---|---|---|
| B-1 | Stock cannot go negative under concurrency | PASS (application) | Advisory locks in `shared/inventory/balances.ts`; integration tests | Backend | Add DB CHECK (PRA-14) |
| B-2 | Posted movements are never edited; corrections are reversals | PASS | Only pair-link `update` calls on the ledger; reversal endpoint | Backend | — |
| B-3 | Duplicate inventory submissions do not double-post | PASS | `shared/idempotency.ts`; `idempotency.real-http.test.ts` | Backend | — |
| B-4 | Duplicate procurement submissions do not double-post | FAIL | No key on PO and RFQ writes | Backend | PRA-17 |
| B-5 | Every change has an audit record in the same transaction | PASS | AUD-01 fixed; `identity-audit-atomicity.real-http.test.ts` | Backend | — |
| B-6 | VAT and order totals are correct and consistent | PASS | `po-pricing.ts` Decimal, half-up per line; unit-tested | Backend | — |
| B-7 | Approval limits are enforced | PASS *(remediated)* | `approve()`; auto-approve now bounded by the submitter's limit | Backend / Business | — |
| B-8 | Segregation of duties on approval | PASS *(remediated)* | Creator refused (ADR-021); integration test | Business + Backend | Confirm the ADR-021 policy |
| B-9 | PO state changes are race-safe | PASS *(remediated)* | Row lock in update, approve and submit; concurrent integration test | Backend | — |
| B-10 | Production database starts free of demo data | PASS *(remediated)* | Bootstrap-only seed; `db:check-bootstrap` in CI (ADR-022) | Backend / Ops | Run `db:check-bootstrap` on the real production DB |
| B-11 | Opening balances import once only | PASS | `opening-balance.service.ts` refuses a second import | Backend | — |
| B-12 | Direct-to-site, in-transit and document management workflows | N/A (not built) | Roadmap scope | Product | Confirm they are out of scope for go-live |

## Security

| # | Criterion | Status | Evidence | Responsible | Outstanding action |
|---|---|---|---|---|---|
| SEC-1 | Production refuses weak or placeholder JWT secrets | PASS | `loadConfig()`; `config.test.ts` | Backend | — |
| SEC-2 | Unset `NODE_ENV` fails closed | PASS | `loadConfig()` defaults to production | Backend | — |
| SEC-3 | Every route is authenticated (except login and health) | PASS | Automated: `src/route-guard.test.ts` *(remediated)* | Backend | — |
| SEC-4 | Every mutation needs a permission, checked on the server | PASS | Per-route scan: all POST/PUT/PATCH/DELETE call `requirePermission` / `requireForKind` | Backend | — |
| SEC-5 | Reads are permission-scoped | PARTIAL | Several reads need authentication only | Backend | PRA-19 |
| SEC-6 | Deactivation and role changes take effect immediately | PASS | DB lookup per request in `authorization.ts` | Backend | — |
| SEC-7 | Password change and reset | PASS *(remediated)* | Change, admin reset, forced change, session cut-off (ADR-023) | Backend / Frontend | — |
| SEC-8 | Login success and failure audited; lockout | PASS *(remediated)* | `Authentication` audit entries; 5 failures lock 15 min | Backend | — |
| SEC-9 | Brute-force rate limit correct behind a proxy | NOT VERIFIED | `TRUST_PROXY` setting added; topology unknown | Platform | Set it for the real proxy chain |
| SEC-10 | Session idle timeout enforced | PASS *(remediated)* | `IdleSignOut` reads the setting | Frontend | — |
| SEC-11 | SPA CSP and security headers | NOT VERIFIED | No hosting config in repo | Platform | PRA-10 |
| SEC-12 | API security headers | PASS | helmet config in `server.ts` | Backend | — |
| SEC-13 | CORS allow-list in production | PASS | `resolveCorsOrigin`; `CORS_ALLOW_ANY` refused in production *(remediated)* | Backend | — |
| SEC-14 | No raw server or driver errors reach users | PASS | `toErrorEnvelope`, `classifyPrismaError`, frontend `errorPresentation.ts` | Backend / Frontend | — |
| SEC-15 | Upload validation | PASS | Auth before body; 10 MB; magic bytes; attachment and nosniff | Backend | PRA-22 (optional scan) |
| SEC-16 | Leaked credential rotated | **FAIL** | SEC-07 open | Security owner | PRA-04 |
| SEC-17 | Database not internet-reachable; least-privilege role | NOT VERIFIED (prod) / PARTIAL (compose) | Compose now `127.0.0.1:5432`; still the owner role | Platform | PRA-12 |
| SEC-18 | DAST / penetration test | NOT VERIFIED | Not performed | Security owner | Schedule before go-live |

## Database

| # | Criterion | Status | Evidence | Responsible | Outstanding action |
|---|---|---|---|---|---|
| D-1 | Migrations apply from empty | PASS | V8: 32 migrations; 34 after remediation | Backend | — |
| D-2 | Schema matches migrations | PASS | V9 empty diff; CI `migration-drift` | Backend | — |
| D-3 | Foreign keys complete | PASS | DATA-03 fixed | Backend | — |
| D-4 | Business invariants backed by constraints | PASS *(remediated)* | 10 CHECK constraints (migration `20260101000032`); integration test | Backend | — |
| D-5 | Migrations tested on a production-like copy | NOT VERIFIED | No staging | Ops | PRA-03 |
| D-6 | Rollback strategy for schema changes | FAIL | Forward-only; no expand–contract procedure | Backend / Ops | PRA-03 |
| D-7 | Backups automated | **FAIL** | None | Ops | PRA-02 |
| D-8 | Restore tested with measured RTO and RPO | **FAIL** | None | Ops | PRA-02 |
| D-9 | Retention policy (audit, ledger, idempotency) | PARTIAL | Idempotency keys pruned after 24 h; no audit or ledger retention policy | Product / Ops | Decide and document |

## Operations

| # | Criterion | Status | Evidence | Responsible | Outstanding action |
|---|---|---|---|---|---|
| O-1 | Liveness and readiness endpoints | PASS | `/health`, `/health/ready` (503 when the DB is down) | Backend | — |
| O-2 | Graceful shutdown | PASS (code) | SIGTERM handler in `server.ts` | Backend | Verify on the chosen host |
| O-3 | Structured logs collected centrally | FAIL | JSON logs to stdout only | Ops | PRA-08 |
| O-4 | Request IDs unique and correlatable | PASS *(remediated)* | UUID per request; `server.test.ts` | Backend | — |
| O-5 | Metrics and dashboards | FAIL | None | Ops | PRA-08 |
| O-6 | Alerting | FAIL | None | Ops | PRA-08 |
| O-7 | Deployment pipeline with approval | FAIL | None | Ops | PRA-03 |
| O-8 | Frontend hosting defined | FAIL | Not in repo | Ops | PRA-03 |
| O-9 | Runbook rehearsed | FAIL | [OPERATIONAL_RUNBOOK.md](OPERATIONAL_RUNBOOK.md) written; not rehearsed | Ops | Rehearse in staging |
| O-10 | Incident owner and escalation path named | FAIL | Not identified | Management | Name owners |
| O-11 | Last-admin recovery route | PASS *(remediated)* | Last admin cannot remove their own access; `db:rotate-admin` for recovery | Backend / Product | — |

## Documentation

| # | Criterion | Status | Evidence | Responsible | Outstanding action |
|---|---|---|---|---|---|
| DOC-1 | Setup instructions work | PASS | Backend README and CI reproduce integration setup (V8–V12) | Engineering | — |
| DOC-2 | Environment variables documented | PASS | `apps/backend/README.md` table; compose comments | Engineering | Note that the seed loads demo data |
| DOC-3 | Architecture decisions recorded | PASS | ADR-001 to ADR-020 | Engineering | Add an ADR on segregation of duties (PRA-06) |
| DOC-4 | Orientation docs current | PASS *(remediated)* | `task_context.md`, AGENTS.md, backend README refreshed | Engineering | — |
| DOC-5 | Operations docs distinguish planned from implemented | PASS | `12-operations/*.md` | Engineering | Refresh evidence commits |
