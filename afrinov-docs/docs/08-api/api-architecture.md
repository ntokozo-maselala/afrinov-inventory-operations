# API Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

REST over HTTP with JSON bodies (Fastify 5), all business endpoints under
`/api/v1`. TLS termination is not part of the repository (*Unverified*
how production serves HTTPS). Excel and PDF downloads are returned as
attachments. An OpenAPI 3 description is served at `/api/docs` (Swagger
UI) and `/api/docs/json`, generated from the same Zod schemas the routes
validate with; it is on by default except in production
(`API_DOCS_ENABLED`).

```
/api/v1/auth/login, /auth/me
/api/v1/users, /users/lookup, /users/:id
/api/v1/materials, /materials/:id
/api/v1/locations, /locations/:id, /locations/:id/status
/api/v1/racks, /racks/:id
/api/v1/stock-items                       (business action: new item + opening stock)
/api/v1/inventory-transactions            (read-only ledger)
/api/v1/inventory-transactions/:id/returns
/api/v1/inventory-transactions/:id/reversal
/api/v1/inventory-issues                  (business action)
/api/v1/inventory-transfers               (business action)
/api/v1/inventory-adjustments             (business action)
/api/v1/stock-counts                      (business action)
/api/v1/stock-receipts                    (business action: counter receipt, no PO)
/api/v1/suppliers
/api/v1/purchase-orders, /purchase-orders/:id and its history, submit, approve, receive, close, cancel actions
/api/v1/goods-receipts, /goods-receipts/:id and its post action
/api/v1/projects, /projects/:projectNumber
/api/v1/recipients, /recipients/:id
/api/v1/reports/current-stock
/api/v1/reports/movement-history
/api/v1/reports/stock-status
/api/v1/reports/stock-value
/api/v1/reports/low-stock
/api/v1/reports/reorder-list/export
/api/v1/reports/project-consumption/:projectNumber
/api/v1/reports/consumption, /reports/consumption/export
/api/v1/reports/month-end, /reports/month-end/export
/api/v1/reports/inventory, /reports/inventory/export
/api/v1/settings, /settings/values, /settings/:key, /settings/reset
/api/v1/audit
/api/v1/health, /api/v1/health/ready      (also served at /health, /health/ready)
```

Purchase-order and goods-receipt routes are registered only when
`PROCUREMENT_ENABLED=true`; otherwise they return 404.

**Planned (no endpoint):** `/tools/check-out`, `/tools/check-in`,
`/roles` (roles are assigned through `/users`). Full method and permission
detail is in `resource-model.md`.

## Evidence
- `afrinov-platform/apps/backend/src/server.ts:201-278`
- `afrinov-platform/apps/backend/src/modules/*/*.routes.ts`
- `afrinov-platform/apps/backend/src/shared/config.ts:84-98` — `PROCUREMENT_ENABLED`, `API_DOCS_ENABLED`
- `afrinov-platform/apps/backend/src/openapi/document.ts:583-592`
