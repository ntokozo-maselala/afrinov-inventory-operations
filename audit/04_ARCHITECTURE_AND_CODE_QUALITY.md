# 04 — Architecture and code quality

## Current design assessment

The application has a recognizable modular structure: Fastify route modules, Zod request schemas, domain services, Prisma persistence and a React client/API layer. This is a workable foundation, and the unit suites exercise many domain edge cases. The most important architectural weakness is that correctness rules that span requests are expressed as read-check-write sequences in services without a shared database serialization primitive. The design boundary should make the stock key and state transition the atomic unit.

The existing code should preserve its public API behavior, signed-ledger semantics, role permissions, audit events and Prisma transaction boundaries during remediation. No broad rewrite or source refactor is recommended by this audit.

## Ranked opportunities

### 1. Define an atomic stock mutation boundary

Affected: inventory.service.ts and shared/inventory/balances.ts.

The current helpers allow each operation to read a cached balance, enforce its own rule and recompute after writing. A focused stock-key operation should own acquisition of the material/location lock, the balance check and ledger write within one database transaction. Every issue, transfer leg, adjustment, count variance and relevant return path must use the same lock protocol. This removes duplicated concurrency assumptions and makes the invariant auditable.

Compatibility: preserve signed ledger entries, transaction IDs, response shapes, audit metadata and the no-negative-stock rule. Validate on isolated PostgreSQL with contention tests and rollback tests. Prefer a small focused helper or conditional database update over splitting the whole service.

### 2. Make document state transitions claim-before-effects

Goods receipt posting should atomically transition SUBMITTED to POSTING/POSTED with a conditional update or row lock before ledger effects. Any failure must roll back the claim and all ledger/PO updates. The API's existing sequential duplicate behavior should remain a conflict response.

### 3. Align Prisma schema and deployed database constraints

Add the missing material/location foreign keys on inventory_balances after checking existing databases for orphan rows. Use a migration with a validation/preflight step, then test clean and populated migration paths. Do not hand-edit production schema.

### 4. Make audit record writes atomic with administrative changes

UserService create writes the user and its audit entry in separate transactions. Update commits its user/role changes, then writes the audit entry. A failed audit insert can return an error after the user change has committed, leaving no corresponding audit record. Wrap each business change and audit entry in one transaction if audit durability is a product requirement; add injected audit-failure tests.

### 5. Clarify idempotency contracts for stock mutations

Inventory issue and stock receipt POSTs can create new ledger effects for repeated calls. There is no idempotency key or duplicate request contract in the inspected API. This is a design concern until product behavior is decided: determine how clients retry after timeouts, then add a caller key and unique constraint only if at-most-once semantics are required. Preserve legitimate repeated receipts.

### 6. Reconcile operational documentation

Deployment docs still name node:20-alpine while the Dockerfile uses node:24-alpine. Onboarding says integration test config loads .env while current configuration reads .env.test only and rejects non-local/non-_test targets. Reconcile docs and keep the safe test target instructions consistent with scripts.

## Other maintainability observations

- User update validation allows setting active state and roleNames without an apparent last-active-admin guard. An administrator can remove their own administrative access or deactivate the last active administrator. Add an explicit recovery/business rule and test it if this is not an accepted operational capability.
- InventoryService combines several ledger operations. Do not split it by aesthetics; first centralize the concrete stock serialization invariant and retain cohesive transaction boundaries.
- Domain events are dispatched synchronously in process. No durable queue/outbox consumer was found. This is adequate only for local side effects; if external consumers are introduced, a transactional outbox is needed to avoid lost notifications after commit.
- User and inventory audit entries should be reviewed for transaction coupling and failure semantics. This report confirms the user create/update case; it does not generalize that finding to every service.

## Phase 4 exit

The design recommendations are tied to observed integrity and operational problems, with behavior-preservation and verification constraints. No source changes were made. Phase 4 exit criteria are met.
