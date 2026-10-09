# API Principles

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

1. Endpoints represent business capabilities and transactions
   (`03-domain/business-transactions.md`), not raw table CRUD —
   `POST /goods-receipts` and `POST /inventory-issues`, not a generic
   `PATCH /materials/:id { quantity }`. *Followed: no endpoint sets a
   quantity or edits a ledger row.*
2. Every mutating endpoint requires authentication and enforces role-based
   authorization server-side. *Followed; the one exception by design is
   `POST /auth/login`.*
3. Every mutating endpoint is idempotent-safe for retries where practical
   (e.g. via a client-supplied idempotency key on POST), so a network retry
   never double-posts a transaction. ***Planned** — no endpoint accepts an
   idempotency key, so a retried issue posts twice (TD-019).
   Purchase-order transitions are protected against double application by
   their status guards.*
4. Responses never expose internal implementation details (raw stack
   traces, internal ids without meaning) — see `error-model.md`.
   *Followed for errors: unexpected errors return a generic
   `INTERNAL_ERROR`.*
5. Read endpoints support filtering/pagination for anything that can grow
   large. *Partial: filters exist; only the inventory report pages; ledger
   and audit reads are capped by `limit` (see `api-conventions.md`).*

## Evidence
- `afrinov-platform/apps/backend/src/modules/*/*.routes.ts` — `preHandler: [app.authenticate]` and `requirePermission` on mutating routes
- `afrinov-platform/apps/backend/src/server.ts:180-199` — error handler
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:213-219` — status-guarded update
