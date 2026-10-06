# System Inspection — Afrinov IMS

> A comprehensive snapshot of the Afrinov Inventory Management System as of the exploration phase. This document describes the architecture, conventions, data model, security model, and key implementation details discovered in the codebase.

---

## 1. Repository Layout

```
files (2)/
├── afrinov-platform/          ← monorepo (backend + frontend)
│   ├── apps/
│   │   ├── backend/            ← Express API server
│   │   └── frontend/           ← React SPA
│   ├── packages/               ← shared packages (if any)
│   └── ... (monorepo config)
├── afrinov-docs/               ← Architecture & design docs
│   └── docs/
│       ├── architecture/
│       ├── decision-log.md     ← ADRs 001–004
│       └── ...
├── task_context.md             ← Exploration task tracking
└── System-Inspection.md        ← This file
```

- **Docs root:** `afrinov-docs/docs/` — lives *outside* `afrinov-platform/`, not inside it.
- **Backend root:** `apps/backend/`
- **Frontend root:** `apps/frontend/`

---

## 2. Backend Architecture

### 2.1 Stack

| Layer         | Technology                          |
|---------------|-------------------------------------|
| Runtime       | Node.js + Express                   |
| Language      | TypeScript (ESM, strict)            |
| Database      | PostgreSQL                          |
| ORM           | Drizzle ORM                          |
| Validation    | Zod (schemas double as OpenAPI)     |
| Build         | `tshy` (TypeScript→ESM/CJS dual)    |
| Testing       | Vitest + `@vitest/coverage-v8`      |
| Coverage gate | 80% (configured in `vitest.config.ts`) |
| DB in tests   | `in-memory-pg` (ephemeral Postgres) |

### 2.2 Directory Structure

```
backend/
├── src/
│   ├── server.ts           ← Express app, middleware, route mounting
│   ├── db.ts               ← Drizzle instance + query helper wrapper
│   ├── config.ts           ← Environment-based configuration
│   ├── errors.ts           ← Standard error envelope + error codes
│   ├── decimal.ts          ← Decimal.js wrapper for monetary precision
│   ├── permissions.ts      ← Role constants + permission matrix
│   ├── authorization.ts    ← RBAC middleware / guard helpers
│   ├── events.ts           ← Domain event emission (`emitEvent`)
│   ├── seed.ts             ← Database seeding (demo data)
│   ├── services/           ← Business-logic layer (one file per concern)
│   ├── routes/             ← HTTP route handlers (thin, delegate to services)
│   └── lib/                ← Utilities (balances, report-query schema, exports)
├── drizzle/                ← Migrations + schema definitions
├── package.json
└── tsconfig.json
```

### 2.3 Service-Layer Pattern

All business logic lives in `src/services/`. Routes are thin handlers that call service methods and translate results into HTTP responses.

**Service files:**

| File                        | Responsibility                                    |
|-----------------------------|---------------------------------------------------|
| `inventory.service.ts`      | Stock balance queries, movements, adjustments     |
| `procurement.service.ts`    | Purchase order CRUD, state transitions            |
| `goods-receipt.service.ts`  | Goods receipt CRUD, receiving workflows           |
| `reporting.service.ts`      | Inventory report generation                       |
| `report.service.ts`         | Report CRUD + export pipelines                   |
| `settings.service.ts`       | System settings CRUD, bulk reset                  |
| `material.service.ts`       | Material/product master data                      |
| `rack.service.ts`           | Rack/location-bin management                      |
| `location.service.ts`       | Physical location hierarchy                       |
| `stock-item.service.ts`     | Individual serialized stock items                 |
| `project.service.ts`        | Project allocation tracking                       |
| `identity.service.ts`       | User management, role assignment                  |

**Conventions:**
- Services return a `ServiceResult<T>` wrapper with `{ success, data, error }`.
- Errors thrown as structured `AppError` objects (see `errors.ts`).
- Domain events emitted via `emitEvent(eventName, payload)` from `events.ts`.
- Decimal precision handled by `decimal.ts` (wraps `decimal.js`).
- DB queries run through a helper in `db.ts` that injects the request-scoped Drizzle instance.

### 2.4 Route Layer

Routes in `src/routes/` are Express `Router` instances that:
1. Parse & validate the request body via Zod schemas.
2. Call the corresponding service method.
3. Return `{ data }` or `{ error }` JSON envelopes.
4. Use the `asyncHandler` wrapper to catch promise rejections.

**Routes:**
- `auth.routes.ts` — `/auth/login`, `/auth/signup`, `/auth/me`
- `material.routes.ts` — CRUD for materials
- `stock-item.routes.ts` — CRUD for serialized items
- `rack.routes.ts` — Rack management
- `location.routes.ts` — Location hierarchy
- `project.routes.ts` — Projects
- `user.routes.ts` — User CRUD + role management (`/users`)
- `audit.routes.ts` — Audit trail (`/audit`)
- `inventory.routes.ts` — Inventory queries + adjustments
- `procurement.routes.ts` — Purchase orders (`/purchase-orders`)
- `reporting.routes.ts` — Reports
- `settings.routes.ts` — Settings (`/settings`, `/settings/reset`)

All API responses are prefixed with `/api/v1` (enforced by the Vite proxy in dev, by a path rewrite in production).

### 2.5 Security Model

#### Roles

Six initial roles (defined in `permissions.ts` and mirrored in frontend `usePermissions.ts`):

| Role             | Description                                  |
|------------------|----------------------------------------------|
| `ADMIN`          | Full access; can manage users & settings     |
| `STORE_CONTROLLER` | Manage stock, materials, racks             |
| `PROCUREMENT`    | Create & manage purchase orders              |
| `APPROVER`       | Approve POs & goods receipts                 |
| `TECHNICIAN`     | View & consume stock, log movements          |
| `VIEWER`         | Read-only access                             |

Admin is implicitly granted all permissions (`useHasRole` short-circuits on `ADMIN`).

#### Authentication

- **Frontend-only / demo mode:** Credentials compared in-browser via `demoAuth.ts`. No real auth.
- **Live mode:** JWT stored in `localStorage` under key `afrinov.token`. Token has a 12-hour lifetime.
- **Session:** Frontend stores a lightweight `AuthUser` in `sessionStorage` under key `afrinov.session`. On mount, `/auth/me` revalidates the JWT against the backend.
- **Logout:** Clears both `localStorage` token and `sessionStorage` session.

#### Authorization

RBAC middleware applied per-route. Permission checks are role-based (`hasRole` or `hasPermission`). The frontend mirrors this via `usePermissions` hooks (`useCanManageMaterials`, `useCanManageProcurement`, `useCanApprove`, `useCanManageUsers`).

#### Error Model

Standard error envelope (see `error-model.md`):
```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable message",
    "details": { ... }
  }
}
```

Key error codes:
- `VALIDATION_ERROR` (400) — input validation failure
- `UNAUTHENTICATED` (401) — missing/invalid token
- `FORBIDDEN` (403) — insufficient role
- `NOT_FOUND` (404) — resource not found
- `CONFLICT` (409) — duplicate / state conflict
- `INTERNAL_ERROR` (500) — unexpected server error

#### Threat Model & Secrets

- JWT 12-hour expiry enforced server-side.
- Secrets loaded from environment variables (see `secrets-management.md`).
- No hardcoded secrets in source.
- Rate limiting on auth endpoints.
- CORS restricted to configured origins.

### 2.6 State Machines

#### Purchase Order (PO)

```
DRAFT → SUBMITTED → APPROVED → SENT → PARTIALLY_RECEIVED → FULLY_RECEIVED → CLOSED
```

- **DRAFT → SUBMITTED:** `submit()` — subject to approval gate (see `purchaseOrders.requireApprovalBeforeProcessing` setting)
- **SUBMITTED → APPROVED:** `approve()` — requires APPROVER role (or auto-approved if gate is off)
- **APPROVED → SENT:** `send()` — marks PO as sent to supplier
- **SENT → PARTIALLY_RECEIVED:** `receivePartial()` — when a partial GR is linked
- **PARTIALLY_RECEIVED → FULLY_RECEIVED:** `receiveFull()` — when remaining quantities are received
- **Any → CANCELLED:** `cancel()` — only if `purchaseOrders.allowCancellation` is true
- **SUBMITTED → REJECTED:** `reject()` — rejection from approval state

#### Goods Receipt (GR)

```
DRAFT → SUBMITTED → POSTED
```

- `POSTED` is terminal — GRs are immutable once posted.
- Posting creates stock movement records and updates balances.

#### Transaction

- Immutable. Once created, a transaction record cannot be deleted or modified.
- Created for every stock movement, adjustment, receipt, and issue.

### 2.7 Settings System

Settings are category-keyed, stored in the database, and editable only by `ADMIN`.

**Categories:** `general`, `inventory`, `purchase_orders`, `notifications`, `appearance`, `security`, `system`, `data`

**Notable settings:**
- `general.companyName` — required, max 120 chars
- `general.defaultPageSize` — integer, 5–200
- `inventory.lowStockMultiplier` — number, 0–5
- `purchaseOrders.requireApprovalBeforeProcessing` — boolean (controls PO state machine gate)
- `purchaseOrders.allowCancellation` — boolean
- `purchaseOrders.allowEditAfterApproval` — boolean
- `security.sessionTimeoutMinutes` — integer, max 720
- `appearance.theme` — `system` | `light` | `dark`
- `appearance.density` — `comfortable` | `compact`
- `general.defaultLandingPage` — controls post-login redirect

Settings API:
- `GET /settings` — returns full settings catalog with metadata (type, category, description, enumOptions, isEditable, updatedAt)
- `PATCH /settings` — accepts `{ updates: Record<string, unknown> }`, returns updated rows
- `POST /settings/reset` — resets all settings to defaults, returns updated rows
- `GET /settings/:key` — single setting by key (used by authService for landing page)

Validation rules are defined in `useSettings.tsx` (`validate` function) and mirrored server-side via Zod.

### 2.8 Reporting & Export

- `reporting.service.ts` generates inventory reports (current stock, low stock, movements).
- `report.service.ts` handles report CRUD and export.
- Export formats: XLSX (via `xlsx`-like library) and PDF.
- `report-query.schema.ts` defines Zod schemas for report queries.
- `report-export.ts` implements the export pipeline (binary streaming from `/reports/inventory/export`).
- Frontend `useReportExporter` hook wraps the export logic, with client-side fallback in frontend-only mode.

---

## 3. Frontend Architecture

### 3.1 Stack

| Layer           | Technology                        |
|-----------------|-----------------------------------|
| Framework       | React 18 (hooks, context)         |
| Language        | TypeScript (strict)               |
| Build           | Vite                              |
| Styling         | Tailwind CSS (custom color palette)|
| Routing         | React Router DOM v6               |
| HTTP client     | Custom `api` wrapper (see below)  |
| Testing         | Vitest + `@testing-library/react` |
| CSS convention  | BEM-like classes with `surface-*`, `brand-*`, `danger-*` tokens |

### 3.2 Directory Structure

```
frontend/
├── src/
│   ├── api/
│   │   ├── client.ts          ← Unified API client (real or mock)
│   │   ├── authService.ts     ← Auth logic (login, signup)
│   │   └── landingPath.ts     ← Post-login redirect resolver
│   ├── hooks/
│   │   ├── useApi.ts          ← Generic data-fetching hook
│   │   ├── useSettings.ts     ← Settings provider + hooks (tsx)
│   │   ├── useAppearance.ts   ← Theme/density global state
│   │   └── usePermissions.ts  ← Role-based permission hooks
│   ├── components/
│   │   ├── auth.tsx           ← AuthProvider, useAuth
│   │   ├── ui.tsx             ← Shared UI primitives (Button, Input, etc.)
│   │   ├── Toast, Alert, Modal, Skeleton, Badge, Icon, Logo, Field, etc.
│   │   └── ...
│   ├── pages/
│   │   ├── Login.tsx, Signup.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Stock.tsx
│   │   ├── Materials.tsx
│   │   ├── Movements.tsx
│   │   ├── PurchaseOrders.tsx
│   │   ├── PurchaseOrderDetail.tsx
│   │   ├── GoodsReceipts.tsx
│   │   ├── LowStock.tsx
│   │   ├── InventoryReport.tsx
│   │   ├── Settings.tsx
│   │   └── SettingsSections.tsx
│   ├── mock/
│   │   ├── mockApi.ts         ← In-memory API implementation
│   │   ├── types.ts           ← Mock data types
│   │   ├── seed.ts            ← Seed data for mock layer
│   │   └── mockReport.ts      ← Mock report generator
│   ├── lib/
│   │   └── format.ts          ← Date/formatting utilities
│   └── main.tsx               ← App entry point (AuthProvider + Router)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 3.3 API Client

The API client (`api/client.ts`) is a mode-aware wrapper:

- **`FRONTEND_ONLY === true`** (`VITE_FRONTEND_ONLY=true`): All calls delegate to `mock/mockApi.ts` via a `Proxy` that lazily imports the mock module.
- **`FRONTEND_ONLY === false`**: Calls go to `fetch('/api/v1/...')` with JWT in `Authorization: Bearer` header.

JWT is stored in `localStorage` (`afrinov.token`), managed by `getToken()` / `setToken()`.

The client surfaces a unified `ApiError` shape:
```typescript
interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

### 3.4 Auth Flow

1. **`auth.tsx`** exports `AuthProvider` (mounted at root in `main.tsx`) and `useAuth()`.
2. On mount, `AuthProvider` restores user from `sessionStorage` synchronously (avoids flash), then revalidates against `/auth/me` if a JWT exists.
3. `login()` delegates to `authService.login()`:
   - Frontend-only: accepts any non-empty creds; recognizes in-memory accounts created via `signup()`.
   - Demo mode (`VITE_DEMO_AUTH_ENABLED`): matches configured `DEMO_CREDENTIALS` exactly.
   - Live mode: calls `POST /auth/login`, stores JWT, fetches landing page setting.
4. `signup()` delegates to `authService.signup()`:
   - Frontend-only: stores account in-memory map, returns user immediately.
   - Live mode: throws `NOT_AVAILABLE` (no production signup endpoint wired).
5. Post-login redirect: `landingPathFor()` maps `general.defaultLandingPage` setting to a route.
6. Logout clears both `localStorage` token and `sessionStorage` session.

**Demo credentials source:** `config/demoAuth.ts` reads `VITE_DEMO_AUTH_EMAIL` / `VITE_DEMO_AUTH_PASSWORD` from env (no hardcoded fallbacks in production bundles).

### 3.5 Settings System (Frontend)

- `useSettings.tsx` provides a `SettingsProvider` that:
  - Fetches settings from `GET /settings` on mount.
  - Maintains a local `draft` (unsaved edits) and a `saved` snapshot for dirty tracking.
  - Validates each setting via the `validate()` function (type, min/max, format rules).
  - Applies theme + density to `document.documentElement` on load.
  - Exposes `save()` (PATCH), `resetAll()` (POST reset), `reload()`, dirty tracking, and per-key validation errors.
- `Settings.tsx` renders the layout: sidebar nav + `<Outlet />` router outlet. Admin-only sections are filtered out for non-admins.
- `SettingsSections.tsx` contains per-section components: General, Inventory, Purchase Orders, Notifications, Appearance, Users & Permissions, Security, System, Data & Backup, Change History.
- Appearance settings (`theme`, `density`) apply live via `useAppearance`.
- Non-admins can edit only `appearance` settings (per-view, stored client-side concept).

### 3.6 Permission Hooks

```typescript
useHasRole(requiredRoles)  // ADMIN auto-grants all
useIsAdmin()
useCanManageMaterials()    // ADMIN + STORE_CONTROLLER
useCanManageProcurement()  // ADMIN + PROCUREMENT
useCanApprove()            // ADMIN + APPROVER
useCanManageUsers()        // ADMIN only
```

### 3.7 Mock Layer

When `FRONTEND_ONLY=true`, the app uses an in-memory mock API:
- `mockApi.ts` — implements all `GET/POST/PATCH/DELETE` endpoints with in-memory data.
- `mock/types.ts` — TypeScript interfaces for mock entities.
- `mock/seed.ts` — initial seed data (materials, locations, racks, stock items, POs, users).
- `mockReport.ts` — generates report data client-side for the export pipeline.
- `rememberMockAccount()` / `findMockAccount()` in `authService.ts` handle auth within the mock store.

### 3.8 Routing

React Router v6 with these routes (inferred from page files + landing paths):
| Route                    | Page                  | Auth         |
|--------------------------|-----------------------|--------------|
| `/login`                 | Login                 | Public       |
| `/signup`                | Signup                | Public (demo)|
| `/`                      | Dashboard             | Protected    |
| `/stock`                 | Stock                 | Protected    |
| `/movements`             | Movements             | Protected    |
| `/materials`             | Materials             | Protected    |
| `/purchase-orders`       | PurchaseOrders        | Protected    |
| `/purchase-orders/:id`   | PurchaseOrderDetail   | Protected    |
| `/goods-receipts`        | GoodsReceipts         | Protected    |
| `/reports/low-stock`     | LowStock              | Protected    |
| `/reports/inventory`     | InventoryReport       | Protected    |
| `/settings`              | Settings (General)    | Admin: full  |
| `/settings/*`            | SettingsSections      | Admin: full  |

Route guards use `useAuth().user` and `usePermissions` hooks to conditionally render or redirect.

---

## 4. Testing

- **Framework:** Vitest (unit + integration)
- **Coverage:** `@vitest/coverage-v8`, threshold at 80%
- **DB tests:** `in-memory-pg` provides an ephemeral PostgreSQL instance per test
- **Frontend tests:** `@testing-library/react` for component rendering
- **Auth persistence:** tests in `auth.test.ts` stub `sessionStorage` and verify round-trip serialization
- **Test files found:** auth.test.ts, settings.service.test.ts, seed.test.ts, migrations.test.ts, server.test.ts, permissions.test.ts, decimal.test.ts, balances.test.ts, stock-item.service.test.ts (glob-confirmed; not all fully read)

---

## 5. Key Patterns & Conventions

- **ServiceResult wrapper:** All service methods return `{ success, data?, error? }`.
- **asyncHandler:** Express route wrapper that forwards promise rejections to error middleware.
- **Zod schemas:** Used for both request validation and OpenAPI auto-generation.
- **Dirty tracking:** Frontend `useSettings` compares draft vs. saved snapshot via deep equality (with type coercion for strings/numbers/booleans).
- **Lazy mock import:** API client uses a Proxy + dynamic import so the mock bundle is only loaded when `FRONTEND_ONLY` is true.
- **eslint-disable comments:** Used for `react-hooks/exhaustive-deps` in effect blocks that intentionally call setState after mount.
- **Component primitives:** Shared UI components (Button, Field, Input, Select, Modal, etc.) in `components/` with a consistent `variant`/`size`/`tone` API.

---

## 6. Open Questions / Uncertainties

- Some files remain truncated (20K char limit): `server.ts`, `procurement.service.ts`, `report.service.ts`, `settings.service.ts`, `mockApi.ts`, `InventoryReport.tsx`, `PurchaseOrderDetail.tsx`
- Backend `drizzle/` migration files not yet inspected
- Backend `package.json` scripts (dev/test/build commands) not fully enumerated
- No `.env` or `.env.example` found yet — secrets configuration location needs confirmation
