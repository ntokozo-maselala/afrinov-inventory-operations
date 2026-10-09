# Architecture Audit — Afrinov Platform

Generated: 2026-09-17

---

## Executive Summary

The Afrinov Platform is a well-structured modular monolith with clear bounded contexts, a rigorous inventory ledger model (ADR-002), and a disciplined state-machine approach to the PO lifecycle. The backend follows clean module/service separation with transactional boundary enforcement. The frontend is a React SPA with lazy-loaded routes, a dual-mode API client (real + mock), and comprehensive component library.

**Overall Assessment**: The architecture is fundamentally sound and production-oriented. The primary issues are **scale** (the mock API is 1100+ lines duplicating backend logic) and **integration gaps** (mock layer doesn't perfectly mirror backend business rules). Minor coupling and consistency issues exist.

---

## CURRENT STATE

### Backend Architecture

#### Module Boundaries
- **Well-defined**: Six bounded contexts (`identity`, `inventory`, `procurement`, `reporting`, `settings`, `audit`) each in `modules/<context>/`
- **Dependency direction**: All modules depend downward on `shared/`, no upward dependencies
- **Shared layer**: `shared/` contains truly cross-cutting concerns (config, errors, db, decimal, authorization, permissions, events)

#### Service Pattern
- Each module exposes route files (`*.routes.ts`) that register Fastify routes
- Route handlers delegate to service objects (`*.service.ts`)
- Services contain all business logic; routes are thin orchestrators
- **Exception**: `procurement.service.ts` redefines `recomputeBalance` locally — a duplicate of the one in `inventory.service.ts`

#### Transaction Management
- All mutating operations use `prisma.$transaction` with optimistic guards
- Purchase order number generation uses PostgreSQL advisory lock
- Transfer operations create paired transactions atomically

#### Domain Model
- **Ledger pattern**: `InventoryBalance` is a derived view over `InventoryTransaction` (ADR-002)
- **State machines**: PO lifecycle (DRAFT → PENDING_APPROVAL → APPROVED → SHIPPED → DELIVERED) is explicit with guards
- **Audit trail**: All mutations create `AuditLogEntry` records (append-only)

### Frontend Architecture

#### Dual-Mode Design
- **Real mode**: API calls go to `/api/v1/*` via Vite proxy
- **Mock mode** (`VITE_FRONTEND_ONLY=true`): API calls go to in-memory `mockApi.ts`
- This is a sound pattern for parallel frontend/backend development

#### Component Organization
- **Pages**: One per workflow, lazily loaded with `React.lazy` + `Suspense`
- **Components**: Organized into `ui/` (primitives), `charts/` (reusable charts), and root-level domain components
- **Hooks**: Custom hooks for data fetching, settings, appearance, permissions

#### Auth Architecture
- Single `AuthProvider` owns all auth state (no scattered auth logic)
- `sessionStorage` for session persistence (survives refresh, clears on tab close)
- `sessionStorage` chosen over `localStorage` for demo-appropriate expiry semantics

---

## TARGET STATE

The current architecture is close to the target. The intended architecture is a modular monolith with:
1. Strict bounded contexts with no cross-module business logic leakage
2. Dual-mode frontend with mock always mirroring real backend behavior
3. Comprehensive test coverage at all layers
4. Clean architectural boundaries enforced and tested

---

## ARCHITECTURAL DRIFT & VIOLATIONS

### 1. CRITICAL: `recomputeBalance` Duplicated in Procurement

**Location**: `modules/procurement/procurement.service.ts:442-453`

**Problem**: `procurement.service.ts` contains a local `recomputeBalance` function that duplicates the one in `inventory.service.ts:48-60`. Both compute the same aggregate and upsert to `inventoryBalance`.

**Impact**: If the balance computation logic changes, one copy may be updated while the other is missed. Two different balance models could exist in production.

**Root Cause**: `procurement.service.ts` creates receipt transactions directly (in `deliver()`) rather than delegating to `InventoryService.postGoodsReceipt` or a shared balance module.

**Recommended Fix**: Extract `recomputeBalance` to `shared/` or have procurement call through InventoryService for all transaction creation.

### 2. CRITICAL: Mock API Duplicates Backend Business Logic (1100+ lines)

**Location**: `apps/frontend/src/mock/mockApi.ts`

**Problem**: The mock API reimplements all backend business logic (PO lifecycle, GR posting, inventory balances, validation) independently. This is a mirror of the backend that can diverge.

**Impact**: Mock behavior may not match backend behavior. Tests against mock don't validate backend contracts.

**Recommended Fix**: This is a design trade-off inherent to the "frontend-only mode" pattern. The duplication should be documented as accepted technical debt. The mock should be treated as implementing the same API contract (verified via integration tests or contract tests).

### 3. HIGH: `SettingsService` Called Inside Transactions

**Location**: `inventory.service.ts:234,271`, `procurement.service.ts:165,195,389`

**Problem**: `SettingsService.getValue()` is called inside `prisma.$transaction(async (tx) => { ... })` blocks. This means the settings read uses the global `prisma` client, not `tx`, creating a potential inconsistency if settings change mid-transaction.

**Impact**: In theory, a setting could change between the read and the write within the same transaction. In practice, settings rarely change, but this violates transactional consistency principles.

**Recommended Fix**: Either pass settings values as parameters (prefer composition roots read settings before entering transactions) or ensure `SettingsService` accepts an optional `TransactionClient`.

### 4. MEDIUM: `loadConfigUnsafe` Bypasses Config Validation

**Location**: `server.ts:134-143`

**Problem**: `loadConfigUnsafe()` used when `skipConfigValidation` is true (test mode) provides insecure defaults including `'insecure-dev-secret-change-me'`.

**Impact**: Tests run with insecure JWT secret, but this is scoped to test environment and documented.

**Assessment**: Acceptable for dev/test. Production always uses `loadConfig()`.

### 5. MEDIUM: Frontend API Error Mapping Lacks Type Safety

**Location**: `authService.ts:160-163`

**Problem**: Error handling casts `err as ApiError` without runtime validation. If the error shape doesn't match (e.g., network error thrown differently), the error code checks fail silently.

**Impact**: Could surface wrong error messages to user.

**Recommended Fix**: Add a type guard `isApiError(err: unknown): err is ApiError`.

### 6. LOW: Inconsistent Import of Decimal Helpers

**Location**: `inventory.service.ts:12` imports `{ ZERO, toDecimal, gtZero }` from `shared/decimal.js`, but `procurement.service.ts:18` imports only `{ toDecimal, gtZero }` and uses `new Prisma.Decimal(0)` directly in `recomputeBalance`.

**Impact**: Minor inconsistency; `ZERO` constant exists but isn't used consistently.

---

## CIRCULAR DEPENDENCIES

None found. The dependency graph is acyclic:
```
modules/* → shared/* → (external)
```

`procurement.service.ts` calling into transaction creation for receipts could create an implicit dependency on `inventory.service.ts` logic, but currently doesn't import it.

---

## STABLE vs UNSTABLE MODULES

### Stable (infrequently changed, high fan-in):
- `shared/db.ts` — single Prisma client
- `shared/errors.ts` — error taxonomy
- `shared/config.ts` — config validation
- `shared/decimal.ts` — decimal helpers

### Unstable (frequently changed, feature-driven):
- `mockApi.ts` — mock API (1100 lines, frequently diverges from backend)
- `SettingsSections.tsx` — 10 settings sections (38KB)
- `procurement.service.ts` — complex PO lifecycle state machine
- `report-export.ts` — report export logic

---

## LAYER VIOLATIONS

### 1. Settings Read Inside Transaction Boundary
As noted above (Finding #3), `SettingsService.getValue()` is called inside `$transaction` callbacks, reading outside the transaction scope.

### 2. Frontend Mock Contains Business Logic
The mock API contains validation, state transitions, and balance computation. While this is by design for the frontend-only mode, it creates a parallel business layer that isn't tested by backend tests.

### 3. `SettingsSections.tsx` Contains Both UI and Orchestration
The file (38KB) contains 10 settings section components in a single file, each mixing UI rendering with API calls and state manipulation.

---

## GOD MODULES / GOD FUNCTIONS

### `mockApi.ts` (~1100 lines)
- Contains all CRUD for all entities
- Contains all business logic (PO lifecycle, GR posting, inventory operations)
- Contains all validation
- **Risk**: High cognitive load; changes in one area risk breaking others

### `SettingsSections.tsx` (38KB, 10 sections)
- 10 settings section components in single file
- Each section has its own API calls and state
- **Risk**: Hard to navigate; large file

### `inventory.service.ts` (462 lines)
- Large but cohesive: single responsibility (InventoryService)
- Contains helper functions not exported (`recomputeBalance`, `checkMaterialActive`, `checkLocationActive`, `getCurrentBalance`)
- **Risk**: Moderate; cohesive but could benefit from extraction to a `balances.ts` module

---

## TIGHT COUPLING

### `report-export.ts` ↔ `reporting.service.ts`
The report export module depends on the exact shape of report query results. If report result structures change, both must be updated.

### `authService.ts` ↔ `mockApi.ts` (via `api` client)
In frontend-only mode, `authService.login()` calls through the `api` proxy which delegates to `mockApi.ts`. The mock's `/auth/login` handler duplicates login logic.

---

## HIDDEN STATE & MUTABLE SHARED STATE

### Mock API
- Module-level `state` object mutated by all route handlers
- `MOCK_AUDIT` array, `MOCK_SETTINGS` object, `mockUsers` — all module-level mutable state
- Reset only via `resetMockState()` (not called between tests automatically)

### Backend Authorization Cache
- `permissionCache` in `authorization.ts` uses `WeakMap<FastifyRequest, Set<string>>`
- Properly scoped to request lifetime via WeakMap (GC'd when request object is GC'd)
- **Assessment**: Correct pattern

---

## FAILURE MODES SUMMARY

| Module | Failure Mode | Recovery |
|--------|-------------|----------|
| InventoryService | InsufficientBalance | User corrects quantity |
| ProcurementService | Conflict (concurrent edit) | User refreshes; optimistic lock retry |
| GoodsReceiptService | Already posted | UI prevents post button when status=POSTED |
| AuthService | Bad credentials | User retries |
| Config | Missing env var | Fail-fast at startup |
| Mock API | State drift | Not a production concern |

---

## RECOMMENDED ARCHITECTURAL IMPROVEMENTS

### Priority 1 (CRITICAL)
1. Eliminate `recomputeBalance` duplication — extract to `shared/inventory/` or have `procurement` delegate transaction creation to `InventoryService`
2. Add `transactionClient` parameter to `SettingsService.getValue()` to support passing within transactions

### Priority 2 (HIGH)
3. Split `mockApi.ts` into per-domain mock files (`mockMaterials.ts`, `mockPurchaseOrders.ts`, etc.)
4. Add `isApiError` type guard in frontend `api/client.ts`

### Priority 3 (MEDIUM)
5. Split `SettingsSections.tsx` into per-section files
6. Consider extracting balance recompution to shared `shared/inventory/balances.ts`

### Priority 4 (LOW)
7. Create `ADR-005`: Document the mock API duplication as accepted technical debt
8. Standardize on `ZERO` constant usage in all services

---

## COMPLIANCE WITH ADRs

| ADR | Status | Notes |
|-----|--------|-------|
| ADR-001 (Bounded Domain) | ✅ | Modular monolith with clear contexts |
| ADR-002 (Ledger) | ✅ | `InventoryBalance` never written directly; recomputed from transactions |
| ADR-003 (Normalized Locations) | ✅ | `Location` table with type enum, code, extended fields |
| ADR-004 (Single Material Table) | ✅ | One `Material` model with `category` enum |