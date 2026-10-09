# Frontend Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Single-page application consuming the REST API (`08-api/`): React 18,
TypeScript, Vite 8, Tailwind CSS 3, React Router 7. It is organised by
technical role, not by domain feature folders:

```
afrinov-platform/apps/frontend/src/
├── main.tsx           # BrowserRouter + AuthProvider + App
├── App.tsx            # all routes; pages lazy-loaded; procurement routes gated by a flag
├── auth.tsx, auth.ts  # AuthProvider / useAuth (token, current user, login, logout)
├── pages/             # one component per screen (Dashboard, Stock, IssueStock, ReceiveStock,
│                      #   StockCount, Movements, Materials, Locations, Racks, Projects, Recipients,
│                      #   Suppliers, PurchaseOrders, GoodsReceipts, StockStatus, Consumption,
│                      #   MonthEnd, InventoryReport, Settings + SettingsSections, Login, NotFound)
├── components/        # shared UI (AppShell, Sidebar, DataTable, Modal, Field, SearchSelect,
│                      #   StockActionForm, TransactionDrawer, charts/, ui/ Radix wrappers, …)
├── hooks/             # useApi, useSettings, usePermissions, useNavGroups, useDashboardData, …
├── api/               # client.ts (fetch wrapper), authService.ts, Excel download helpers
├── config/            # features.ts (VITE_PROCUREMENT_ENABLED), demoAuth.ts, buildGuard.ts
├── lib/               # formatting, currency, stock-status and dashboard calculations
└── mock/              # in-memory API used in frontend-only mode (see FRONTEND_ONLY.md)
```

- **Data fetching:** `api/client.ts` calls `fetch('/api/v1' + path)` with
  the bearer token from `localStorage`; custom hooks wrap it. No data
  library (React Query, Redux) is used.
- **Auth state:** React context (`AuthProvider`); on load it calls
  `GET /auth/me` when a token is present.
- **Feature flags:** `VITE_PROCUREMENT_ENABLED` shows purchase orders and
  goods receipts; `VITE_FRONTEND_ONLY` swaps the API client for the mock;
  `VITE_DEMO_AUTH_ENABLED` enables a single demo login. A production build
  refuses to run with either demo flag on.
- **Planned:** a Tools (check-out/check-in) area; no such page exists.

## Evidence
- `afrinov-platform/apps/frontend/package.json`
- `afrinov-platform/apps/frontend/src/main.tsx`, `afrinov-platform/apps/frontend/src/App.tsx:15-165`
- `afrinov-platform/apps/frontend/src/api/client.ts:27-116`
- `afrinov-platform/apps/frontend/src/config/buildGuard.ts`, `afrinov-platform/apps/frontend/vite.config.ts:6-15`
