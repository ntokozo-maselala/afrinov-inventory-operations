# Business Transaction Catalogue

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Each transaction lists the API operation that implements it, or **Planned**
when no code path exists. Purchase-order and goods-receipt operations are
registered only when `PROCUREMENT_ENABLED=true`.

## Procurement
| Transaction | API |
|---|---|
| Create supplier | `POST /suppliers` |
| Update supplier | **Planned** (no endpoint) |
| Deactivate supplier | **Planned** (no endpoint) |
| Create purchase order | `POST /purchase-orders` |
| Edit purchase order (notes, expected delivery date) | `PATCH /purchase-orders/:id` |
| Submit purchase order | `POST /purchase-orders/:id/submit` |
| Approve purchase order | `POST /purchase-orders/:id/approve` |
| Receive everything outstanding | `POST /purchase-orders/:id/receive` |
| Record and post a goods receipt | `POST /goods-receipts`, `POST /goods-receipts/:id/post` |
| Close purchase order | `POST /purchase-orders/:id/close` |
| Cancel purchase order | `POST /purchase-orders/:id/cancel` |

## Inventory
| Transaction | API |
|---|---|
| Create material | `POST /materials` |
| Create material with opening stock | `POST /stock-items` |
| Update material (name, description, unit, required stock, unit cost) | `PATCH /materials/:id` |
| Deactivate material | `PATCH /materials/:id` with `active: false` |
| Create / update location | `POST /locations`, `PATCH /locations/:id` |
| Activate / deactivate location | `PATCH /locations/:id/status` |
| Delete unused location | `DELETE /locations/:id` |
| Merge locations | **Planned** (no endpoint; import maps spellings instead) |
| Create / update / archive rack | `POST /racks`, `PATCH /racks/:id`, `DELETE /racks/:id` |
| Receive stock at the counter (no PO) | `POST /stock-receipts` |
| Issue stock (to a recipient, optional project, several items) | `POST /inventory-issues` |
| Return unused stock from an issue | `POST /inventory-transactions/:id/returns` |
| Transfer stock (location to location) | `POST /inventory-transfers` |
| Adjust stock (reason: count variance, damage, loss, scrap, other) | `POST /inventory-adjustments` |
| Count stock at a location | `POST /stock-counts` |
| Reverse a movement | `POST /inventory-transactions/:id/reversal` |
| Check out tool / Check in tool | **Planned** (no endpoint) |

## Operations
| Transaction | API |
|---|---|
| Create / update / archive project | `POST /projects`, `PATCH /projects/:projectNumber`, `DELETE /projects/:projectNumber` |
| Create / update (incl. deactivate) recipient | `POST /recipients`, `PATCH /recipients/:id` |

## Reporting
| Transaction | API |
|---|---|
| Current-stock report (by category/location/material) | `GET /reports/current-stock` |
| Movement-history report | `GET /reports/movement-history` |
| Stock-value report | `GET /reports/stock-value` |
| Stock status / re-order list | `GET /reports/stock-status`, `GET /reports/reorder-list/export` |
| Low-stock report | `GET /reports/low-stock` |
| Project-consumption report | `GET /reports/project-consumption/:projectNumber` |
| Stock used (by project, recipient, category, date range) | `GET /reports/consumption`, `GET /reports/consumption/export` |
| Month-end report | `GET /reports/month-end`, `GET /reports/month-end/export` |
| Inventory report | `GET /reports/inventory`, `GET /reports/inventory/export` |

## Identity & Access
| Transaction | API |
|---|---|
| Create user (with roles) | `POST /users` |
| Assign roles / deactivate user | `PATCH /users/:id` |

All paths are under `/api/v1`. Mapping to acceptance scenarios is in
`11-testing/test-traceability.md`.

## Evidence
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts:78-224`
- `afrinov-platform/apps/backend/src/modules/inventory/material.routes.ts:27-161`
- `afrinov-platform/apps/backend/src/modules/inventory/rack.routes.ts:34-80`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-item.routes.ts:37-58`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:70-170`
- `afrinov-platform/apps/backend/src/modules/operations/project.routes.ts:40-85`, `afrinov-platform/apps/backend/src/modules/operations/recipient.routes.ts:32-71`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts:26-198`
- `afrinov-platform/apps/backend/src/modules/identity/user.routes.ts:24-69`
