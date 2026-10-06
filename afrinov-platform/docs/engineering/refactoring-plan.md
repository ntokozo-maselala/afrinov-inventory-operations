# Refactoring Plan — Afrinov Platform

Generated: 2026-09-17

---

## Phase 1 — Stabilisation

### Objective
Establish baseline: all quality gates pass, all tests green, build succeeds.

### Tasks
1. Run full test suite (backend + frontend) to establish baseline
2. Run typecheck on both apps
3. Run lint on both apps
4. Document any pre-existing failures as known issues

### Risk
None — diagnostic only

### Completion Criteria
- `npm test` passes for both apps
- `npm run typecheck` passes for both apps
- `npm run build` passes for both apps

---

## Phase 2 — Correctness

### Objective
Fix correctness defects identified in architecture audit and code inspection.

### 2.1: Eliminate `recomputeBalance` Duplication (CRITICAL)

**Problem**: `procurement.service.ts` has a local `recomputeBalance` that duplicates `inventory.service.ts`.

**Evidence**: `procurement.service.ts:442-453` — identical logic to `inventory.service.ts:48-60`

**Root Cause**: Procurement's `deliver()` creates receipt transactions directly instead of delegating to InventoryService.

**Proposed Change**:
1. Extract `recomputeBalance` to `shared/inventory/balances.ts`
2. Both `inventory.service.ts` and `procurement.service.ts` import from shared
3. Add unit test for shared `recomputeBalance`

**Affected Files**:
- `modules/inventory/inventory.service.ts`
- `modules/procurement/procurement.service.ts`
- `shared/inventory/balances.ts` (new)

**Risk**: Medium — shared function used in transactions
**Tests Required**: Update existing tests; add shared function test
**Validation**: All inventory & procurement tests pass

### 2.2: SettingsService Transactional Consistency (HIGH)

**Problem**: `SettingsService.getValue()` called inside `$transaction` callbacks uses global `prisma`, not transaction client.

**Root Cause**: SettingsService doesn't accept a transaction client parameter.

**Proposed Change**:
1. Add optional `tx` parameter to `SettingsService.getValue<T>()`
2. Update all callers inside `$transaction` to pass `tx`
3. Update callers outside transactions to pass nothing (use global)

**Affected Files**:
- `modules/settings/settings.service.ts`
- `modules/inventory/inventory.service.ts`
- `modules/procurement/procurement.service.ts`

**Risk**: Medium — touch all settings reads in transactions
**Tests Required**: Existing service tests continue to pass; verify settings integration tests
**Validation**: All tests pass; typecheck passes

---

## Phase 3 — Architecture

### Objective
Resolve structural issues, extract shared logic, enforce boundaries.

### 3.1: Split Mock API by Domain (HIGH)

**Problem**: `mockApi.ts` is 1100+ lines containing all CRUD + business logic.

**Proposed Change**:
1. Create `mock/materials.ts`, `mock/locations.ts`, `mock/suppliers.ts`, `mock/purchaseOrders.ts`, `mock/goodsReceipts.ts`, `mock/inventory.ts`, `mock/racks.ts`, `mock/projects.ts`, `mock/users.ts`, `mock/settings.ts`
2. `mockApi.ts` becomes a router that delegates to domain-specific handlers
3. Each domain file exports `handle<Domain>()` and type definitions

**Affected Files**:
- `mock/mockApi.ts` (split)
- New files in `mock/`

**Risk**: Medium — behavior must be preserved exactly
**Tests Required**: `mockApi.test.ts` must continue to pass
**Validation**: Frontend mockApi tests pass; frontend-only mode still works

### 3.2: Add ADR-005 — Mock API as Contract Mirror (DOCUMENTATION)

**Problem**: Mock API duplication is by design but undocumented as accepted debt.

**Proposed Change**: Write ADR-005 documenting the mock API pattern and how divergence is prevented.

**Affected Files**: `docs/engineering/adr/ADR-005-mock-api-as-contract-mirror.md` (new)

---

## Phase 4 — Type Safety

### Objective
Fix TypeScript issues, eliminate unsafe assertions, improve type coverage.

### 4.1: Add `isApiError` Type Guard (MEDIUM)

**Problem**: Error handling in `authService.ts` casts errors without validation.

**Proposed Change**:
1. Add `isApiError(err: unknown): err is ApiError` to `api/client.ts`
2. Use in all error-handling sites

**Affected Files**:
- `apps/frontend/src/api/client.ts`
- `apps/frontend/src/api/authService.ts`

### 4.2: Fix `noUncheckedIndexedAccess` Compliance

**Problem**: Code accesses array elements without null checks (tsconfig has `noUncheckedIndexedAccess: true`).

**Proposed Change**: Audit all `array[0]` or `array[i]` accesses; add proper guards.

**Affected Files**: To be determined by lint output

---

## Phase 5 — Error Handling

### Objective
Standardize error handling across frontend and backend.

### 5.1: Frontend Error Normalization

**Problem**: Error handling inconsistent across components.

**Proposed Change**:
1. Create `api/errors.ts` with `isApiError` guard and `getErrorMessage` helper
2. Audit all `try/catch` blocks in hooks and pages
3. Ensure errors are surfaced to user (never swallowed)

---

## Phase 6 — Testing

### Objective
Fill gaps in test coverage.

### 6.1: Add Backend API Integration Tests (HIGH)

**Problem**: Only service-level unit tests exist; no API endpoint tests against real Fastify instance.

**Proposed Change**:
1. Create `apps/backend/src/integration/` directory
2. Add tests using `buildServer()` with mocked DB that exercise full request→response cycle
3. Cover at minimum: auth flow, PO lifecycle, inventory operations

### 6.2: Add Frontend Hook Tests (MEDIUM)

**Problem**: Most frontend tests are for auth and mock API only; hooks untested.

**Proposed Change**:
1. Add tests for `useApi`, `usePermissions`, `useSettings`
2. Use `@testing-library/react-hooks` or React test renderer

### 6.3: Contract Tests Between Frontend and Backend (MEDIUM)

**Problem**: No verification that frontend mock matches backend behavior.

**Proposed Change**:
1. Extract shared type definitions for API responses
2. Add test that mock API responses conform to backend response shapes

---

## Phase 7 — Security

### 7.1: Rate Limiting (MEDIUM)

**Problem**: No rate limiting on auth endpoints.

**Proposed Change**: Add `@fastify/rate-limit` for login and signup endpoints.

### 7.2: Password Strength (LOW)

**Problem**: Only minimum length enforced.

**Proposed Change**: Add basic password strength validation (mixed case, number) — optional, may conflict with demo flow.

---

## Phase 8 — Frontend Structural

### 8.1: Split SettingsSections.tsx (MEDIUM)

**Problem**: Single 38KB file with 10 settings sections.

**Proposed Change**: Split each settings section into its own file under `pages/settings/` directory.

---

## Phase 9 — Documentation

### 9.1: Update READMEs
Ensure all documentation reflects actual behavior.

### 9.2: Create Engineering Documentation
- `docs/engineering/codebase-map.md` ✅ (created)
- `docs/engineering/architecture-audit.md` ✅ (created)
- `docs/engineering/requirements-model.md` ✅ (created)
- `docs/engineering/refactoring-plan.md` ✅ (this file)
- `docs/engineering/decision-log.md`
- `docs/engineering/testing-strategy.md`
- `docs/engineering/technical-debt.md`
- `docs/engineering/refactoring-final-report.md`

---

## Phase 10 — Final Verification

### Objective
All quality gates pass, no regressions.

### Tasks
1. Full test suite (backend + frontend)
2. Typecheck (both apps)
3. Build (both apps)
4. Lint (both apps)
5. Manual smoke test of frontend-only mode

---

## Execution Order

```
Phase 1  (Stabilisation)  →  MUST PASS before any changes
Phase 2  (Correctness)     →  Fix critical bugs first
Phase 3  (Architecture)    →  Structural improvements
Phase 4  (Type Safety)     →  TypeScript hardening
Phase 5  (Error Handling)  →  Consistent error UX
Phase 6  (Testing)          →  Coverage gaps
Phase 7  (Security)        →  Hardening
Phase 8  (Frontend Struct) →  Component organization
Phase 9  (Documentation)   →  Capture decisions
Phase 10 (Verification)    →  All gates green
```

## Rollback Plan
Each phase produces independently verifiable commits. If a phase breaks tests:
1. `git revert` the last commit(s)
2. Investigate root cause
3. Re-attempt with corrected approach

Do NOT proceed to the next phase until the current phase passes all quality gates.

---

## Priority Matrix

| ID | Description | Priority | Category |
|----|-------------|----------|----------|
| 2.1 | recomputeBalance duplication | CRITICAL | Correctness |
| 2.2 | SettingsService tx consistency | HIGH | Correctness |
| 3.1 | Split mock API | HIGH | Architecture |
| 6.1 | Backend API integration tests | HIGH | Testing |
| 4.1 | isApiError type guard | MEDIUM | Type Safety |
| 8.1 | Split SettingsSections | MEDIUM | Frontend Struct |
| 7.1 | Rate limiting | MEDIUM | Security |
| 5.1 | Frontend error normalization | LOW | Error Handling |