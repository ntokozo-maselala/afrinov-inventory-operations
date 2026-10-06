# Engineering Decision Log

Last Updated: 2026-09-17

---

## ADR-005 — Extract Inventory Balance Recomputation to Shared Module

**Date:** 2026-09-17 · **Status:** Accepted

**Context**: `recomputeBalance` was duplicated between `modules/inventory/inventory.service.ts` and `modules/procurement/procurement.service.ts`. Both functions had identical logic but different implementations (one used `ZERO` constant, the other `new Prisma.Decimal(0)`).

**Problem**: Duplicate business logic for a critical invariant (ADR-002: balances derived from transactions). If the balance computation logic changes, one copy could be missed.

**Decision**: Extracted `recomputeBalance` and `getCurrentBalance` to `shared/inventory/balances.ts`. Both `inventory.service.ts` and `procurement.service.ts` now import from this shared location.

**Alternatives considered**:
1. Have `procurement.service.ts` call `InventoryService` methods for transaction creation — rejected because `deliver()` already operates within a `$transaction` callback and creating a dependency on the inventory service would require passing the transaction through, adding complexity.
2. Use the existing `modules/inventory/balances.ts` `recomputeBalancesFor` function — rejected because that function uses the global prisma client, not a transaction client.

**Consequences**: Single source of truth for balance recomputation logic. The `modules/inventory/balances.ts` file (non-transactional variant) is preserved for seed data initialization.

**Trade-offs**: Adds `shared/inventory/` as a new import path, but the single responsibility of this module makes the dependency clear and acceptable.

---

## ADR-006 — Add Optional Transaction Client to SettingsService

**Date:** 2026-09-17 · **Status:** Accepted

**Context**: `SettingsService.getValue<T>()` was called inside `$transaction` callbacks (specifically in `InventoryService.issue`), reading settings via the global `prisma` client rather than the transaction-scoped client. This could lead to inconsistent reads if a setting changed between the read and the writes in the same transaction.

**Problem**: The cached `getValue` function had no way to accept a transaction client, so calls inside transactions read outside the transaction boundary.

**Decision**: Added optional `tx?: Prisma.TransactionClient` parameter to both `getValue<T>()` and `getValues()`. When `tx` is provided, the function reads via the transaction client and skips the cache (since transaction-scoped reads should see the same data as the transaction). All existing callers remain backward-compatible (parameter is optional).

**Alternatives considered**:
1. Always pass `tx` to settings calls inside transactions — considered but the optional parameter approach is cleaner and doesn't require changing all call sites outside transactions.
2. Remove the cache entirely — rejected because settings rarely change and the 60-second cache is valuable for performance.

**Consequences**: Transactional settings reads are now consistent. Callers inside transactions should pass `tx`; callers outside transactions don't need to change.

**Trade-offs**: Slightly more complex `cachedGetValue` function with branching, but the consistency guarantee is worth it.

---

## ADR-007 — Add isApiError Type Guard to Frontend API Client

**Date:** 2026-09-17 · **Status:** Accepted

**Context**: Frontend error handling used unsafe type assertions (`err as ApiError`) when catching errors from API calls. This meant malformed error objects could be incorrectly treated as `ApiError`, leading to undefined behavior when accessing `.code` or `.message`.

**Problem**: The `catch (err)` blocks in `authService.ts` and `useApi.ts` cast errors without runtime validation. If the error wasn't actually an `ApiError` (e.g., a network error object with different shape), the code would silently fail to match error codes.

**Decision**: Added `isApiError(err: unknown): err is ApiError` type guard to `api/client.ts`. Updated `authService.ts` and `useApi.ts` to use the guard before accessing `ApiError` properties.

**Alternatives considered**:
1. Validate in the `realRequest` function and always throw `ApiError` — partially done already (network errors are converted), but mock API can throw differently shaped errors.
2. Wrap all API calls in a try/catch that normalizes errors — would require more pervasive changes.

**Consequences**: Error handling in the frontend is now safer; non-ApiError errors are handled with a generic fallback rather than being incorrectly typed.

**Trade-offs**: Minimal runtime overhead for the type guard check.