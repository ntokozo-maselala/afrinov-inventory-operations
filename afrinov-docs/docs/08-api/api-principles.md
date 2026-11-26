<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-08-003</b></td>
<td align="center"><b><i>API Principles</i></b><br><i>API Reference</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-08-003 updated=2026-11-26 by="Ntokozo Maselala" body=d4ba4285e355 -->

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
   never double-posts a transaction. *Followed for inventory: every inventory
   mutation accepts an `Idempotency-Key` and replays the stored response on a
   repeat (`src/shared/idempotency.ts`, TD-019 partly resolved). Concurrent
   retries serialise on a transaction-scoped advisory lock, a present-but-
   invalid key is refused rather than run unkeyed, a reused key answers a
   distinct `IDEMPOTENCY_KEY_REUSED`, and stored keys are pruned after 24h. The
   remaining write endpoints (procurement, master data) do not yet accept a
   key.
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
