# Testing Strategy — Afrinov Platform

Last Updated: 2026-09-17

---

## Overview

The platform uses **Vitest** as the test framework for both backend and frontend. Tests run without a real database (backend services are unit-tested with in-memory Prisma fakes) except for API smoke tests that require a PostgreSQL instance.

---

## Test Pyramid

```
                         E2E (Manual / Future)
                        /                  \
              API Smoke (server.test.ts)
                    /                        \
         Service Unit Tests         Component/Hook Tests
        (inventory, procurement,  (auth, useApi, dashboardMetrics,
         settings, identity,       mockApi, exportReport)
         reporting, etc.)
```

---

## Backend Testing

### Unit Tests (Current State)

All backend service tests use **in-memory Prisma fakes** — no database required. This enables fast, deterministic testing of business logic.

| Test File | Module | Coverage |
|-----------|--------|----------|
| `inventory.service.test.ts` | Inventory | Full ADR-002 invariant testing: issue, transfer, adjust, balance recompute, settings integration |
| `procurement.service.test.ts` | Procurement | Full PO lifecycle: create, submit, approve, ship, deliver, cancel; settings integration |
| `identity.service.test.ts` | Identity | User create, update, role assignment, password hashing, audit |
| `settings.service.test.ts` | Settings | Validation, type coercion, bulk updates, defaults, cache behavior |
| `reporting.service.test.ts` | Reporting | Report query parsing, stock classification, KPIs, Excel/PDF export |
| `location.service.test.ts` | Inventory | CRUD, status transitions, dependency counts, deletion blocking |
| `rack.service.test.ts` | Inventory | CRUD, status transitions, validation |
| `stock-item.service.test.ts` | Inventory | Combined material + initial receipt |
| `balances.test.ts` | Inventory | Balance aggregation |
| `decimal.test.ts` | Shared | Decimal arithmetic helpers |
| `permissions.test.ts` | Shared | Role-permission matrix integrity |
| `seed.test.ts` | DB | Seed data consistency (SKUs, locations, project links, transfer pairs) |
| `migrations.test.ts` | DB | Schema correctness (enums, FKs, indexes, constraints) |
| `server.test.ts` | Server | Health, auth (401/400/403), materials endpoint |

### Test Patterns

1. **In-memory Prisma Fake**: Each service test defines a `fakeTx` object implementing only the Prisma methods the service uses. The fake is injected via `vi.mock('../../shared/db.js')`.

2. **Settings Mocking**: A `mockSettings` Map is used to set toggle values per-test, verified to flow through to business logic.

3. **ADR-002 Invariants**: The inventory tests explicitly verify that balances are never written directly — only recomputed from transactions.

### API Smoke Tests

`server.test.ts` uses `buildServer({ skipConfigValidation: true })` with an in-memory approach. Tests cover:
- `GET /health` returns 200
- `GET /api/v1/materials` without auth returns 401
- `POST /auth/login` with missing payload returns 400
- `GET /api/v1/users` without auth returns 401
- `GET /api/v1/users` without permission returns 403

**Limitation**: These tests don't exercise the full request→service→DB cycle because they don't have a database. They verify route wiring and middleware (auth, error handling) but not data persistence.

### Missing Tests

1. **Full integration tests**: No tests run against a real PostgreSQL database. The service tests use fakes, which means Prisma query correctness is not verified.
2. **Contract tests**: No verification that backend API responses match frontend expectations.
3. **State transition matrix**: PO state machine transitions are tested individually but not exhaustively (e.g., transition from every state to every other state).
4. **Concurrent modification**: No tests for race conditions in concurrent PO transitions.
5. **Negative balances**: Only tested with `enableNegativeStockPrevention` toggle; edge cases at exactly zero not covered.

---

## Frontend Testing

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `auth.test.ts` | Session persistence (sessionStorage read/write/clear, malformed JSON, missing fields) |
| `useAppearance.test.ts` | Theme/density preference hooks |
| `exportReport.test.ts` | Report export API calls and blob handling |
| `useDashboardData.test.ts` | Dashboard data fetching and caching logic |
| `dashboardMetrics.test.ts` | KPI computation from transaction data |
| `mockApi.test.ts` | Mock API behavior coverage |
| `demoAuth.test.ts` | Demo credentials validation |

### Test Patterns

1. **Session Storage Stubbing**: `sessionStorage` is stubbed with a Map to test auth persistence in Node environment.

2. **Mock API Testing**: `mockApi.test.ts` verifies the in-memory API returns correct shapes and enforces validation.

### Missing Tests

1. **Component rendering tests**: No React component tests (no Testing Library setup)
2. **Hook integration tests**: `useApi`, `useSettings`, `usePermissions` untested
3. **Page-level tests**: No tests for actual page rendering or user flows
4. **E2E tests**: No Playwright/Cypress tests for critical user workflows

---

## Testing Recommendations

### Phase 6 Priorities

1. **Add backend integration tests** with a real PostgreSQL container
   - Test full PO lifecycle through API endpoints
   - Test inventory operations end-to-end
   - Use testcontainers or docker-compose for DB

2. **Add contract-style tests** for critical API responses
   - Verify response shapes match frontend expectations
   - Especially for reporting endpoints (complex nested data)

3. **Add frontend hook tests** for `useApi`, `useSettings`
   - Test loading, error, and success states
   - Test caching behavior

4. **Add E2E tests** for critical user workflows
   - Login → dashboard view
   - Create PO → submit → approve → ship → deliver
   - Material → issue → verify balance
   - Use Playwright with the real backend + a test database

---

## Test Execution

### Backend
```bash
cd apps/backend
npm test              # Run all tests (vitest run)
npm run test:watch    # Watch mode (interactive dev)
npm run typecheck     # TypeScript compilation check
npm run lint          # ESLint
npm run build         # TypeScript build
```

### Frontend
```bash
cd apps/frontend
npm test              # Run all tests
npm run typecheck     # TypeScript project references check
npm run lint          # ESLint
npm run build         # tsc + vite build
```

### Quality Gates (must pass before merge)
- ✅ All tests pass (126 backend + 90 frontend)
- ✅ TypeScript typecheck passes (both apps)
- ✅ ESLint passes (0 errors)
- ✅ Build succeeds (both apps)

---

## Coverage Goals (Future)

| Module | Current Focus | Target Coverage |
|--------|--------------|-----------------|
| InventoryService | 100% (invariant tests) | 100% |
| PurchaseOrderService | Core lifecycle tested | Add: cancellation from all states, partial receive scenarios |
| IdentityService | User CRUD tested | Add: password reset, role change validation |
| SettingsService | Validation + CRUD tested | Add: cache invalidation on write |
| ReportingService | Report generation tested | Add: edge cases in date window logic |
| Frontend hooks | 0% tested | 80% for useApi, useSettings, usePermissions |
| Frontend pages | 0% tested | 50% for critical pages (Dashboard, Stock, PurchaseOrder) |