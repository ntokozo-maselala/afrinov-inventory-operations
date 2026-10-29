# API Conventions

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

- Nouns for resources, verbs implied by HTTP method: `GET /materials`,
  `POST /materials`, `GET /materials/:id`, `PATCH /materials/:id`.
  `DELETE` is used for locations (a real delete, only when unused), racks
  and projects (both archive rather than delete). The only `PUT` is
  `PUT /settings/:key`.
- Business actions that aren't plain CRUD are modelled as `POST` to a
  purpose-named resource: `POST /inventory-issues`, not
  `POST /materials/:id/issue`. Actions on one existing record are `POST` to
  a sub-path: `POST /purchase-orders/:id/approve`,
  `POST /inventory-transactions/:id/reversal`.
- Filtering via camelCase query params, e.g.
  `GET /inventory-transactions?materialId=..&from=..&to=..&type=ISSUE&projectNumber=..`.
  Enum values are upper case, as stored.
- **Pagination:** only `GET /reports/inventory` pages (`page`, `pageSize`
  up to 1000, default 200). `GET /inventory-transactions` and
  `/reports/movement-history` take `limit` (default 200, capped at 1000);
  `GET /audit` takes `limit` 1 to 500 (default 100). Other lists return
  every row. Cursor pagination is **Planned** (TD-019).
- Request bodies are validated with Zod at the route; a failure returns
  `400 VALIDATION_ERROR` with the flattened Zod issues in `details`.
- **Idempotency:** inventory mutations (`/inventory-issues`,
  `/inventory-transfers`, `/inventory-adjustments`, `/stock-counts`,
  `/stock-receipts`, `/inventory-returns`,
  `/inventory-transactions/:id/returns`, `/inventory-transactions/:id/reversal`)
  accept an optional `Idempotency-Key` header (1-200 printable ASCII
  characters; a UUID is typical). A repeat with the same key and the same
  request replays the stored status and body and carries
  `Idempotency-Replayed: true`; the same key with a different body or record
  answers `409 IDEMPOTENCY_KEY_REUSED`, so the client can rotate its key rather
  than retry a permanent conflict. A *present but invalid* key (blank or
  over-long) is refused `400 VALIDATION_ERROR` rather than silently run unkeyed.
  Keys are scoped per actor, route and record, are stored with the movement in
  one transaction, and are serialised against concurrent retries with a
  transaction-scoped advisory lock. Stored keys are pruned after 24 hours
  (hourly sweep at startup).
- Dates: ISO 8601 strings; timestamps are returned in UTC
  (`toISOString()`). Some inputs are dates only (`YYYY-MM-DD`, e.g. report
  ranges) or a month (`YYYY-MM`, month-end).
- Numbers: request quantities are JSON numbers. Ledger quantities in
  responses are strings (Prisma decimals serialised with `toString()`);
  report figures are numbers.
- Creation returns `201`, `DELETE /locations/:id` returns `204`, everything
  else `200`.

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:71-81`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:116,153`
- `afrinov-platform/apps/backend/src/modules/reporting/report-query.schema.ts:70-71`
- `afrinov-platform/apps/backend/src/modules/audit/audit.routes.ts:11-15`
- `afrinov-platform/apps/backend/src/modules/settings/settings.routes.ts:49`
- `afrinov-platform/apps/backend/src/modules/inventory/material.routes.ts:154-160`
- `afrinov-platform/apps/backend/src/modules/reporting/month-end.service.ts:63-73`
