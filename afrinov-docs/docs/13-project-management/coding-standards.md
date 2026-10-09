# Coding Standards

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Standard | Enforced by | Current state |
|---|---|---|
| Module structure follows `06-system-architecture/module-architecture.md` — no cross-module direct database access | Code review only | Not met: several modules read or write other modules' tables (TD-004) |
| Domain layer has no framework dependencies (testable in isolation) | — | No domain layer exists; rules are in services that use Prisma directly. Services are unit-tested with Prisma replaced by fakes |
| No direct writes to `inventory_balances`/derived data | Code review | Balances are written only by recomputing from the ledger, but through three copies of the recompute function (TD-009); no database grant enforces it (TD-006) |
| Every use case that mutates data writes an audit entry in the same transaction | Code review | Not met for several actions (TD-008) |
| TypeScript strict mode | `tsconfig.json` (`strict`, `noImplicitAny`, `noUncheckedIndexedAccess`) | Met; `npm run typecheck` passes |
| Lint | ESLint (`@typescript-eslint/recommended`; React rules in the frontend) | Run in CI |

## Evidence
- `afrinov-platform/apps/backend/tsconfig.json`, `afrinov-platform/apps/backend/.eslintrc.cjs`, `afrinov-platform/apps/frontend/.eslintrc.cjs`
- `afrinov-platform/apps/backend/src/shared/inventory/balances.ts:6-21`, `afrinov-platform/apps/backend/src/modules/inventory/balances.ts:15-26`, `afrinov-platform/apps/backend/src/modules/inventory/stock-item.service.ts:53-68`
- `06-system-architecture/module-architecture.md` (boundary table)
