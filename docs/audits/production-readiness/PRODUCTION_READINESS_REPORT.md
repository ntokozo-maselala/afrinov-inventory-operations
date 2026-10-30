# Production readiness report

**Assessment date:** 2026-10-30 · **Commit assessed:** `60a1432` (main, clean tree)
**Scope:** the whole repository: backend, frontend, database schema and migrations, CI/CD, container configuration and documentation.
**Method:** read-only source inspection plus execution of the repository's own gates. No application code, configuration, schema or workflow was changed.

Companion documents in this folder:
[checklist](PRODUCTION_READINESS_CHECKLIST.md) ·
[remediation plan](PRODUCTION_REMEDIATION_PLAN.md) ·
[deployment checklist](PRODUCTION_DEPLOYMENT_CHECKLIST.md) ·
[operational runbook](OPERATIONAL_RUNBOOK.md)

---

## 1. Executive summary

**Verdict: C — NOT PRODUCTION READY.**

The application code is well above average for its size and age. The stock
ledger is append-only and serialised with database locks. Inventory writes are
idempotent. Authorisation is enforced on the server and checked against the
database on every request. Errors pass through one sanitising boundary. All
automated gates pass, including 173 integration tests against a real
PostgreSQL 16.

Readiness is not decided by the code alone. These conditions block a
production go-live today:

1. **No production environment, backup or tested restore exists** (PRA-02,
   PRA-03). The system will become Afrinov's only stock record once the
   workbook is archived. Nothing in the repository, and no evidence supplied,
   shows that its data can be recovered.
2. **The documented production start command loads demo business data into the
   production database** (PRA-01). That data is fictitious suppliers, purchase
   orders and stock movements. Every restart then overwrites the demo-SKU
   materials. This finding is new: no earlier audit records it.
3. **A real administrator password is still readable in the public repository's
   Git history**, and there is no evidence that it was rotated (PRA-04, existing
   SEC-07).
4. **Users cannot change or reset passwords** (PRA-05). The seed tells the
   operator to "CHANGE PASSWORD ON FIRST LOGIN", but no endpoint or screen can
   do that. A compromised password can only be fixed by deactivating the account
   or editing the database directly.
5. **Purchase-order approval has no segregation of duties** (PRA-06). The person
   who raises an order can approve it. For Stores orders this happens by design,
   because the same permission both raises and approves them.

None of these needs a redesign. Items 2, 4 and 5 are bounded code changes.
Items 1 and 3 need operational action and evidence from outside the repository.

**Confidence:** high for repository-level conclusions, because they rest on
executed gates and source review. There is no confidence about any production
environment, because none was identified or accessed.

---

## 2. System overview

Afrinov Inventory & Operations replaces an Excel stock workbook. It covers
Stores inventory (receipts, issues to recipients, transfers, adjustments,
counts, returns, tool loans) and procurement: purchase orders with approval
limits, goods receipts, and requests for quotation that end in an award. It also
provides reporting (stock status, consumption, month-end, re-order list) and
administration (users, roles, settings, audit history).

Architecture: a modular monolith. A Fastify REST API (`/api/v1`) sits over
PostgreSQL through Prisma. A separately built React single-page app talks to
it. The API is stateless apart from an in-memory rate-limit counter.

```
Browser (React SPA, bearer token in localStorage)
   │  HTTPS (hosting not defined in repo)
   ▼
Fastify API  ── helmet, CORS allow-list, rate limit, JWT HS256, Zod
   │  ├─ modules: identity, inventory, procurement, operations,
   │  │            reporting, settings, audit, migration, health
   │  └─ shared: authorization (DB-fresh), errors, idempotency, tx
   ▼
PostgreSQL 16  ── ledger (inventory_transactions) + derived balances,
                  audit_log_entries, idempotency_keys
```

## 3. Technology stack (verified from manifests and the toolchain)

| Layer | Technology | Version evidence |
|---|---|---|
| Runtime | Node.js | 24.21.0 locally; 24 in all CI workflows and the `node:24-alpine` image |
| Package manager | npm workspaces | 11.19.0; lockfile at `afrinov-platform/package-lock.json` |
| API | Fastify 5, @fastify/jwt, helmet, cors, rate-limit, swagger | `apps/backend/package.json` |
| Validation | Zod 4, zod-to-openapi 9.1.0 | same |
| ORM / DB | Prisma 7.10.1 with `@prisma/adapter-pg`; PostgreSQL 16 | `allowScripts` pins; compose image |
| Frontend | React 19, Vite 8 (rolldown), Tailwind CSS 4, React Router | `apps/frontend/package.json` |
| Tests | Vitest 5, Playwright | both workspaces |
| CI | GitHub Actions (backend, frontend, security, CodeQL), action SHAs pinned | `.github/workflows/` |

---

## 4. Verification performed

| # | Command (from `afrinov-platform/` unless noted) | Result | Status |
|---|---|---|---|
| V1 | `npm ci` | Failed with `EPERM unlink …rolldown-binding.win32-x64-msvc.node`. Running dev servers (`dev:backend` ×2, `dev:frontend`, `dev:frontend-only`) held the file open. This is a local workstation condition, not a repository defect | FAIL (environmental) |
| V2 | `npm install` (same lockfile, to repair V1) | 0 vulnerabilities; `git status` clean afterwards (lockfile unchanged); `npm install-scripts ls`: no unreviewed scripts | PASS |
| V3 | `npm run typecheck` | Both workspaces, exit 0 | PASS |
| V4 | `npm run lint` | Both workspaces, exit 0, no warnings printed | PASS |
| V5 | `npm test` | Backend **62 files / 898 tests passed**; frontend **96 files / 1,029 tests passed**; none skipped | PASS |
| V6 | `npm run build` | Backend `tsc` and frontend Vite build, exit 0. Largest chunk is `exceljs`, 929 kB and lazy-loaded | PASS |
| V7 | `npm audit --omit=dev` and `npm audit` | `found 0 vulnerabilities` for both | PASS |
| V8 | `prisma migrate deploy` on a throwaway `postgres:16-alpine` (loopback :5439, generated credentials, removed afterwards) | All 32 migrations applied | PASS |
| V9 | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code` | Exit 0, "empty migration" | PASS |
| V10 | `npm run db:seed` on the same throwaway DB | Exit 0. Wrote 12 materials, 4 suppliers, 2 purchase orders, 27 inventory transactions and 2 projects of demo data (supports PRA-01) | PASS (behaviour is a finding) |
| V11 | `SELECT … FROM pg_constraint WHERE contype='c'` | Only PostgreSQL's built-in `information_schema` domain checks. **No application CHECK constraints** (supports PRA-14) | Evidence |
| V12 | `npm run test:integration` (apps/backend) | **18 files / 173 tests passed**, none skipped | PASS |
| V13 | Playwright E2E (`apps/frontend/e2e`) | Not run: needs a running stack, and the suite has only 7 tests (login and error handling) | NOT VERIFIED |
| V14 | Branch protection on `main` | `gh` CLI not installed; repository settings not readable | NOT VERIFIED |
| V15 | Production / staging environment, backups, monitoring | None identified in the repository; no access supplied | NOT VERIFIED |
| V16 | Docker image build | Not run. The Dockerfile was reviewed instead | NOT VERIFIED |

A first integration attempt on port 55432 failed before any test ran, because
that port is in a Windows-reserved range (`netsh … excludedportrange`). The
failures it printed are not test results; V12 is the valid run.

**Side effect to note:** V1 removed part of `node_modules` before it failed,
while the dev servers were running. V2 restored it from the unchanged lockfile.
The running dev servers may have logged errors during that window and may need
restarting.

---

## 5. Domain assessments

### A. Architecture and system design (score 3 — Established)

**Strengths.** Clear modules under `src/modules/*`, each with routes and
services, plus a `shared/` kernel for errors, authorisation, idempotency and
transactions. Twenty ADRs in `afrinov-docs/docs/00-governance/decision-log.md`
record the important choices: ledger (ADR-002/010), reversal not edit (ADR-005),
no negative stock (ADR-013), order kinds (ADR-020). An OpenAPI document is
generated from the route schemas and tested (`src/openapi/openapi.test.ts`).
Business rules live in services, not routes.

**Weaknesses.**
- `procurement.service.ts` (1,025 lines), `inventory.service.ts` (998) and
  `rfq.service.ts` (844) carry many responsibilities and are the main
  maintainability risk.
- Some reads are guarded only by authentication, while comparable reads require
  `view:reports` (PRA-19). The policy is consistent in practice, because every
  role holds `view:reports`, but not in code.
- `seed.ts` mixes required bootstrap data (roles, permissions, admin, settings)
  with demo data (PRA-01).
- The frontend production bundle includes the mock API as a lazy chunk
  (`mockApi-*.js`, 20.8 kB). A build guard prevents it from being activated
  (`src/config/buildGuard.ts`), so this is dead code rather than exposure.

### B. Functional and business correctness (score 3 — Established)

**Verified strengths.**
- **Stock ledger.** Every balance change is an `inventory_transactions` row. The
  balance is recomputed from the ledger inside the same transaction
  (`shared/inventory/balances.ts`).
- **Negative stock.** Every writer (issue, transfer, adjustment, reversal,
  return, goods receipt, count) takes sorted, transaction-scoped advisory locks
  per (material, location) before checking the balance (`lockInventoryBalances`).
  That prevents check-then-write races and deadlocks.
- **Duplicate transactions.** Inventory mutations accept an `Idempotency-Key`.
  The key is stored in the same transaction under an advisory lock, scoped by
  actor, route and concrete path (`shared/idempotency.ts`). Integration tests
  cover it (`idempotency.real-http.test.ts`).
- **Corrections.** Posted rows are never edited. The only `update` calls on the
  ledger set transfer-pair links (`inventory.service.ts:533,534,793`).
- **Purchase orders.** State changes use guarded `updateMany … where status in
  (…)` and audit records in the same transaction. Receiving takes
  `SELECT … FOR UPDATE` on the order plus per-line advisory locks. Approval
  limits are checked against the VAT-inclusive total, and unpriced lines block
  approval.
- **Money.** Prisma `Decimal` arithmetic throughout. Each line is rounded half
  up to cents before summing, as on the paper template (`po-pricing.ts`).
- **Numbering.** PO, GR and RFQ numbers are serialised by advisory locks.

**Findings.** PRA-01 (demo data in production), PRA-06 (no segregation of
duties), PRA-07 (PO edit/approve race), PRA-13 (last-admin lockout).

**Not assessed in depth.** Direct-to-site delivery, in-transit inventory and
document management are not built as distinct workflows. The PO schema has
delivery-method and delivery-address fields, but no in-transit stock state
exists. That matches the roadmap and is not a defect, but these workflows must
not be assumed available.

### C. Application security (score 2 — Developing)

**Verified controls.**
- JWT HS256 with the algorithm pinned on verification and a 12 h expiry.
  Production refuses known or short secrets: under 32 bytes, or listed in
  `INSECURE_SECRETS` (`shared/config.ts`).
- An unset `NODE_ENV` is treated as production (fail-closed).
- Account status and permissions are read from the database on every request.
  Deactivation and role changes take effect immediately
  (`shared/authorization.ts`).
- Every non-health, non-login route has `preHandler: [app.authenticate]`, and
  every mutation calls `requirePermission` (route map in the checklist,
  item SEC-3).
- CORS is an allow-list and disabled when unset outside development. Helmet sets
  `default-src 'none'` and `frame-ancestors 'none'` on API responses.
- Login is rate-limited to 5/min per IP, on its own key.
- bcrypt cost 12.
- Zod validation on request bodies.
- Prisma parameterised queries; the raw SQL uses tagged templates only.
- Errors pass through one sanitising boundary (`toErrorEnvelope`,
  `classifyPrismaError`). Raw driver messages are never returned.
- PDF uploads: authorised in `onRequest` before the body is read, 10 MB limit,
  `%PDF-` magic-byte check, served as an attachment with `nosniff`.
- API docs are off in production by default.
- Supply chain: action SHAs pinned, gitleaks with a one-entry baseline,
  `npm audit --omit=dev --audit-level=high` blocking, CodeQL weekly.
- The frontend has no `dangerouslySetInnerHTML` or `eval`.

**Findings.** PRA-04 (credential in history), PRA-05 (no password lifecycle),
PRA-06 (segregation of duties), PRA-09 (no login audit or lockout; rate limit
not proxy-aware or shared), PRA-10 (token storage, no SPA CSP), PRA-11
(session-timeout setting not enforced), PRA-12 (database exposure and superuser
role), PRA-16 (login timing enumeration).

**Not performed.** DAST, penetration testing and production configuration
review.

### D. Backend and API reliability (score 3 — Established)

- Transactions wrap each mutation together with its audit record (AUD-01 fixed
  and integration-tested in `identity-audit-atomicity.real-http.test.ts`).
- Timeouts: HTTP `requestTimeout` 30 s, body limit 1 MB, pg connect timeout
  5 s, idle 10 s, pool of 10 (`shared/db.ts`). There is **no database statement
  timeout**: a slow query keeps its pool connection after the HTTP timeout fires
  (PRA-18).
- `/health` is liveness and `/health/ready` runs a database `SELECT 1`
  (503 on failure), at the root and under `/api/v1`. Readiness does not check
  migration state.
- SIGTERM and SIGINT are handled gracefully: the server stops accepting
  requests, drains, and closes the pool. `uncaughtException` and
  `unhandledRejection` log and exit 1.
- The idempotency-key pruner runs hourly and is best-effort.
- Mutations are never retried automatically. The frontend reports
  `OUTCOME_UNKNOWN` instead.
- Procurement and master-data writes have no idempotency key (PRA-17).

### E. Database integrity and data management (score 3 — Established)

- 32 forward-only migrations apply cleanly from empty (V8), and the drift check
  is empty (V9). The CI `migration-drift` job enforces the same check.
- Primary and foreign keys and unique constraints are declared. The
  `inventory_balances` foreign keys are now in a migration (DATA-03, fixed).
  Indexes cover the hot paths (`(material_id, location_id, posted_at)`,
  status, project, reference).
- **No CHECK constraints** (V11). Balance ≥ 0, quantity > 0 on order lines,
  `received_qty ≥ 0` and the valid status for each kind are enforced only in
  application code (PRA-14).
- The runtime connects with the database owner/superuser credential (PRA-12).
  Any manual SQL bypasses every invariant.
- Two migrations share the prefix `20260101000030_` (`idempotency_keys`,
  `order_stores_stock`). They apply in lexical order. They currently touch
  disjoint objects, but the ordering is fragile (PRA-24).
- Rollback: there are no down migrations; `deployment.md` states this honestly.
- Backups, retention and restore: none (PRA-02).

### F. Frontend quality and resilience (score 3 — Established)

- Errors go through one presentation path (`src/lib/errorPresentation.ts`), and
  `api/client.ts` replaces any non-domain server message at the boundary.
  An `ErrorBoundary` exists.
- Stale-data rules: availability failures keep the data; 401/403 clear it.
- Idempotency keys for inventory forms (`src/lib/idempotency.ts`).
- At most three error toasts.
- A 401 raises a session-expired event and the sign-in page explains it.
- Production builds refuse the demo and frontend-only flags.
- Route-level code splitting; the initial `index` chunk is 135.8 kB (42.6 kB gzip).
- Gaps: no automated accessibility testing (PRA-25); no hosting or CSP
  definition (PRA-03, PRA-10); the session-timeout setting has no effect
  (PRA-11).

### G. Testing and quality engineering (score 3 — Established)

- 2,100 automated tests pass: 898 backend unit, 1,029 frontend unit, 173
  backend integration on real PostgreSQL. None are skipped. The only
  conditional skips are three `ctx.skip()` calls in `opening-balances`, and none
  fired.
- CI runs the integration suite on every backend PR, with migrations and seed
  as in production.
- The integration tests exercise the real concurrency seams: advisory locks,
  idempotency races and transaction atomicity.
- Gaps (PRA-15):
  - Playwright E2E is not in CI and covers only login and error handling.
  - No browser test of a business workflow (receive, then issue, then return;
    or PO raise, approve, receive).
  - No accessibility, performance or load tests.
  - No coverage measurement. The decision not to gate on a coverage percentage
    is documented and reasonable, but coverage is not measured at all.

### H. Performance and scalability (score 2 — Developing; nothing measured)

- Indexes match the main query shapes, and the frontend uses lazy loading.
- `recomputeBalance` aggregates the whole history of one (material, location)
  pair on every write. That is index-supported and fine at workbook scale
  (hundreds to low thousands of items). Its cost grows with history, so it
  should be measured before multi-year volumes.
- `GET /materials` and several lookups are unpaginated. Movement history caps
  at 1,000 rows.
- Rate-limit counters live in memory per process.
- **No baseline, SLO, load test or production telemetry exists.** Any
  performance claim is unverified.

### I. Observability and operational readiness (score 1 — Initial)

- Structured pino JSON logs with request and response lines. The error handler
  separates client faults (warn) from defects (error). Database outages are
  reported as 503 `SERVICE_UNAVAILABLE`, not as 401 or 500.
- **Request IDs are Fastify's per-process counter** (`req-1`, `req-2`, … as
  seen in the V5 test logs). The `onRequest` hook (`req.id || randomUUID()`)
  never runs its fallback, because `req.id` is always set. No `genReqId` and no
  incoming `x-request-id` is honoured. IDs therefore repeat after every restart
  and across instances, which weakens "quote this reference" support (PRA-08).
- No metrics, error tracking, alerting, dashboards or log shipping.

Against the seven operator questions: only "is the system operational?" can be
answered (health and readiness). The other six cannot be answered without logs
being collected somewhere, and nothing in the repository collects them.

### J. Infrastructure, deployment and CI/CD (score 2 — Developing)

- **CI is strong.**
  - SHA-pinned actions and least-privilege `permissions`.
  - Typecheck, lint, test and build for each app.
  - Real-Postgres integration and a migration-drift gate.
  - Dependency audit (blocking, production dependencies only), gitleaks
    secret scan, CodeQL.
- **CD does not exist.** No deployment workflow, staging, image registry,
  release tagging or environment configuration. No definition of how the SPA is
  served (TLS, CSP, SPA fallback, cache headers).
- The backend Dockerfile is sound: multi-stage, `npm ci` from the lockfile,
  `npm prune --omit=dev`, non-root user. It has no `HEALTHCHECK` and the base
  image is pinned by tag, not digest.
- The Compose start command runs `migrate deploy && seed && start` on every
  container start. That means:
  - schema changes are coupled to process start;
  - two replicas race to migrate (Prisma takes an advisory lock, so this is
    safe but slow);
  - demo data is seeded (PRA-01);
  - `SEED_ADMIN_PASSWORD` has to stay in the runtime environment permanently
    (PRA-21).
- Branch protection is documented as required configuration but could not be
  verified (V14).

### K. Reliability, resilience and disaster recovery (score 1 — Initial)

- What exists: graceful shutdown, fail-fast configuration, readiness that
  reports the database correctly, and transactional writes that cannot leave a
  half-posted movement.
- What is missing: backups, point-in-time recovery, a restore drill, RPO, RTO,
  an incident process with named owners, and failover. `backup-and-recovery.md`
  and `disaster-recovery.md` both state "Planned — nothing implemented". That
  statement is accurate, and it is a production blocker for a system of record
  (PRA-02).

### L. Documentation and maintainability (score 3 — Established)

- Extensive and, unusually, honest. Docs mark "Planned" against "Implemented",
  record evidence commits, and keep a risk register and an exceptions register.
- Drift (PRA-20):
  - `task_context.md` still says Prisma 5, React 18 and Tailwind 3, and lists a
    Node 20 follow-up that is already done.
  - AGENTS.md test counts (894/978) are behind the actual 898/1,029. AGENTS.md
    says these counts are only a guide.
  - The ops docs were last verified at `4e6d76f` (2026-10-09).
- Neither the README nor the deployment docs warn that the seed loads demo
  data.

---

## 6. Risk register (this assessment)

IDs prefixed `PRA-`. Where a finding duplicates an existing entry in
`docs/engineering/RISK_REGISTER.md`, that ID is given and the existing entry
stays canonical.

| ID | Domain | Title | Sev. | Priority | Existing ID |
|---|---|---|---|---|---|
| PRA-01 | Data / Deploy | Production start path seeds demo business data and overwrites demo-SKU materials on every restart | **High** | P0 | new |
| PRA-02 | DR | No backup, no restore drill, no RPO/RTO | **High** | P0 | OPS-01 |
| PRA-03 | Deploy | No production/staging environment, frontend hosting, CD or rollback procedure | **High** | P0 | OPS-01 |
| PRA-04 | Security | Bootstrap admin credential in public Git history; rotation not evidenced | **High** | P0 | SEC-07 / EX-01 |
| PRA-05 | Security | No password change, reset or forced first-login change | **High** | P0 | new |
| PRA-06 | Business control | No segregation of duties on PO approval; auto-approve ignores limits | **High** | P0 | new |
| PRA-07 | Concurrency | PO edit and approval can interleave, so an unchecked total ends up approved | Medium | P1 | new |
| PRA-08 | Observability | No metrics, alerting or error tracking; request IDs not unique | Medium | P1 | OPS-01 (part) |
| PRA-09 | Security | No login audit or lockout; rate limit not proxy-aware or shared | Medium | P1 | SEC-05 (part) |
| PRA-10 | Security | Bearer token in localStorage (12 h, no server logout); no SPA CSP | Medium | P1 | SEC-06 |
| PRA-11 | Security | `security.sessionTimeoutMinutes` is editable but enforced nowhere | Medium | P1 | new |
| PRA-12 | Security / DB | Compose publishes Postgres on all interfaces; API uses the owner role | Medium | P1 | SEC-03 |
| PRA-13 | Admin | The last administrator can demote or deactivate themselves | Medium | P1 | ARCH-01 |
| PRA-14 | DB | No CHECK constraints backing ledger and order invariants | Medium | P2 | new |
| PRA-15 | Testing | E2E not in CI; no business-workflow browser test; no a11y or perf tests | Medium | P1 | new |
| PRA-16 | Security | Login timing reveals whether an account exists | Low | P2 | new |
| PRA-17 | Reliability | No idempotency on procurement and master-data writes | Low | P2 | ARCH-02 |
| PRA-18 | Performance | No DB statement timeout; unpaginated lists; no performance baseline | Low | P2 | new |
| PRA-19 | Security | Several reads need authentication only, not a permission | Low | P2 | new |
| PRA-20 | Docs | Orientation docs out of date (versions, counts, follow-ups) | Low | P2 | DOC-01 |
| PRA-21 | Deploy | Seed runs on every start and needs the admin secret permanently in env | Low | P1 (with PRA-01) | new |
| PRA-22 | Security | Uploaded PDFs are not malware-scanned (stored in DB, served as attachment) | Info | P3 | new |
| PRA-23 | Frontend | Mock API shipped as a dead lazy chunk in production builds | Info | P3 | new |
| PRA-24 | DB | Two migrations share a timestamp prefix | Low | P3 | new |
| PRA-25 | Frontend | No automated accessibility checks | Low | P2 | new |
| — | Security | `CORS_ALLOW_ANY=true` accepted in production | Low | P2 | SEC-04 |

### Finding details

#### PRA-01 — Production start seeds demo business data (High)

- **Evidence:**
  - `apps/backend/docker-compose.yml` backend `command: sh -c "npx prisma migrate deploy && node dist/db/seed.js && node dist/index.js"`.
  - `.github/workflows/backend-ci.yml` describes the seed as the "same migration and seed steps the production container runs on start".
  - `src/db/seed.ts` `main()` unconditionally calls `ensureLocations`, `ensureSuppliers`, `ensureMaterials`, `ensureProjects`, `ensureRecipients`, `ensureRackRooms`, `ensurePurchaseOrders`, `ensureGoodsReceipt` and `ensureTransactions`. No `NODE_ENV` gate exists. `ensureMaterials` upserts by SKU with an `update:` clause, so it rewrites those rows on every run.
  - V10 confirmed the seed writes 12 materials, 4 suppliers, 2 POs, 27 ledger rows and 2 projects into an empty database.
- **Affected:** seed, Compose deployment, opening-balance import. The import refuses SKUs that already exist and refuses a second import.
- **Reproduce:** run the V8 and V10 steps against an empty database and count the rows.
- **Business impact:** fictitious stock, suppliers and orders in the system of record from day one. Stock values and month-end figures are wrong. Removing the rows means deleting ledger entries, which the design (ADR-002/005) forbids.
- **Technical impact:** any real material whose SKU matches a demo SKU is silently overwritten on each restart.
- **Remediation:** split `seed.ts` into a bootstrap seed (permissions, roles, settings catalog, admin on first run) and a demo seed. Only an explicit command or flag runs the demo seed, and it refuses when `NODE_ENV=production`. Remove the seed from the container start path, or make it bootstrap-only.
- **Verify:** a new test asserting that the production bootstrap writes no rows to materials, suppliers, projects, purchase_orders, goods_receipts or inventory_transactions. Run the V10 probe again: all those counts must be 0.

#### PRA-02 — No backup or tested restore (High)

- **Evidence:** `afrinov-docs/docs/12-operations/backup-and-recovery.md` ("Planned — nothing in the repository implements backups"); `disaster-recovery.md`; risk OPS-01.
- **Impact:** if the database host or volume is lost, all stock history and purchase orders are lost. Once the workbook is archived there is no fallback.
- **Remediation:** managed PostgreSQL with point-in-time recovery, or scheduled `pg_dump` to off-host storage with retention. An agreed RPO and RTO. A timed restore drill into a scratch database, verified by row counts and a balance-reconciliation query.
- **Verify:** a dated restore-drill record with measured RTO and RPO, filed under `docs/engineering/`.

#### PRA-03 — No production environment, CD or rollback (High)

- **Evidence:** `CI_CD_ARCHITECTURE.md` ("Stages D–F … Not implemented"); `deployment.md` ("how [the frontend] is served is not defined"); no deploy workflow in `.github/workflows/`.
- **Remediation:** choose hosting. Define the SPA host (TLS, CSP, SPA fallback, immutable asset caching), staging, image registry and tagging. Write a deployment workflow with a manual production approval, a migration step separate from app start, and a rollback procedure for forward-only migrations (expand–contract).
- **Verify:** one rehearsed staging deploy and one rehearsed rollback, recorded.

#### PRA-04 — Credential in public Git history (High)

- **Evidence:** `docs/engineering/SECURITY_CONTROLS.md` SEC-07; `EXCEPTIONS.md` EX-01. This report does not repeat the value.
- **Remediation:** confirm the account does not exist in any environment, or rotate its password and then deactivate it. Confirm the password is not reused anywhere. Record the outcome and close EX-01.
- **Verify:** a written confirmation in SECURITY_CONTROLS.md with date and owner.

#### PRA-05 — No password lifecycle (High)

- **Evidence:**
  - `updateUserSchema` (`modules/identity/user.routes.ts`) has no password field.
  - No `/auth/password` route exists.
  - `scripts/rotate-admin-password.ts` handles only `admin@afrinov.local`.
  - The seed prints "CHANGE PASSWORD ON FIRST LOGIN" (V10), but nothing enforces or allows it.
- **Impact:** a password the administrator chose, or one that leaked, cannot be changed through the product. The only options are deactivation or direct SQL against the superuser database.
- **Remediation:** an authenticated self-service change (current and new password). An admin reset with a forced change at next login. A minimum length of at least 12 characters, with the policy documented. All of it audited.
- **Verify:** unit and integration tests covering change, reset and forced change. Old tokens must be refused after a password change, either through a token-version or `passwordChangedAt` claim checked against the database.

#### PRA-06 — No segregation of duties on approval (High)

- **Evidence:**
  - `ProcurementService.approve` (`procurement.service.ts:714`) checks status and approval limit only. Nothing compares `actorId` with `po.createdById`.
  - `approvePermissionFor('stores')` returns `order:stores_stock`, the same permission used to raise a Stores order (`po-approval.ts`), so every store controller can approve their own orders.
  - ADMIN holds every permission with no default limit.
  - When `purchaseOrders.requireApprovalBeforeProcessing=false`, `submit()` auto-approves with the submitter as approver and checks no limit.
- **Impact:** one person can commit company spend without independent review. This is a standard audit finding for any procure-to-pay process.
- **Remediation:** after confirming the policy with the business, refuse approval by the order's creator (and optionally by its last editor). Apply approval limits on the auto-approve path, or remove that path. Record the decision as an ADR.
- **Verify:** a test that the creator gets 403/409 on approve, and a test that auto-approve over the limit is refused.

#### PRA-07 — PO edit/approval race (Medium; plausible, not reproduced)

- **Evidence:** `update()` reads the order with `findUnique` and writes without a row lock or a status-guarded write. Its re-approval check runs only when the order it read was already `APPROVED`. `approve()` reads the lines without a lock and guards only the status flip.
- **Scenario:** the approver loads a PENDING_APPROVAL order totalling R400 k, within their limit. Concurrently the buyer saves prices that make it R900 k; the buyer's transaction read PENDING_APPROVAL, so no re-approval is triggered. Both commit under READ COMMITTED. The order is now APPROVED at R900 k, and the limit check only ever saw R400 k.
- **Remediation:** take `SELECT … FOR UPDATE` on the order at the start of both `update` and `approve`, which `receive` already does.
- **Verify:** an integration test that runs both operations concurrently and asserts that either the approval is refused or the order returns to PENDING_APPROVAL.

#### PRA-08 — Observability (Medium)

- **Evidence:** `server.ts` creates Fastify without `genReqId` or `requestIdHeader`. The test logs show `"requestId":"req-1"`. No metrics endpoint, APM or alerting configuration exists.
- **Remediation:** `genReqId: () => randomUUID()` (optionally honouring a validated inbound `x-request-id` from a trusted proxy). Ship logs to a central store. Add an uptime check on `/health/ready`. Alert on the 5xx rate and on readiness failure. Optionally add error tracking.
- **Verify:** request IDs are unique across restarts. A synthetic database outage raises an alert within the agreed window.

#### PRA-09 — Login auditing and brute-force controls (Medium)

- **Evidence:** `AuthService.login` writes no audit record for success or failure, and there is no lockout logic. Rate-limit keys use `req.ip` without `trustProxy`, in a per-process store.
- **Impact:** a credential-stuffing attempt or a misuse investigation leaves no trace. Behind a reverse proxy, every user shares one 5-per-minute login budget.
- **Remediation:** audit `LOGIN_SUCCEEDED` and `LOGIN_FAILED` events (email hash, IP, user agent). Set `trustProxy` to the known proxy hop count. Add a per-account failure back-off. Use a shared limiter store if more than one instance runs.

#### PRA-10 — Token storage and CSP (Medium)

- **Evidence:** `apps/frontend/src/api/client.ts:44-62` uses `localStorage['afrinov.token']`. JWTs are signed with `expiresIn: '12h'`. No server-side logout or revocation exists other than deactivation. No CSP is defined for the SPA host.
- **Remediation:** define a strict CSP at the SPA host (`script-src 'self'`, `connect-src` set to the API origin, `frame-ancestors 'none'`). Shorten the token lifetime, or add a token version that logout and password change increment. Moving to an HttpOnly cookie is optional and needs CSRF design.

#### PRA-11 — Session timeout setting has no effect (Medium)

- **Evidence:** `security.sessionTimeoutMinutes` (default 60) is defined in `settings.service.ts` and editable in `SettingsSections.tsx`. No idle timer reads it in the frontend, and the backend token lifetime is a fixed 12 h.
- **Impact:** administrators believe sessions end after 60 minutes of inactivity, but a session on a shared stores PC stays signed in for 12 hours.
- **Remediation:** implement an idle sign-out that reads the setting, or remove the setting until it is enforced.

#### PRA-12 — Database exposure and privileges (Medium)

- **Evidence:** compose `ports: "5432:5432"`. `docker ps` on the assessed workstation shows `backend-db-1 … 0.0.0.0:5432->5432/tcp`. `DATABASE_URL` uses `POSTGRES_USER`, the owner role.
- **Remediation:** in production, do not publish the database port. Use separate migration (owner) and runtime (DML-only) roles. Revoke `UPDATE` and `DELETE` on `inventory_transactions` and `audit_log_entries` from the runtime role.

#### PRA-13 — Last-admin lockout (Medium)

See ARCH-01. `UserService.update` allows the last active ADMIN to remove their
own ADMIN role or deactivate themselves, and recovery then needs database
access. Remediation: refuse that change inside the transaction.

#### PRA-14 — No database CHECK constraints (Medium)

- **Evidence:** V11.
- **Remediation:** add CHECK constraints, each with an orphan/violation preflight like DATA-03:
  - `inventory_balances.quantity >= 0`
  - `purchase_order_lines.ordered_qty > 0` and `received_qty >= 0`
  - `goods_receipt_lines.quantity > 0`
  - `purchase_orders.vat_rate BETWEEN 0 AND 100`
- **Verify:** integration tests that try invalid SQL inserts and expect a constraint error.

#### PRA-15 — Test-pyramid gaps (Medium)

- **Evidence:** `.github/workflows/frontend-ci.yml` has no Playwright step. `apps/frontend/e2e` holds 7 tests. No axe or a11y dependency.
- **Remediation:** add three browser smoke tests to CI against a seeded stack: sign in and issue stock; receive against a PO; a role that lacks a permission sees the action refused. Add axe checks to the key pages.

#### PRA-16 through PRA-25

Short entries; see the table above and the remediation plan.

- PRA-16: `AuthService.login` returns before bcrypt when the user is missing. Compare against a dummy hash instead.
- PRA-17: extend `withIdempotency` to PO create/submit/approve/receive and RFQ award.
- PRA-18: add `statement_timeout` (for example 15 s) to the runtime role or connection, paginate `/materials`, and record a baseline.
- PRA-19: require `view:reports` on `/inventory-transactions*`, `/materials*`, `/locations*`, `/projects*`, `/recipients*` and `/settings*` reads, or document "authenticated read" as the policy.
- PRA-20: refresh `task_context.md` and the ops doc evidence commits.
- PRA-21: resolved together with PRA-01.
- PRA-22: accept with a documented risk, or scan uploads.
- PRA-23: exclude `mock/` from production builds.
- PRA-24: no action unless a future migration depends on the order; renumber neither.
- PRA-25: add axe.

---

## 7. Maturity scores

| Domain | Score | Basis |
|---|---|---|
| A. Architecture | 3 | Clear modules, ADRs, tested OpenAPI; large services |
| B. Business correctness | 3 | Ledger, locks, idempotency verified by integration tests; PRA-01/06/07 |
| C. Security | **2** | Strong API controls, but open credential, no password lifecycle, no segregation of duties, no login audit |
| D. Backend reliability | 3 | Transactions, timeouts, graceful shutdown, readiness; no statement timeout |
| E. Database | 3 | Clean migrations with drift gate; no CHECK constraints; superuser runtime |
| F. Frontend | 3 | Disciplined error and stale handling, idempotent forms; no a11y automation or CSP |
| G. Testing | 3 | 2,100 passing tests including 173 real-DB; E2E thin and not in CI |
| H. Performance | 2 | Sensible indexes and splitting; **nothing measured** |
| I. Observability | **1** | Structured logs and health only; IDs not unique; no metrics or alerts |
| J. Infra / CI/CD | 2 | Excellent CI; no CD, environments or SPA hosting |
| K. Reliability / DR | **1** | No backup, restore, RPO or RTO |
| L. Documentation | 3 | Thorough and candid; some drift |

The average is about 2.4. **The average is not the verdict.** Domain K (score
1, no recoverability) and the P0 findings in C and B each block go-live on
their own.

## 8. Production blockers

1. PRA-01: demo data seeded by the production start path.
2. PRA-02: no backup and no tested restore.
3. PRA-03: no defined production environment, deployment or rollback.
4. PRA-04: SEC-07 credential not evidenced as rotated.
5. PRA-05: no password change or reset.
6. PRA-06: no segregation of duties on approval. This applies only if
   procurement is enabled at go-live. With `PROCUREMENT_ENABLED=false` it does
   not block a Stores-only launch.

## 9. Recommendations: the five most important actions

1. **Separate bootstrap from demo seeding** and take demo data out of every
   production path (PRA-01, PRA-21). This is small and removes a data-integrity
   defect that cannot be undone.
2. **Stand up staging and production with managed PostgreSQL, PITR and a timed
   restore drill**, and record RPO and RTO (PRA-02, PRA-03).
3. **Close SEC-07 with written evidence** (PRA-04).
4. **Add password change, admin reset with forced change, and login auditing**
   (PRA-05, PRA-09).
5. **Enforce segregation of duties and lock the order row in update and
   approve** (PRA-06, PRA-07). Then add central logs, unique request IDs and
   a readiness alert (PRA-08).

## 10. Claims versus code versus evidence

| Claim (docs) | Code | Verified here |
|---|---|---|
| "Stock can never go below zero" | Enforced in every writer under advisory locks | Integration tests pass; **no DB constraint** |
| "Accounts are created by an administrator" | True | Yes |
| Seed is "idempotent" | True for inserts, but re-applies demo material fields on every run | V10 plus code review |
| "CHANGE PASSWORD ON FIRST LOGIN" | No mechanism exists | Confirmed absent |
| Session timeout setting "Inactivity time before a session is signed out" | Not read anywhere | Confirmed absent |
| Request ID ties an error to a log line | True within one process lifetime only | Test logs show `req-1` |
| Backups | "Planned" | None, as stated |
| Branch protection makes CI gates enforcing | Documented as configuration | **Not verified** |

## 11. Limitations

No production, staging or hosting environment was identified or accessed. No
live credentials were used. No DAST, penetration test, load test, Docker image
build or Playwright run was performed. Findings marked "plausible" were
established by code reading and were not reproduced. The absence of a finding in
an area that was not exercised is not evidence that the area is safe.

---

## 12. Remediation addendum (2026-10-30)

The code-level items of the [remediation plan](PRODUCTION_REMEDIATION_PLAN.md)
were implemented on branch `feature/production-readiness-remediation`. Verified
on that branch:

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` (both workspaces) | PASS, no warnings |
| `npm test` | Backend 64 files / 929 tests; frontend 99 files / 1,044 tests; all pass |
| `npm run build` | PASS |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Throwaway PostgreSQL 16: `migrate deploy` (34 migrations), drift check | PASS, empty diff |
| Production-mode bootstrap, then `db:check-bootstrap` | PASS, 0 rows in every business table |
| Demo seed with `NODE_ENV=production` | Refused (exit 1), as required |
| `npm run test:integration` | 20 files / 181 tests pass, none skipped |

**Resolved:** PRA-01, PRA-05, PRA-07, PRA-09, PRA-11, PRA-13 (ARCH-01),
PRA-14, PRA-16, PRA-19, SEC-04. **Implemented, policy confirmation pending:**
PRA-06 (ADR-021). **Partly resolved:** PRA-08 (unique request IDs; no central
logging or alerting yet), PRA-10 (no SPA CSP yet), PRA-12 (Compose on
loopback; no separate DB role yet), PRA-18 (statement timeout; no pagination
or baseline yet), SEC-05 (`TRUST_PROXY` setting).

**Verdict after remediation: still C — NOT PRODUCTION READY.** The remaining
blockers cannot be closed from the repository:

1. PRA-02: no backup or tested restore.
2. PRA-03: no production or staging environment, deployment pipeline or
   rehearsed rollback.
3. PRA-04: SEC-07 credential rotation not evidenced.

Once these three are closed with evidence, and ADR-021 is confirmed, the
system can be re-assessed for a **conditionally production ready** verdict.
The condition would be the P1 operational items: central logs and alerts, a
SPA CSP, a separate DB role, and E2E smoke tests in CI.
