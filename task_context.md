# Task Context — Codebase Exploration Summary

## Objective
Explore and document the Afrinov platform codebase structure, conventions, entity relationships, service-layer logic, frontend architecture, and testing setup to support future implementation tasks.

## Important Details
- **Workspace root:** `C:\Users\Ntokozo Maselala`
- **Working dir:** `C:\Users\Ntokozo Maselala\OneDrive - Afrinov\Desktop\files (2)`
- **Backend:** `backend/` — Express + TypeScript + PostgreSQL + Zod + tshy + vitest
- **Frontend:** `frontend/` — React 18 + TypeScript + Vite + Tailwind + React Router v6
- **Docs:** docs are at `files (2)\afrinov-docs\docs\` (NOT inside `afrinov-platform`)
- **ADR count found:** ADR-001 through ADR-004 exist in `afrinov-docs/docs/decision-log.md`
- **Backend has 6 initial roles:** ADMIN, STORE_CONTROLLER, PROCUREMENT, APPROVER, TECHNICIAN, VIEWER
- **PO state machine:** DRAFT → SUBMITTED → APPROVED → SENT → PARTIALLY_RECEIVED → FULLY_RECEIVED → CLOSED (with cancellation and rejection transitions)
- **GR state machine:** DRAFT → SUBMITTED → POSTED
- **Transaction:** immutable POSTED state
- **Testing:** vitest with `@vitest/coverage-v8`; coverage threshold 80%; uses `in-memory-pg` for DB tests
- **Backend API docs:** OpenAPI schema auto-generated from Zod schemas via `tshy`

## Completed
### Documentation files read:
- `afrinov-docs/docs/decision-log.md` (ADR-001 to ADR-004)
- `afrinov-docs/docs/architecture/state-machines.md` (PO, GR, Transaction states)
- `afrinov-docs/docs/architecture/domain-model.md` (entity relationships)
- `afrinov-docs/docs/architecture/authorization.md` (6 roles, RBAC model)
- `afrinov-docs/docs/architecture/error-model.md` (standard error envelope)
- `afrinov-docs/docs/architecture/threat-model.md`
- `afrinov-docs/docs/architecture/authentication-model.md`
- `afrinov-docs/docs/architecture/secrets-management.md`

### Backend files read (full or partial):
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/server.ts` (truncated — needs full re-read)
- `src/db.ts`, `src/events.ts`, `src/config.ts`, `src/errors.ts`, `src/decimal.ts`, `src/permissions.ts`, `src/authorization.ts`
- `src/seed.ts` (truncated — 19717 chars)
- `src/services/`:
  - `inventory.service.ts` (truncated at line ~542)
  - `procurement.service.ts` (truncated at 22393 chars)
  - `report.service.ts` (truncated at 6545 chars)
  - `settings.service.ts` (truncated at 11984 chars)
  - `reporting.service.ts` (complete)
  - `goods-receipt.service.ts` (complete)
  - `material.service.ts` (truncated at 1974 chars)
  - `rack.service.ts` (truncated at 5395 chars)
  - `location.service.ts` (truncated at 8248 chars)
  - `stock-item.service.ts` (complete)
  - `project.service.ts` (truncated at 6670 chars)
  - `identity.service.ts` (complete)
- `src/routes/`:
  - `material.routes.ts` (truncated at 5523 chars)
  - `stock-item.routes.ts` (truncated at 723 chars)
  - `rack.routes.ts` (truncated at 1573 chars)
  - `location.routes.ts` (truncated at 4503 chars)
  - `project.routes.ts` (truncated at 2179 chars)
  - `user.routes.ts` (truncated at 983 chars)
  - `audit.routes.ts` (complete)
  - `inventory.routes.ts` (truncated at 2624 chars)
  - `procurement.routes.ts` (truncated at 7316 chars)
  - `reporting.routes.ts` (truncated at 3459 chars)
  - `settings.routes.ts` (truncated at 1983 chars)
  - `auth.routes.ts` (truncated at 4311 chars)
- `src/lib/`:
  - `balances.ts` (complete)
  - `report-query.schema.ts` (truncated at 5314 chars)
  - `report-export.ts` (truncated at 20952 chars)

### Frontend files read (full or partial):
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/main.tsx`, `src/app.tsx` (truncated at 7807 chars)
- `src/api/client.ts` (truncated at 1939 chars), `src/api/authService.ts` (truncated at 7680 chars), `src/api/landingPath.ts` (complete)
- `src/components/auth.tsx` (truncated at 4311 chars)
- `src/hooks/useApi.ts` (complete), `src/hooks/usePermissions.ts` (complete)
- `src/mock/`:
  - `mockApi.ts` (truncated at 54104 chars)
  - `types.ts` (truncated at 4503 chars)
  - `seed.ts` (truncated)
  - `mockReport.ts` (truncated at 19401 chars)
- `src/pages/`:
  - `Login.tsx`, `Signup.tsx` (complete)
  - `Stock.tsx` (truncated at 8396 chars)
  - `Materials.tsx` (truncated at 8205 chars)
  - `Movements.tsx` (truncated at 6433 chars)
  - `Dashboard.tsx` (truncated at 11038 chars)
  - `PurchaseOrders.tsx` (truncated)
  - `PurchaseOrderDetail.tsx` (truncated at 26619 chars)
  - `GoodsReceipts.tsx` (truncated)
  - `InventoryReport.tsx` (truncated at 30950 chars)
  - `LowStock.tsx` (truncated at 6563 chars)

## Active
- **Status:** Exploration phase complete (partial — many files truncated by 20K char output limit)
- **System-Inspection.md created:** comprehensive system inspection document saved at workspace root
- **Key observation:** docs live in `afrinov-docs/docs/` (separate from `afrinov-platform/`)
- **Backend architecture:** Services use a `ServiceResult` wrapper pattern with success/error; DB via Drizzle ORM with `db.ts` query helper; event emission via `emitEvent()` in `events.ts`
- **frontend architecture:** custom `api` client with real/mock modes, permission-gated by `usePermissions` and `auth.tsx` wrapper; mock API layer for offline dev

## Relevant Files
- `backend/package.json`
- `backend/src/server.ts`
- `backend/src/services/procurement.service.ts`
- `backend/src/services/inventory.service.ts`
- `backend/src/services/report.service.ts`
- `backend/src/services/settings.service.ts`
- `frontend/package.json`
- `frontend/src/app.tsx`
- `frontend/src/mock/mockApi.ts`
- `frontend/src/api/client.ts`
- `frontend/src/auth.tsx`
- `frontend/src/auth.test.ts`
- `frontend/src/api/authService.ts`
- `frontend/src/api/landingPath.ts`
- `frontend/src/hooks/usePermissions.ts`
- `frontend/src/hooks/useApi.ts`
- `frontend/src/hooks/useSettings.tsx`
- `frontend/src/pages/Settings.tsx`
- `frontend/src/pages/SettingsSections.tsx`
- `frontend/src/pages/Login.tsx`
- `frontend/src/pages/Signup.tsx`
- `frontend/src/config/demoAuth.ts`
- `System-Inspection.md`

## Next Move
No explicit task given yet. Pending user instruction on what to implement. Recommended follow-up reads if a task is assigned:
1. Re-read truncated files fully: `server.ts`, `inventory.service.ts`, `procurement.service.ts`, `report.service.ts`, `settings.service.ts`, `mockApi.ts`, `InventoryReport.tsx`, `PurchaseOrderDetail.tsx`, `app.tsx`, `report-export.ts`
2. Read test files (glob found) to understand testing patterns before writing new tests
3. Read migration files in `backend/drizzle/` to understand schema
