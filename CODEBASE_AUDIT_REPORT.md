# Full-System Engineering Audit, Quality Assurance & Production Readiness Assessment

**Audit date:** 2026-10-21
**Repository:** afrinov-inventory-operations
**Branch / commit:** main / 3a35a1b19d42296ba6f7aa6572986645e0a3385f
**Status:** Completed for repository evidence available on this date
**Overall decision:** **Not Production Ready**
**Change scope:** This document only. No application code, tests, migrations, environment files, or deployment data were changed.

## 1. Executive summary

The repository contains a substantial modular-monolith implementation: React SPA, Fastify API, Prisma/PostgreSQL data layer, inventory ledger and reports, unit and real-HTTP integration tests, a Playwright login test, backend/database Docker configuration, and two GitHub Actions workflows. Request validation, centralized error handling, security headers, rate limiting, server-side permission checks, current account-status checks, and detailed domain documentation provide a useful baseline.

Local typecheck, lint, unit tests (54 backend files / 727 tests; 68 frontend files / 690 tests), and production build passed on Node 24.21.0. Frontend tests emitted React act(...) warnings. The build emitted an ExcelJS direct-eval warning and a 1,056 kB minified ExcelJS chunk warning. Production dependency audit reported zero advisories; full graph reported eight development/build advisories (six high, two moderate).

The system is **not production ready**. A safe database-free probe reproduced a configuration fail-open: an unrecognized NODE_ENV accepted a repository-known weak JWT secret and enabled API docs by default. Static review found a concurrent stock-out race that can violate the no-negative-stock rule, Compose publication of PostgreSQL and the plain-HTTP API without a production network/TLS boundary, and no repository backup or tested restore arrangement. Backend CI and Docker target Node 20 while locked Vitest requires Node 22.12 or 24. Production SPA hosting, release promotion, and rollback are not defined or verified.

Archived September 22 authorization and placeholder-secret boot failures were rechecked. Current route code authenticates protected routes, applies server-side permission checks, checks account activity in the database, and Compose requires an injected JWT secret. Those earlier source/configuration defects appear resolved; runtime deployment remains unverified because no database, backend environment file, Docker command, or production environment was available.

There are **0 Critical, 5 High, 8 Medium, and 3 Low findings**. High findings and selected Medium findings block release until closed or formally resolved.

## 2. Overall production-readiness decision

### Decision: Not Production Ready

Mandatory gates remain open: stock integrity under concurrency; fail-closed environment validation; TLS and database ingress boundaries; backup and tested restore; supported CI/runtime alignment; safe user API responses; a signed-off role-read matrix; production frontend deployment and rollback; and UAT/cutover evidence.

No production environment was available to verify possible external controls. The repository contains no accepted-risk decision or named individual accepting residual risk.

## 3. Scope, exclusions, assumptions, and limitations

### Examined

- Repository structure, Git branch/status, current and archived audit reports, roadmap, technical-debt register, readiness checklist, UAT plan, and architecture/security/testing/operations docs.
- Workspace manifests, lockfiles, scripts, installed tool versions, workflows, Dockerfile, Compose, TypeScript/React source, Prisma schema, SQL migrations, and test organization.
- Focused login/authorization, inventory issue/transfer/adjust/count/return/reversal, receipt posting, user administration, audit history, and report paths.
- Unit suites, lint, typecheck, production build, npm audit, and a database-free configuration probe.

### Excluded or unavailable

- PostgreSQL, production/staging credentials or data, Docker engine, external hosting, GitHub run history, production firewall/TLS, backup/monitoring service, or browser session against a live API.
- Exhaustive line-by-line review of every UI component/service; review focused on security, integrity, deployment, operations, and important workflows.
- Destructive migrations, seed/import commands, intrusive exploitation, or production traffic.
- Manual accessibility review, load testing, penetration testing, disaster recovery exercise, and business UAT.

The roadmap describes the platform becoming the inventory system of record after workbook cutover. Documentation is evidence of requirements and open decisions; the technical-debt register was last verified against code on 2026-10-09. No external infrastructure or risk-acceptance evidence was supplied.

## 4. System architecture and repository inventory

- Repository root contains governance, product, domain, operations docs, reports, roadmap and GitHub workflows.
- **afrinov-platform/** is the active npm workspace monorepo, using **afrinov-platform/package-lock.json**. A separate root package-lock.json has no root package.json and is not the active lockfile.
- **afrinov-platform/apps/backend/**: Fastify 5, TypeScript, Zod, Prisma 5, PostgreSQL 16, scripts, unit and real-HTTP integration tests.
- **afrinov-platform/apps/frontend/**: React 18, React Router 7, Vite 8, Tailwind 3, jsdom/Vitest tests, mock API, and Playwright E2E files.
- **afrinov-docs/docs/** contains product, business, domain, API, security, testing, validation, and operations docs.
- Languages are TypeScript, SQL, CSS, and Markdown; package manager is npm workspaces.
- Backend entry points are apps/backend/src/index.ts and src/server.ts; SPA starts at apps/frontend/src/main.tsx and routes in src/App.tsx.
- No AGENTS.md was found.

The system is a modular monolith. Backend folders group identity, inventory, procurement, operations, reporting, settings, audit, health, and migration. Boundaries are conventions rather than enforced dependencies. The frontend separates pages, components, hooks, API, configuration, and mock mode.

Login verifies bcrypt hashes and issues a 12-hour JWT. Protected routes verify the token and current user activity; handlers load permissions from PostgreSQL. The inventory ledger is inventory_transactions; inventory_balances is recomputed after movements.

Inventory, locations/racks, receipts, issue/transfer/adjustment, stock counts, returns/reversals, tools, suppliers, projects/recipients, purchase orders/goods receipts, reports/exports, settings, identity, audit/activity, health, and workbook import tooling exist in source. Frontend-only mode uses an in-memory mock API. Production SPA hosting, backup automation, CD promotion, and production observability are absent from repository evidence. Domain events have no application handler registrations.

## 5. Audit methodology and standards

The review used repository inventory, static source/configuration inspection, workflow tracing, current unit/build/static checks, and the package manager advisory endpoint. Findings distinguish reproduced behavior, static risk, and environment-blocked checks.

Severity reflects realistic exploitability, business impact, scope, and operational effect. High normally blocks production; Medium requires planned remediation and explicit release decision; Low is localized or longer-term. Priority is separate: P1 release blocker, P2 near-term hardening, P3 longer-term improvement. No project-specific CVSS score was invented. Npm advisory severities are reported as returned and contextualized by dependency use.

No application code or test assertions were changed. No destructive or production operation was executed.

## 6. Environment and tooling

- Audit date: 2026-10-21, Africa/Johannesburg.
- Node 24.21.0, npm 11.19.0, Windows PowerShell.
- Commands run from afrinov-platform/.
- Prisma CLI/client 5.22.0; Vite 8.2.2; Tailwind 3.4.19; Vitest 5.0.0.
- Vitest engine requirement: Node ^22.12.0 || ^24.0.0 || >=26.0.0.
- apps/backend/.env was absent; DATABASE_URL, JWT_SECRET, SEED_ADMIN_PASSWORD, and POSTGRES_PASSWORD were unset. Values were not printed.
- Docker was unavailable. No production database or records were accessed.
- Npm registry access was used for dependency auditing.

## 7. Verification matrix

| Check | Outcome | Evidence / limitation |
|---|---|---|
| Git status | Pass at start | Clean main before report update |
| npm run typecheck | Pass, exit 0 | Backend Prisma generation and backend/frontend TypeScript checks |
| npm run lint | Pass, exit 0 | Backend and frontend ESLint |
| Backend unit tests | Pass | 54 files; 727 tests |
| Frontend unit/component tests | Pass with warnings | 68 files; 690 tests; React act(...) warnings |
| npm run build | Pass with warnings | Exit 0; ExcelJS direct-eval and 1,056 kB chunk |
| npm audit --omit=dev | Pass | Zero production dependency advisories |
| npm audit | Findings | Exit 1; 8 dev/build advisories: 6 high, 2 moderate |
| NODE_ENV probe | Reproduced fail-open | Safe output: {"accepted":true,"environment":"staging","insecureSecretAccepted":true,"apiDocsEnabledByDefault":true}; dummy non-connecting URL; no DB connection |
| PostgreSQL integration suite | Blocked / not run | No .env, DATABASE_URL, or Docker |
| Playwright E2E | Not run | Needs database/backend; no E2E script or CI job |
| Docker image / Compose | Not run | Docker unavailable |
| Migrations against PostgreSQL | Not run | No DB; migration command not issued |
| Live API and browser UX | Not run | Backend environment/database unavailable |
| Backup/restore | Not run; no repo implementation | Operations doc says backup is planned and absent |
| Remote CI | Not verified | Workflow files inspected; no remote run history queried |
| Accessibility/load/security/DR testing | Not run | No suitable environment/tools/data |

ExcelJS chunk measured 1,056.26 kB minified (246.95 kB gzip). Build warnings did not fail the build; no performance target was supplied.

## 8. Findings summary

| Severity | Count | IDs |
|---|---:|---|
| Critical | 0 | — |
| High | 5 | AUD-001–AUD-005 |
| Medium | 8 | AUD-006–AUD-013 |
| Low | 3 | AUD-014–AUD-016 |

## 9. Detailed findings register

### AUD-001 — Unknown NODE_ENV bypasses production security policy

- **Classification / severity / priority / status:** Security/configuration vulnerability; High; P1; reproduced with safe runtime probe.
- **Evidence:** afrinov-platform/apps/backend/src/shared/config.ts:42-62, 93-98; src/server.ts:226-243.
- **Reproduction:** Set NODE_ENV to staging, DATABASE_URL to a dummy non-connecting URL, JWT_SECRET to a repository-known weak placeholder; call loadConfig() and isApiDocsEnabled().
- **Expected / observed:** Unknown environment should fail startup. Call succeeded, weak placeholder was accepted, and API docs defaulted on. Output is in the verification matrix.
- **Root cause / impact:** NODE_ENV is cast without runtime validation. Weak-secret rejection runs only for exact production; docs default on for every value except exact production. A typo or staging deployment can use a public signing key and permit forged tokens if reachable.
- **Remediation:** Validate environment names against a runtime enum, fail closed on unknown values, and default docs off outside development.
- **Closure criteria:** Tests prove invalid names fail; supported environments each have explicit secret/docs policy; production/staging tests reject known placeholders.

### AUD-002 — Concurrent stock-outs can violate the no-negative-stock invariant

- **Classification / severity / priority / status:** Data-integrity/reliability risk; High; P1; static inspection, not reproduced against PostgreSQL.
- **Evidence:** apps/backend/src/modules/inventory/inventory.service.ts:549-570, 722-763, 782-810; apps/backend/src/shared/inventory/balances.ts:6-20. Stock count locks a location at apps/backend/src/modules/inventory/stock-count.service.ts:137-139. No issue/transfer/adjust concurrency test was found; integration tests do test concurrent tool checkout.
- **Expected / observed:** Concurrent movements must preserve nonnegative stock and ledger/balance equality. Issue, transfer, and negative adjustment read and validate without a common lock or explicit serializable transaction, then write/recompute. Concurrent requests can both pass on the same stale balance.
- **Impact:** Overselling, negative ledger totals, or stale balance can corrupt issues, reorders, reports, and reconciliation.
- **Remediation:** Serialize by material/location with row/advisory locks or serializable transactions and retry handling, consistently across movement paths.
- **Closure criteria:** PostgreSQL tests submit competing issue/transfer/negative-adjustment calls and prove no negative/stale balance and atomic transfers.

### AUD-003 — Compose publishes PostgreSQL and plain-HTTP API without a production boundary

- **Classification / severity / priority / status:** Security/deployment risk; High; P1; configuration verified, actual exposure unknown.
- **Evidence:** apps/backend/docker-compose.yml:8-14, 30-58; backend server has no TLS listener.
- **Expected / observed:** Database should be private to backend/operators and bearer traffic protected by TLS. Compose maps host ports 5432 and 4000 without explicit host binding or TLS proxy. A host firewall or external proxy may compensate; none was available to inspect. App uses the configured POSTGRES_USER role, with no separate restricted runtime role defined here.
- **Impact:** If run on a public host without restrictions, PostgreSQL is directly reachable and API tokens can traverse plain HTTP.
- **Remediation:** Remove/bind database host mapping for production, use restricted runtime DB role, and publish API only behind documented TLS and ingress policy.
- **Closure criteria:** Topology and grants are documented; external port scan confirms only approved TLS endpoints are exposed.

### AUD-004 — No backup or tested restore exists in repository evidence

- **Classification / severity / priority / status:** Reliability/data-loss risk; High; P1; absent in repo, external provider state unknown.
- **Evidence:** afrinov-docs/docs/12-operations/backup-and-recovery.md; apps/backend/docker-compose.yml:13-14; workbook-replacement-roadmap.md:228-236, 312-321.
- **Expected / observed:** Before cutover, automated backups, retention, recovery objectives, and tested restore protect the inventory system of record. Compose defines a PostgreSQL volume only; operations doc says backup automation is planned/absent; roadmap backup/restore gates remain unchecked.
- **Impact:** Loss, corruption, or operator error may remove the inventory record with no verified recovery.
- **Remediation:** Configure managed/automated encrypted backup, retention, owner, RPO/RTO, and isolated restore procedure.
- **Closure criteria:** Dated restore exercise meets approved RPO/RTO and reconciles ledger and balances.

### AUD-005 — Backend CI and Docker target Node 20; Vitest requires Node 22.12+

- **Classification / severity / priority / status:** CI/runtime reliability; High; P1; static mismatch, remote CI not run.
- **Evidence:** .github/workflows/backend-ci.yml uses Node 20 for checks/integration; apps/backend/Dockerfile targets Node 20; Vitest 5.0.0 declares ^22.12.0 || ^24.0.0 || >=26.0.0. Frontend workflow explicitly says Vitest and related tools need Node 22+ and fail to start on Node 20.
- **Expected / observed:** CI and deployed image should use supported runtime. Local checks pass on Node 24.21.0 while backend CI runs same Vitest major on Node 20. Hosted result was not checked.
- **Impact:** Backend test checks may fail before assertions; local and production runtime differ.
- **Remediation:** Align backend CI, integration and container with supported Node policy.
- **Closure criteria:** CI suites and image build/start pass on selected runtime; README policy agrees.

### AUD-006 — User update response returns a password hash

- **Classification / severity / priority / status:** Sensitive-data exposure; Medium; P1; static path verified.
- **Evidence:** apps/backend/src/modules/identity/identity.service.ts:118-155; src/modules/identity/user.routes.ts:59-69.
- **Expected / observed:** No response includes password hashes. Update re-reads full Prisma user without safe field selection, returns it, and PATCH serializes it directly. Normal list/detail select safe fields. Hash values are not reproduced.
- **Impact:** ADMIN caller can collect bcrypt hashes for offline cracking or credential reuse.
- **Remediation:** Return explicit safe projection and define response schema excluding password material.
- **Closure criteria:** Tests prove create/update/list/detail/error responses contain no passwordHash/password fields.

### AUD-007 — Authenticated read routes bypass role-level permissions

- **Classification / severity / priority / status:** Access-control policy gap; Medium; P1 pending business read-policy approval; static path verified.
- **Evidence:** apps/backend/src/modules/inventory/material.routes.ts:48-67, 129-140; src/modules/inventory/inventory.routes.ts:125-159; shared/permissions.ts:96. Material service returns full rows, including unitCost.
- **Expected / observed:** Reads follow an approved role/resource matrix. Several catalogue/location/supplier/transaction routes require app.authenticate but no requirePermission. VIEWER has only view:reports yet can call them directly.
- **Impact:** Authenticated roles may see unit costs and movement data beyond assigned permissions. Frontend hiding is not server authorization.
- **Remediation:** Approve read matrix and add server checks with allowed/denied role tests.
- **Closure criteria:** Every route has a permission decision; HTTP tests prove unauthorized reads return 403 without records.

### AUD-008 — General audit history omits operations and some audits are non-atomic

- **Classification / severity / priority / status:** Auditability/partial-failure gap; Medium; P2; static inspection.
- **Evidence:** issue/transfer/adjust in apps/backend/src/modules/inventory/inventory.service.ts:534-615, 715-817; separate writes in apps/backend/src/modules/inventory/material.service.ts:75-139 and apps/backend/src/modules/identity/identity.service.ts:74-155; stock count transaction at apps/backend/src/modules/inventory/stock-count.service.ts:137-205.
- **Expected / observed:** Required changes appear in consolidated audit history and audit failure does not leave untracked mutation. Issue/transfer/adjust are absent from general AuditLogEntry, though movement ledger retains actor/time. Material/user changes may commit before audit insert.
- **Impact:** Consolidated investigations are incomplete; API error can prompt a retry after business write committed.
- **Remediation:** Define audit action matrix and insert required records in same transaction as mutation.
- **Closure criteria:** Integration tests prove event coverage and rollback when audit insert fails.

### AUD-009 — Inventory-balance foreign keys are missing from migrations

- **Classification / severity / priority / status:** DB integrity/migration gap; Medium; P2; source mismatch verified, live DB unavailable.
- **Evidence:** apps/backend/prisma/schema.prisma:547-558; apps/backend/prisma/migrations/20260101000000_initial/migration.sql:253-260, 456-475; apps/backend/src/db/migrations.test.ts:55-102.
- **Expected / observed:** Migration creates material/location FKs declared by InventoryBalance. Initial migration creates only composite primary key; no later migration adds FKs. Regression test expected-FK list omits them.
- **Impact:** Direct SQL/future scripts can create orphan balance rows; schema and deployed DB can drift.
- **Remediation:** Add forward migration after validating existing rows and assert constraints in migration tests.
- **Closure criteria:** Fresh/upgrade PostgreSQL installs apply; invalid references are rejected.

### AUD-010 — Ledger and audit immutability is application convention only

- **Classification / severity / priority / status:** DB tamper-resistance/least privilege; Medium; P2; static review.
- **Evidence:** apps/backend/prisma/schema.prisma:520-542, 600-614; migrations; Compose DB role config.
- **Expected / observed:** Runtime credentials cannot edit/delete history. API corrections use reversals, but migrations contain no trigger/grant/revoke protections and Compose defines no separate restricted runtime role.
- **Impact:** Compromised credentials or operator error can alter history outside API.
- **Remediation:** Separate migration owner/runtime user; restrict runtime grants and protect ledger/audit rows or use immutable external audit storage.
- **Closure criteria:** Runtime-role tests prove historical updates/deletes are rejected while normal app writes work.

### AUD-011 — Full dependency audit reports eight development/build advisories

- **Classification / severity / priority / status:** Dependency security; Medium; P2; registry audit verified.
- **Evidence:** npm audit on 2026-10-21: eight advisories (six high, two moderate) in development/build graph. Includes Vite 8.2.2 and Tailwind 3.4.19 dependency chain (braces, chokidar, fast-glob, micromatch, postcss-nested, postcss-selector-parser). npm audit --omit=dev found zero. Tailwind fix crosses to major 4.3.3.
- **Impact:** Findings affect build/dev tooling and dev-server exposure; production dependency graph was clean in snapshot.
- **Remediation:** Apply compatible Vite update and assess Tailwind migration; avoid force upgrades without CSS/build review.
- **Closure criteria:** Full/production audits clean or remaining dev advisories have explicit owner/exposure acceptance; build and visual checks pass.

### AUD-012 — Production SPA hosting and release/rollback path are undefined

- **Classification / severity / priority / status:** Deployment readiness gap; Medium; P1; repo evidence verified, external setup unknown.
- **Evidence:** afrinov-docs/docs/12-operations/deployment.md; CI workflows; backend Compose.
- **Expected / observed:** Repeatable deployment covers frontend/API/database, migrations, smoke checks and rollback. Repository builds frontend files but has no serving target or deploy job. Docs note forward-only migrations/manual rollback planning; no staging evidence available.
- **Impact:** Local build does not prove complete deploy or recovery.
- **Remediation:** Document hosting, secrets, migrations, smoke checks, schema compatibility, rollback and owners; rehearse in staging.
- **Closure criteria:** Repeatable staging deploy, login/read/controlled movement smoke tests, rollback rehearsal.

### AUD-013 — Monitoring, alert routing, and service objectives are not established

- **Classification / severity / priority / status:** Operational reliability gap; Medium; P2; repository docs verified, external service unknown.
- **Evidence:** apps/backend/src/server.ts:60-68, 210-222; afrinov-docs/docs/12-operations/monitoring.md; afrinov-docs/docs/14-validation/readiness-checklist.md.
- **Expected / observed:** Operators receive actionable health/error alerts and correlate requests. Structured logs and health/readiness routes exist; docs say metrics/alerts planned; no log shipping, alert owner, or SLO recorded.
- **Impact:** Failures may be missed or hard to diagnose.
- **Remediation:** Select monitoring/log destination, define alerts/owners, agree recovery/availability objectives.
- **Closure criteria:** Staging failure triggers alert; logs searchable by request ID; alert routing documented.

### AUD-014 — JWT stored in localStorage for 12 hours

- **Classification / severity / priority / status:** Browser session exposure risk; Low; P2; static review, no XSS exploit demonstrated.
- **Evidence:** apps/frontend/src/api/client.ts:28-36; apps/backend/src/server.ts:105-108.
- **Expected / observed:** Session lifetime/storage matches documented threat model. Bearer token is in localStorage; no HttpOnly cookie is used.
- **Impact:** Same-origin script injection could read token until expiry or deactivation. No concrete XSS was confirmed.
- **Remediation:** Assess Secure/HttpOnly/SameSite cookie or document bearer storage with CSP/XSS and session lifetime controls. security.sessionTimeoutMinutes does not set JWT expiry.
- **Closure criteria:** Approved session design and browser tests for expiry/revocation/hosted-origin headers.

### AUD-015 — Domain events have no application handlers

- **Classification / severity / priority / status:** Functionality/dead code; Low; P3; static search verified.
- **Evidence:** apps/backend/src/shared/events.ts, inventory dispatches, apps/backend/src/modules/settings/settings.service.ts:196-205. registerDomainEventHandler is called in tests but no application module registers handlers.
- **Expected / observed:** Notification settings trigger promised behavior or are marked unavailable. Dispatches currently reach no consumer.
- **Impact:** Users may believe notifications are enabled when none are delivered.
- **Remediation:** Register required handlers or remove/disable unused settings and update docs.
- **Closure criteria:** Integration test proves notification or UI/docs clearly mark feature unavailable.

### AUD-016 — E2E test uses fixed demo credential and is not wired into CI

- **Classification / severity / priority / status:** QA/test hygiene; Low; P2; static review, E2E not run.
- **Evidence:** afrinov-platform/apps/frontend/e2e/login.spec.ts:9-10, afrinov-platform/apps/frontend/e2e/global-setup.ts, afrinov-platform/apps/frontend/package.json, and .github/workflows/frontend-ci.yml. Credential is redacted.
- **Expected / observed:** Browser tests use generated credentials and isolated DB in CI. Current test assumes database seeded with same literal; no E2E script or CI job exists.
- **Impact:** Browser-to-API regressions may escape checks; demo credential could be reused accidentally.
- **Remediation:** Inject generated masked credentials, use disposable DB, add E2E script/CI job.
- **Closure criteria:** CI provisions DB/browser, seeds random credential, runs Playwright, tears down.

## 10. Functional correctness and requirements assessment

Issue validates positive quantities, active entities and available balance; transfer posts paired rows transactionally; negative adjustment checks stock; returns reference issues; reversal uses unique reversal reference. Stock counts lock by location, compare expected/current quantities, and write count details, adjustments and audit together. Unit tests cover many validation/state boundaries. Real PostgreSQL behavior and concurrency are unverified (AUD-002).

Procurement, receipts, approvals, reports, exports and settings exist with service tests. Purchase-order approval requirements remain open (TD-003). Workbook mappings still need business decisions (TD-001/TD-002). No UAT, import reconciliation, physical count, parallel run, or cutover sign-off was provided. Read visibility by role is unclear (AUD-007).

## 11. Architecture and code-quality assessment

The modular monolith is proportionate to product size. Risks include unenforced inventory/procurement boundaries (TD-004), duplicate balance recompute (TD-009), dead event dispatch (AUD-015), unused settings/permissions (TD-010/TD-011), unbounded lists (TD-019), and project status enforced in service code rather than DB constraint (TD-024). Prisma comments incorrectly say the app does not write balances and a trigger refreshes them. No broad rewrite is justified.

## 12. Frontend and UX assessment

Page/component tests, mock API mode, error/loading components, permission hooks, and production build exist. Live browser, keyboard/focus, contrast, screen-reader, responsive, accessibility, and visual-regression checks were not performed. No accessibility/visual CI job was found. LocalStorage token is AUD-014. ExcelJS export chunk is 1,056 kB minified. React tests emit act(...) warnings. Dashboard threshold labels hard-code bands despite configurable settings (TD-025).

## 13. Backend and API assessment

Positive controls: Fastify body limit/request timeout, reviewed Zod schemas, centralized public error shape, request logs, Helmet, CORS allow-list, login/global rate limits, health/readiness, JWT checks, and server permissions on writes.

Gaps: read authorization matrix (AUD-007), hash in user update response (AUD-006), unbounded lists, incomplete OpenAPI response schemas, no live HTTP run, and no distributed rate-limit store if multiple replicas are used.

## 14. Database and data-integrity assessment

Schema uses keys, relations, unique constraints, decimal quantities/money, and reporting indexes. Ledger/derived-balance design is appropriate. Risks: missing balance FKs (AUD-009), movement race (AUD-002), no DB immutability (AUD-010), no backups (AUD-004), forward-only migrations, and migration tests that inspect DDL text without PostgreSQL. No live schema comparison was possible. No migration, seed, import, reset, or data-changing command was run.

## 15. Security assessment

Bcrypt cost 12, JWT verification, DB-fresh account status, server-side permissions, request validation, Helmet, explicit CORS, and auth rate limiting were observed. Earlier archived auth defect is not present in reviewed source.

Material security findings: AUD-001, AUD-003, AUD-006, AUD-007, AUD-010, AUD-014. No confirmed SQL injection/XSS was established in the focused review; this is not a penetration test. No intrusive testing or live credentials were used. No credential values are reproduced.

## 16. Testing and quality assurance assessment

Unit/component suites pass. Backend unit tests mock Prisma and do not prove PostgreSQL isolation, migrations, constraints, query plans, or rollback behavior. Real HTTP integration tests exist but were blocked. Playwright exists without package script or CI (AUD-016). No coverage report, role-matrix integration, stock concurrency, accessibility, visual, performance, or disaster-recovery test was run. act(...) warnings should be cleaned up.

## 17. Performance and reliability assessment

Production build passes with ExcelJS direct-eval and large-chunk warnings. No latency/data-volume target or measured runtime bottleneck exists. Some lists use unbounded findMany; growth may increase memory/response cost. Stock concurrency is the main integrity risk. Health/readiness and structured logs exist, but retry/idempotency, alert delivery, and recovery need verification. No load/soak test was run.

## 18. Build, dependencies, configuration, CI/CD, deployment

The active workspace is afrinov-platform/. Local typecheck, lint, tests and build pass on Node 24.21.0/npm 11.19.0. Backend CI and Docker use Node 20 (AUD-005). Frontend manifest pairs plugin-react 4 with Vite 8; build passes but peer compatibility should be reconciled. Full dependency audit is not clean; production-only audit is clean in snapshot. Compose defaults NODE_ENV to production and requires injected JWT secret, but unknown environment names bypass policy (AUD-001). Backend container applies migrations/seeds at startup; migrations are forward-only. Frontend serving and deployment workflow are absent (AUD-012). Remote CI was not checked.

## 19. Documentation and maintainability

The repository has detailed product, domain, API, security, test and operations docs. This root CODEBASE_AUDIT_REPORT.md is current audit authority; docs/archive reports remain historical. Technical-debt/readiness docs were last verified 2026-10-09; UAT is DRAFT and backup, monitoring, some deployment items remain planned.

This update supersedes the 2026-10-12 root report’s test counts and dependency evidence. That report’s install recovery, missing backend .env/Docker, ExcelJS warning and open debt remain useful history. September 22 auth/Compose findings remain archived and are historical.

## 20. Technical debt and architectural risks

Relevant open/partly resolved register items: TD-001/002 workbook ambiguity; TD-003 approval rule; TD-004/009 boundaries and duplicate balance logic; TD-005/006 FKs and immutability; TD-007 events; TD-008 audit coverage; TD-010/011 unused timeout/notifications/permissions; TD-014 broad reads; TD-017/018 E2E credential and Node mismatch; TD-019 idempotency/pagination; TD-024/025 project status and labels. This is carry-forward; only items explicitly described above were rechecked.

## 21. Production release blockers

1. AUD-001: reject invalid NODE_ENV; verify secret/docs policy.
2. AUD-002: serialize movements and prove invariant with PostgreSQL tests.
3. AUD-003: establish TLS, restrict DB ingress and use restricted runtime role.
4. AUD-004: automate backup and complete restore exercise.
5. AUD-005: align CI/container Node and confirm tests run.
6. AUD-006/AUD-007: remove hashes from responses; approve/enforce read matrix.
7. AUD-012/AUD-013: define/rehearse hosting, health checks, rollback, monitoring and owners.
8. Complete integration/E2E/UAT, migration dry-run/reconciliation, physical count and cutover sign-off.

No P0 incident is confirmed because no production environment was accessible. If Compose ports are currently public, restrict them before use.

## 22. Prioritized remediation roadmap

| Phase | IDs | Action / risk reduction | Acceptance / dependency |
|---|---|---|---|
| P0 — Immediate containment | AUD-003 | Confirm DB/API are not publicly exposed while production topology is established. | Infrastructure owner verifies bindings, firewall and TLS; host unavailable here. |
| P1 — Release blockers | AUD-001/002 | Fail closed on environment; serialize movements. | Agree env list and DB locking strategy; config and PostgreSQL tests. |
| P1 — Release blockers | AUD-003/004/012/013 | Define network, SPA host, secrets, backups/restore, health/alerts, rollback. | Hosting/provider and RPO/RTO decisions; staging deploy/restore evidence. |
| P1 — Release blockers | AUD-005 | Align CI/container runtime. | Successful CI and image build/start under selected Node policy. |
| P1 — Release blockers | AUD-006/007 | Remove hash response; approve/enforce read matrix. | Business sign-off; API allow/deny tests. |
| P2 — Near-term hardening | AUD-008/009/010 | Atomic audit coverage, FK migration, restricted DB role/immutable history. | Validate data; fresh/upgrade DB and runtime-role tests. |
| P2 — Near-term hardening | AUD-011/016 | Resolve advisories; isolate E2E credentials and run Playwright in CI. | Plan Tailwind migration if needed; disposable DB/browser CI. |
| P2 — Near-term hardening | AUD-014 | Approve token/session policy and verify hosted-origin headers. | Security decision and browser expiry/revocation tests. |
| P3 — Longer-term | AUD-015 and remaining TDs | Implement/remove events, deduplicate balances, paginate lists, reconcile settings/labels/module conventions. | Product priority and data-volume evidence. |

Effort estimates are omitted because hosting, business rules, recovery targets, and access policy remain unresolved.

## 23. Residual risks and risk acceptance

No production/staging environment was available to verify external mitigations. Production dependency audit was clean on 2026-10-21; dev advisories remain. Stock concurrency awaits PostgreSQL tests. UAT, import reconciliation, physical count, parallel run, cutover, and named risk acceptance are absent. Docs list Product/Engineering generally; no individual risk owner was identified. This audit accepts no risks.

## 24. Recommended follow-up tests and verification

1. Config tests for invalid NODE_ENV and each supported environment.
2. PostgreSQL concurrency tests for issue, transfer, negative adjustment.
3. User response tests excluding password hashes.
4. HTTP role matrix for every route.
5. Audit-insert failure rollback tests.
6. Fresh/upgrade migration tests for balance FKs and runtime-role restrictions.
7. Backend CI and production container on supported Node.
8. Isolated Playwright CI with random credential/disposable DB.
9. Keyboard/focus/contrast checks at desktop/tablet sizes.
10. Performance checks at agreed data volumes and service objectives.
11. Staging deploy, port/TLS scan, restore exercise, alert test, rollback rehearsal.
12. UAT, import dry run, reconciliation, physical count and parallel-run sign-off.

## 25. Audit limitations and unverified areas

No real DB connection; applied schema, transaction isolation and grants remain unverified. Docker, production network/TLS, external secret store, frontend host, remote CI, backup, monitoring, browser E2E, accessibility, load, penetration and disaster recovery were not checked. Dependency audit is point-in-time. Static findings need stated runtime/acceptance evidence to close.

## 26. Evidence appendix

### Commands

- npm run typecheck — exit 0.
- npm run lint — exit 0.
- npm test — backend 54 files/727 tests; frontend 68 files/690 tests.
- npm run build — exit 0; ExcelJS direct-eval and large-chunk warnings.
- npm audit — exit 1; eight development advisories (six high, two moderate).
- npm audit --omit=dev — exit 0; zero production advisories.
- node --experimental-strip-types --input-type=module -e ... — safe configuration probe; no DB access.
- git status --short --branch — clean before report update; final diff reviewed.
- Focused rg --files / rg -n searches — inventory, route auth, migrations, event registrations, scripts and config.

### Important references

- Auth/config: apps/backend/src/shared/config.ts, src/server.ts, src/shared/authorization.ts, src/shared/permissions.ts.
- Inventory: apps/backend/src/modules/inventory/inventory.routes.ts, inventory.service.ts, stock-count.service.ts, apps/backend/src/shared/inventory/balances.ts.
- User API: apps/backend/src/modules/identity/identity.service.ts, user.routes.ts.
- Database: apps/backend/prisma/schema.prisma, prisma/migrations/, apps/backend/src/db/migrations.test.ts.
- Deployment: apps/backend/Dockerfile, docker-compose.yml, .github/workflows/backend-ci.yml, .github/workflows/frontend-ci.yml.
- Frontend: apps/frontend/src/api/client.ts, playwright.config.ts, e2e/.
- Operations: afrinov-docs/docs/12-operations/backup-and-recovery.md, deployment.md, monitoring.md; docs/14-validation/readiness-checklist.md, uat-plan.md; root workbook-replacement-roadmap.md.

## 27. Final audit consistency check

Every finding has an ID, classification, severity, priority, status, evidence, impact, remediation, and closure criteria. Static risks are labeled. Blocked/not-run tests are not passes. Counts agree: 0 Critical, 5 High, 8 Medium, 3 Low. Readiness reflects verified defects and unresolved mandatory controls. Historical reports remain archived; this is the current root report. No application code or test assertion changed.
