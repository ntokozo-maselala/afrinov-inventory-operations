# Page Inventory

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 2026-10-21

| Page (route) | Domain | Purpose | Main actions → API |
|---|---|---|---|
| Login (`/login`) | Identity | Sign in | `POST /auth/login` |
| Dashboard (`/`) | Cross-domain | Stock value, items in stock, urgent, warning, out of stock, tools checked out (and overdue); stock status and value charts; re-order candidates; "Waiting for your approval" for approvers | `GET /reports/inventory`, `/reports/low-stock`, `/reports/stock-value`, `/tools`, `/purchase-orders?awaitingMyApproval=true` |
| Stock (`/stock`) | Inventory | The store's current balances: Stores items only, each with its **Required** stock threshold and status; transfer and adjust from a row. Project material goes straight to site, so it is not stock: any still in the store from before is listed above the table by project (a closed project's as leftovers to move to Stores, an open project's linking to its items on Materials). An older `?section=PROJECTS` link opens the same page | `GET /reports/current-stock`, `GET /reports/stock-value`; `POST /inventory-transfers`, `/inventory-adjustments` |
| Issue stock (`/stock/issue`) | Inventory | Issue several items to one recipient, optional project | `POST /inventory-issues` |
| Return stock (`/stock/return`) | Inventory | Return unused stock from a recipient against the issues it came from (last 30 days unless changed) | `GET /inventory-returns/returnable`, `POST /inventory-returns` |
| Receive stock (`/stock/receive`) | Inventory | The one place a delivery to the store is booked, with the delivery/invoice number and date. Procurement on: only against an approved Stores order, for those who receive orders: choose the order (`?order=<id>` chooses one), its outstanding lines are filled in, and the order is closed from the confirmation once complete, or with the delivery and a reason; says so when no order is waiting. Procurement off: a counter receipt of several items from a supplier; add a new supplier or item from the form | `POST /goods-receipts`, `POST /purchase-orders/:id/close` (procurement on); `POST /stock-receipts`, `POST /suppliers`, `POST /materials` (off) |
| Count stock (`/stock/count`) | Inventory | Count a location; post differences | `POST /stock-counts` |
| Tools (`/tools`) | Inventory | What is in store and out, with whom; check out and check in; overdue loans flagged (`04-processes/tool-loans.md`) | `GET /tools`, `POST /tools/check-out`, `/tools/check-in` |
| Movements (`/movements`) | Inventory / Reporting | Ledger history in views: all movements, received, issued, returned, stock counts, transfers, write-offs and adjustments, tool check in/out, other changes. Date range, filters, paging; Excel and PDF download; drawer to reverse or return | `GET /inventory-transactions`, `/activity`; `POST …/reversal`, `…/returns` |
| Materials (`/materials`, `/materials/:id`) | Inventory | Material master (Stores and Projects tabs) and per-item detail; edit Required Stock, unit cost and active status; Order the item: a Stores item on Order stock's form (store controller), a Projects item on New purchase order (Procurement). A Stores item's page has its stock summary, status and stock by location; a Projects item's has its project's status instead, and **Left in the store** only while some is left from before (Move to Stores for a closed project) | `POST/PATCH /materials` |
| Locations (`/locations`) | Inventory | Location master; activate/deactivate; delete unused | `/locations` routes |
| Projects (`/projects`) | Operations | Project master; archive | `/projects` routes |
| Recipients (`/recipients`) | Operations | "Issued To" list | `/recipients` routes |
| Suppliers (`/suppliers`, `/suppliers/:id`) | Procurement | Supplier master (the template's vendor list): list, add, edit, deactivate; a supplier's orders and a new order for it, on the form the viewer orders from | `GET/POST /suppliers`, `PATCH /suppliers/:id` |
| Purchase orders (`/purchase-orders`) | Procurement | Project orders only, with status and project filters in the link (`?status=`, `?project=`); `?status=mine` lists the project orders waiting for the signed-in approver | `GET /purchase-orders?kind=projects` |
| New purchase order (`/purchase-orders/new`) | Procurement | A project order on the template's Inputs sheet: the project (required), supplier, that project's material with prices, VAT, order and delivery details. Save draft, or Create & submit. Filled in from `?supplierId=&materialIds=` | `POST /purchase-orders`, `POST /:id/submit` |
| Order stock (`/stock/orders`, an order at `/stock/orders/:id`) | Inventory | The store's orders (no project), for the store controller only: search and a status filter, including **Waiting for my approval** (`?status=mine`) and **On order** (approved, not yet fully received); New order; **Receive** on an order still awaiting delivery opens Receive stock with that order chosen | `GET /purchase-orders?kind=stores` |
| New stock order (`/stock/orders/new`) | Inventory | The same form for a Stores order: no project, Stores items only. Filled in from the re-order list's `?supplierId=&materialIds=` | `POST /purchase-orders`, `POST /:id/submit` |
| Purchase order (`/purchase-orders/:id`, or `/stock/orders/:id` for a Stores order) | Procurement or Order stock | Lines with subtotal, VAT and net; totals; approval (who may approve); submit, approve, close, cancel; a Stores order's **Receive delivery** (opens Receive stock with the order chosen), a project order's **Confirm delivery** (to site, no stock added); download the order document (PDF); history | `/purchase-orders/:id/*`, `…/confirm-delivery` |
| Edit purchase order (`/purchase-orders/:id/edit`) | Procurement | Prices, delivery dates, VAT, details and remarks while editable | `PATCH /purchase-orders/:id` |
| Stock status (`/reports/stock-status`) | Reporting | URGENT/WARNING/OK per item; re-order list download (Excel, PDF); start a stock order from the list (store controller) | `/reports/stock-status`, `/reports/reorder-list/export` |
| Stock used (`/reports/consumption`) | Reporting | Use by project, recipient and category over dates; issues to one recipient | `/reports/consumption`, `/export` |
| Stock report (`/reports/stock-report`) | Reporting | The workbook's Summary/Stock Report layout, as stock stood at the end of a month, week or range of days; **Project material still in the store** lists only projects with some left at the end of the period | `/reports/month-end`, `/export` |
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

## Route coverage and UI audit (2026-10-21)

The router in `afrinov-platform/apps/frontend/src/App.tsx` defines these active route families:

- Public: `/login`.
- Protected shell: `/`, `/stock`, `/stock/issue`, `/stock/return`, `/stock/receive`, `/stock/count`, `/materials`, `/materials/:id`, `/movements`, `/suppliers`, `/suppliers/:id`, `/reports/stock-status`, `/reports/consumption`, `/reports/stock-report`, `/locations`, `/projects`, `/recipients`, `/tools`, and `/settings`.
- Conditional procurement routes when `PROCUREMENT_ENABLED`: `/stock/orders`, `/stock/orders/new`, `/purchase-orders`, `/purchase-orders/new`, `/purchase-orders/:id`, `/purchase-orders/:id/edit`, `/rfqs` and its pages, and `/settings/purchase-orders`.
- Settings child routes: `/settings/notifications`, `/settings/inventory`, `/settings/appearance`, `/settings/users`, `/settings/security`, `/settings/system`, `/settings/data`, and `/settings/history`; `/settings` renders the general section.
- Fallback: all other protected paths render Not found.

Redirects are not separate page designs: `/reports/low-stock` → `/reports/stock-status`, `/reports/month-end` → `/reports/stock-report`, `/reports/inventory` → `/`, `/goods-receipts/*` → `/purchase-orders` when procurement is enabled, and procurement paths → `/` when it is disabled. The disabled `/settings/purchase-orders` section redirects to `/settings`.

### Render and source audit notes

On 2026-10-21 the route families were opened in Chromium using the frontend-only mock mode and an administrator session. Registered list/form/settings/report routes reached their page component without page-level JavaScript errors. Representative rendered views included `/`, `/stock`, `/stock/issue`, `/materials`, `/reports/stock-status`, and `/settings/appearance`; dashboard light/dark and desktop/mobile variants were also inspected. This is a mock-data browser pass, not a live API or role-matrix verification.

Page components share `PageHeader`, `Field`/`Input`/`Select`, `Button`, `Badge`, surface classes, and `DataTable` where applicable. The dashboard has its own local composition; settings child routes share the parent Settings heading and navigation. Only `index.css` and the dashboard-specific `Dashboard.css` define stylesheet rules in `src/`; the rest of the routes use shared styles and utility classes.

The audit identified a missing dashboard h1, invalid Tailwind opacity placeholders in plain CSS, and a nested Settings main landmark. These were corrected: the dashboard now has its page heading, theme rules use valid CSS alpha values, and Settings has one main landmark. The chart-axis fill resolves to the expected light and dark surface colors in Chromium.

Some API-backed detail and list routes were still displaying their loading branch in the short browser sampling window. Their loading, empty, and error branches were reviewed in source, but those delayed data states are not reported as visually verified. Mobile rendering beyond the dashboard and touch hardware remain unverified.

## Evidence
- `afrinov-platform/apps/frontend/src/App.tsx` (routes)
- `afrinov-platform/apps/frontend/src/hooks/useNavGroups.tsx` (menu)
- `afrinov-platform/apps/frontend/src/pages/*.tsx`
- `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx`, `NoAccess.tsx`, `RoleGuard.tsx`
