# Non-Functional Requirements

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Performance
- Common read operations (stock lookup, movement history) should return in
  under 500ms for typical query volumes at Afrinov's current scale
  (thousands of materials, low tens of thousands of transactions per year,
  based on the current `*Issued` sheet row counts). *Unverified* — no
  performance tests exist (`11-testing/performance-testing.md`).
- The system should comfortably support at least the current 52 active
  users, with headroom for growth. *Unverified.*

## Reliability
- Inventory transactions must be atomic: a partially-recorded receipt or
  issue must never leave the balance in an inconsistent state. *Met:*
  every movement runs in one database transaction.
- The system must not lose data on a failed request — the client should be
  able to tell whether an operation succeeded, failed, or is unknown, and
  retries must not double-post a transaction (idempotency on write
  endpoints). ***Planned:*** no idempotency keys exist (TD-019).

## Security
- All access requires authentication; no anonymous write access.
- Passwords/credentials never stored in plain text; standard hashing.
- Audit log entries are themselves immutable (append-only). *Partly met:*
  no endpoint changes them; the database does not prevent it (TD-006).

## Maintainability
- Code organised by bounded context (`06-system-architecture/module-architecture.md`),
  not by technical layer alone, so a new developer can find "everything
  about Inventory" in one place. *Met* at folder level; boundaries are not
  enforced (TD-004).
- Automated tests cover business rules, not just CRUD (`11-testing/testing-strategy.md`).

## Scalability
- Architecture (modular monolith, see ADR-001) should not block splitting
  a module into a separate service later if a specific domain (e.g.
  Reporting) needs to scale independently — but this is not needed at
  current scale and should not be built prematurely.

## Data quality
- Master data (Material, Location, Supplier) must be deduplicated during
  migration; the system must make it hard to recreate the "six spellings of
  stores" problem (e.g. via lookups/autocomplete rather than free text).
  *Met:* movements pick locations, suppliers, projects and recipients from
  lists; names are unique (recipients and suppliers ignoring case).

## Auditability
- Every inventory-affecting action is traceable to a user, timestamp, and
  business reference (project, PO, delivery note) — non-negotiable, since
  this is the single biggest capability gap identified in the AS-IS system.

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:304` — `prisma.$transaction`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000005_recipients/migration.sql:24`
