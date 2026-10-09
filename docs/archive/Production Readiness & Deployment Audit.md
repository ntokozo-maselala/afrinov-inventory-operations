# Production Readiness & Deployment Audit

**Audit date:** 2026-10-06  
**Repository audited:** `afrinov-platform/` within this workspace  
**Scope:** Read-only source, configuration, dependency, build, test, and local-runtime audit. No tracked application code or configuration was changed. Prisma client generation was run only to validate the declared generated-client build path; the worktree remained clean.

## 1. Executive Summary

**The system must not be deployed to production.** It has a well-structured prototype implementation with meaningful controls—JWT authentication, database-backed server-side permission checks, bcrypt password hashing, input validation on most mutations, security headers, rate limits, health/readiness endpoints, structured request logs, and a ledger/derived-balance model. Post-generation typecheck, lint, build, schema validation, and 574 unit/frontend tests were successful.

However, the evidence also establishes release-blocking defects and gaps:

- Concurrent stock mutations can bypass negative-stock prevention and produce incorrect inventory balances.
- Concurrent posting of the same goods receipt can duplicate receipt ledger entries and overstate stock/PO receipt quantities.
- Goods-receipt PO-line references are neither foreign-key constrained nor validated as belonging to the selected PO/material.
- The declared Compose deployment has an invalid build context, no production frontend/TLS/reverse-proxy architecture, and could not be started because Docker Desktop was unavailable.
- The full test command exits non-zero (one stale migration test fails); database integration and Playwright E2E suites did not run successfully; no CI/CD workflow exists.
- Backup, restoration, RPO, RTO, monitoring/alerting implementation, and production environment have no operational evidence.

This is a production prototype with substantial implementation progress, not a release-ready inventory system. The biggest risk is **silent inventory and procurement data corruption under normal concurrent operator use**.

### Audit execution summary

| Check | Result | Evidence |
|---|---|---|
| Backend/frontend lint | ✅ Pass | `npm run lint` completed with exit 0. |
| Typecheck, before Prisma generation | ❌ Fail | `npm run typecheck` reported missing generated Prisma model/types. |
| Explicit Prisma generation | ✅ Pass | `npx prisma generate --schema prisma/schema.prisma`; required downloading the Windows engine. |
| Typecheck, after generation | ✅ Pass | `npm run typecheck` completed with exit 0. Root scripts do not perform generation. |
| Production build | ✅ Pass with warnings | `npm run build` completed with exit 0 after generation. Vite reported deprecated esbuild settings, direct `eval` in ExcelJS, and a 1.06 MB minified ExcelJS chunk. |
| Unit/frontend test command | ❌ Fail | `npm run test`: backend **298 passed, 1 failed**; frontend **276 passed**. |
| Database integration suite | ❌ Not executed | `npx vitest run --config vitest.integration.config.ts` failed before tests because `SEED_ADMIN_PASSWORD` was absent; all 7 were skipped, then teardown threw. |
| Browser E2E | ❓ Not run successfully | Playwright discovers 2 tests, but its setup requires a local `.env`, live seeded PostgreSQL, and a stale hard-coded password. |
| Prisma schema validation | ✅ Pass | `DATABASE_URL=<non-secret dummy> npx prisma validate --schema prisma/schema.prisma`. |
| Production dependency audit | ❌ Findings | `npm audit --omit=dev --json`: 5 high, 2 moderate; rooted in TailwindCSS/build dependencies. |
| Docker/Compose smoke test | ❌ Not verified | Docker daemon unavailable. Static inspection finds a Compose build-context error. |

## 2. System Baseline

### Implemented system and scope

Afrinov is a **single-site, single-tenant inventory and procurement modular monolith** intended to replace spreadsheet-based stock operations. Its central rule is that `inventory_transactions` is the source-of-truth ledger and `inventory_balances` is a derived read model.

| Concern | Actual implementation/evidence |
|---|---|
| Frontend | React 18 SPA, Vite, TypeScript, Tailwind; entry point `apps/frontend/src/main.tsx`; routing in `src/App.tsx`. |
| Backend | Node/Fastify/TypeScript; entry `apps/backend/src/index.ts`; server bootstrap/middleware in `src/server.ts`. |
| API | 65 routes mounted beneath `/api/v1`, plus root `/`, `/health`, and `/health/ready`. |
| Database | PostgreSQL through Prisma 5; schema `apps/backend/prisma/schema.prisma`; three migration directories. |
| Authentication | Email/password login, bcrypt cost 12, HS256 JWT with 12-hour expiry, DB-active-account check per authenticated request. |
| Authorization | Permission grants are read from the DB per request by `shared/authorization.ts`; route mutations usually invoke `requirePermission`. |
| Core business domains | Materials, locations, racks, projects, suppliers, purchase orders, goods receipts, inventory issue/transfer/adjustment, reports, user/settings/audit reads. |
| Documents/files | No binary document-management or upload implementation. `deliveryRef` is text only. No upload middleware/storage provider exists. |
| External integrations | No external business SaaS/payment/email/storage integration found. PDF/XLSX exports are generated in-process. |
| Local deployment artifact | Backend `Dockerfile` and `apps/backend/docker-compose.yml`; compose supplies PostgreSQL 16 and backend only. |
| Frontend production artifact | Vite static `dist/`; no frontend container, static-host configuration, reverse proxy, HTTPS/TLS, or SPA rewrite manifest found. |
| CI/CD/infrastructure | No `.github/workflows`, GitLab CI, Azure pipeline, Kubernetes, Helm, Terraform, or deployment pipeline found. |
| Documentation | Extensive product/design-operation intent docs exist under `afrinov-docs/`; runtime backend `README.md` is skeletal. Operations docs are policy aspirations, not evidence of a configured production service. |

### Functional capability assessment

| Capability | Implemented | Functional evidence | Tested | Production-safe | Evidence |
|---|---:|---|---|---|---|
| Login/session/logout | Yes | API and frontend flow implemented | Unit/route tests; no real DB/browser pass | Conditional | `auth.routes.ts`, `identity.service.ts`, `auth.tsx`. |
| Users and role assignment | Yes | Create/list/update user routes | Unit/service and route coverage | Conditional | `user.routes.ts`, `identity.service.ts`; no role-management API. |
| Materials | Yes | List/detail/create/edit | Service tests; no DB integration | Conditional | `material.routes.ts`, `material.service.ts`. |
| Locations/racks/projects | Yes | CRUD/archive/status behavior | Service tests | Conditional | `location.service.ts`, `rack.service.ts`, `project.service.ts`. |
| Suppliers | Partial | List/create only; no edit/delete endpoint | Service tests | Conditional | `procurement.routes.ts`; model has no Prisma `@unique`, relies on `citext` migration. |
| Purchase-order lifecycle | Yes | Draft → approval → ship → deliver/cancel | Unit tests | Conditional | `procurement.service.ts`; no real-DB concurrency test. |
| Goods receipts | Yes | Create, submit-on-create, post to ledger | Unit tests | **No** | `goods-receipt.service.ts`, `inventory.service.ts`; P0/P1 integrity findings below. |
| Initial stock / receiving | Yes | `POST /stock-items`, GR, PO delivery | Unit tests | Conditional | `stock-item.service.ts`, inventory/procurement services. |
| Issues/transfers/adjustments | Yes | Ledger entries and balance recomputation | Unit/route tests | **No** | `inventory.service.ts`; concurrent stock protection is unsafe. |
| Stock calculations/low stock | Yes | Decimal ledger and derived balances | Unit tests | Conditional | `shared/inventory/balances.ts`, reporting services. |
| Reporting/export | Yes | JSON, XLSX, PDF routes | Unit tests/build | Conditional | `reporting.routes.ts`, `report.service.ts`, `report-export.ts`. |
| Search/filter/sorting | Partial | Filters exist for many views; multiple lists lack pagination | Unit tests vary | Conditional | Route/service `findMany` calls. |
| Files/documents | No | No uploads/storage/ACL/malware pipeline | Not applicable | No (if required scope) | Platform README explicitly excludes Document Management. |
| Tool checkout/check-in | No dedicated workflow | Tool category only; issue records a transaction | Not tested end-to-end | No (if required scope) | Platform README explicitly defers it. |
| Mock/demo mode | Yes, development-only | In-memory mock API behind build-time flags | Frontend tests | Unsafe if enabled in release | `VITE_FRONTEND_ONLY`, `VITE_DEMO_AUTH_ENABLED`; banner appears only in frontend-only mode. |

### Database baseline

The schema has UUID/string primary keys, a composite `InventoryBalance(materialId, locationId)` key, relevant ledger/report indexes, PostgreSQL enums for most state values, and many foreign keys. Good protections include user/email, material/SKU, location/name/code, PO/GR number, and transfer pair uniqueness.

Important exceptions:

- `GoodsReceiptLine.purchaseOrderLineId` is a scalar only: no Prisma relation, no database foreign key, and no ownership/material consistency check.
- `InventoryTransaction.recipientId` is a scalar only: no user FK or validation of an active recipient.
- Quantity signs/zero constraints and adjustment/type relationship are application conventions, not database `CHECK` constraints.
- `Project.status` is free text in the database, although the API uses a TypeScript/Zod union.
- The supplier uniqueness safeguard is a later `citext` unique index migration, not represented as Prisma `@unique`; its own SQL requires manual duplicate clean-up before deployment if duplicate data already exists.

### Configuration and secret inventory

No actual `.env` files were present during the audit; they are ignored by `afrinov-platform/.gitignore`. `git ls-files` found only example env files. Do not treat that as evidence of secure secret management in an eventual hosting environment.

| Variable | Required | Secret | Environment | Validated | Safe |
|---|---:|---:|---|---|---|
| `DATABASE_URL` | Yes | Yes | Backend | Presence only | Conditional; connection/SSL/host policy not validated. |
| `JWT_SECRET` | Yes | Yes | Backend | Presence plus a known-insecure deny-list in production | Conditional; no length/entropy validator or rotation plan. |
| `NODE_ENV` | No (defaults production) | No | Backend | Restricted type only by cast | Conditional. Fail-closed default is positive. |
| `PORT` | No | No | Backend | Numeric range checked | Yes. |
| `HOST`, `LOG_LEVEL` | No | No | Backend | No allow-list | Conditional. |
| `CORS_ORIGIN` | Required for cross-origin production SPA | No | Backend | Parsed only | Conditional; empty production setting disables CORS. |
| `CORS_ALLOW_ANY` | No | No | Backend | No production prohibition | No; an operator can enable arbitrary credentialed origins. |
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_GLOBAL` | No | No | Backend | Positive number fallback | Conditional; in-memory limits are not shared across replicas. |
| `SEED_ADMIN_PASSWORD` | Yes when production seed first creates admin | Yes | Seed/Compose | Seed checks it in production | Conditional; compose does not declare it, and README/E2E use a stale default password. |
| `SEED_ADMIN_EMAIL`, `REPORT_CURRENCY` | No | No | Backend | Minimal/defaulted | Conditional. |
| `VITE_FRONTEND_ONLY` | No | No | Frontend build | Boolean equality check | No for production if true—uses mock data. |
| `VITE_DEMO_AUTH_ENABLED` | No | No | Frontend build | Boolean equality check | No for production if true—local demo auth replaces server login. |
| `VITE_DEMO_AUTH_EMAIL/PASSWORD` | No | **Yes if supplied** | Frontend build | No startup validation | No—Vite embeds `VITE_*` values in the browser bundle. |

## 3. Production Readiness Scorecard

| Area | Status | Severity | Evidence | Release Blocker |
|---|---|---|---|---|
| Business functionality | ❌ NOT READY | P0 | Core stock and GR flows are concurrency-unsafe. | YES |
| Frontend | ⚠️ READY WITH CONDITIONS | P2 | Build/tests pass after client generation; no production serving/API topology, browser E2E, or session-expiry proof. | YES (as deployment package) |
| Backend | ❌ NOT READY | P0 | Strong controls exist, but core concurrent writes violate inventory invariants. | YES |
| Database | ❌ NOT READY | P0/P1 | Schema/migrations exist; live migration, constraints, and concurrent behavior unverified; GR PO-line relationship absent. | YES |
| Authentication | ⚠️ READY WITH CONDITIONS | P2 | JWT/bcrypt/active-user revocation route tests pass; real login unverified. | NO |
| Authorization | ⚠️ READY WITH CONDITIONS | P2 | Server permission checks exist for writes; many master-data reads are authentication-only. | NO |
| Security | ⚠️ READY WITH CONDITIONS | P2 | Helmet/CORS/rate limiting/validation present; token localStorage, unsafe CORS escape hatch, and deployment TLS unknown. | NO |
| Dependencies | ⚠️ READY WITH CONDITIONS | P2 | Audit reports 5 high/2 moderate advisories in Tailwind build chain. | NO |
| Testing | ❌ NOT READY | P1 | Full suite is non-green; DB integration/E2E not executable in supplied state. | YES |
| Static analysis | ⚠️ READY WITH CONDITIONS | P2 | Lint/build/typecheck pass only after manual Prisma generation; Vite warnings remain. | NO |
| API reliability | ❌ NOT READY | P0/P1 | Transactional code lacks concurrency controls; partial raw-query validation. | YES |
| File handling | ❓ UNKNOWN / NOT VERIFIED | P2 | No binary upload/document capability exists. | NO |
| Observability | ⚠️ READY WITH CONDITIONS | P2 | Structured request/error logs and probes exist; no metrics, trace, alert delivery, or collection configuration. | NO |
| Health checks | ⚠️ READY WITH CONDITIONS | P2 | Liveness/readiness behavior unit-tested; no deployed probe verified. | NO |
| Performance | ⚠️ READY WITH CONDITIONS | P2 | Several unpaginated/unbounded DB reads; workload expectations are not defined. | NO |
| Reliability | ❌ NOT READY | P0 | Stock/receipt mutation failure and concurrent-write protection are inadequate. | YES |
| Deployment | ❌ NOT READY | P1 | Compose context is invalid; Docker daemon unavailable; no frontend/TLS/reverse proxy deployment. | YES |
| CI/CD | ❌ NOT READY | P1 | No workflow/pipeline files found. | YES |
| Backup/recovery | ❌ NOT READY | P1 | Only intent docs; no configured backup/restore evidence, RPO/RTO, or restore test. | YES |
| Documentation | ⚠️ READY WITH CONDITIONS | P2 | Domain docs are extensive, but runtime/deployment documents are stale/incomplete. | NO |
| Environment configuration | ❌ NOT READY | P1 | Local/test/production intent exists; no enforceable deployment separation or operational provisioned environments. | YES |

## 4. Critical Findings

### P0-1 — Negative-stock protection is bypassable by concurrent mutations

**Finding:** `issue`, `transfer`, and negative `adjust` read `inventory_balances`, check availability, then create ledger entries and recompute the balance. The Prisma transactions use the default isolation level and acquire no row/advisory lock for a `(materialId, locationId)` balance.

**Evidence:** `apps/backend/src/modules/inventory/inventory.service.ts` invokes `getCurrentBalance()` before the write; `apps/backend/src/shared/inventory/balances.ts` simply `findUnique`s then later aggregates/upserts. Neither file uses a `FOR UPDATE`/advisory lock nor passes serializable transaction isolation. The source has no concurrency regression test against PostgreSQL.

**Impact:** Two store users can each see the same available stock, both pass the check, and both issue/adjust/transfer it. The ledger and derived balance can become negative despite the setting intended to prevent it. The recomputed balance may also reflect transaction interleaving unpredictably.

**Severity:** P0  
**Recommendation:** Serialize the balance invariant for each material/location (for example, transaction-scoped advisory locks in a deterministic key order or locked balance rows) and use an isolation/retry strategy appropriate to PostgreSQL. Add a real-PostgreSQL concurrent-issue/adjust/transfer test asserting exactly one success and a non-negative final balance.  
**Release Blocking:** **YES**

### P0-2 — Goods receipts can be posted twice concurrently

**Finding:** Goods-receipt posting reads status `SUBMITTED`, writes receipt transactions and PO-line increments, then unconditionally updates status to `POSTED`. There is no status-conditional claim/update, unique posting marker, lock, or serializable isolation.

**Evidence:** `InventoryService.postGoodsReceipt()` in `apps/backend/src/modules/inventory/inventory.service.ts`; endpoint path `POST /api/v1/goods-receipts/:id/post` delegates through `GoodsReceiptService.post()`.

**Impact:** Two simultaneous post requests for the same receipt can both create ledger receipts and increment PO `receivedQty`, overstate stock, and corrupt PO receiving status. A normal double-click, retry, or concurrent operator action can trigger it.

**Severity:** P0  
**Recommendation:** Atomically claim the receipt with `updateMany({ where: { id, status: 'SUBMITTED' } })` before any ledger write, reject zero rows as conflict, and lock/validate PO lines as part of the same transaction. Add real-DB duplicate-request and concurrent-post tests.  
**Release Blocking:** **YES**

### P1-1 — Goods-receipt PO-line linkage is not referentially safe

**Finding:** `GoodsReceiptLine.purchaseOrderLineId` has no relation/FK. Receipt creation accepts an arbitrary UUID. Posting silently skips a missing PO line and does not ensure the line belongs to the receipt’s PO or has the same material.

**Evidence:** `prisma/schema.prisma` defines `purchaseOrderLineId String?` without `@relation`; `goods-receipt.service.ts` only validates that the optional receipt-level PO exists; `inventory.service.ts` updates a PO line only inside `if (poLine)`.

**Impact:** A receipt can be orphaned from its intended PO line, applied to an unrelated PO line, or mark one PO status while incrementing another. This is an integrity/control defect for receiving.

**Severity:** P1  
**Recommendation:** Add a real relation/FK, require the referenced line to exist when provided, and validate PO ownership plus material consistency before creating/posting a receipt.  
**Release Blocking:** **YES**

### P1-2 — Declared deployment path is not reproducible or complete

**Finding:** The Compose backend build context does not match the Dockerfile’s required source layout. No frontend production deployment, TLS, reverse proxy, SPA rewrite, or ingress architecture is supplied.

**Evidence:** `apps/backend/docker-compose.yml` uses `context: ..`; relative to that file this resolves to `afrinov-platform/apps`. Audit checks confirmed `apps/package.json` and `apps/apps/backend/package.json` do not exist. The Dockerfile then requires `COPY package.json package-lock.json* ./` and `COPY apps/backend/package.json apps/backend/package.json`, which require the monorepo root context. Docker build could not be executed because Docker Desktop’s daemon was unavailable. The frontend only has a Vite development proxy (`apps/frontend/vite.config.ts`); its production API client is fixed to relative `/api/v1`.

**Impact:** The declared Compose build cannot be relied on to build the backend, and there is no repeatable production means to serve the SPA, terminate HTTPS, route `/api`, or prevent database exposure.

**Severity:** P1  
**Recommendation:** Correct and test the build context, produce a complete production topology (frontend static server/reverse proxy, TLS termination, SPA fallback, private database network, health probes), and execute a clean image build/start/smoke test in CI.  
**Release Blocking:** **YES**

### P1-3 — Release gates are not green and are not automated

**Finding:** The required root test command exits with failure, database integration does not execute, browser E2E has no passing execution, and no CI workflow exists to prevent an unsafe deployment.

**Evidence:** `npm run test` produced **298 backend pass / 1 fail** and **276 frontend pass**, then exited 1. The failed test is `src/db/migrations.test.ts`, which references absent `20260101000000_location_management` while the actual directory is `20260101000001_location_management`. `vitest.integration.config.ts` is not part of npm scripts; direct execution failed before all 7 integration tests due missing `SEED_ADMIN_PASSWORD` and then failed teardown. `playwright.config.ts` discovers two tests only; no `test:e2e` script exists. No CI configuration files were found.

**Impact:** The repository cannot currently provide a passing, automated release decision or prove clean migration/real DB/browser behavior.

**Severity:** P1  
**Recommendation:** Make all default checks green; add a self-contained ephemeral PostgreSQL integration suite and E2E bootstrap; add CI gates for generate, typecheck, lint, tests, build, image build, migration rehearsal, security audit, and post-deploy smoke.  
**Release Blocking:** **YES**

### P1-4 — Backup and recovery are unimplemented operationally

**Finding:** Backup/recovery documents state desired outcomes, but repository evidence does not identify a backup service, retention, encryption, restoration procedure, restoration test, RPO, or RTO.

**Evidence:** `afrinov-docs/docs/12-operations/backup-and-recovery.md` says automated daily/PITR backups should exist and restore should be tested; `disaster-recovery.md` calls proposed RPO/RTO defaults subject to hosting finalization. No infrastructure or test evidence implements either.

**Impact:** Inventory/ledger data can become unrecoverable or recovery duration unknowable following deletion, corruption, failed migration, or infrastructure failure.

**Severity:** P1  
**Recommendation:** Select the production database service, define/enforce backup frequency, retention, access control and encryption, write a restoration runbook, and record a successful restore drill with agreed RPO/RTO before go-live.  
**Release Blocking:** **YES**

## 5. Security Findings

### Verified controls

- Passwords are bcrypt-hashed at cost 12 (`identity.service.ts`), not returned through user endpoints.
- Backend startup requires `DATABASE_URL` and `JWT_SECRET`; known committed placeholder secrets are rejected in production (`shared/config.ts`).
- Every business route is authenticated except login/register and health endpoints; permission checks query current DB assignments rather than trusting JWT role claims (`shared/authorization.ts`).
- Account deactivation is checked against the DB per authenticated request, limiting the remaining lifetime of a deactivated account’s JWT.
- Fastify Helmet, a default-deny API CSP, CORS allow-list behavior, 1 MB body limit, auth/global rate limits, request timeouts, and centralized non-leaking 500 responses are implemented in `server.ts`.
- Static review found no `dangerouslySetInnerHTML`, direct application `eval`, binary upload parser, or committed actual `.env` file. API health output does not disclose database credentials/errors.

### Conditions and findings

| Finding | Evidence | Impact | Severity | Recommendation | Blocking |
|---|---|---|---|---|---|
| JWT is stored in browser `localStorage` for 12 hours. | `apps/frontend/src/api/client.ts`; settings export also reads the token directly. | Any successful XSS can exfiltrate a bearer token. | P2 | Establish a frontend CSP/XSS posture; consider short-lived access tokens with a hardened renewal design. | No |
| Production can opt into `CORS_ALLOW_ANY=true` with credentials. | `shared/config.ts` returns `true`; `server.ts` registers credentials. | Misconfiguration opens cross-origin access more broadly than intended. | P2 | Reject/ignore this escape hatch in production or require an explicit non-production mode. | No |
| Multiple authenticated reads are not permission-gated. | Material, location, rack, project, supplier, and inventory-history GET routes use `app.authenticate` but no `requirePermission`. | Any authenticated role can enumerate master-data/contact/ledger information. Whether this is acceptable is not documented as an approved authorization decision. | P2 | Define resource-read permissions and enforce them, or explicitly approve the organization-wide read policy. | No |
| Stale known credentials remain in documentation/E2E source. | Root `README.md` and `apps/frontend/e2e/login.spec.ts` say `ChangeMe!2026`; current production seed requires `SEED_ADMIN_PASSWORD` and otherwise makes an unreported random password. | Operators and E2E users may rely on a credential that does not exist; this is configuration drift, not evidence that the current secret is active. | P2 | Remove/replace the stale credential, inject E2E credentials through protected CI secrets, and document bootstrap/rotation. | No |
| Supply-chain audit reports 5 high and 2 moderate advisories. | `npm audit --omit=dev --json`: `tailwindcss` ≤3.4.19 via `braces`, `chokidar`, `fast-glob`, `micromatch`; `postcss-*` moderate. | The listed path is primarily build/development tooling, so production exploitability was not proven, but dependencies are not clean. | P2 | Assess the shipped dependency graph and upgrade/remediate Tailwind dependency chain; record accepted risk if build-only. | No |

## 6. Functional Findings

- The SPA exposes routes for dashboard, stock, materials, movements, suppliers, PO/GRs, reports, racks, locations, projects, and settings. Routes are authenticated at the React layer, but client-side routing is not a security control.
- The frontend contains explicit mock/demo code guarded by build-time flags. It is not active by default, but a release build with `VITE_FRONTEND_ONLY=true` or `VITE_DEMO_AUTH_ENABLED=true` is non-production behavior. Add a deployment-time assertion that both are false/absent.
- Supplier management is only list/create; no update/delete endpoint is implemented despite an `EditSupplier` permission existing.
- Role changes occur as part of user updates, but no role/permission administration API is implemented despite `ManageRoles` existing.
- Binary document upload, access control, scanning, retention, delete cleanup, and backup behavior are **not implemented**, not merely untested.
- Dedicated tool checkout/check-in state transitions are deferred.
- On auth/session error the frontend generally displays a message and redirects/revalidates; actual browser behavior for expiration, refresh, deep link, logout and mutation recovery was not demonstrated against a live database.

## 7. Database Findings

### What is verified

- Prisma schema validation passed after supplying a non-secret dummy `DATABASE_URL`.
- Migrations are present: initial schema, location management, and case-insensitive supplier name unique index.
- FK/index/unique coverage is generally thoughtful: ledgers reference material/location/actor, `InventoryBalance` has a composite key, and indexes cover primary stock/report access patterns.
- PO transition code uses conditional `updateMany` state claims in several lifecycle actions; this is stronger than an unguarded read/write transition.

### Database readiness gaps

| Finding | Evidence | Impact | Severity | Recommendation | Blocking |
|---|---|---|---|---|---|
| Concurrency invariants are application reads without locking. | `inventory.service.ts`, `shared/inventory/balances.ts`. | Negative stock and duplicate/over receipts; see P0-1/P0-2. | P0 | Lock/serialize and regression-test on PostgreSQL. | Yes |
| GR PO-line relation absent. | `schema.prisma` `GoodsReceiptLine.purchaseOrderLineId` scalar; no FK in initial migration. | Orphan/unrelated receipt allocation; see P1-1. | P1 | Model and migrate FK plus ownership/material validation. | Yes |
| Migration test points at a stale directory name. | `src/db/migrations.test.ts:158` vs actual `20260101000001_location_management`. | Default test gate fails and does not prove migration execution. | P1 | Correct test/docs; run clean DB migrate deploy in CI. | Yes |
| Supplier `citext` migration requires pre-cleaning duplicates. | `20260101000002_supplier_name_uniqueness/migration.sql` comment. | Upgrade may halt on production data and needs manual intervention. | P1 | Add a preflight duplicate report/remediation runbook and rehearsal on production-candidate data. | Yes |
| No clean DB migration or restore was performed. | No runnable Docker daemon/local database; integration suite assumes pre-seeded DB. | Schema/migration compatibility and production data upgrade safety are unknown. | P1 | Rehearse from empty DB and sanitized production candidate data. | Yes |
| Audit writes are often separate from master-data writes. | Examples: `SupplierService.create`, `LocationService.create/update`, `ProjectService.create/update`. | A successful data mutation can lack a corresponding audit row if the second write fails. | P2 | Place mutation and audit row in one transaction where audit completeness is a requirement. | No |
| Several queries materialize full datasets. | `findMany` without paging in materials, locations, suppliers, projects, PO/GR lists and report preload paths. | Response time/memory can degrade as inventory/transaction history grows. | P2 | Add server pagination/cursor contracts and indexes based on expected volume. | No |

## 8. Testing Findings

### Actual result record

| Suite/check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Backend and frontend ESLint completed exit 0. |
| `npm run typecheck` before generation | Fail | Local installed Prisma client was fallback/un-generated. |
| `npx prisma generate` | Pass | Required an explicit command; no root `postinstall`, build, or test script performs this step. |
| `npm run typecheck` after generation | Pass | Backend and frontend TypeScript checks completed exit 0. |
| `npm run build` after generation | Pass with warnings | Backend TS build and frontend Vite build passed. |
| `npm run test` | Fail | Backend: 25 files, 298 passed/1 failed; frontend: 22 files, 276 passed. |
| Database integration test | Fail before tests | 7 tests skipped due missing `SEED_ADMIN_PASSWORD`; `afterAll` dereferenced undefined app. |
| E2E test discovery | Pass | Two Chromium login tests discovered; no successful browser execution. |
| Prisma schema validate | Pass | Does not connect/migrate a DB. |
| Docker runtime smoke | Not run | Docker daemon unavailable. |

### Coverage assessment

### Exact command record

| Command (working directory) | Result |
|---|---|
| `npm run typecheck` (`afrinov-platform`) | Initial failure: the installed Prisma fallback client exposed no generated schema types. |
| `npx prisma generate --schema prisma/schema.prisma` (`apps/backend`) | Passed after Prisma engine download. |
| `npm run typecheck` (`afrinov-platform`) | Passed after generation. |
| `npm run lint` (`afrinov-platform`) | Passed. |
| `npm run build` (`afrinov-platform`) | Passed after generation, with Vite/ExcelJS warnings. |
| `npm run test` (`afrinov-platform`) | Exit 1: backend 298 pass/1 fail; frontend 276 pass. |
| `npx vitest run --config vitest.integration.config.ts` (`apps/backend`) | Exit 1 before test execution: `SEED_ADMIN_PASSWORD` absent; 7 skipped; teardown then failed. |
| `npx playwright test --list` (`apps/frontend`) | Passed discovery: 2 Chromium tests. |
| `DATABASE_URL=<dummy> npx prisma validate --schema prisma/schema.prisma` (`apps/backend`) | Passed schema validation. |
| `npm audit --omit=dev --json` (`afrinov-platform`) | Exit 1 due 5 high and 2 moderate advisories. |
| `docker compose -p afrinov_audit_20261006 -f apps/backend/docker-compose.yml build backend` with disposable env vars (`afrinov-platform`) | Could not connect to `dockerDesktopLinuxEngine`; no image/service smoke test ran. |

No clean production-style smoke test could be completed: no runnable Docker daemon/local PostgreSQL and no provisioned non-production environment were available. This is evidence of an unverified release path, not a successful smoke test.

Unit coverage is substantial for services, route validation, authorization/security regression, and frontend components. It does **not** establish the following critical conditions:

- Clean database provisioning and `prisma migrate deploy` from zero.
- Existing-data migration rehearsal, including supplier deduplication preflight.
- Rollback behavior when a transaction fails after an earlier database write.
- PostgreSQL isolation/concurrency behavior for inventory issues, transfers, adjustments, and goods-receipt posting.
- Browser workflow against a real seeded database, including login/logout/refresh/deep links/session expiration.
- Production container build, startup, health/readiness, graceful shutdown, and restart.
- Backup restoration and data reconciliation after restore.

The existing route/unit tests are valuable but mocked Prisma transaction clients cannot prove database isolation, locks, FK behavior, actual Prisma error mapping, or rollback semantics.

## 9. Deployment Findings

### Deployment architecture actually present

- Backend image: Node 20 Alpine multi-stage Dockerfile, non-root runtime user, compiled TypeScript.
- Compose: PostgreSQL 16 plus backend; migration/seed/server sequence is in the Compose `command`, not the Dockerfile `CMD`.
- Frontend: static Vite output only. No image, server, reverse proxy, static-host configuration, HTTPS configuration, or `/api` routing configuration is supplied.

### Deployment concerns

- The Compose `context: ..` resolves to `afrinov-platform/apps`, but the Dockerfile expects monorepo-root files. The source layout cannot satisfy that build.
- The runtime Dockerfile copies only `/app/apps/backend` into the final image. Local workspace inspection shows backend dependencies (such as Fastify) are hoisted in the root `node_modules`, not `apps/backend/node_modules`; this is an additional unverified packaging risk. The final stage also runs `npm prune` from `/app` without copying a root package manifest. This must be proven by a clean image build, not assumed.
- Compose publishes both `5432:5432` and `4000:4000`. There is no production-specific network isolation, ingress policy, firewall, or TLS definition.
- Database migrations run at service startup in Compose. That is acceptable only when migration ownership, multi-replica startup coordination, failure handling, and rollback strategy are defined and tested; none are.
- Deployment is not automated, no post-deploy smoke test is configured, and no rollback mechanism is implemented beyond aspirational prose.
- Production configuration requires manually supplied `POSTGRES_PASSWORD`, `JWT_SECRET`, and (for first production seed) `SEED_ADMIN_PASSWORD`. The repository does not show a secret-injection service or deployment secret policy.

## 10. Operational Readiness

### Verified operational strengths

- Fastify emits structured Pino request logs with request IDs.
- The central error handler logs unexpected failures and returns generic `INTERNAL_ERROR` responses.
- Liveness endpoints are `/health` and `/api/v1/health`; readiness endpoints query `SELECT 1` and return 503 on database failure.
- Process startup logs configuration/service metadata; SIGTERM/SIGINT closes Fastify and disconnects Prisma.

### Gaps

- No metric endpoint, tracing, dashboard, log collection/retention, uptime monitor, alert routing, SLO, or on-call runbook exists.
- No handler is registered for the in-process domain events; `StockThresholdReached` is dispatched but no notification delivery is wired. Low-stock reports still compute from data, but alert delivery is absent.
- Database errors are observable in logs but upstream operators cannot prove “which endpoint is failing” historically without a configured log platform.
- Root and API health endpoints are unit-tested with mocked Prisma only. No deployed probe configuration was verified.
- No production workload, data volume, concurrency target, document volume, RPO, RTO, or retention target is defined. Therefore performance/scaling readiness is **unknown**, not demonstrated.

## 11. API Endpoint Control Matrix

Legend: **JWT** = authenticated by `app.authenticate`; **Perm** = DB-backed `requirePermission`; **Zod** = explicit route Zod body/query parsing; **Raw Q/ID** = raw/cast query or parameter. “Conditional” reflects global P0/P1 blockers, not a claim that the individual handler necessarily fails.

| Endpoint | Auth | Authorization | Validation | Error handling / DB safety | Tested | Production ready |
|---|---|---|---|---|---|---|
| `POST /auth/login` | Public | N/A | Zod | Central error contract; rate limited | Route unit | Conditional |
| `POST /auth/register` | Public | Setting gate | Zod | Central error contract; rate limited | Route unit | Conditional |
| `GET /auth/me` | JWT | Self | N/A | DB active-account check | Route unit | Conditional |
| `GET /users` | JWT | `manage:users` | N/A | DB read | Route/security unit | Conditional |
| `GET /users/lookup` | JWT | `view:users` | N/A | DB read | Route/security unit | Conditional |
| `GET /users/:id` | JWT | `manage:users` | Raw ID | DB read | Service/route unit | Conditional |
| `POST /users` | JWT | `manage:users` | Zod | DB mutation; audit not fully atomic | Service/route unit | Conditional |
| `PATCH /users/:id` | JWT | `manage:users` | Zod body; raw ID | DB transaction for roles; audit outside it | Service/route unit | Conditional |
| `GET /materials` | JWT | Auth-only | Raw Q | Unpaged DB read | Service unit | Conditional |
| `GET /materials/:id` | JWT | Auth-only | Raw ID | DB read | Service unit | Conditional |
| `POST /materials` | JWT | `create:material` | Zod | DB mutation; audit path | Service unit | Conditional |
| `PATCH /materials/:id` | JWT | `edit:material` | Zod body; raw ID | DB mutation | Service unit | Conditional |
| `GET /locations` | JWT | Auth-only | Raw Q | Unpaged DB read | Service unit | Conditional |
| `GET /locations/:id` | JWT | Auth-only | Raw ID | Dependency count reads | Service unit | Conditional |
| `POST /locations` | JWT | `create:location` | Zod | Audit separate from mutation | Service unit | Conditional |
| `PATCH /locations/:id` | JWT | `edit:location` | Zod body; raw ID | Audit separate from mutation | Service unit | Conditional |
| `PATCH /locations/:id/status` | JWT | `manage:location_status` | Zod | Audit separate from mutation | Service unit | Conditional |
| `DELETE /locations/:id` | JWT | `delete:location` | Raw ID | Dependency check then delete; race not DB-locked | Service unit | Conditional |
| `POST /stock-items` | JWT | `create:material` + `receive:inventory` | Zod/refinement | Transactional material+initial receipt | Service unit | Conditional |
| `GET /racks` | JWT | Auth-only | Raw Q | Unpaged DB read | Service unit | Conditional |
| `GET /racks/:id` | JWT | Auth-only | Raw ID | DB read | Service unit | Conditional |
| `POST /racks` | JWT | `manage:racks` | Zod | Mutation/audit behavior unit tested | Service unit | Conditional |
| `PATCH /racks/:id` | JWT | `manage:racks` | Zod | Mutation/audit behavior unit tested | Service unit | Conditional |
| `DELETE /racks/:id` | JWT | `manage:racks` | Raw ID | Archives instead of hard delete | Service unit | Conditional |
| `GET /inventory-transactions` | JWT | Auth-only | Raw Q; capped in service | Read capped at 1,000; invalid raw values not schema-validated | Route unit | Conditional |
| `POST /inventory-issues` | JWT | `issue:inventory` | Zod | Transaction but P0 concurrency unsafe | Route/service unit | **No** |
| `POST /inventory-transfers` | JWT | `transfer:inventory` | Zod | Transaction but P0 concurrency unsafe | Route/service unit | **No** |
| `POST /inventory-adjustments` | JWT | `adjust:inventory` | Zod | Transaction but P0 concurrency unsafe | Route/service unit | **No** |
| `PATCH /inventory-transactions/:id` | JWT | `update:inventory_transaction` | Manual actor check; raw ID | Actor update transaction/audit | Route/service unit | Conditional |
| `GET /suppliers` | JWT | Auth-only | Raw Q | Unpaged DB read | Service unit | Conditional |
| `POST /suppliers` | JWT | `create:supplier` | Zod | DB CI unique migration; audit separate | Service unit | Conditional |
| `GET /purchase-orders` | JWT | `view:purchase_order` | Raw enum cast | Unpaged DB read | Service unit | Conditional |
| `GET /purchase-orders/:id` | JWT | `view:purchase_order` | Raw ID | DB read | Service unit | Conditional |
| `POST /purchase-orders` | JWT | `create:purchase_order` | Zod | Transaction/advisory number lock | Service unit | Conditional |
| `PATCH /purchase-orders/:id` | JWT | `create:purchase_order` | Zod | DB mutation | Service unit | Conditional |
| `GET /purchase-orders/:id/history` | JWT | `view:purchase_order` | Raw ID | DB read | Service unit | Conditional |
| `POST /purchase-orders/:id/submit` | JWT | `submit:purchase_order` | Raw ID | Conditional state update | Service unit | Conditional |
| `POST /purchase-orders/:id/approve` | JWT | `approve:purchase_order` | Raw ID | Conditional state update | Service unit | Conditional |
| `POST /purchase-orders/:id/ship` | JWT | `ship:purchase_order` | Zod | Conditional state update | Service unit | Conditional |
| `POST /purchase-orders/:id/deliver` | JWT | `deliver:purchase_order` | Zod | Conditional state claim; receipt balance not real-DB tested | Service unit | Conditional |
| `POST /purchase-orders/:id/cancel` | JWT | `cancel:purchase_order` | Zod | Conditional state update | Service unit | Conditional |
| `GET /goods-receipts` | JWT | `view:goods_receipt` | N/A | Unpaged DB read | Service unit | Conditional |
| `GET /goods-receipts/:id` | JWT | `view:goods_receipt` | Raw ID | DB read | Service unit | Conditional |
| `POST /goods-receipts` | JWT | `receive:inventory` | Zod | Missing PO-line relationship/ownership validation | Service unit | **No** |
| `POST /goods-receipts/:id/post` | JWT | `receive:inventory` | Raw ID | P0 duplicate-post race | Service unit | **No** |
| `GET /projects` | JWT | Auth-only | Raw Q | Unpaged DB read | Service unit | Conditional |
| `GET /projects/:projectNumber` | JWT | Auth-only | Raw ID | DB read | Service unit | Conditional |
| `POST /projects` | JWT | `manage:projects` | Zod | Audit separate from mutation | Service unit | Conditional |
| `PATCH /projects/:projectNumber` | JWT | `manage:projects` | Zod | Audit separate from mutation | Service unit | Conditional |
| `DELETE /projects/:projectNumber` | JWT | `manage:projects` | Raw ID | Archive operation | Service unit | Conditional |
| `GET /reports/current-stock` | JWT | `view:reports` | Raw Q | Read model; unpaged | Service unit | Conditional |
| `GET /reports/movement-history` | JWT | `view:reports` | Raw Q; capped in service | Read capped at 1,000 | Service unit | Conditional |
| `GET /reports/low-stock` | JWT | `view:reports` | N/A | Unpaged read | Service unit | Conditional |
| `GET /reports/project-consumption/:projectNumber` | JWT | `view:reports` | Raw ID | Unpaged ledger read | Service unit | Conditional |
| `GET /reports/inventory` | JWT | `view:reports` | Zod query parser | Some server cap; full material/balance preloads | Service unit | Conditional |
| `GET /reports/inventory/export` | JWT | `view:reports` | Zod query parser + format check | In-memory PDF/XLSX generation, no live-size test | Unit/build | Conditional |
| `GET /settings` | JWT | Auth-only | Raw Q | DB read | Service unit | Conditional |
| `GET /settings/values` | JWT | Auth-only | Raw Q | DB read | Service unit | Conditional |
| `GET /settings/:key` | JWT | Auth-only | Raw key | DB read | Service unit | Conditional |
| `PUT /settings/:key` | JWT | Admin + `manage:settings` | Zod | DB mutation | Service unit | Conditional |
| `PATCH /settings` | JWT | Admin + `manage:settings` | Zod | DB mutation | Service unit | Conditional |
| `POST /settings/reset` | JWT | Admin + `manage:settings` | N/A | DB mutation | Service unit | Conditional |
| `GET /audit` | JWT | `view:audit_log` | Zod query/cap 500 | DB read | Route/security unit | Conditional |
| `GET /api/v1/health` | Public | N/A | N/A | Liveness only | Unit injected | Conditional |
| `GET /api/v1/health/ready` | Public | N/A | N/A | DB `SELECT 1`, returns 503 | Unit injected | Conditional |

Root `GET /`, `/health`, and `/health/ready` provide identical service/liveness/readiness operational endpoints outside the API prefix. They are unit-tested with mocked database calls; not verified in a deployed environment.

## 12. Release Blockers

1. **P0:** Concurrent stock issues/transfers/adjustments can violate negative-stock inventory invariants.
2. **P0:** Concurrent goods-receipt posting can duplicate ledger receipts and overstate stock/PO receipts.
3. **P1:** Goods-receipt PO-line references have no FK/ownership/material validation.
4. **P1:** The declared Compose deployment has an invalid build context and no production frontend/TLS/reverse-proxy topology.
5. **P1:** Release verification is non-green and incomplete: failing default test, no passing real DB/E2E/migration rehearsal, and no CI gate.
6. **P1:** Backup/recovery, RPO/RTO, and restore testing are unknown/unimplemented.

## 13. Required Remediation

| Issue | Severity | Root cause | Fix | Verification | Deployment impact |
|---|---|---|---|---|---|
| Concurrent negative stock | P0 | Check-then-write under default transaction isolation | Add deterministic balance/ledger locking or serializable retries | Real PostgreSQL `Promise.all` issue/transfer/adjust tests; final balance must not be negative | Blocks release |
| Duplicate GR posting / over-receipt | P0 | No atomic status claim/line locking | Atomically claim `SUBMITTED` receipt and lock/validate affected PO lines | Parallel POST same GR; one 2xx only, one conflict; ledger/PO values exact | Blocks release |
| Invalid GR PO line links | P1 | Scalar reference without FK or cross-entity validation | Add FK/relation; require ownership/material consistency | Migration test plus API tests for unknown/mismatched line | Blocks release |
| Non-runnable deployment | P1 | Wrong Compose context and missing frontend/edge architecture | Correct build context; create/prove complete production stack and private DB network | Clean `docker compose build/up`, health/readiness, browser login, restart | Blocks release |
| Non-green/nonexistent quality gates | P1 | Stale migration test, externalized integration prerequisites, no CI | Repair test name/teardown; self-contained ephemeral DB; add CI | Green pipeline on clean checkout | Blocks release |
| Migration safety | P1 | No clean/existing-data rehearsal; supplier migration needs manual dedupe | Add preflight, data remediation runbook, staging rehearsal and rollback/forward plan | `migrate deploy` clean DB and sanitized candidate DB | Blocks release |
| Backup/recovery | P1 | Hosting/backup design not implemented | Configure backups/PITR and protected restore runbook; agree RPO/RTO | Successful timed restore and ledger reconciliation | Blocks release |
| Prisma generation reproducibility | P2 | Root scripts omit `prisma generate` | Add reliable install/build lifecycle step and document it | Clean clone/install/typecheck/build passes without manual step | Must fix before automated release |
| Token/CORS/demo config | P2 | Browser bearer-token exposure; production escape hatches | Enforce release env policy; harden frontend CSP; prohibit demo flags/allow-any CORS in production | Production config validation and browser security tests | Pre-release condition |
| Unbounded queries/report payloads | P2 | Multiple `findMany` paths without pagination | Introduce pagination/cursors and data-volume limits | Load test representative stock/ledger sizes | Pre-release condition |
| Observability | P2 | Logs/probes only | Configure centralized logs, dashboards, alerts, owners, retention, availability checks | Incident simulation and alert test | Pre-release condition |
| Dependency advisories | P2 | Outdated Tailwind dependency tree | Upgrade/remediate and re-audit | Zero accepted high advisories or documented risk acceptance | Pre-release condition |
| Audit atomicity | P2 | Business and audit writes separate in master-data services | Enclose required audit writes in the same transaction | Inject failure tests and inspect rollback | Near-term |
| Stale README/E2E bootstrap credentials | P2 | Seed behavior changed without test/doc update | Use injected test secret and truthful bootstrap docs | E2E works from clean environment | Near-term |
| Bundle size/direct eval warning | P3 | Client-side ExcelJS bundled | Code-split/remove client exporter or consciously accept | CSP/browser export and bundle-budget check | Post-release after safety gates |

## 14. Recommended Verification Tests

Run these after remediation, against a disposable PostgreSQL 16 environment matching production version:

1. Clean checkout → deterministic install → Prisma generate → typecheck → lint → full test → production build.
2. Start an empty database, run `prisma migrate deploy`, seed using injected bootstrap secret, and verify schema/migration table state.
3. Run two or more simultaneous issue, adjustment, and transfer requests against balance 1; assert one succeeds where appropriate and balances never become negative.
4. Send concurrent `POST /goods-receipts/:id/post` requests; assert one transition, exactly one receipt ledger set, correct PO quantities, and conflict response for duplicates.
5. Attempt GR creation with unknown PO line, wrong PO line, and material mismatch; each must reject without writes.
6. Execute representative RBAC matrix: unauthenticated, viewer, technician, procurement, approver, store controller, and admin across reads and mutations.
7. Run Playwright against the real backend/database: login, deep link, browser refresh, logout, expired token, CRUD, issue/receive, duplicate submission, and backend restart.
8. Build the complete production image/stack from scratch, verify `health` and `health/ready`, perform an authenticated workflow, restart services, and verify persistence.
9. Rehearse supplier unique-index migration against sanitized existing data, including the documented duplicate-data preflight and recovery path.
10. Restore a production-like backup into an isolated environment, run ledger/balance reconciliation, document actual RPO/RTO, and test rollback/forward deployment procedure.
11. Load test unpaginated report/list routes with the expected materials, locations, transactions, and export sizes; set data/latency budgets.
12. Run `npm audit` in CI, review production artifact SBOM/dependency graph, and enforce an explicit vulnerability policy.

## 15. Final Production Readiness Verdict

## 🔴 NOT PRODUCTION READY

The system must not be deployed until all six release blockers above are resolved and the verification tests demonstrate a repeatable, green production path. The evidence is **MEDIUM confidence**: static analysis and a large unit/frontend suite are strong, but the absent live PostgreSQL, unusable deployment environment, failing quality gate, no backup restore, and no successful end-to-end deployment prevent high confidence.

### Deployment Decision

**VERDICT:** `NOT READY`  
**Release blockers:** `6`  
**High-priority issues:** `4`  
**Medium-priority issues:** `9`  
**Low-priority issues:** `1`  
**Confidence:** `MEDIUM`

Confidence is medium because the audit directly verified the most important source-level defects and build/test outputs, but could not execute the production Docker stack, clean PostgreSQL migration, backup restore, or complete browser workflow in the supplied runtime environment.
