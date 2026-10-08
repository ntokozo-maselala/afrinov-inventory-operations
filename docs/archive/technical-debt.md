# Technical Debt Register

Last Updated: 2026-09-17

---

## Active Debt Items

### TD-001: Mock API Duplicates Backend Business Logic

**ID**: TD-001
**Description**: The frontend mock API (`mockApi.ts`) reimplements all backend business logic (PO lifecycle, GR posting, inventory operations, validation, settings) in ~1100 lines of in-memory store.
**Category**: Architecture
**Impact**: High — mock can diverge from backend; changes to business rules must be applied in two places
**Risk**: High — behavioral divergence between frontend-only mode and real backend
**Why it remains**: Fundamental trade-off of the dual-mode frontend architecture. Splitting into per-domain files reduces but doesn't eliminate duplication.
**Recommended future action**: Write contract tests that validate mock responses against backend response schemas; consider extracting shared rule definitions where feasible.
**Priority**: Medium
**Type**: Accepted trade-off

### TD-002: SettingsSections.tsx Is a 38KB Single File

**ID**: TD-002
**Description**: `SettingsSections.tsx` contains 10 settings section components in a single file.
**Category**: Frontend Structure
**Impact**: Medium — harder to navigate and maintain
**Risk**: Low — purely organizational
**Why it remains**: All sections share the same data fetching pattern; splitting requires careful preservation of the lazy-load routes in `App.tsx`.
**Recommended future action**: Split into `pages/settings/<category>.tsx` files; update `App.tsx` lazy imports.
**Priority**: Medium
**Type**: Accidental debt

### TD-003: No Rate Limiting on Auth Endpoints

**ID**: TD-003
**Description**: The backend does not implement rate limiting on authentication endpoints (`POST /auth/login`).
**Category**: Security
**Impact**: Medium — brute-force attacks not mitigated at the application layer
**Risk**: Medium — depends on hosting environment (may be handled by reverse proxy)
**Why it remains**: The prototype assumes a reverse proxy/nginx layer handles rate limiting; not implemented in Fastify.
**Recommended future action**: Add `@fastify/rate-limit` for auth endpoints; configure IP-based limits.
**Priority**: Medium
**Type**: Accepted trade-off (deferred to infrastructure layer)

### TD-004: Frontend-Only Mode Signup Is In-Memory

**ID**: TD-004
**Description**: In `VITE_FRONTEND_ONLY` mode, signups are stored in a module-level Map and lost on page reload.
**Category**: Frontend
**Impact**: Low — only affects development/demo mode
**Risk**: None in production
**Why it remains**: Intentional — frontend-only mode is for UI development only.
**Recommended future action**: None — documented behavior.
**Priority**: Low
**Type**: Intentional debt

### TD-005: ExcelJS Library Uses `eval()` in Browser Build

**ID**: TD-005
**Description**: The `exceljs` npm package uses `eval()` in its minified browser build. Vite warns about this during build.
**Category**: Security / Dependencies
**Impact**: Low — browser `eval()` is not exploitable in the same way as `eval()` receiving untrusted input, but it's a CSP concern.
**Risk**: Low — only affects frontend build output; no untrusted input is eval'd
**Why it remains**: Required for client-side Excel export. Alternative libraries exist but require migration effort.
**Recommended future action**: Consider using `xlsx` or `SheetJS` as an alternative; or implement Excel export on the backend and return a blob URL.
**Priority**: Low
**Type**: Known limitation

### TD-006: Vite Deprecation Warnings (esbuild options)

**ID**: TD-006
**Description**: Vite warns about deprecated `esbuild` options specified by the `vite:react-babel` plugin; both `esbuild` and `oxc` options are set simultaneously.
**Category**: Tooling
**Impact**: Low — build succeeds; deprecation may become breaking in future Vite versions
**Risk**: Medium — may break on Vite upgrade
**Why it remains**: The `vite` dependency is pinned to 8.2.2; upgrading requires testing the entire build pipeline.
**Recommended future action**: Upgrade `@vitejs/plugin-react` to a version that uses `oxc` options; remove deprecated config.
**Priority**: Low
**Type**: Accidental debt

---

## Resolved Debt Items

### RD-001: recomputeBalance Duplication (RESOLVED)
- **Status**: Resolved (Phase 2.1)
- **Action**: Extracted shared `recomputeBalance` and `getCurrentBalance` to `shared/inventory/balances.ts`; both `inventory.service.ts` and `procurement.service.ts` now import from the shared location.

### RD-002: SettingsService Transactional Inconsistency (RESOLVED)
- **Status**: Resolved (Phase 2.2)
- **Action**: Added optional `tx?: Prisma.TransactionClient` parameter to `SettingsService.getValue()` and `getValues()`; callers inside transactions pass the transaction client.

### RD-003: Unsafe Error Casting in Frontend (RESOLVED)
- **Status**: Resolved (Phase 4.1)
- **Action**: Added `isApiError()` type guard; replaced unsafe `as ApiError` casts in `authService.ts` and `useApi.ts`.