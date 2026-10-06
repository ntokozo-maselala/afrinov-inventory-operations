# Architecture Principles

1. Business domain first — every component maps to a capability in
   `01-product/capability-map.md`.
2. Modular architecture — bounded contexts are enforced by module structure
   and code review, even inside one deployable.
3. Database integrity is authoritative — constraints (foreign keys, check
   constraints) enforce invariants the application layer might miss.
4. Inventory changes occur only through InventoryTransaction inserts
   (ADR-002) — no direct `UPDATE` of a balance, anywhere in the codebase.
5. Historical transactions are immutable and auditable.
6. Authorization is enforced server-side, never trusted from the client.
7. The UI never owns business rules — reorder logic, balance derivation,
   and validation live in the application/domain layer.
8. APIs expose business capabilities (`POST /goods-receipts`,
   `POST /inventory-issues`), not raw table CRUD.
9. Prefer simplicity over premature distribution (see
   `architecture-overview.md`).
10. Design for extension (clean module seams), not speculative complexity
    (no tables/features for domains not yet in scope).
