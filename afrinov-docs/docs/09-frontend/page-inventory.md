# Page Inventory

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Page (route) | Domain | Purpose | Main actions → API |
|---|---|---|---|
| Login (`/login`) | Identity | Sign in | `POST /auth/login` |
| Dashboard (`/`) | Cross-domain | KPIs (items in stock, urgent, warning, out of stock), stock value per category, re-order candidates | `GET /reports/inventory`, `/reports/low-stock`, `/reports/stock-value` |
| Stock (`/stock`) | Inventory | Current balances (`GET /reports/current-stock`); quick issue, transfer, adjust; add a stock item | `POST /inventory-issues`, `/inventory-transfers`, `/inventory-adjustments`, `/stock-items` |
| Issue stock (`/stock/issue`) | Inventory | Issue several items to one recipient, optional project | `POST /inventory-issues` |
| Receive stock (`/stock/receive`) | Inventory | Counter receipt: supplier, delivery/invoice number, several items | `POST /stock-receipts` |
| Stock count (`/stock/count`) | Inventory | Count a location; post differences | `POST /stock-counts` |
| Movements (`/movements`) | Inventory | Ledger history; drawer to reverse or return | `GET /inventory-transactions`; `POST …/reversal`, `…/returns` |
| Materials (`/materials`, `/materials/:id`) | Inventory | Material master and per-item detail | `POST/PATCH /materials` |
| Locations (`/locations`) | Inventory | Location master; activate/deactivate; delete unused | `/locations` routes |
| Racks (`/racks`) | Inventory | Rack master; archive | `/racks` routes |
| Projects (`/projects`) | Operations | Project master; archive | `/projects` routes |
| Recipients (`/recipients`) | Operations | "Issued To" list | `/recipients` routes |
| Suppliers (`/suppliers`, `/suppliers/:id`) | Procurement | Supplier list, create, detail | `GET/POST /suppliers` |
| Purchase orders (`/purchase-orders`, `/:id`) | Procurement | Create, submit, approve, receive, close, cancel | `/purchase-orders` routes (procurement flag) |
| Goods receipts (`/goods-receipts`) | Procurement | Record and post receipts against orders | `/goods-receipts` routes (procurement flag) |
| Inventory report (`/reports/inventory`) | Reporting | Filterable inventory report; Excel/PDF | `/reports/inventory`, `/export` |
| Stock status (`/reports/stock-status`) | Reporting | URGENT/WARNING/OK per item; re-order list download | `/reports/stock-status`, `/reports/reorder-list/export` |
| Stock used (`/reports/consumption`) | Reporting | Use by project, recipient and category over dates; issues to one recipient | `/reports/consumption`, `/export` |
| Month-end report (`/reports/month-end`) | Reporting | The workbook's Summary/Stock Report layout for a month | `/reports/month-end`, `/export` |
| Settings (`/settings/*`) | Administration | Settings sections; Users (create, roles, deactivate); System (API health); History (settings audit) | `/settings`, `/users`, `/health`, `/audit` |
| Not found (`*`) | — | Unknown route | — |

`/reports/low-stock` redirects to `/reports/stock-status`. When procurement
is off, `/purchase-orders/*` and `/goods-receipts/*` redirect to `/`.

**Planned:** Tools check-out/in page; Stock value and Project consumption as
their own report pages (their data appears on the Dashboard and the Stock
used page); location merge.

## Evidence
- `afrinov-platform/apps/frontend/src/App.tsx:100-165`
- `afrinov-platform/apps/frontend/src/components/StockActionForm.tsx:68-81`, `afrinov-platform/apps/frontend/src/components/AddStockItemForm.tsx:121`
- `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx:89,254`
- `afrinov-platform/apps/frontend/src/pages/Dashboard.tsx:48-63`, `afrinov-platform/apps/frontend/src/pages/Stock.tsx:47`
- `afrinov-platform/apps/frontend/src/pages/*.tsx`
