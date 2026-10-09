# Architecture Principles

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Each principle is followed by its implementation status in the current code.

1. Business domain first — every component maps to a capability in
   `01-product/capability-map.md`. *Status: largely followed; settings and
   the workbook import are supporting modules outside the capability map.*
2. Modular architecture — bounded contexts are enforced by module structure
   and code review, even inside one deployable. *Status: not enforced —
   modules import each other and read each other's tables (TD-004).*
3. Database integrity is authoritative — constraints (foreign keys, check
   constraints) enforce invariants the application layer might miss.
   *Status: partial. Unique indexes back supplier and recipient names
   (case-insensitive) and one-reversal-per-transaction; but the
   `inventory_balances` foreign keys declared in the schema were never
   created by a migration (TD-005), there are no check constraints, and the
   no-negative-stock rule is enforced only in application code.*
4. Inventory changes occur only through InventoryTransaction inserts
   (ADR-002) — no direct `UPDATE` of a balance, anywhere in the codebase.
   *Status: every service that moves stock inserts ledger rows and then
   recomputes the affected `inventory_balances` row from the ledger sum in
   the same database transaction (an upsert). No code sets a balance to
   any value other than that sum.*
5. Historical transactions are immutable and auditable. *Status: there is
   no update or delete endpoint for transactions; mistakes are corrected by
   reversal (ADR-005). Immutability is not enforced by database grants or
   triggers (TD-006).*
6. Authorization is enforced server-side, never trusted from the client.
   *Status: followed — each mutating route calls `requirePermission`.*
7. The UI never owns business rules — reorder logic, balance derivation,
   and validation live in the application/domain layer. *Status: followed
   for stock rules; the UI additionally hides actions by role.*
8. APIs expose business capabilities (`POST /goods-receipts`,
   `POST /inventory-issues`), not raw table CRUD. *Status: followed for
   stock movements; master data uses resource CRUD.*
9. Prefer simplicity over premature distribution (see
   `architecture-overview.md`).
10. Design for extension (clean module seams), not speculative complexity
    (no tables/features for domains not yet in scope). *Status: mostly
    followed; unused tool permissions and unused `shipped_*` PO columns
    remain (TD-011).*

## Evidence
- `afrinov-platform/apps/backend/src/shared/inventory/balances.ts:6-21` — recompute and upsert of a balance row
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:180-287` — reversal
- `afrinov-platform/apps/backend/src/shared/authorization.ts:52-71` — `requirePermission`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000002_supplier_name_uniqueness/migration.sql:16`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000005_recipients/migration.sql:24`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000003_transaction_reversals/migration.sql:6-8`
- `afrinov-platform/apps/backend/prisma/schema.prisma:304-319,461-475`
