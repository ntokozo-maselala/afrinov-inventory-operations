# Unit Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Backend unit tests (`npm test` in `apps/backend`) exercise services, routes
and shared rules with the Prisma client replaced by in-memory fakes
(`vi.mock` of `shared/db.js`); a dummy `DATABASE_URL` lets the client
module load. There is no separate framework-free domain layer, so "domain
rules in isolation" means service methods against fakes. Covered rules
include: insufficient balance rejected with `INSUFFICIENT_BALANCE`
(e.g. issuing more than is on hand), reversal rules, returns, PO state
transitions, goods-receipt posting, stock status bands, settings
validation, permission grants, configuration and CORS rules, workbook
mapping and reconciliation.

Not unit-tested: `material.service.ts`, `stock-count.service.ts` (covered
by integration tests), `audit.routes.ts`, and supplier creation in
`procurement.service.ts` (TD-023).

Frontend unit and component tests (`npm test` in `apps/frontend`, jsdom)
cover the API client, auth, permissions hook, shared components, the mock
API, formatting, and the Issue, Receive, Stock count, Stock status, Stock
used, Month-end and Dashboard pages.

## Evidence
- `afrinov-platform/apps/backend/vitest.config.ts:4-7`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.test.ts`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.test.ts`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.test.ts`
- `afrinov-platform/apps/frontend/src/pages/*.test.tsx`
