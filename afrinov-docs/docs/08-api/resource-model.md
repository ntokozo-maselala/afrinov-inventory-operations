# Resource Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Every route below is under `/api/v1` and requires a valid token unless
marked *public*. "auth" means any signed-in user; otherwise the named
permission is required (see `authorization.md`).

| Resource | Table(s) | Operations (method path — permission) |
|---|---|---|
| Auth | `users` | `POST /auth/login` — *public*; `GET /auth/me` — auth |
| User | `users`, `user_roles` | `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id` (name, active, roles) — manage:users; `GET /users/lookup` — view:users |
| Material | `materials` | `GET /materials` (category, active, q), `GET /materials/:id` — auth; `POST /materials` — create:material; `PATCH /materials/:id` (incl. active) — edit:material |
| StockItem (action) | `materials` + `inventory_transactions` | `POST /stock-items` — create:material and receive:inventory |
| Location | `locations` | `GET /locations` (q, type, active), `GET /locations/:id` — auth; `POST` — create:location; `PATCH /:id` — edit:location; `PATCH /:id/status` — manage:location_status; `DELETE /:id` (only when unused) — delete:location |
| Rack | `racks` | `GET /racks` (q, locationId, projectNumber, status), `GET /racks/:id` — auth; `POST`, `PATCH /:id`, `DELETE /:id` (archive) — manage:racks |
| Supplier | `suppliers` | `GET /suppliers` (q) — auth; `POST /suppliers` — create:supplier. Update/deactivate **Planned** |
| PurchaseOrder | `purchase_orders` (+lines) | Only when `PROCUREMENT_ENABLED=true`. `GET /purchase-orders` (status), `GET /:id`, `GET /:id/history` — view:purchase_order; `POST` and `PATCH /:id` — create:purchase_order; `POST /:id/submit` — submit:purchase_order; `/approve` — approve:purchase_order; `/receive` — receive:purchase_order; `/close` — close:purchase_order; `/cancel` — cancel:purchase_order |
| GoodsReceipt | `goods_receipts` (+lines) | Only when `PROCUREMENT_ENABLED=true`. `GET /goods-receipts`, `GET /:id` — view:goods_receipt; `POST /goods-receipts`, `POST /:id/post` — receive:inventory |
| StockReceipt (action) | `goods_receipts` (POSTED) + `inventory_transactions` | `POST /stock-receipts` (supplier, delivery/invoice number, date, 1–50 lines) — receive:inventory. Always available |
| InventoryTransaction | `inventory_transactions` | `GET /inventory-transactions` (materialId, type, from, to, projectNumber, limit) — auth. Read-only; no update or delete route |
| InventoryIssue (action) | inserts ISSUE rows | `POST /inventory-issues` (recipient, optional project, 1–50 lines) — issue:inventory |
| Return (action) | inserts a RETURN row | `POST /inventory-transactions/:id/returns` — issue:inventory |
| Reversal (action) | inserts opposite rows | `POST /inventory-transactions/:id/reversal` (reason) — reverse:inventory_transaction |
| InventoryTransfer (action) | inserts two linked rows | `POST /inventory-transfers` — transfer:inventory |
| InventoryAdjustment (action) | inserts an ADJUSTMENT row | `POST /inventory-adjustments` — adjust:inventory |
| StockCount (action) | inserts COUNT_VARIANCE adjustments | `POST /stock-counts` (location, 1–2000 lines) — adjust:inventory |
| ToolCheckOut / ToolCheckIn (action) | — | **Planned** |
| Project | `projects` | `GET /projects` (q, status, active), `GET /projects/:projectNumber` — auth; `POST`, `PATCH`, `DELETE` (archive) — manage:projects |
| Recipient | `recipients` | `GET /recipients` (q, type, active), `GET /recipients/:id` — auth; `POST`, `PATCH /:id` (incl. active) — manage:recipients |
| Report: CurrentStock | derived | `GET /reports/current-stock` (category, locationId, materialId) — view:reports |
| Report: MovementHistory | derived | `GET /reports/movement-history` (materialId, type, from, to, projectNumber, limit) — view:reports |
| Report: StockStatus | derived | `GET /reports/stock-status` (status, category) — view:reports |
| Report: StockValue | derived | `GET /reports/stock-value` — view:reports |
| Report: LowStock | derived | `GET /reports/low-stock` — view:reports (empty when stock alerts are off) |
| Report: ReorderList | derived | `GET /reports/reorder-list/export` (.xlsx) — view:reports |
| Report: ProjectConsumption | derived | `GET /reports/project-consumption/:projectNumber` — view:reports |
| Report: Consumption | derived | `GET /reports/consumption` and `/export` (.xlsx) (from, to, projectNumber, category, recipientId) — view:reports |
| Report: MonthEnd | derived | `GET /reports/month-end` and `/export` (.xlsx) (month `YYYY-MM`) — view:reports |
| Report: Inventory | derived | `GET /reports/inventory` and `/export` (`format=xlsx` or `format=pdf`) — view:reports |
| Setting | `settings` | `GET /settings`, `/settings/values`, `/settings/:key` — auth; `PUT /settings/:key`, `PATCH /settings`, `POST /settings/reset` — ADMIN role and manage:settings |
| AuditLogEntry | `audit_log_entries` | `GET /audit` (entityType, entityId, limit) — view:audit_log |
| Health | — | `GET /health`, `GET /health/ready` — *public* (also at the root) |
| Role | `roles` | No endpoint; roles are assigned through `/users` |

## Evidence
- `afrinov-platform/apps/backend/src/modules/identity/auth.routes.ts:10-27`, `afrinov-platform/apps/backend/src/modules/identity/user.routes.ts:24-69`
- `afrinov-platform/apps/backend/src/modules/inventory/material.routes.ts:27-161`, `afrinov-platform/apps/backend/src/modules/inventory/stock-item.routes.ts:37-58`, `afrinov-platform/apps/backend/src/modules/inventory/rack.routes.ts:34-80`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:10-170`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts:78-224`
- `afrinov-platform/apps/backend/src/modules/operations/project.routes.ts:40-85`, `afrinov-platform/apps/backend/src/modules/operations/recipient.routes.ts:32-71`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts:26-198`
- `afrinov-platform/apps/backend/src/modules/settings/settings.routes.ts:26-75`
- `afrinov-platform/apps/backend/src/modules/audit/audit.routes.ts:17-38`, `afrinov-platform/apps/backend/src/modules/health/health.routes.ts:17-33`
