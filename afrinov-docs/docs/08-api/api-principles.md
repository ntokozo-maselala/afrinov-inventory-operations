# API Principles

1. Endpoints represent business capabilities and transactions
   (`03-domain/business-transactions.md`), not raw table CRUD —
   `POST /goods-receipts` and `POST /inventory-issues`, not a generic
   `PATCH /materials/:id { quantity }`.
2. Every mutating endpoint requires authentication and enforces role-based
   authorization server-side.
3. Every mutating endpoint is idempotent-safe for retries where practical
   (e.g. via a client-supplied idempotency key on POST), so a network retry
   never double-posts a transaction.
4. Responses never expose internal implementation details (raw stack
   traces, internal ids without meaning) — see `error-model.md`.
5. Read endpoints support filtering/pagination for anything that can grow
   large (transaction history, especially — the current `Project Material
   Issued` sheet alone has 4,514 rows).
