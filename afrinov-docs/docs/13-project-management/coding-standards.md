# Coding Standards

- Module structure follows `06-system-architecture/module-architecture.md`
  — no cross-module direct database access.
- Domain layer has no framework dependencies (testable in isolation).
- No direct writes to `inventory_balances`/derived data anywhere in the
  codebase — enforced by code review and, ideally, database grants.
- Every use case that mutates data writes an audit entry in the same
  transaction (not a follow-up call that could be skipped).
