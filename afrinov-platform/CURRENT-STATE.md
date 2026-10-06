# Current State — Afrinov Inventory Management System

## 1. Document Control

| Field | Value |
| --- | --- |
| System | Afrinov Inventory Management System |
| Document | Current-State Baseline |
| Status | Current-State Baseline (pre-change snapshot) |
| Date | 2026-10-06 |
| Repository | `afrinov-platform/` (npm workspaces monorepo) |
| Branch | `master` |
| Commit | **No commits.** `git rev-parse HEAD` is undefined; the repository has 256 uncommitted files and has not been initialized with a baseline commit. |
| Version | `0.1.0` (root `package.json`) |
| Environment assessed | Local Windows workstation (`win32`), no PostgreSQL listener on `localhost:5432` |
| Prepared from | Direct inspection of the repository, configuration, schema, source code, and live verification runs executed during this assessment. |

## 2. Executive Summary

The Afrinov IMS is a **Fastify + React + TypeScript + Prisma** modular monolith exposing a RESTful API under `/api/v1/*` and a React 18 SPA on Vite. It is **substantially implemented**: the full inventory ledger, procurement (purchase order) lifecycle, goods-receipt receiving, project allocation, reporting, settings, users/roles, and audit trail all exist and the code compiles, lints, and the unit test suites pass.

However, the system is **not production-ready in its current, verified state** because the runtime dependencies required to exercise it end-to-end are not running or verifiable in this environment:

- The PostgreSQL database is **not reachable** (`localhost:5432` connection refused; backend `/health/ready` returns `503`).
- Because the database is down, the E2E (Playwright) suite **cannot start** — `global-setup` times out on `/health/ready`.
- The integration test config is a separate, non-default config that is not run by `npm test`.
- No CI/CD pipeline exists, and the application does not auto-migrate or auto-seed on startup in dev (`npm run dev`); only the production Docker entrypoint runs `prisma migrate deploy` + `seed`.

In addition to these runtime/operational blockers, several application-level defects of P1–P2 severity were identified and are recorded below. The conclusion is **Not Production Ready** pending remediation and end-to-end verification.

| Area | Implemented? | Verified? |
| --- | --- | --- |
| Backend compiles & typechecks | Yes | Yes (`npm run typecheck` passes) |
| Backend unit tests | Yes (299/299) | Yes (against mocked Prisma) |
| Frontend compiles & typechecks | Yes | Yes (`npm run typecheck` passes) |
| Frontend unit tests | Yes (277/277) | Yes (jsdom) |
| Backend + frontend build | Yes | Yes (`npm run build` passes) |
| Backend linting | Yes | Yes (1 pre-existing warning) |
| Live database connectivity | Configured, not running | No (503 on `/health/ready`) |
| E2E / integration tests | Implemented (1 e2e, 1 integration file) | No (require a live DB) |

## 3. System Purpose

The implemented system is a **single-site inventory and procurement management application**. Users authenticate, then record the receipt of materials (initial stock, goods receipts, PO delivery), issue and transfer stock to projects/locations, adjust balances, manage suppliers and purchase orders through a full approval/shipping/delivery lifecycle, and view consolidated reports. The ledger (`inventory_transactions`) is the source of truth; `inventory_balances` is derived.

The system is explicitly **single-tenant / single-site** by design (per `README.md` "What's intentionally NOT in this prototype"). Multi-tenancy is not implemented.

It is **not** a general ERP; it does not implement production planning, demand forecasting, supplier portals, or financial accounting.

## 4. Current Architecture

Components that actually exist:

```text
Browser (React 18 SPA, Vite dev:5173 / proxy -> backend)
   |
   | HTTP (JWT Bearer), CORS allow-list, Helmet
   v
Fastify API server (apps/backend, port 4000, /api/v1/*)
   |
   | Prisma Client
   v
PostgreSQL 16  (docker compose db, or direct)
```

- **Frontend**: React 18, Vite 8 dev/build, TypeScript, Tailwind CSS v3, React Router DOM v7. Runs as `vite` (dev) or a static build. Proxy `/api` -> `http://localhost:4000` in dev.
- **Backend**: Node 20, Fastify v5, Prisma Client v5, `pino` structured logger, `bcryptjs` (cost 12), `zod` for request validation, `exceljs` + `pdfkit` for exports, `@fastify/cors` / `helmet` / `jwt` / `rate-limit`.
- **Database**: PostgreSQL 16 (docker image `postgres:16-alpine`). Prisma is the only data-access layer; no raw query paths.
- **Secrets**: `DATABASE_URL`, `JWT_SECRET`, optional `CORS_ORIGIN`/`CORS_ALLOW_ANY`/`RATE_LIMIT_*`. See `apps/backend/.env.example`.
- **Deployment**: `Dockerfile` (node:20-alpine, multi-stage, non-root `app` user) + `docker-compose.yml` (db + backend). Production entrypoint runs migrations + seed + server.

No message broker, load balancer, or external services are configured in the repository. Domain events are dispatched in-process and consumed synchronously (`shared/events.ts`).

## 5. Current Technology Stack

| Layer | Technology | Current State |
| --- | --- | --- |
| Frontend app | React 18, React Router DOM v7, Vite 8, TypeScript | Implemented |
| Frontend styling | Tailwind CSS v3 | Implemented |
| Backend app | Node 20, Fastify v5, TypeScript (strict) | Implemented |
| Data validation | zod v3 (per-route `safeParse`) | Implemented |
| ORM | Prisma Client v5.18 | Implemented |
| Database | PostgreSQL 16 (`postgres:16-alpine`) | Schema + migrations present; not reachable in assessed env |
| Auth | JWT HS256 (12h), bcrypt cost 12 | Implemented |
| Authorization | RBAC server-side (`requirePermission`) | Implemented (enforced in handlers) |
| HTTP security | @fastify/cors, helmet (CSP, HSTS, etc.), rate-limit | Implemented |
| Ledger/valuation | Decimal (Prisma.Decimal), derived balances | Implemented |
| Exports | exceljs, pdfkit | Implemented (`/reports/inventory/export`) |
| Containerization | Docker + docker-compose | Implemented |
| CI/CD | — | Not implemented |
| Logging/observability | pino (structured, request ids); no metrics/tracing/alerting | Logging only |
| Package manager | npm 10+ (workspaces) | Implemented |

## 6. Current Functional Modules

States are determined by the presence of backend routes + service logic + (where applicable) frontend pages. "Not verified" = the code exists but could not be exercised against a live database in this environment.

| Module | Current State | Evidence | Notes |
| --- | --- | --- | --- |
| Authentication (login/session) | Implemented | `auth.routes.ts` `POST /auth/login`, `GET /auth/me`; `identity.service.ts` AuthService | Signup route does not exist (see Known Issues). |
| Users | Implemented | `user.routes.ts`; `UserService` (list/get/create/update) | Mutations require `manage:users`. |
| Roles / Permissions | Implemented | `permissions.ts` (6 roles, permission matrix); `authorization.ts` | Server-side enforced via `requirePermission`. |
| Materials (catalog) | Implemented | `material.routes.ts`, `material.service.ts` | Create/edit/listing; SKU uniqueness. |
| Locations / Racks / Stores | Implemented | `material.routes.ts` (locations), `rack.routes.ts` `LocationService`, `RackService` | Location management fields added (code, contact, address). |
| Inventory (ledger) | Implemented | `inventory.routes.ts`, `inventory.service.ts` | Issue/transfer/adjust/transactions/history; balances derived. |
| Stock In | Partially implemented | `stock-item.routes.ts` `POST /stock-items`; `POST /goods-receipts` + `/post` | No dedicated "Stock In" page; intake via "Add stock item" on the Stock page, or via Goods Receipts / PO delivery. |
| Stock Out | Partially implemented | `inventory.routes.ts` `POST /inventory-issues` | No dedicated "Stock Out" page; issuance via the Stock page action sheet. |
| Stock adjustments | Implemented | `POST /inventory-adjustments` | Reason codes enforced (`COUNT_VARIANCE`, `DAMAGE`, `LOSS`, `SCRAP`, `OTHER`). |
| Transfers | Implemented | `POST /inventory-transfers` | Paired `TRANSFER_OUT`/`TRANSFER_IN` legs. |
| Projects | Implemented | `project.routes.ts`, `project.service.ts` | CRUD; used as allocation context on issues. |
| Suppliers | Implemented | `procurement.routes.ts` / `SupplierService` | List + create. No edit/delete endpoints in routes (only `CreateSupplier` permission exists). |
| Purchase Orders | Implemented | `procurement.routes.ts` `PurchaseOrderService` | Full lifecycle DRAFT→PENDING_APPROVAL→APPROVED→SHIPPED→DELIVERED + cancel; per-transition audit. |
| Goods Receipts | Implemented | `procurement.routes.ts` `GoodsReceiptService` + `InventoryService.postGoodsReceipt` | Draft→Submitted→Posted; posts receipt transactions and updates PO received qty. |
| Procurement / Receive | Implemented | PO workflow + GR posting | Over-receipt prevented per PO line. |
| Reports | Implemented | `reporting.routes.ts` (`ReportService`), `reporting.service.ts` (`ReportingService`) | Consolidated inventory report + export (xlsx/pdf); low-stock, movement history, project consumption. |
| Dashboard | Implemented | frontend `pages/Dashboard.tsx` | Driven by `/reports/inventory` + `/reports/low-stock`. |
| Movements | Implemented | frontend `pages/Movements.tsx` (`GET /inventory-transactions`) | Read-only ledger view. |
| Stock page | Implemented | frontend `pages/Stock.tsx` | On-hand view + issue/transfer/adjust + add stock item. |
| Materials page | Implemented | frontend `pages/Materials.tsx`, `MaterialDetail.tsx` | |
| Suppliers page | Implemented | frontend `pages/Suppliers.tsx`, `SupplierDetail.tsx` | |
| Purchase orders page | Implemented | frontend `pages/PurchaseOrders.tsx`, `PurchaseOrderDetail.tsx` | |
| Goods receipts page | Implemented | frontend `pages/GoodsReceipts.tsx` | |
| Racks / Locations / Projects pages | Implemented | frontend pages | |
| Settings | Implemented | `settings.routes.ts`, `settings.service.ts`, `pages/Settings*` | Typed key/value catalog; per-field validation; audit. |
| Documents / attachments | Not implemented | — | No binary upload; `deliveryRef` is a free-text field only (per README). |
| Tool check-out/check-in UI | Not implemented | `Material.category=TOOLS` exists | Modelled but no dedicated UI/state machine (per README). |
| Notifications (in-app/alerts) | Mocked / non-functional | `SettingsService` toggles + domain events (`StockThresholdReached`) | No alert/notification persistence or delivery is wired (see Known Issues). |

## 7. Current Inventory Workflow

End-to-end paths that exist in code today:

```text
(Procurement)
  Supplier ──create──> Supplier master
  PO (DRAFT) ──lines(materials)──>
      submit ──> PENDING_APPROVAL (or APPORVED if approval disabled)
      approve ──> APPROVED
      ship ──> SHIPPED  (+ tracking/carrier)
      deliver ──> DELIVERED
                 └─ for each line: create RECEIPT txn + recompute balance + mark line received
      cancel ──> CANCELLED (configurable)
(Receiving)
  GoodsReceipt (SUBMITTED) ──lines(material, location, qty, PO line?)──> post ──> POSTED
      └─ for each line: create RECEIPT txn + (if on a PO line) increment receivedQty + recompute balance
      └─ PO status recomputed to FULLY_RECEIVED / PARTIALLY_RECEIVED
(Stock transactions — all on inventory_transactions)
  RECEIPT (stock-items initial, GR post, PO deliver)
  ISSUE  (optionally projectNumber)    ──negative-prevention checked
  TRANSFER_OUT + TRANSFER_IN (paired)  ──source-balance checked
  ADJUSTMENT (reasonCode required)     ──negative-prevention checked
  PATCH transaction (reassign actor only)
(Derived read model)
  inventory_balances ← recomputed per (material, location) after each write
```

Operational steps that exist and are exercised by the seed: opening receipts, project consumption issues, inter-location transfers, and a count-variance adjustment.

Missing operational steps / constraints (verified absence):

- **No physical goods receiving separate from GR posting** — receiving == posting a Goods Receipt.
- **No dedicated "Stock In" / "Stock Out" transaction pages** — intake is via "Add stock item" or PO delivery; outtake is via the Issue action.
- **No approval workflow for inventory adjustments/transfers** — the `inventory.requireApprovalForSensitiveChanges` setting exists but is not enforced by any code path.
- **No tool check-out/check-in tracking** beyond recording an `Issue` with a `recipientId`.
- **No automated reorder point triggers** — low stock is only surfaced as a report/flag, not an automatic requisition.

## 8. Database Current State

- **Technology**: PostgreSQL 16 (`postgres:16-alpine`), via Prisma Client `datasource db { provider = "postgresql", url = env("DATABASE_URL") }` (`apps/backend/prisma/schema.prisma:12-15`).
- **Schema**: 18 models/tables in `schema.prisma` (`users`, `user_roles`, `roles`, `permissions`, `role_permissions`, `materials`, `locations`, `suppliers`, `projects`, `racks`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `inventory_transactions`, `inventory_balances`, `settings`, `audit_log_entries`).
- **Migrations**: two migration directories, both prefixed `20260101000000` (`20260101000000_initial`, `20260101000000_location_management`). The shared timestamp prefix is a known drift risk (see Known Issues). `migration_lock.toml` is a hand-written placeholder, not generated by `prisma migrate dev`.
- **Constraints**: primary keys, unique constraints (email, sku, location name/code, project code, rack code, PO/GR numbers, transaction `paired_with_id`), foreign keys with `ON DELETE` rules (CASCADE/RESTRICT/SET NULL), and indexes on category/active/type/status. **No database triggers** enforce append-only behaviour on `inventory_transactions`; append-only semantics are application-level only.
- **Seed**: idempotent demo seed in `apps/backend/src/db/seed.ts` (users/roles/permissions, admin, locations, suppliers, materials, projects, racks, 2 POs, 1 GR, ledger transactions, computed balances). Admin password comes from `SEED_ADMIN_PASSWORD` (mandatory in production; random if unset).
- **Connectivity**: **Not operational** in the assessed environment. `Test-NetConnection localhost 5432` → refused. Running the E2E global setup produced `Can't reach database server at localhost:5432` and `/health/ready` returned `503 {"status":"not_ready","database":"error"}`.
- **Status**: Schema and migrations are present and version-controlled, but there is **no running database** to apply them against or query. Development status only; production status is unknown (no deployment infra reachable from this workstation).

## 9. API Current State

- **Base URL / port**: Backend listens on `PORT` (default `4000`), host `HOST` (default `0.0.0.0`). Routes registered under the `/api/v1` prefix (see `server.ts` `instance.register(..., { prefix: '/api/v1' })`). Liveness `/health` and readiness `/health/ready` are registered at the **root**, outside the prefix.
- **Auth requirement**: `app.authenticate` (JWT verify) on every route inside `/api/v2`; `POST /auth/login` and `GET /` + `/health*` are unauthenticated.
- **Authorization**: `requirePermission(...)` called in handlers for mutations and most reads (see evidence: `permissions.ts`/`authorization.ts`; `requirePermission` calls appear in every `*routes.ts`).
- **Validation**: zod `safeParse` per route, returning `400 VALIDATION_ERROR` on failure.
- **Error handling**: central `setErrorHandler` returns the documented `{ error: { code, message, details } }` envelope for `ApiError`; generic `Error` → `500 INTERNAL_ERROR`. Prisma exceptions are **not** mapped to HTTP status and surface as `500` (see Known Issues).

Endpoints that work (by area — grep across `apps/backend/src/modules/*/*.routes.ts` enumerated 57 route registrations inside `/api/v1`, plus 3 root endpoints in `server.ts`):

- Identity: `POST /auth/login`, `GET /auth/me`, `GET /users`, `GET /users/lookup`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`.
- Inventory: `GET /materials`, `GET /materials/:id`, `POST /materials`, `PATCH /materials/:id`; `GET /locations`, `GET /locations/:id`, `POST /locations`, `PATCH /locations/:id`, `PATCH /locations/:id/status`, `DELETE /locations/:id`; `POST /stock-items`; `GET /inventory-transactions`, `POST /inventory-issues`, `POST /inventory-transfers`, `POST /inventory-adjustments`, `PATCH /inventory-transactions/:id`.
- Racks: `GET /racks`, `GET /racks/:id`, `POST /racks`, `PATCH /racks/:id`, `DELETE /racks/:id`.
- Procurement: `GET /suppliers`, `POST /suppliers`; `GET /purchase-orders`, `GET /purchase-orders/:id`, `POST /purchase-orders`, `PATCH /purchase-orders/:id`, `GET /purchase-orders/:id/history`, `POST /purchase-orders/:id/submit|approve|ship|deliver|cancel`; `GET /goods-receipts`, `GET /goods-receipts/:id`, `POST /goods-receipts`, `POST /goods-receipts/:id/post`.
- Operations: `GET /projects`, `GET /projects/:projectNumber`, `POST /projects`, `PATCH /projects/:projectNumber`, `DELETE /projects/:projectNumber`.
- Reporting: `GET /reports/current-stock`, `GET /reports/movement-history`, `GET /reports/low-stock`, `GET /reports/project-consumption/:projectNumber`, `GET /reports/inventory`, `GET /reports/inventory/export` (xlsx|pdf).
- Settings: `GET /settings`, `GET /settings/values`, `GET /settings/:key`, `PUT /settings/:key`, `PATCH /settings`, `POST /settings/reset`.
- Audit: `GET /audit`.

Endpoints that fail or are unavailable / not verified:

- `POST /auth/register` — **does not exist**. `server.ts` references it in `STRICT_AUTH_PATHS` and `signup` is linked from the UI, but no registration route is registered (`auth.routes.ts` only has `/login` and `/me`). Live-mode signup returns `NOT_AVAILABLE` (`authService.ts`).
- `GET /api/v1/health` — **returns 404** because health probes are mounted at the root, not under the `/api/v1` prefix. The frontend Settings → System page calls `/api/v1/health` and therefore **misreports the API as offline** even when it is up.
- `GET /purchase-orders` (list) — only requires `app.authenticate`, **not** `ViewPurchaseOrder`. Any authenticated user can enumerate PO numbers/status/line quantities regardless of role.
- All endpoints — **not verified against a live database** in this environment (DB down).

### Mock layer

When `VITE_FRONTEND_ONLY=true`, the frontend API client delegates to an in-memory mock (`src/mock/mockApi.ts`, ~60 KB) that reimplements the catalog, PO lifecycle, GR posting, inventory operations, settings, users, and reports. Mock parity with the backend is not contract-tested; it is hand-maintained (see Known Issues).

## 10. Frontend Current State

- **Pages** (from `App.tsx` route table): Login, Signup, Dashboard, Stock, Materials, MaterialDetail, Movements, Suppliers, SupplierDetail, PurchaseOrders, PurchaseOrderDetail, GoodsReceipts, LowStock, InventoryReport, Racks, Locations, Projects, Settings (+ 11 sections), NotFound.
- **Navigation**: sidebar via `useNavGroups.tsx`. **No nav item carries a `permissions` filter**, so all links render for every authenticated user regardless of role; client-side hiding relies on `RoleGuard` only on specific buttons/rows, not the menu.
- **API integration**: single `api` client (`src/api/client.ts`); real mode uses `fetch` to `/api/v1${path}` with the stored JWT; frontend-only mode proxies to the mock. `useApi` hook wraps GET with loading/error/reload state.
- **UI state handling**: `Loading` (Spinner `PageSkeleton` / `KPICardSkeleton`), `ErrorState`, `EmptyState`, and `Skeleton` primitives are present and used.
- **Responsive**: `MobileDrawer` / `MobileNav` components exist → responsive layout implemented.
- **Dark mode**: implemented (`appearance.theme` setting + `GlobalPreferencesApplier`).
- **Known UI issues**:
  - `SettingsSections.tsx:375` — ESLint `react-hooks/exhaustive-deps` warning (missing `reload` dep).
  - Default export mode / empty state coverage verified where present; no systemic missing fallbacks observed in the audited routes.
  - The "Add stock item" form (`AddStockItemForm.tsx`) calls `POST /locations`, `POST /suppliers`, `POST /stock-items` — all implemented backend endpoints.

## 11. Authentication & Authorization

- **Mechanism**: password verified with `bcryptjs.compare`; JWT signed HS256, 12h expiry (`server.ts` jwt config). Token stored in `localStorage` (`afrinov.token`), sent as `Authorization: Bearer`. Frontend-only mode bypasses the backend and accepts any non-empty credential (demo) or a configured demo pair.
- **Session**: no server-side session store; JWT stateless. `isActiveInDb` performs a per-request DB lookup for revocation so deactivated users are rejected immediately even with a valid token. `req.user` is augmented with `{ id, active }` on top of the JWT payload.
- **Roles**: 6 roles seeded (`ADMIN, STORE_CONTROLLER, PROCUREMENT, APPROVER, TECHNICIAN, VIEWER`) with a permission matrix in `permissions.ts`.
- **Enforcement**: server-side via `requirePermission` in route handlers (verified via grep — present in identity, inventory, procurement, operations, reporting, settings, audit routes). Deny-by-default.
- **Client role gating**: `usePermissions` / `RoleGuard` hide UI elements. **Fail-open caveat**: `usePermissions.hasPermission` returns `true` for any permission string it does not recognize; this is UI-only and does not affect server enforcement, but is a defence-in-depth weakness.
- **Security limitations**:
  - JWT secret loaded from env; `loadConfig()` rejects known-insecure placeholder secrets when `NODE_ENV=production`. A committed `.env` on this workstation contains one such placeholder secret (`a1b2c3d4-...`, present in the `INSECURE_SECRETS` set). `.env` is git-ignored, so it is not in the repository, but it is present on disk and would be rejected at boot if `NODE_ENV=production`.
  - Rate limiting exists (`@fastify/rate-limit`): 5/min on `/auth/login` & `/auth/register`, 1000/min global (default). 429 returned as the documented `TOO_MANY_REQUESTS` error.
  - No password policy, password rotation, MFA, or account lockout UI.

## 12. Testing Current State

- **Frameworks**: Backend `vitest` (`include: src/**/*.test.ts`); Frontend `vitest` (jsdom). Separate configs: `vitest.config.ts` (unit, mocked DB), `vitest.integration.config.ts` (real HTTP + real DB). E2E: Playwright (`apps/frontend/e2e`), wired via `global-setup` that boots the real backend and frontend.
- **Counts (verified by execution)**:
  - Backend unit: **25 files, 299 tests — all passing** (`npm run test` in `@afrinov/backend`).
  - Frontend unit: **22 files, 277 tests — all passing** (`npm run test` in `@afrinov/frontend`).
  - Backend lint: 0 errors, 1 warning. Typecheck: pass. Build: pass.
  - Frontend lint: 0 errors, 1 warning. Typecheck: pass. Build: pass.
- **What the tests actually prove**:
  - **Backend unit tests run against a mocked Prisma client** — 18 of 25 test files call `vi.mock(...shared/db.js)`. They prove route/service logic and the error contract for mocked responses, **not** real database behaviour, transactions, or concurrency.
  - **Integration tests** (`integration/auth.real-http.test.ts`) boot a real server and a real DB, but require `SEED_ADMIN_PASSWORD` and a reachable PostgreSQL. They are **not** executed by `npm test` and are **not runnable** in this environment (DB down).
  - **E2E (Playwright)**: 1 spec (`e2e/login.spec.ts`). `global-setup` waits for `/health/ready`; with no DB it fails before any test runs — confirmed: E2E run exited with `Timed out waiting for http://127.0.0.1:4000/health/ready`.
- **Gaps**: no load/performance test is part of the committed suite (the `*_PERFORMANCE_AUDIT_REPORT.md` artifacts at repo root are prior auditor reports, not automated tests); no property/contract tests between the frontend mock and the real backend.

## 13. Current Runtime / Environment State

| Environment | Availability | Configuration | DB | Notes |
| --- | --- | --- | --- | --- |
| Local development (backend) | Startable | `.env` present (dev); `PORT=4000`, `HOST=0.0.0.0`, `NODE_ENV=development` | **Not reachable** (`localhost:5432` refused; `/health/ready` → 503) | `npm run dev` does not auto-migrate/seed. |
| Local development (frontend) | Startable | `.env.example` (defaults); `VITE_FRONTEND_ONLY=false` | N/A (proxies to backend) | Frontend-only mode (`VITE_FRONTEND_ONLY=true`) runs with in-memory mock; fully functional without a DB. |
| Test | Configured via `vitest.config.ts` | dummy `DATABASE_URL`, `NODE_ENV=test` | Mocked Prisma only | Unit tests pass. |
| Staging | Unknown | `.env.example` / `.env.test.example` reference it | Unknown | No staging deployment is reachable or configured in-repo. |
| Production | Unknown | `Dockerfile` + `docker-compose.yml` (fail-closed `NODE_ENV=production`, `JWT_SECRET` required) | Unknown | No production host reachable from this workstation. Container entrypoint runs `prisma migrate deploy && seed && start`. |

Secrets were not exposed in this document. The only runtime signal captured: E2E global-setup stdout `Can't reach database server at localhost:5432` and a `503` from `/health/ready`.

## 14. Known Issues & Defects

| ID | Area | Issue | Severity | Current Impact | Status |
| --- | --- | --- | --- | --- | --- |
| K1 | Runtime | PostgreSQL not running; `/health/ready` returns 503; E2E and integration tests cannot start. | P0 | Cannot develop/verify against a real DB without starting Postgres and running migrate+seed. | Open (environmental) |
| K2 | Auth | `POST /auth/register` route is referenced (`server.ts` STRICT_AUTH_PATHS) and linked from the UI (`Signup.tsx`), but is **not implemented**. Live-mode signup returns `NOT_AVAILABLE`. | P0 | Signup flow is broken for real-backend mode. | Open |
| K3 | Observability | No CI/CD pipeline exists in-repo; nothing gates commits/builds/tests. | P1 | No automated quality gate; regressions can be introduced unverified. | Open |
| K4 | Notifications | Domain event handlers are never registered in production — `StockThresholdReached` and inventory events are dispatched but do nothing; low-stock/supplier/PO/delivery notification toggles are inert. | P1 | Alert settings have no effect; no in-app notifications are ever produced. | Open |
| K5 | API contract | Frontend Settings → System calls `GET /api/v1/health`, which 404s (probes are at root). The page shows the API as "offline" even when running. | P1 | Misleading system-status indicator; operators may believe the API is down. | Open |
| K6 | Authorization | `GET /purchase-orders` (list) requires only `authenticate`, not `ViewPurchaseOrder`; any authenticated user can enumerate PO metadata. Inconsistent with `GET /purchase-orders/:id` (requires the permission). | P1 | Unauthorized information disclosure of PO list. | Open |
| K7 | Auditing | `PATCH /inventory-transactions/:id` rewrites the actor on a ledger row, contradicting the documented append-only ledger (ADR-002). No DB trigger enforces immutability. | P2 | Audit-trail integrity can be altered; ledger is mutable by privilege. | Open |
| K8 | Schema | Two migrations share the timestamp prefix `20260101000000` (`initial` + `location_management`); `migration_lock.toml` is a hand-written placeholder. | P2 | `prisma migrate` tooling may misorder/reject migrations; reproducible migrate is at risk. | Open |
| K9 | Data integrity | Supplier name uniqueness is enforced only in the app layer (`SupplierService.create` does a case-insensitive check); `Supplier` has no DB unique constraint and no `citext` extension is applied. | P2 | Concurrent/duplicate supplier creation possible. | Open |
| K10 | Authorization | `GET /users/lookup` requires `UpdateInventoryTransaction` permission — a mislabelled/mismatched permission code. | P2 | The intended recipient lookup is unavailable to roles that should use it; misleading code. | Open |
| K11 | Frontend | `usePermissions.hasPermission` returns `true` for unknown permission strings (fail-open). | P3 | Client-side gating can over-show UI; server still enforces. | Open |
| K12 | Config | `SettingsService` caches values in a per-process map (60s TTL) and never invalidates across instances/processes. | P3 | A setting change can take up to 60s to propagate within one process and is not shared across replicas. | Open |
| K13 | Concurrency | `preventNegative` / `enableNegativeStockPrevention` is read once outside the DB transaction in `InventoryService.issue/adjust` (the setting read occurs before `prisma.$transaction`). | P3 | Setting toggled between read and commit could allow a negative-balance write to succeed. | Open |
| K14 | Frontend | `SettingsSections.tsx:375` ESLint `react-hooks/exhaustive-deps` warning. | P3 | Lint warning; potential stale-closure reload behaviour. | Open |
| K15 | Frontend | `exceljs` browser bundle uses direct `eval()` (build-time warning); bundled chunk `exceljs.min.js` is ~1 MB. | P3 | CSP constraint concern; large bundle size. | Open |
| K16 | Ops | Dev entrypoint (`npm run dev`) does not auto-run migrations or seed; must be run manually. Only the prod Docker entrypoint migrates+seeds. | P3 | New developers / fresh DBs require manual `db:migrate` + `db:seed` before the app is usable. | Open |
| K17 | Suppliers | No `PATCH /suppliers/:id` or `DELETE /suppliers/:id` route; `SupplierService` only exposes `list`/`create`. | P3 | Suppliers are create-only from the API; deactivation/merge not possible. | Open |

## 15. Production Readiness Assessment

| Area | Current State | Assessment |
| --- | --- | --- |
| Functional completeness | High — procurement→receiving→inventory→reporting implemented | Partially ready: core flows exist, but signup and notifications are not functional |
| Database | Schema + 2 migrations present; no DB running in assessed env | Not operational (local dev); production unknown |
| Security | bcrypt(12), JWT 12h fail-closed, rate-limit, helmet, CORS allow-list | Good, with residual IDOR on PO list and client-side fail-open |
| Authentication | Server-side verified per request; revocation checked | Implemented |
| Authorization | RBAC enforced server-side per route | Implemented, with PO-list oversight |
| Validation | zod per route | Implemented; no global body parser validation |
| Error handling | Central handler with documented envelope | Implemented; Prisma exceptions surface as 500 |
| Logging | pino structured + correlation ids + readiness probe | Implemented |
| Observability | Logging only | Missing metrics, tracing, alerting |
| Testing | 299 backend + 277 frontend unit tests pass | Unit only; integration/e2e blocked by DB |
| Deployment | Docker + compose provided | Implemented but untested in this env |
| Backup / recovery | — | Not implemented / not documented |
| Documentation | `docs/engineering/*`, README, prior audit reports | Good |
| Data integrity | Ledger transactions + derived balances, advisory-locked numbering | Strong, with mutable-ledger caveat |

**Conclusion: Not Production Ready.**

The system is materially and structurally implemented and its unit test suites pass, but it has **not been verified end-to-end against a live database** in the assessed environment (the database is unreachable, so `/health/ready` returns `503`, the E2E suite fails at global setup, and the integration suite cannot run). It has **no CI/CD**, and it carries residual P1 defects (dead domain-event/notification system, a missing `/auth/register` route wired into the UI, a health-check 404 that misreports service status, and a PO-list authorization gap). Until these are remediated and the integration/E2E suites are restored against a reachable database, the deployment cannot be considered production-capable.

## 16. Current Gaps

Prioritised against a production-capable inventory/operations system.

1. **Critical blockers**
   - Live database unreachable; no automated path to bring up a verified DB (no CI, dev entrypoint does not migrate/seed).
   - `POST /auth/register` not implemented despite being wired into the UI and rate-limit config.
2. **Functional gaps**
   - No document/binary attachment support (`deliveryRef` is text only).
   - No tool check-out/check-in UI beyond recording an issue.
   - No automatic reorder point → no auto-requisitions from low stock.
   - Supplier edit/deactivate/delete endpoints missing.
   - No production order / demand-planning bounded context.
3. **Technical gaps**
   - No CI/CD pipeline; no automated schema/migration validation gate.
   - No metrics, tracing, or alerting (pino only).
   - No secrets management beyond `.env` (production expects externally-injected `JWT_SECRET`/`POSTGRES_*`).
   - No backup/recovery procedure in-repo.
   - Two migrations share a timestamp prefix; hand-written `migration_lock.toml`.
   - Ledger mutability via `PATCH /inventory-transactions/:id` (no DB-level append-only enforcement).
   - Prisma exceptions not mapped to HTTP (500-only).
   - Frontend mock duplicates backend business logic without contract tests.
   - Append-only ledger relies on application convention, not database constraint.
4. **Operational gaps**
   - Seed admin password is random (not printed) when `SEED_ADMIN_PASSWORD` is unset; no documented first-login rotation flow.
   - No health-check endpoint exposed under the `/api/v1` prefix the frontend expects.
5. **Documentation gaps**
   - No production deployment runbook in-repo; production-readiness relies on prior auditor PDF reports, not living runbooks.

## 17. Current-State Risks

| Risk | Evidence | Likelihood | Impact |
| --- | --- | --- | --- |
| Undeployable/unverifiable state | DB down, `/health/ready` 503, E2E timed out on health probe | High | A deployment with no passing end-to-end signal |
| Stale auth credentials in dev | On-disk `.env` holds placeholder JWT secret accepted only because `NODE_ENV=development` | Low (dev only) | A production checkout of that secret would fail closed; a weak secret in a dev DB is low blast |
| Silent notification failure | `registerDomainEventHandler` called only in tests; none in prod (`events.ts`) | High | Users never receive alerts; low-stock warnings invisible operationally |
| Information disclosure | `GET /purchase-orders` list lacks `requirePermission` (`procurement.routes.ts`) | Medium | Any authenticated user sees all PO metadata |
| Mutable audit trail | `PATCH /inventory-transactions/:id` rewrites `actorId`; no DB trigger | Medium | Accountability gaps; non-repudiation weakened |
| Deployment drift / duplicate suppliers | App-layer-only supplier name uniqueness; no DB unique / no citext | Low–Medium | Duplicate master data under concurrency |
| Misreported downtime | Frontend calls `/api/v1/health`; backend serves `/health` (root) → 404 | High | Operators may act on a false "offline" signal |
| Migration ordering instability | Two migrations share `20260101000000` prefix | Medium | `prisma migrate` can misorder or reject |
| Regression risk | No CI/CD | High | Changes merge without automated validation |
| Mock/back divergence | Frontend mock reimplements business logic (TD-001 in `technical-debt.md`) | Medium | Demo/dev behaviour drifts from backend |

## 18. Unknowns / Items Requiring Confirmation

- **Unknown — requires stakeholder confirmation**: the actual, authoritative business workflow for procurement (is approval mandatory? who approves?), goods receiving (do users post GRs, or receive against a packing list?), and inventory adjustments (who may reclassify an actor?).
- **Unknown — requires stakeholder confirmation**: the required production deployment topology (reverse proxy/TLS termination, secret injection, `CORS_ORIGIN` allow-list for production, single vs multiple replicas — affects the per-process settings cache).
- **Unknown — requires stakeholder confirmation**: the production database backup/restore and disaster-recovery procedure, and who owns it.
- **Unknown — requires stakeholder confirmation**: the production seeding/bootstrap expectations (is the demo seed dataset intended for production, or should production start empty / migrate existing data from the legacy `.xlsm`?).
- **Unknown — requires stakeholder confirmation**: the intended fate of the `Signup` route — is user self-registration required in production (would need backend `/auth/register`, password policy, and an approval/verification flow)?
- **Unknown — requires operator confirmation**: the production value of `SEED_ADMIN_PASSWORD` and whether a first-login password-rotation mandate is part of the operational runbook.
- **Unknown — not verified**: production reachability and the actual runtime environment, since no production host is reachable from the assessed workstation.

## 19. Evidence / Verification Notes

- **Repo version control state**: `git rev-parse HEAD` → `fatal: ambiguous argument 'HEAD': unknown revision` (no commits); `git branch --show-current` → `master`; `git status --porcelain` → 256 entries. Evidence: `git` CLI in repo root `afrinov-platform/`.
- **Backend typecheck**: `npm run typecheck --workspace=@afrinov/backend` → `tsc -p tsconfig.json --noEmit`, exit 0.
- **Backend tests**: `npm run test --workspace=@afrinov/backend` → `Test Files 25 passed (25) · Tests 299 passed (299) · Duration 20.31s`.
- **Backend unit tests use a mocked Prisma**: `vitest.config.ts` sets a dummy `DATABASE_URL`; grep shows 18 of 25 `*.test.ts` files import and call `vi.mock('../shared/db.js', ...)`. `server.test.ts` confirms the mock pattern and that `GET /health` returns 200 and unauthenticated `/api/v1/materials` returns 401.
- **Frontend typecheck**: `npm run typecheck --workspace=@afrinov/frontend` → `tsc -b --noEmit`, exit 0.
- **Frontend tests**: `npm run test --workspace=@afrinov/frontend` → `Test Files 22 passed (22) · Tests 277 passed (277) · Duration 63.35s` (jsdom).
- **Lint**: `npm run lint --workspaces --if-present` → 0 errors; 1 warning (`SettingsSections.tsx:375` react-hooks/exhaustive-deps).
- **Build**: `npm run build` (workspaces) → both `tsc` builds and the Vite build succeed. Frontend emits a `exceljs.min.js` chunk with a direct-`eval` build warning.
- **Database reachability**: `Test-NetConnection -ComputerName localhost -Port 5432` → `False`. E2E global setup stdout: `prisma:error … Can't reach database server at localhost:5432`; `Error: Timed out waiting for http://127.0.0.1:4000/health/ready`. Corroborating backend log: `{"statusCode":503}` on `/health/ready` and `{"status":"not_ready","database":"error"}`.
- **Backend liveness**: `/health` and `GET /` are registered at root in `server.ts`; the E2E run shows `/health` returning 200 in the server logs while `/health/ready` returns 503 — confirming the process is alive but the database is not.
- **Route inventory**: grep across `apps/backend/src/modules/*/*.routes.ts` enumerated 49 `app.get|post|put|patch|delete(...)` registrations.
- **Authorization enforcement**: grep for `requirePermission` shows calls in every mutation route and most read routes; `GET /purchase-orders` (list) and `GET /suppliers`/`GET /materials`/`GET /locations`/`GET /projects`/`GET /racks` have only `app.authenticate` (read-only, no `View*` permission) — confirmed in `procurement.routes.ts:90-93` and `material.routes.ts`.
- **Missing register route**: `auth.routes.ts` defines only `/auth/login` and `/auth/me`; `server.ts` `STRICT_AUTH_PATHS` includes `/api/v1/auth/register`.
- **Health 404**: `client.ts` prefixes all calls with `/api/v1`; `SettingsSections.tsx:507` calls `api.get('/health')` → `/api/v1/health`; backend mounts `/health` at root (`server.ts:190`), not under the prefix.
- **Domain-event deadness**: `registerDomainEventHandler` is referenced only in `src/shared/events.test.ts`; no production module imports or calls it. `dispatchDomainEvents` is called from `inventory.service.ts` and `procurement.service.ts` but no handler is ever registered.
- **Migration timestamps**: `Get-ChildItem .../prisma/migrations` shows `20260101000000_initial` and `20260101000000_location_management` (shared prefix). `migration_lock.toml` contents are a comment placeholder with only `provider = "postgresql"`.
- **Supplier uniqueness**: `Supplier` model (`schema.prisma:163-180`) has `@@index([name])` only (no `@@unique`); `SupplierService.create` does an app-layer case-insensitive `findFirst` check.
- **Ledger mutability**: `inventory.routes.ts:83` `PATCH /inventory-transactions/:id` updates `actorId`; `inventory.service.ts:updateActor` writes `tx.inventoryTransaction.update(...)`.
- **`.env` secret**: `apps/backend/.env` present on disk (git-ignored via `.gitignore:3`), `JWT_SECRET="a1b2c3d4-e5f6-7890-abcd-ef1234567890"`, which is a member of `INSECURE_SECRETS` in `shared/config.ts:28-36`. Allowed only because `NODE_ENV=development`.
- **Frontend-only mode**: `vite.config.ts` proxy `/api`→`:4000`; `client.ts` `FRONTEND_ONLY = import.meta.env.VITE_FRONTEND_ONLY === 'true'`; `authService.ts` accepts any non-empty creds when `FRONTEND_ONLY`.

No secrets are included in this document.
