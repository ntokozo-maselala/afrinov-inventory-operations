# Production remediation plan

**Basis:** [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md)
(2026-10-30, commit `60a1432`).
**Status:** code-level remediation implemented on branch
`feature/production-readiness-remediation` (2026-10-30, authorised by the
repository owner). Infrastructure and operational items remain open. See
the status table below.

## Implementation status (2026-10-30)

| Task | Status | What was done / what remains | Evidence |
|---|---|---|---|
| P0-1 Seed split | **Done** | Bootstrap-only `db:seed`; `db:seed:demo` refused in production; `SEED_ADMIN_PASSWORD` needed only to create the admin; CI proves both (ADR-023) | `src/db/seed.ts`, `seed-mode.ts` (+ tests), `scripts/check-bootstrap-only.ts`, `backend-ci.yml` |
| P0-2 Environments, backups, restore drill | **Open** | Needs a hosting decision, RPO/RTO and a drill. Nothing in the repository can close it | — |
| P0-3 Deployment pipeline, rollback | **Open** | Needs a registry and target. Compose comments now point to separate migration steps | — |
| P0-4 Close SEC-07 | **Open** | Operational: rotate or remove the account and record it. Cannot be done from code | `SECURITY_CONTROLS.md` SEC-07 |
| P0-5 Password lifecycle | **Done** | Change, admin reset, forced change (also for the bootstrap admin), session cut-off, 12-character minimum, audit (ADR-024) | Migration `20260101000032`; `modules/identity/*`; `server.ts`; `pages/ChangePassword.tsx`; `integration/password-lifecycle.real-http.test.ts` |
| P0-6 Segregation of duties | **Done** | The creator of a project order cannot approve it; Stores orders keep ADR-021 (the store controller approves his own within his limit); auto-approve bounded by the submitter's authority; own project orders left out of "Waiting for my approval" (ADR-022) | `po-approval.ts`, `procurement.service.ts`, `integration/production-controls.real-http.test.ts` |
| P1-1 PO row lock | **Done** | `FOR UPDATE` in `update`, `approve`, `submit`; concurrent test repeats 10 times | `integration/production-controls.real-http.test.ts` |
| P1-2 Observability | **Partly done** | UUID request IDs (inbound IDs not adopted). Central logs, uptime check and alerts need hosting | `server.ts` `genReqId`; `server.test.ts` |
| P1-3 Login hardening | **Done (code)** | Audit of every attempt; 5-failure / 15-minute lockout; `TRUST_PROXY`. Shared limiter store only needed with more than one replica | `identity.service.ts`, `config.ts` |
| P1-4 Session controls | **Partly done** | Idle sign-out driven by the setting. SPA CSP needs the hosting config; token lifetime stays 12 h, now bounded by idle sign-out and password-change revocation | `components/IdleSignOut.tsx` |
| P1-5 Database roles | **Partly done** | Compose publishes PostgreSQL on loopback only. Separate runtime role needs the hosting database | `docker-compose.yml` |
| P1-6 Last-admin guard | **Done** | 409 inside the transaction, serialised | `identity.service.ts` (+ tests) |
| P1-7 CI E2E smoke | **Open** | Not started | — |
| P2-1 CHECK constraints | **Done** | 10 constraints with violation preflight | Migration `20260101000033`; integration test |
| P2-3 Statement timeout | **Partly done** | `statement_timeout` 30 s, configurable. Pagination and baseline open | `shared/db.ts` (+ tests) |
| P2-4 Constant-time login | **Done** | Dummy bcrypt comparison for unknown emails | `identity.service.ts` |
| P2-6 Route-guard test | **Done** | Fails for any unauthenticated route not on the public list | `src/route-guard.test.ts` |
| P2-8 Refuse `CORS_ALLOW_ANY` in production | **Done** | `loadConfig` throws | `config.ts` (+ tests) |
| P2-9 Docs refresh | **Done** | `task_context.md`, AGENTS.md, backend README, `.env.example`, ops docs, ADR-022 to ADR-024 | — |
| P2-2, P2-5, P2-7, P2-10, P3-* | **Open** | Not started | — |

### Decisions taken

- **ADR-022 (segregation of duties)** applies to project orders. Stores orders
  follow ADR-021 (merged in #122): the store controller approves his own,
  within the limit an admin set. Decided by the repository owner on
  2026-10-30 when this branch was merged with main.

### Upgrade notes for existing databases

- Migrations `20260101000032` (additive columns) and `20260101000033` (CHECK
  constraints, with preflight) must be applied. The second refuses to run if
  existing rows break a rule, and lists the counts.
- Existing accounts are unaffected until an administrator resets a password.
- A development database seeded before this change keeps its demo data; use
  `npm run db:seed:demo` for new ones.

## Working rules for every task

- One task per branch and pull request, kept small.
- Record a baseline first (failing test or probe), then fix, then re-run.
- `npm run typecheck && npm run lint && npm test && npm run build` from
  `afrinov-platform/`, plus `npm run test:integration` for backend changes.
- A schema change ships with a migration. The CI `migration-drift` job enforces
  this.
- Update `docs/engineering/RISK_REGISTER.md` and the affected docs in the same
  pull request.
- No new dependency without a written reason in the PR.

---

## P0 — Production blockers

### P0-1 · Separate bootstrap seeding from demo data (PRA-01, PRA-21)

- **Owner:** Backend · **Size:** S–M · **Authorisation:** code change
- **Work:**
  1. Split `src/db/seed.ts` into `bootstrap.ts` (permissions, roles, settings
     catalog, first admin) and `demo-seed.ts` (everything else).
  2. `demo-seed.ts` throws when `NODE_ENV=production` and runs only via an
     explicit script (`npm run db:seed:demo`).
  3. `npm run db:seed` and `dist/db/seed.js` run the bootstrap only.
  4. The bootstrap needs `SEED_ADMIN_PASSWORD` only when it creates the admin,
     so the secret can leave the runtime environment afterwards.
  5. Update the Compose command, the backend README, `deployment.md` and CI.
     CI integration tests that rely on demo rows call the demo seed explicitly.
- **Acceptance criteria:**
  - Bootstrap on an empty database leaves 0 rows in `materials`, `suppliers`,
    `projects`, `recipients`, `purchase_orders`, `goods_receipts` and
    `inventory_transactions`.
  - Running bootstrap twice changes no row: same `updated_at` values for
    roles and settings rows.
  - The demo seed refuses under `NODE_ENV=production`.
- **Verification:** a unit test for the production refusal; an integration probe
  (the report's V10 query) after bootstrap only; the full integration suite
  still passes.

### P0-2 · Production and staging environments with backups and restore drill (PRA-02, PRA-03)

- **Owner:** Platform / Ops, with Management for RPO/RTO · **Size:** M–L ·
  **Authorisation:** infrastructure and spend
- **Work:**
  1. Choose hosting for the API container, managed PostgreSQL 16 with
     point-in-time recovery, and a static SPA host.
  2. Create a staging environment that mirrors production.
  3. Define the SPA host config: TLS, a CSP (see P1-4), SPA fallback to
     `index.html`, long-cache hashed assets, and no cache on `index.html`.
  4. Set `CORS_ORIGIN`, `JWT_SECRET` (≥ 32 random bytes, in a secret store),
     `NODE_ENV=production` and `trustProxy` (see P1-3).
  5. Agree RPO and RTO in writing. A suggested starting point is RPO ≤ 15 min
     with PITR and RTO ≤ 4 h.
  6. Run a restore drill: restore to a new database, start a staging API
     against it, then run the reconciliation query from
     [OPERATIONAL_RUNBOOK.md §8](OPERATIONAL_RUNBOOK.md#8-data-integrity-incident)
     and the smoke tests.
- **Acceptance criteria:**
  - A restore drill record exists with timestamps, measured RTO and the
    achieved recovery point.
  - Reconciliation returns zero mismatched balances after the restore.
  - The staging URL serves the SPA with a CSP header and the API answers
    `/health/ready` with 200.
- **Verification:** the drill record and header capture are filed under
  `docs/engineering/`.

### P0-3 · Deployment pipeline and rollback procedure (PRA-03)

- **Owner:** Platform · **Size:** M · **Authorisation:** CI/CD and
  infrastructure change
- **Work:**
  1. Workflow: build the image once and tag it with the commit SHA, push it to
     a registry, deploy to staging, run smoke tests, then require a manual
     approval for production.
  2. Run migrations as a separate one-off step before the new version starts,
     not in the container `command`.
  3. Write down expand–contract for schema changes: additive migration first,
     code that tolerates both shapes, and destructive changes only in a later
     release. Rollback then means redeploying the previous image tag.
  4. Add `HEALTHCHECK` to the Dockerfile, or a platform health check on
     `/health/ready`.
- **Acceptance criteria:**
  - One staging deploy and one rollback to the previous tag have been
    rehearsed and recorded.
  - A production deploy cannot run without the approval step.
- **Verification:** workflow run links in `CI_CD_ARCHITECTURE.md`.

### P0-4 · Close SEC-07 (PRA-04)

- **Owner:** Application / security owner · **Size:** S · **Authorisation:**
  operational
- **Work:** confirm in every environment that the account named in SEC-07
  either does not exist or has been rotated and then deactivated. Confirm the
  password is not reused anywhere else (email, other systems). Update
  `SECURITY_CONTROLS.md` and close EX-01. Do not rewrite Git history unless
  that is decided separately: rotation is the control, and the gitleaks
  baseline already scopes the exception.
- **Acceptance criteria:** a dated, signed-off entry in `SECURITY_CONTROLS.md`
  and EX-01 marked closed.

### P0-5 · Password lifecycle (PRA-05)

- **Owner:** Backend + Frontend · **Size:** M · **Authorisation:** code and
  schema change
- **Work:**
  1. Add `users.must_change_password` (bool) and
     `users.password_changed_at` (timestamptz), with a migration.
  2. `POST /api/v1/auth/password` (authenticated): current and new password.
     Minimum 12 characters; reject a new password equal to the email or the
     current password.
  3. `POST /api/v1/users/:id/password-reset` (`manage:users`): sets a
     temporary password and `must_change_password=true`.
  4. `authenticate` refuses tokens issued before `password_changed_at`, which
     is already loaded by the per-request user lookup. While
     `must_change_password` is set, it allows only `/auth/me` and
     `/auth/password`.
  5. Audit both actions in the same transaction.
  6. Frontend: a change-password screen, forced after a reset or on the first
     admin login.
- **Acceptance criteria:**
  - After a change, the old token gets 401.
  - A reset user can call nothing except change-password until they change it.
  - Audit rows exist for both actions.
- **Verification:** unit tests for each rule; integration tests for the token
  cut-off and the forced-change gate; one E2E test.

### P0-6 · Segregation of duties on approval (PRA-06)

Required before procurement is enabled in production. Not required for a
Stores-only launch with `PROCUREMENT_ENABLED=false`.

- **Owner:** Business owner (policy) + Backend · **Size:** S–M ·
  **Authorisation:** policy decision, then code
- **Work:**
  1. Agree the rule with the business and record it as ADR-022. Suggested
     rule: the approver must differ from the creator, for both order kinds;
     ADMIN is not exempt.
  2. Enforce it in `approve()` inside the transaction.
  3. On the auto-approve path (`requireApprovalBeforeProcessing=false`), apply
     `approvalBlock` with the submitter's limit, or remove the path.
  4. Show the reason in `GET /purchase-orders/:id/approval` (`canApprove:
     false`, with a reason).
- **Acceptance criteria:**
  - The creator approving gets 409 `INVALID_STATE` (or 403) with a clear
    message.
  - Auto-approve over the submitter's limit is refused.
- **Verification:** unit tests for the rule; integration tests for both order
  kinds.

---

## P1 — Required before production

| ID | Task | Findings | Acceptance criteria | Verification |
|---|---|---|---|---|
| P1-1 | Lock the PO row at the start of `update()` and `approve()` (`SELECT … FOR UPDATE`) | PRA-07 | A concurrent edit and approve can never produce an APPROVED order whose total was not checked | Integration test running both with `Promise.all`, repeated 20 times |
| P1-2 | Observability baseline: `genReqId` with a UUID (and a validated inbound `x-request-id` from a trusted proxy); ship logs centrally; uptime check on `/health/ready`; alerts on readiness failure and on 5xx rate above 2% for 5 min; optional error tracking | PRA-08 | IDs unique across restarts; alert fires within 5 min of a staging DB stop | Staging drill record |
| P1-3 | Login hardening: audit `LOGIN_SUCCEEDED` and `LOGIN_FAILED`; per-account back-off after 5 failures in 15 min; `trustProxy` set to the real hop count; shared limiter store if more than one replica | PRA-09, SEC-05 | Failed logins visible in the audit log; one user's lockout does not affect another; limiter keys by client IP behind the proxy | Unit and integration tests; staging check of `req.ip` |
| P1-4 | Session controls: SPA CSP at the host; idle sign-out driven by `security.sessionTimeoutMinutes`, or remove the setting; token lifetime ≤ 8 h, or token-version revocation on logout and password change | PRA-10, PRA-11 | The CSP header is present and the app works under it; idle sign-out happens at the configured minutes | Header capture; frontend unit test with fake timers |
| P1-5 | Database roles: runtime role with DML only; no `UPDATE`/`DELETE` on `inventory_transactions` (except the pair-link column) or `audit_log_entries`; DB port not published in production | PRA-12, SEC-03 | The runtime role cannot `DELETE FROM audit_log_entries`; the app works fully on that role | Integration suite run under the restricted role |
| P1-6 | Last-admin guard in `UserService.update` | PRA-13, ARCH-01 | Demoting or deactivating the last active ADMIN returns 409 | Unit and integration test |
| P1-7 | CI E2E smoke: Playwright against a seeded stack (sign-in and issue; receive against a PO; refused action for a lower role) | PRA-15 | The job is required on PRs | CI run link |

---

## P2 — Reliability and maintainability

| ID | Task | Findings | Acceptance criteria |
|---|---|---|---|
| P2-1 | CHECK constraints with a violation preflight: `inventory_balances.quantity >= 0`, `ordered_qty > 0`, `received_qty >= 0`, `goods_receipt_lines.quantity > 0`, `vat_rate BETWEEN 0 AND 100` | PRA-14 | Invalid raw inserts fail; the migration aborts with a clear message if existing rows would violate |
| P2-2 | Idempotency keys on PO create/submit/approve/receive and RFQ award | PRA-17, ARCH-02 | A retried request replays the first response; integration test per route |
| P2-3 | `statement_timeout` (e.g. 15 s) for the runtime role; paginate `GET /materials`; record p95 latency for the top 10 endpoints at expected volume | PRA-18 | A baseline document exists; a slow query is cancelled |
| P2-4 | Constant-time login (dummy bcrypt compare when the user is missing) | PRA-16 | Response time for an unknown and a known email differs by < 20% over 50 samples |
| P2-5 | Permission-scope reads, or document the "authenticated read" policy | PRA-19 | Route-guard test enumerates every route and its permission |
| P2-6 | Automated route-guard test using `onRoute`: every route except an allow-list has `authenticate` | SEC-3 | Test fails if a new route is unguarded |
| P2-7 | axe checks on login, dashboard, issue stock, receive stock, PO detail | PRA-25 | No serious or critical violations |
| P2-8 | Reject `CORS_ALLOW_ANY=true` in production | SEC-04 | `loadConfig` throws |
| P2-9 | Refresh `task_context.md`, AGENTS.md counts and ops doc evidence commits | PRA-20 | Docs match manifests |
| P2-10 | Retention policy for audit log and ledger (legal/tax: typically 5+ years in South Africa; confirm) | D-9 | Written policy |

---

## P3 — Longer term

| ID | Task | Findings |
|---|---|---|
| P3-1 | Split `procurement.service.ts`, `inventory.service.ts` and `rfq.service.ts` by use case | Architecture |
| P3-2 | Exclude `src/mock/` from production builds | PRA-23 |
| P3-3 | Malware scanning for uploaded PDFs, or a documented risk acceptance | PRA-22 |
| P3-4 | Pin base images by digest; SBOM and image signing once a registry exists | Supply chain |
| P3-5 | Measure `recomputeBalance` cost at multi-year volumes; consider an incremental balance update with periodic reconciliation if needed | Performance |
| P3-6 | Coverage reporting (informational, not a gate) | Testing |

## Suggested order

P0-1 and P0-4 are quick and independent, so start with them. P0-5 and P0-6
are code work that can proceed in parallel with P0-2 and P0-3, which depend on
hosting decisions. P1 items should land before the parallel run in roadmap
Phase 4.
