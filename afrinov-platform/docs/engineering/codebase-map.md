# Codebase Map — Afrinov Platform

Generated: 2026-09-17

---

## Repository Structure

```
afrinov-platform/
├── apps/
│   ├── backend/          # Fastify API (Node.js 20, TypeScript, Prisma/PostgreSQL)
│   └── frontend/         # React 18 SPA (Vite, TypeScript, TailwindCSS)
├── docs/engineering/     # This documentation
├── package.json          # Workspace root (npm workspaces)
├── decision-log.md       # ADRs (ADR-001 through ADR-004)
├── gap-analysis.md       # Current state vs target gaps
├── README.md             # Project overview & quick start
└── System-Inspection.md  # Detailed inspection notes
```

---

## Backend — Application Entry Points

### `apps/backend/src/server.ts`
- **Purpose**: Fastify server bootstrap, plugin registration, route mounting, graceful shutdown
- **Responsibilities**:
  - Configuration loading & validation (via `shared/config.ts`)
  - CORS, JWT authentication plugin registration
  - Global error handler (maps `ApiError` → HTTP responses)
  - Health endpoints (`/health`, `/health/ready`)
  - Route registration for all modules under `/api/v1`
  - PrismaClient singleton management
  - SIGTERM/SIGINT graceful shutdown
- **Dependencies**: `shared/config`, `shared/errors`, `shared/db`, all module routes
- **Consumers**: `npm run dev`, `npm run start`, test suite
- **State**: PrismaClient (global singleton), Fastify instance
- **Side Effects**: HTTP server, database connections, process signal handlers
- **Invariants**: Config validated before server starts; JWT secret non-empty in production
- **Failure Modes**: ConfigError on missing/invalid env; 500 on unhandled errors; 503 on DB unready
- **Tests**: `server.test.ts` (API smoke tests)
- **Refactoring Risk**: LOW — well-isolated bootstrap logic

---

## Backend — Shared Infrastructure (`apps/backend/src/shared/`)

### `shared/config.ts`
- **Purpose**: Centralized environment configuration & validation
- **Responsibilities**: Load `AppConfig` from env; fail fast on missing/insecure values; define `ConfigError`
- **Inputs**: `process.env` (NODE_ENV, PORT, HOST, DATABASE_URL, JWT_SECRET, LOG_LEVEL)
- **Outputs**: Validated `AppConfig` object
- **Dependencies**: None (pure)
- **Invariants**: `DATABASE_URL` required; `JWT_SECRET` non-empty & not in insecure set in production
- **Tests**: None directly (exercised via server tests)

### `shared/errors.ts`
- **Purpose**: Shared error taxonomy matching `08-api/error-model.md`
- **Responsibilities**: `ApiError` class + factory functions (`Errors.unauthenticated`, `Errors.forbidden`, `Errors.notFound`, `Errors.conflict`, `Errors.validation`, `Errors.insufficientBalance`, `Errors.invalidState`)
- **Dependencies**: None
- **Consumers**: All services, route handlers, global error handler
- **Invariants**: Structured error codes; no sensitive data in external responses

### `shared/db.ts`
- **Purpose**: PrismaClient singleton (avoids multiple instances in dev hot-reload)
- **Responsibilities**: Export single `prisma` instance; log warnings/errors in dev
- **Dependencies**: `@prisma/client`
- **Consumers**: All services, repositories
- **Invariants**: Single instance per process

### `shared/decimal.ts`
- **Purpose**: Decimal arithmetic helpers (wraps Prisma.Decimal)
- **Responsibilities**: `toDecimal`, `gtZero`, `ZERO` constant; safe arithmetic for financial quantities
- **Dependencies**: `@prisma/client`
- **Consumers**: Inventory, Procurement, Reporting services
- **Invariants**: Never use JS `number` for monetary/stock quantities

### `shared/authorization.ts`
- **Purpose**: RBAC permission loading & checking
- **Responsibilities**: `loadUserPermissions` (cached per request), `requirePermission`, `userHasPermission`
- **Dependencies**: `shared/db`, `shared/errors`, `shared/permissions`
- **Consumers**: Route pre-handlers, service methods requiring authz
- **Invariants**: Deny-by-default; inactive users forbidden; permissions loaded from DB roles

### `shared/permissions.ts`
- **Purpose**: Permission code definitions & role-permission matrix
- **Responsibilities**: `PermissionCodeValue` type; default role→permission mapping
- **Dependencies**: None
- **Consumers**: `authorization.ts`, seed script, tests

### `shared/events.ts`
- **Purpose**: Domain event dispatch (in-process, fire-and-forget)
- **Responsibilities**: `dispatchDomainEvents` — emits to registered handlers; used for stock alerts, audit triggers
- **Dependencies**: None
- **Consumers**: `InventoryService`, `ProcurementService`

---

## Backend — Bounded Context Modules

### `modules/identity` — Users, Roles, Authentication
| File | Purpose |
|------|---------|
| `auth.routes.ts` | `POST /auth/login`, `GET /auth/me` |
| `user.routes.ts` | CRUD for users (admin only) |
| `identity.service.ts` | `AuthService` (bcrypt hash/verify, login), `UserService` (CRUD, role assignment, audit) |

**Domain Entities**: `User`, `Role`, `Permission`, `UserRole`, `RolePermission`
**State**: User active/inactive; role assignments; password hash
**Invariants**: Email unique (case-insensitive); at least one role on create; passwords hashed (bcrypt 10)
**Failure Modes**: Conflict on duplicate email; NotFound on missing user/role; Unauthenticated on bad credentials

### `modules/inventory` — Materials, Locations, Stock Ledger
| File | Purpose |
|------|---------|
| `material.routes.ts` | CRUD for materials (sku, name, category, UoM, requiredStock, unitCost) |
| `location.routes.ts` | CRUD for locations (name, code, type, extended fields) |
| `rack.routes.ts` | CRUD for racks (code, name, locationId, projectNumber, capacity, status) |
| `stock-item.routes.ts` | Combined create: material + initial balance |
| `inventory.routes.ts` | Issue, transfer, adjust, history, actor update |
| `inventory.service.ts` | **Core domain logic** — only writer to `inventory_transactions`; enforces ADR-002 |
| `location.service.ts` | Location CRUD + dependency counts (prevents delete if referenced) |
| `rack.service.ts` | Rack CRUD + status transitions |
| `stock-item.service.ts` | Creates material + optional initial receipt transaction |
| `balances.ts` | Balance query helpers (read-only) |

**Domain Entities**: `Material`, `Location`, `Rack`, `InventoryTransaction`, `InventoryBalance`
**State Machines**:
- InventoryTransaction: append-only ledger (RECEIPT, ISSUE, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT)
- InventoryBalance: derived view (recomputed after each transaction)
- Rack: ACTIVE | INACTIVE | FULL
**Invariants (ADR-002)**:
- `InventoryBalance` NEVER written directly — always recomputed from transactions
- Issue/Transfer check balance before write (unless `enableNegativeStockPrevention=false`)
- Transfers atomic: both TRANSFER_OUT + TRANSFER_IN in same tx; paired via `pairedWithId`
- Adjustments require `reasonCode` (COUNT_VARIANCE, DAMAGE, LOSS, SCRAP, OTHER)
**Failure Modes**: InsufficientBalance; InvalidState; NotFound; ValidationError
**Tests**: Comprehensive unit tests with in-memory Prisma fake (`inventory.service.test.ts`)

### `modules/procurement` — Suppliers, Purchase Orders, Goods Receipts
| File | Purpose |
|------|---------|
| `procurement.routes.ts` | All procurement endpoints |
| `procurement.service.ts` | `SupplierService`, `PurchaseOrderService`, `GoodsReceiptService` |
| `goods-receipt.service.ts` | Goods receipt posting (creates RECEIPT transactions) |

**Domain Entities**: `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`, `GoodsReceiptLine`
**State Machine (PO)**:
```
DRAFT → PENDING_APPROVAL → APPROVED → SHIPPED → DELIVERED
  ↓         ↓                    ↓
CANCELLED  CANCELLED          CANCELLED (from APPROVED)
```
Legacy statuses (SUBMITTED, SENT, PARTIALLY_RECEIVED, FULLY_RECEIVED, CLOSED, REJECTED) accepted for compat.
**Invariants**:
- PO number generation serialized via `pg_advisory_xact_lock`
- Submission requires ≥1 line
- Approval required if `purchaseOrders.requireApprovalBeforeProcessing=true` (default)
- Ship only from APPROVED; Deliver only from SHIPPED
- Deliver creates RECEIPT transactions for shortfall only (idempotent wrt GoodsReceipt)
- Cancellation allowed from DRAFT/PENDING/SUBMITTED/APPROVED with reason
- GoodsReceipt: DRAFT → SUBMITTED → POSTED; posting creates RECEIPT transactions & updates PO receivedQty
**Failure Modes**: Conflict (concurrent transition); InvalidState; NotFound; ValidationError
**Tests**: Comprehensive (`procurement.service.test.ts`)

### `modules/reporting` — Read-Only Views
| File | Purpose |
|------|---------|
| `reporting.routes.ts` | Report endpoints |
| `reporting.service.ts` | `ReportingService` — current stock, movement history, low stock, inventory report (Excel/PDF export) |
| `report-export.ts` | Excel (exceljs) & PDF (pdfkit) generation |
| `report-query.schema.ts` | Zod schema for report query params |

**Responsibilities**: Zero mutations; composes data from transactions, balances, materials, locations, POs
**Invariants**: No writes to DB; deterministic results for same query
**Tests**: `report.service.test.ts`

### `modules/settings` — Typed Key/Value Configuration
| File | Purpose |
|------|---------|
| `settings.routes.ts` | GET all, GET by key, GET values (batch), PUT single, PATCH bulk, POST reset |
| `settings.service.ts` | `SettingsService` — typed get/set with validation, audit logging |

**Domain Entity**: `Setting` (key, value:Json, type:enum, category, description, isEditable, enumOptions)
**Categories**: general, inventory, purchase_orders, notifications, users, appearance, security, system, data
**Invariants**: Type validation on write; audit log on change; defaults preserved
**Tests**: `settings.service.test.ts`

### `modules/audit` — Append-Only Audit Log
| File | Purpose |
|------|---------|
| `audit.routes.ts` | GET /audit (filter by entityType, limit) |

**Domain Entity**: `AuditLogEntry` (actorId, action, entityType, entityId, before, after, createdAt)
**Invariants**: Append-only; never modified/deleted by application code
**Consumers**: All services (via `prisma.auditLogEntry.create`)

---

## Backend — Database (`apps/backend/prisma/`)

### `schema.prisma` — Source of Truth
- **Generator**: `prisma-client-js`
- **Datasource**: PostgreSQL (`DATABASE_URL`)
- **Models**: 23 models covering all bounded contexts
- **Key ADRs Enforced**:
  - ADR-002: `InventoryBalance` @@id([materialId, locationId]) — derived, never written directly
  - ADR-003: `Location` normalized with type enum, code, extended fields
  - ADR-004: Single `Material` with `category` enum (5 categories)
- **Migrations**: Two migrations (initial + location_management)

---

## Frontend — Application Entry Points

### `apps/frontend/src/main.tsx`
- **Purpose**: React root mount
- **Structure**: `BrowserRouter` → `AuthProvider` → `App`

### `apps/frontend/src/App.tsx`
- **Purpose**: Route definitions, layout, auth guards
- **Routes**:
  - Public: `/login`, `/signup` (wrapped in `PublicOnly` guard)
  - Protected: all others (wrapped in `Protected` → `ToastProvider` + `GlobalPreferencesApplier` + `AppShell` + `Outlet`)
  - Settings: nested routes under `/settings/*` (lazy-loaded from `SettingsSections.tsx`)
- **Lazy Loading**: All pages via `React.lazy` + `Suspense`

### `apps/frontend/src/auth.tsx`
- **Purpose**: Auth context provider + `useAuth` hook (single source of truth)
- **State**: `user` (AuthUser | null), `loading` (boolean)
- **Persistence**: `sessionStorage` key `afrinov.session` (survives refresh, clears on tab close)
- **Actions**: `login`, `signup`, `logout`
- **Revalidation**: On mount, calls `/auth/me` if JWT present (non-FRONTEND_ONLY mode)

---

## Frontend — API Layer (`apps/frontend/src/api/`)

### `client.ts`
- **Purpose**: Unified API client (real HTTP + mock proxy)
- **Modes**:
  - `VITE_FRONTEND_ONLY=true` → delegates to `mockApi` (in-memory)
  - Default → `fetch` to `/api/v1*` (proxied by Vite to backend)
- **Auth**: Bearer token from `localStorage` (`afrinov.token`)
- **Error Handling**: Normalizes to `ApiError` shape; maps 401/403 → session expiry

### `authService.ts`
- **Purpose**: Login/signup business logic (thin wrapper over `api`)
- **Modes**:
  - FRONTEND_ONLY: accepts any creds; remembers signups in memory
  - DEMO_AUTH_ENABLED: only accepts configured demo credentials
  - Live: forwards to backend `/auth/login`, `/auth/signup`
- **Exports**: `login`, `signup`, `AuthUser`, `LoginResult`, `rememberMockAccount`, `findMockAccount`

### `landingPath.ts`
- **Purpose**: Maps `general.defaultLandingPage` setting → route path

### `exportReport.ts`
- **Purpose**: Report export triggers (calls backend, handles blob download)

---

## Frontend — Mock Layer (`apps/frontend/src/mock/`)

### `mockApi.ts` (~1100 lines)
- **Purpose**: Full in-memory backend simulation for frontend-only mode
- **State**: Module-level `State` object (materials, locations, suppliers, POs, GRs, transactions, racks, projects)
- **Balances**: Computed on-demand from transactions (mirrors ADR-002)
- **Features**: All CRUD, PO lifecycle, GR posting, inventory operations, reports, settings, users, audit
- **Validation**: Returns same `ApiError` codes as real backend

### `seed.ts` / `types.ts`
- **Purpose**: Seed data & TypeScript interfaces for mock state

### `mockReport.ts`
- **Purpose**: Report computation logic (shared with backend reporting service)

---

## Frontend — Pages (`apps/frontend/src/pages/`)

| Page | Purpose |
|------|---------|
| `Login.tsx` / `Signup.tsx` | Auth forms |
| `Dashboard.tsx` | KPIs, charts, recent activity, low stock panel |
| `Materials.tsx` / `MaterialDetail.tsx` | Material catalog & detail |
| `Stock.tsx` | Current stock table (balance view) |
| `Movements.tsx` | Transaction history with filters |
| `Suppliers.tsx` / `SupplierDetail.tsx` | Supplier CRUD |
| `PurchaseOrders.tsx` / `PurchaseOrderDetail.tsx` | PO list + full lifecycle detail |
| `GoodsReceipts.tsx` | GR list + create/post |
| `LowStock.tsx` | Low stock report |
| `InventoryReport.tsx` | Advanced filterable inventory report + export |
| `Racks.tsx` | Rack management |
| `Locations.tsx` | Location management (with dependency checks) |
| `Projects.tsx` | Project CRUD |
| `Settings.tsx` / `SettingsSections.tsx` | 10 settings sections (General, Notifications, Inventory, POs, Appearance, Users, Security, System, Data, History) |
| `NotFound.tsx` | 404 |

---

## Frontend — Components (`apps/frontend/src/components/`)

| Category | Components |
|----------|------------|
| **UI Primitives** | `Button`, `Badge`, `Alert`, `Modal`, `ConfirmDialog`, `Tooltip`, `DropdownMenu`, `Popover`, `Progress`, `Skeleton`, `ScrollArea`, `Card`, `Toolbar`, `Icon`, `Logo`, `Field` |
| **Data Display** | `DataTable`, `Stat`, `KPICard`, `KPIGrid`, `KPICardSkeleton` |
| **Charts** | `BarChart`, `LineChart`, `DonutChart`, `StatusBarChart` |
| **Domain-Specific** | `ActivityFeed`, `RecentActivity`, `DashboardFilters`, `LowStockPanel`, `TopInventoryItems`, `CategoryDistribution`, `InventoryValueChart`, `StockStatusView`, `StockHealthView`, `StockMovementAnalysis`, `StockActionForm`, `AddStockItemForm`, `MaterialDetail`, `SupplierAnalytics`, `PurchaseOrderAnalytics`, `TransactionDrawer`, `MobileDrawer`, `Sidebar`, `AppHeader`, `AppShell`, `PageContainer`, `PageHeader`, `RoleGuard`, `DevModeBanner`, `GlobalPreferencesApplier` |

---

## Frontend — Hooks (`apps/frontend/src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useApi.ts` | Thin wrapper over `api` client |
| `useAppShell.tsx` | Sidebar/mobile drawer state |
| `useDashboardData.ts` | Dashboard data fetching + caching |
| `useSettings.tsx` | Settings CRUD + caching |
| `useAppearance.ts` | Theme/density preferences |
| `usePermissions.ts` | Permission checks |
| `useNavGroups.tsx` | Navigation grouping |
| `useDebounced.ts` | Debounced value |
| `useKeyboardShortcut.ts` | Keyboard shortcuts |

---

## Frontend — Config (`apps/frontend/src/config/`)

| File | Purpose |
|------|---------|
| `demoAuth.ts` | Demo credentials toggle (`VITE_DEMO_AUTH_ENABLED`) |

---

## Configuration & Environment

### Backend Required Env Vars
| Var | Required | Description |
|-----|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | HS256 secret (non-empty, not in insecure set in prod) |
| `PORT` | No (default 4000) | HTTP port |
| `HOST` | No (default 0.0.0.0) | Bind address |
| `NODE_ENV` | No (default production) | development/test/production |
| `LOG_LEVEL` | No (default info) | pino log level |
| `CORS_ORIGIN` | No | Comma-separated origins (prod only) |

### Frontend Env Vars
| Var | Description |
|-----|-------------|
| `VITE_FRONTEND_ONLY` | "true" → mock mode |
| `VITE_DEMO_AUTH_ENABLED` | "true" → strict demo credentials |

---

## Testing Architecture

### Backend (Vitest)
- **Unit**: Service-level tests with in-memory Prisma fake (`*.service.test.ts`)
- **Integration**: API smoke tests (`server.test.ts`)
- **DB**: Migration & seed tests (`migrations.test.ts`, `seed.test.ts`)
- **Shared**: `decimal.test.ts`, `permissions.test.ts`

### Frontend (Vitest)
- **Unit**: `auth.test.ts`, `useAppearance.test.ts`, `exportReport.test.ts`
- **Component**: `mockApi.test.ts`
- **Lib**: `dashboardMetrics.test.ts`

### Test Pyramid
```
        E2E (manual/playwright — not in repo)
       /   \
   Integration (server.test.ts)
     /       \
    Unit Tests (service tests, hook tests)
```

---

## Build & Runtime

### Backend
- **Build**: `tsc -p tsconfig.json` → `dist/`
- **Dev**: `tsx watch src/server.ts`
- **Start**: `node dist/server.js`
- **Typecheck**: `tsc -p tsconfig.json --noEmit`
- **Lint**: `eslint src --ext .ts`

### Frontend
- **Build**: `tsc -b && vite build`
- **Dev**: `vite` (port 5173, proxies `/api` → `localhost:4000`)
- **Preview**: `vite preview`
- **Typecheck**: `tsc -b --noEmit`
- **Lint**: `eslint src --ext .ts,.tsx`

### Database
- **Migrate**: `tsx src/db/migrate.ts` (runs `prisma migrate deploy`)
- **Seed**: `tsx src/db/seed.ts` (creates roles, permissions, admin user, demo data)

---

## Dependency Relationships (Key)

```
server.ts
  → shared/config, shared/errors, shared/db, shared/authorization
  → modules/*/routes (all)

modules/identity
  → shared/db, shared/errors, shared/authorization, shared/permissions

modules/inventory
  → shared/db, shared/errors, shared/decimal, shared/events, modules/settings

modules/procurement
  → shared/db, shared/errors, shared/decimal, modules/settings, modules/inventory (balance recompute)

modules/reporting
  → shared/db (read-only)

modules/settings
  → shared/db, shared/errors

modules/audit
  → shared/db
```

---

## Critical Workflows

### 1. Stock Issue (User → Issue Form → InventoryService.issue)
```
UI: StockActionForm → api.post('/inventory-issues')
    → InventoryService.issue(input)
    → checkMaterialActive, checkLocationActive
    → getCurrentBalance
    → if preventNegative && balance < qty → INSUFFICIENT_BALANCE
    → create InventoryTransaction (type=ISSUE, quantity=-qty)
    → recomputeBalance
    → dispatchDomainEvents (InventoryIssued, optionally StockThresholdReached)
    → return { transactionId }
```

### 2. PO Lifecycle (Create → Submit → Approve → Ship → Deliver)
```
Create:  POST /purchase-orders → generatePONumber (advisory lock) → DRAFT
Submit:  POST /purchase-orders/:id/submit → PENDING_APPROVAL (or APPROVED if approval off)
Approve: POST /purchase-orders/:id/approve → APPROVED + approvedAt/approvedById
Ship:    POST /purchase-orders/:id/ship → SHIPPED + tracking/carrier
Deliver: POST /purchase-orders/:id/deliver → DELIVERED + creates RECEIPT transactions for shortfall
```

### 3. Goods Receipt Posting
```
POST /goods-receipts/:id/post
  → validate status = SUBMITTED
  → for each line: create RECEIPT transaction + update PO line receivedQty
  → recomputeBalance per line
  → update GR status = POSTED
  → update PO status (FULLY_RECEIVED / PARTIALLY_RECEIVED / APPROVED)
```

### 4. Settings Change Propagation
```
PUT /settings/:key → SettingsService.setValue
  → validate type/enum
  → update Setting row + audit log
  → subsequent service calls read fresh value via SettingsService.getValue
  → e.g. inventory.enableNegativeStockPrevention toggles issue/transfer checks
```

---

## Module Responsibility Summary

| Module | Responsibility | Mutates | Reads |
|--------|---------------|---------|-------|
| identity | AuthN/AuthZ, user/role management | User, UserRole, RolePermission | User, Role, Permission |
| inventory | Stock ledger (SOURCE OF TRUTH) | InventoryTransaction, InventoryBalance | Material, Location, Setting |
| procurement | PO/GR lifecycle | PurchaseOrder, POLine, GoodsReceipt, GRLine, InventoryTransaction (via InventoryService) | Supplier, Material, Location, Setting |
| reporting | Read-only views | (none) | All |
| settings | Typed configuration | Setting | Setting |
| audit | Append-only log | AuditLogEntry | (all) |