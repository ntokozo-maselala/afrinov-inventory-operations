# Page Inventory

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

| Page (route) | Domain | Purpose | Main actions → API |
|---|---|---|---|
| Login (`/login`) | Identity | Sign in | `POST /auth/login` |
| Dashboard (`/`) | Cross-domain | Stock value, items in stock, urgent, warning, out of stock, tools checked out (and overdue); stock status and value charts; re-order candidates; "Waiting for your approval" for approvers | `GET /reports/inventory`, `/reports/low-stock`, `/reports/stock-value`, `/tools`, `/purchase-orders?awaitingMyApproval=true` |
| Stock (`/stock`) | Inventory | Current balances; transfer and adjust from a row | `GET /reports/current-stock`; `POST /inventory-transfers`, `/inventory-adjustments` |
| Issue stock (`/stock/issue`) | Inventory | Issue several items to one recipient, optional project | `POST /inventory-issues` |
| Return stock (`/stock/return`) | Inventory | Return unused stock from a recipient against the issues it came from (last 30 days unless changed) | `GET /inventory-returns/returnable`, `POST /inventory-returns` |
| Receive stock (`/stock/receive`) | Inventory | Counter receipt: supplier, delivery/invoice number, several items; add a new supplier or item from the form; offers the supplier's open purchase orders | `POST /stock-receipts`, `POST /suppliers`, `POST /materials` |
| Count stock (`/stock/count`) | Inventory | Count a location; post differences | `POST /stock-counts` |
| Tools (`/tools`) | Inventory | What is in store and out, with whom; check out and check in; overdue loans flagged (`04-processes/tool-loans.md`) | `GET /tools`, `POST /tools/check-out`, `/tools/check-in` |
| Movements (`/movements`) | Inventory / Reporting | Ledger history in views: all movements, received, issued, returned, stock counts, transfers, write-offs and adjustments, tool check in/out, other changes. Date range, filters, paging; Excel and PDF download; drawer to reverse or return | `GET /inventory-transactions`, `/activity`; `POST …/reversal`, `…/returns` |
| Materials (`/materials`, `/materials/:id`) | Inventory | Material master and per-item detail; edit Required Stock, unit cost and active status; start a purchase order for the item | `POST/PATCH /materials` |
| Locations (`/locations`) | Inventory | Location master; activate/deactivate; delete unused | `/locations` routes |
| Racks (`/racks`) | Inventory | Rack master; archive | `/racks` routes |
| Projects (`/projects`) | Operations | Project master; archive | `/projects` routes |
| Recipients (`/recipients`) | Operations | "Issued To" list | `/recipients` routes |
| Suppliers (`/suppliers`, `/suppliers/:id`) | Procurement | Supplier master (the template's vendor list): list, add, edit, deactivate; a supplier's orders and a new order for it | `GET/POST /suppliers`, `PATCH /suppliers/:id` |
| Purchase orders (`/purchase-orders`) | Procurement | Orders with status and project filters in the link (`?status=`, `?project=`); `?status=mine` lists the orders waiting for the signed-in approver | `GET /purchase-orders` |
| New purchase order (`/purchase-orders/new`) | Procurement | The template's Inputs sheet: supplier, lines with prices, VAT, order and delivery details. Save draft, or Create & submit. Filled in from `?supplierId=&materialIds=` | `POST /purchase-orders`, `POST /:id/submit` |
| Purchase order (`/purchase-orders/:id`) | Procurement | Lines with subtotal, VAT and net; totals; approval (who may approve); submit, approve, receive a delivery line by line, close, cancel; download the order document (PDF); history | `/purchase-orders/:id/*`, `POST /goods-receipts`, `…/post` |
| Edit purchase order (`/purchase-orders/:id/edit`) | Procurement | Prices, delivery dates, VAT, details and remarks while editable | `PATCH /purchase-orders/:id` |
| Stock status (`/reports/stock-status`) | Reporting | URGENT/WARNING/OK per item; re-order list download (Excel, PDF); start a purchase order from the list | `/reports/stock-status`, `/reports/reorder-list/export` |
| Stock used (`/reports/consumption`) | Reporting | Use by project, recipient and category over dates; issues to one recipient | `/reports/consumption`, `/export` |
| Stock report (`/reports/stock-report`) | Reporting | The workbook's Summary/Stock Report layout, as stock stood at the end of a month, week or range of days | `/reports/month-end`, `/export` |
| Settings (`/settings/*`) | Administration | General, Notifications, Inventory, Purchase orders, Appearance, Users (create, roles, approval limits, deactivate), Security, System (API health), Data, History (settings audit) | `/settings`, `/users`, `/health`, `/audit` |
| Not found (`*`) | — | Unknown route | — |

Redirects: `/reports/low-stock` → Stock status; `/reports/month-end` → Stock
report; `/reports/inventory` → Dashboard; `/goods-receipts/*` → Purchase
orders. When procurement is switched off, `/purchase-orders/*` and
`/goods-receipts/*` redirect to `/` and the Purchase orders settings section
is hidden.

Pages a role cannot use are left out of its menu, and the buttons for
actions it cannot take are hidden; an action page reached by a typed or old
link shows a "no access" message instead of its form (`10-security/access-control.md`).

**Planned:** Stock value and Project consumption as their own report pages
(their data appears on the Dashboard and the Stock used page); location merge.

## Evidence
- `afrinov-platform/apps/frontend/src/App.tsx` (routes)
- `afrinov-platform/apps/frontend/src/hooks/useNavGroups.tsx` (menu)
- `afrinov-platform/apps/frontend/src/pages/*.tsx`
- `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx`, `NoAccess.tsx`, `RoleGuard.tsx`
