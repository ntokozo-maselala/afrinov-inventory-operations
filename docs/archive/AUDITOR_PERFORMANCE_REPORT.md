# Performance & Resource-Efficiency Audit Report
## Afrinov Inventory & Operations Platform — v0.1.0

**Date:** 2026-09-09
**Scope:** Full-stack audit of `apps/backend` (Fastify + Prisma + PostgreSQL) and `apps/frontend` (Vite + React 18 + TailwindCSS)
**Auditor:** Automated Code & Build Analysis

---

## 1. Executive Summary

The platform is architecturally sound — a modular monolith with a clean separation of concerns, ADR-002 compliant immutable ledger, and well-structured services. Both apps typecheck cleanly, lint passes (18 minor warnings), and all 170 tests pass. However, significant performance and resource-efficiency issues exist across all layers:

| Severity | Count | Category |
|----------|-------|----------|
| **Critical** | 3 | Bundle size, algorithmic complexity, unbounded queries |
| **High** | 5 | Missing indexes, no caching, no code splitting, excessive DB round-trips |
| **Medium** | 8 | N+1 settings queries, full-table eager loads, no request compression |
| **Low** | 4 | Lint warnings, unused variables, redundant re-renders |

**Estimated impact of fixes:** Frontend Time-to-Interactive reduction of 60-80% (bundle 1.5MB → ~300KB), report endpoint latency reduction of 70-95% for large datasets, backend throughput improvement of 2-3x under concurrent load.

---

## 2. Build & Bundle Analysis

### 2.1 Frontend Bundle

| File | Size (raw) | Size (gzip) |
|------|-----------|-------------|
| `dist/assets/index-mKDFMYyS.js` | **1,548,061 bytes (1.5 MB)** | **371 KB** |
| `dist/assets/index-zk2hGT2o.css` | 45,610 bytes | 7.5 KB |
| `dist/index.html` | 742 bytes | 440 bytes |

**Build time:** 3.36s (CSS transform = 1.4s, 33% of total)
**Modules transformed:** 79
**Plugins:** 39% of build time spent in plugin hooks

#### Critical Issue: ExcelJS Bundled in Production

The entire 1.5 MB bundle is essentially ExcelJS (`exceljs/dist/exceljs.min.js`). The file is imported statically in `apps/frontend/src/api/exportReport.ts:14`:

```typescript
import ExcelJS from 'exceljs';
```

ExcelJS is a server-side Node.js library for reading/writing Excel files. It is **only used in `FRONTEND_ONLY` (mock) mode** for client-side XLSX generation. In real-backend mode, the backend API streams the generated file. The static import means ExcelJS is always bundled regardless of deployment mode.

**Security concern:** ExcelJS uses `eval()` internally (`exceljs.min.js` line 1065249), flagged by Rolldown as a security risk.

**Fix:** Convert to dynamic `import()`:
```typescript
// Only load ExcelJS when actually needed (mock mode + XLSX format)
const ExcelJS = await import('exceljs');
```
Additionally, configure Vite with `build.commonjsOptions` and `resolve.fallback` to exclude `exceljs` from the production bundle, or split it into a lazy-loaded chunk.

#### No Code Splitting

The Vite config (`apps/frontend/vite.config.ts:1-12`) has no `build` section whatsoever. There is:
- No `manualChunks` for route-based or vendor-based code splitting
- No `rollupOptions` / `rolldownOptions` configuration
- No `outDir` or `emptyOutDir` setting
- No CSS code splitting config

**Fix:** Add a `build` section with code splitting:
```typescript
build: {
  chunkSizeWarningLimit: 500,
  reportCompressedSize: true,
  sourcemap: true,
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ['react', 'react-dom', 'react-router-dom'],
        excel: ['exceljs'],  // lazy-loaded only
      },
    },
  },
},
```

### 2.2 Backend Build

- Build command: `tsc -p tsconfig.json` (no bundling/transpilation beyond tsc)
- Output: `dist/` — 52 files, 332 KB total
- TypeScript config: `isolatedModules: true`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `strict: true`
- No minification (expected for server-side, but worth noting)

### 2.3 Tailwind CSS

Content paths are correctly configured (`content: ['./index.html', './src/**/*.{ts,tsx}']`), so unused CSS is purged. The 45.6 KB CSS is a reasonable output for the design token system.

---

## 3. Linting & Type Safety

| App | Errors | Warnings | Typecheck |
|-----|--------|----------|-----------|
| Frontend | 0 | 18 (all unused vars) | Clean |
| Backend | 0 | 0 | Clean |

**Frontend lint warnings (18)** — all `@typescript-eslint/no-unused-vars`:
- `auth.tsx:24` — `landingPathFor` imported but unused (re-exported, false positive)
- `Toast.tsx:1` — `useEffect` unused
- `demoAuth.ts:18` — `env` variable unused
- `GoodsReceipts.tsx:2` — `Link` unused
- `InventoryReport.tsx:485` — `inner` unused
- `MaterialDetail.tsx:8` — `Icon` unused
- `Movements.tsx:9` — `Badge` unused
- `PurchaseOrderDetail.tsx` — `emptyShip`, `emptyDeliver`, `poId` unused (3)
- `Settings.tsx:2` — `Navigate` unused
- `Signup.tsx:23` — `SIGN_IN_TITLE` unused
- `Stock.tsx` — `Field`, `ConfirmDialog`, `api`, `ApiError`, `Material`, `Location` unused (6)

These are minor code-quality issues that indicate dead code or incomplete refactors.

---

## 4. Test Coverage

| App | Test Files | Tests | Status |
|-----|-----------|-------|--------|
| Frontend | 5 | 45 | All passing (2.09s) |
| Backend | 15 | 125 | All passing (18.76s) |
| **Total** | **20** | **170** | **All passing** |

**No performance, load, or benchmark tests exist.** The backend tests use a real (test) database with HTTP-level integration tests. Response times observed during test runs:
- `GET /health` → 5.57ms
- `POST /auth/login` (401) → 0.88ms
- `GET /materials` (401) → 5.88ms
- `GET /users` (403) → 3.85ms

These are single-request benchmarks with trivial data. No concurrent load testing has been performed.

---

## 5. Backend Performance Issues

### 5.1 O(N²) Algorithmic Complexity in Report Generation

**File:** `apps/backend/src/modules/reporting/report.service.ts` (lines 276-598)

The `ReportService.inventory()` method builds a comprehensive inventory report used by the dashboard, inventory report page, and export endpoints. It contains multiple O(N²) loops:

#### Issue 1: Linear scan per material for balances (line 308)
```typescript
const myBals = Array.from(balancesByKey.values())
  .filter((b) => b.materialId === m.id);  // O(M) per material → O(N×M) total
```
For each material, it iterates ALL balance rows. With 1,000 materials and 10,000 balances, this is 10 million iterations.

**Fix:** Build a `Map<string, BalanceRow[]>` keyed by `materialId` upfront: O(N+M).

#### Issue 2: Linear scan per material for category breakdown (line 454-467)
```typescript
for (const m of materials) {
  const lines = allLines.filter((l) => l.materialId === m.id);  // O(K) per material
```
Same pattern — filters ALL lines for EACH material. With K=N lines, this is O(N²).

**Fix:** Pre-build `Map<string, ReportInventoryLine[]>` from `allLines`.

#### Issue 3: Supplier breakdown nested loops (line 498-547)
Two nested O(N²) operations:
- Line 504-517: For each supplier's material, scans all lines AND calls `Array.from(supplierMaterialMap.values()).filter((s) => s.has(mid))` which iterates ALL suppliers per material: O(S × M × S)
- Line 528-538: For each unassigned material, scans all lines again: O(N × K)

**Fix:** Pre-build a reverse `Map<string, string[]>` (materialId → supplierIds) and use the same `Map<string, ReportInventoryLine[]>` from fix 2.

#### Issue 4: No early `alertsOn` check (reporting.service.ts:101-120)
```typescript
async lowStock() {
  const [balances, multiplier, alertsOn] = await Promise.all([...]);
  // ... fetch all materials and locations ...
  if (!alertsOn) return [];  // Checked AFTER fetching everything
}
```
When stock alerts are disabled, all data is still fetched and processed before the early return.

**Fix:** Move the `alertsOn` check before fetching materials and locations.

### 5.2 Excessive `SettingsService.getValue()` DB Round-Trips

**File:** `apps/backend/src/modules/settings/settings.service.ts:298-308`

`getValue<T>(key)` executes a separate `prisma.setting.findUnique({ where: { key } })` query for each call. In hot paths:

- `ReportingService.currentStock()` (reporting.service.ts:29-30): 2 individual queries for `inventory.lowStockMultiplier` and `inventory.enableStockAlerts`
- `ReportingService.lowStock()` (reporting.service.ts:104-105): 2 individual queries (same keys)
- `InventoryService.issue()` (inventory.service.ts:234,270): 2 individual queries
- `InventoryService.adjust()` (inventory.service.ts:347): 1 query

Each request that hits a reporting endpoint incurs 2 sequential DB round-trips just for settings. The `SettingsService` already has a `getValues()` method (line 311-321) that batches these, but it's not used in these hot paths.

**Fix:** Replace individual `getValue` calls with a single `getValues` batch call, or implement an in-memory cache for settings (they change infrequently).

### 5.3 Eager Loading of Full Table Rows

**`reporting.service.ts:70-79` (movementHistory):**
```typescript
const trx = await prisma.inventoryTransaction.findMany({
  where,
  include: {
    material: true,    // ALL columns from Material
    location: true,    // ALL columns from Location
    actor: { select: { id: true, name: true, email: true } },
  },
  orderBy: { postedAt: 'desc' },
  take: Math.min(filter.limit ?? 200, 1000),
});
```
`material: true` and `location: true` fetch ALL columns (12+ fields including address, contact info, notes, etc.) when only `sku`, `name`, `category` from material and `name` from location are needed.

**`inventory.service.ts:104-113` (queryHistory):**
Same pattern:
```typescript
include: {
  material: true,  // ALL material columns — needs only sku, name, category
  location: true,  // ALL location columns — needs only name
  actor: { select: { id: true, name: true, email: true } },
}
```

**Fix:** Replace `include: { material: true }` with `include: { material: { select: { sku: true, name: true, category: true } } }` and similarly for location.

### 5.4 `postGoodsReceipt` N Sequential `recomputeBalance` Calls

**File:** `apps/backend/src/modules/inventory/inventory.service.ts:389-460`

```typescript
for (const line of gr.lines) {
  // ... create transaction ...
  await recomputeBalance(line.materialId, line.locationId, tx);  // N sequential round-trips
}
```

Each `recomputeBalance` call executes `tx.inventoryTransaction.aggregate({ where: { materialId, locationId }, _sum: { quantity: true } })` — a DB round-trip. For a goods receipt with 50 lines, this is 50 sequential aggregate queries plus 50 upserts.

**Fix:** Batch balance recomputation — collect unique (materialId, locationId) pairs, compute aggregates in a single query, then batch upsert.

### 5.5 Auth Revalidation on Every App Start

**File:** `apps/frontend/src/auth.tsx:95-118`

The `AuthProvider` calls `GET /auth/me` on mount to revalidate the JWT. While this is standard, there's no token refresh mechanism — the JWT expires after 12h (`expiresIn: '12h'` in server.ts:53) and users are silently logged out without refresh.

The persisted session in `sessionStorage` avoids the flash, but the revalidation call still adds latency to every app startup.

**Noted but lower priority:** JWT refresh is a feature gap rather than a performance issue.

---

## 6. Frontend Performance Issues

### 6.1 No Request Caching or Deduplication

**File:** `apps/frontend/src/hooks/useApi.ts:1-47`

The `useApi` hook is a bare wrapper around `fetch`:
- **No caching** — navigating away and back to a page re-fetches all data
- **No request deduplication** — if multiple components call `useApi('/reports/current-stock')`, multiple identical HTTP requests are fired
- **No stale-while-revalidate** — no background data refresh strategy
- **No request timeout** — requests can hang indefinitely

**Dashboard.tsx:50-54** fires 4 parallel unpaginated requests on mount:
```typescript
const stock = useApi<StockRow[]>('/reports/current-stock');
const low = useApi<LowStockRow[]>('/reports/low-stock');
const moves = useApi<MovementRow[]>('/inventory-transactions?limit=8');
const pos = useApi<POO[]>('/purchase-orders');  // ALL POs, unbounded
```

The `/purchase-orders` call has no limit parameter — it fetches every PO with all their lines. The `/reports/current-stock` and `/reports/low-stock` calls fetch ALL inventory balances (see §5.4).

**Fix:** Implement SWR-style caching (e.g., `swr` or `react-query`), add request deduplication, and add server-side pagination to unbounded endpoints.

### 6.2 No List Virtualization

**File:** `apps/frontend/src/components/DataTable.tsx:1-76`

The `DataTable` component renders all rows into the DOM at once:
```typescript
{!isLoading && rows.map((row, i) => (
  <tr key={rowKey(row, i)} ...>
    {columns.map((c) => (
      <td key={c.key}>{c.render(row, i)}</td>
    ))}
  </tr>
))}
```

For a table with 500 rows and 8 columns, this creates 4,000 DOM nodes. This causes:
- Slow initial render
- Janky scrolling
- High memory usage
- Layout thrashing on sort/filter

The skeleton loading also creates `loadingRows × columns` DOM nodes (default `loadingRows=6`, but can be higher).

**Fix:** Integrate `react-window` or `react-virtualized` for virtualized rendering. Only render the visible viewport rows.

### 6.3 `GlobalPreferencesApplier` Makes an API Call on Every Navigation

**File:** `apps/frontend/src/components/GlobalPreferencesApplier.tsx:8-36`
**File:** `apps/frontend/src/App.tsx:84-91`

`GlobalPreferencesApplier` is mounted inside the `Protected` route component (App.tsx:86), which wraps every protected route via `<Outlet />`. On every navigation between protected routes, React unmounts and remounts this component, triggering:

```typescript
api.get<{ 'appearance.theme'?: string; 'appearance.density'?: string }>(
  `/settings/values?keys=${THEME_KEYS.join(',')}`
);
```

This means every page navigation makes an unnecessary settings API call. The `Protected` component is re-created on each render because it's an inline function component, causing the `useEffect` to run each time.

**Fix:** Move `GlobalPreferencesApplier` outside the route outlet (mount once at app root inside `Protected`), or use the existing `SettingsProvider` context instead of a separate API call.

### 6.4 Duplicate Client-Side Filtering in Dashboard

**File:** `apps/frontend/src/pages/Dashboard.tsx`

The purchase orders are fetched in full (all POs), then filtered twice:
- Line 60: `pos.data.filter(...)` for `openPOs` count
- Line 100: `pos.data.filter(...)` for the displayed list

Both filter operations run on every render with identical predicate logic. With 1,000 POs, this is 2,000 filter iterations per render.

**Fix:** Memoize the filtered result with `useMemo`, or push the filtering to the backend via query parameters.

### 6.5 Mock API Uses O(N) Linear Lookups

**File:** `apps/frontend/src/mock/mockApi.ts:101-109`

```typescript
function findMaterial(id: string): MockMaterial | undefined {
  return state.materials.find((m) => m.id === id);  // O(N) per call
}
```

`findMaterial`, `findLocation`, and `findSupplier` perform O(N) linear scans on every call. These are invoked inside `.map()` callbacks on PO lines, GR lines, and transaction enrichment:

```typescript
lines: po.lines.map((l) => ({ ...l, material: findMaterial(l.materialId) }))  // O(L × M)
```

**Impact:** Only affects frontend-only mock mode, but with large mock datasets this causes noticeable UI lag.

**Fix:** Build `Map<string, MockMaterial>` lookup maps once and reuse.

### 6.6 Redundant `JSON.parse(JSON.stringify())` Deep Clones

**File:** `apps/frontend/src/mock/mockApi.ts:66-67,77`

```typescript
purchaseOrders: JSON.parse(JSON.stringify(SEED_PURCHASE_ORDERS)),
goodsReceipts: JSON.parse(JSON.stringify(SEED_GOODS_RECEIPTS)),
racks: JSON.parse(JSON.stringify(SEED_RACKS)),
projects: JSON.parse(JSON.stringify(SEED_PROJECTS)),
mockUsers: JSON.parse(JSON.stringify(SEED_USERS)),
```

Deep cloning via `JSON.parse(JSON.stringify())` is expensive for large objects. This runs on every `createMockApi()` call (i.e., every time the app mounts in mock mode).

**Fix:** Use a structured clone (`structuredClone()`) or a shallow clone with lazy deep-copy on mutation.

---

## 7. Database Performance Issues

### 7.1 Missing Indexes

The Prisma schema (`apps/backend/prisma/schema.prisma`) and migration SQL are mostly well-indexed, but several foreign-key columns used in joins and filters are missing indexes:

| Table | Column | Used By | Impact |
|-------|--------|---------|--------|
| `purchase_order_lines` | `material_id` | `loadSuppliersForMaterials`, `report.service.ts:359` | O(N) scan per report generation |
| `purchase_order_lines` | `purchase_order_line_id` (self-ref in goods_receipt_lines) | `postGoodsReceipt` lookups | O(N) scan |
| `goods_receipt_lines` | `material_id` | Reporting joins | O(N) scan |
| `goods_receipt_lines` | `location_id` | Reporting joins | O(N) scan |
| `inventory_balances` | `material_id` | Filter by material in `currentStock`/`lowStock` | O(N) scan (compound PK `material_id, location_id` exists, but queries filtering by `material_id` only benefit from the PK prefix — this is acceptable) |
| `purchase_orders` | `created_by_id` | Audit/user-based queries | O(N) scan |
| `users` | `active` | Filtering active users | O(N) scan |

**Fix:** Add indexes for `material_id` on `purchase_order_lines` and `goods_receipt_lines`, and for `created_by_id` on `purchase_orders`.

### 7.2 No Pagination on Reporting Endpoints

| Endpoint | Limit? | Returns |
|----------|--------|---------|
| `GET /api/v1/reports/current-stock` | ❌ No | ALL inventory balances + ALL materials + ALL locations |
| `GET /api/v1/reports/low-stock` | ❌ No | ALL balances + ALL materials + ALL locations (then filters in memory) |
| `GET /api/v1/reports/movement-history` | ✅ Yes (max 1000) | 200 by default, capped at 1000 |
| `GET /api/v1/inventory-transactions` | ✅ Yes (max 1000) | Capped |
| `GET /api/v1/reports/inventory` | ✅ Yes (page/pageSize) | 200 per page (default pageSize=200) |
| `GET /api/v1/purchase-orders` | ❌ No | ALL POs with all lines |

The `current-stock` and `low-stock` endpoints are called by the **Dashboard** on every page load. With 10,000 materials across 500 locations, these endpoints return 10,000+ rows each, causing:
- Large JSON payloads (megabytes)
- Slow Prisma query execution
- High memory usage on both server and client

**Fix:** Add `page`/`pageSize` pagination parameters to `/reports/current-stock` and `/reports/low-stock`, and to `GET /api/v1/purchase-orders`.

### 7.3 `SettingsService.getValue()` N+1 Queries

Each `getValue()` call is a separate DB query (see §5.2). In the reporting path, every `currentStock` request costs 2 extra sequential DB round-trips. With `getValues()` available (batching in a single query), this is a 2x latency reduction per request.

### 7.4 No Connection Pool Configuration

**File:** `apps/backend/src/shared/db.ts:9-13`

```typescript
new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
```

No `connection_limit`, `pool_max`, or other pool settings. Prisma defaults to `connection_limit: max(10, DATABASE_URL.pool_max)` for PostgreSQL, which may be insufficient under high concurrency (many simultaneous reporting requests).

---

## 8. Runtime & Infrastructure Issues

### 8.1 No Response Compression

The Fastify server (`apps/backend/src/server.ts:28-36`) does not register `@fastify/compress` or any compression middleware. JSON API responses — especially the unpaginated `current-stock` and `inventory` report endpoints — could benefit from gzip/brotli compression, reducing payload sizes by 70-90%.

### 8.2 No Rate Limiting

No rate limiting middleware (e.g., `@fastify/rate-limit`) is configured. The reporting endpoints, which are computationally expensive (O(N²) processing), are vulnerable to abuse or accidental repeated calls.

### 8.3 No Security Headers

No Helmet or equivalent security headers are configured:
- Missing `X-Content-Type-Options: nosniff`
- Missing `X-Frame-Options: DENY`
- Missing `Content-Security-Policy`
- Missing `Strict-Transport-Security`

### 8.4 CORS Configuration Risk

**File:** `apps/backend/src/server.ts:47`
```typescript
const corsOrigin = config.nodeEnv === 'development'
  ? true
  : process.env.CORS_ORIGIN?.split(',') ?? false;
```

In production, if `CORS_ORIGIN` is not set, `false` is passed to `@fastify/cors`, which means **CORS is disabled**. If the frontend is served from a different origin than the backend, all requests will fail. If the frontend and backend are served from the same origin, this is fine but the configuration is fragile and undocumented as a deployment requirement.

### 8.5 No Health Check Cache

The `/health/ready` endpoint (`server.ts:89-97`) runs `SELECT 1` on every check. If a load balancer health-checks every 5 seconds, this adds 2 DB queries per second. While trivial, it's unnecessary — the check should be cached or use a lighter mechanism.

---

## 9. Resource Efficiency Summary

### Memory
- **Frontend:** 1.5MB initial JavaScript download + parse/compile cost. ExcelJS alone accounts for ~1.4MB.
- **Backend:** Full-table eager loads (`material: true`, `location: true`) load all columns into memory. The `currentStock` and `lowStock` methods load entire tables into memory then filter.
- **Mock layer:** `JSON.parse(JSON.stringify())` deep clones on initialization create unnecessary garbage.

### CPU
- **Backend report generation:** O(N²) loops in `report.service.ts` cause CPU-bound report generation that scales quadratically.
- **Frontend rendering:** No virtualization in `DataTable` causes O(N) DOM node creation for large lists.
- **Mock layer:** O(N) linear lookups in tight loops cause O(N²) mock query processing.

### Network
- **Frontend:** 1.5MB initial bundle download dominates. Unbounded API responses (current-stock, low-stock, purchase-orders) cause multi-megabyte JSON transfers.
- **Backend:** No compression middleware multiplies network usage by 3-5x. Sequential `SettingsService.getValue()` calls add 2 extra round-trips per reporting request.

### Database
- **Connection pool:** Uses Prisma defaults with no tuning.
- **Missing indexes:** Several FK columns used in joins lack indexes.
- **Excessive queries:** `getValue()` N+1 pattern, `recomputeBalance` N queries in `postGoodsReceipt`.
- **Unbounded transactions:** Reports fetch all rows without `LIMIT`.

---

## 10. Priority Recommendations

### P0 — Critical (fix immediately)

1. **Dynamic import ExcelJS** (`exportReport.ts:14`) — Reduces frontend bundle from 1.5MB to ~200KB. Use `await import('exceljs')` only in `FRONTEND_ONLY` mode.

2. **Replace O(N²) loops in `report.service.ts`** (lines 308, 454-467, 504-517, 534-538) — Build lookup `Map` objects once instead of repeatedly filtering arrays. Use `Map<string, BalanceRow[]>` and `Map<string, ReportInventoryLine[]>`.

3. **Add pagination to `/reports/current-stock` and `/reports/low-stock`** — These are called by the Dashboard on every load. Add `page`/`pageSize` parameters or at minimum a server-side limit.

### P1 — High (fix before production)

4. **Add Vite build optimization config** (`vite.config.ts`) — Add `manualChunks` for vendor splitting, `chunkSizeWarningLimit`, and `sourcemap`.

5. **Batch `SettingsService.getValue()` calls** — Replace individual `getValue` calls in hot paths with `getValues()` to reduce 2 sequential DB queries to 1.

6. **Add missing database indexes** — Add indexes for `material_id` on `purchase_order_lines`, `goods_receipt_lines`, and `created_by_id` on `purchase_orders`.

7. **Add `@fastify/compress`** — Enable gzip/brotli compression on the backend. A 500KB JSON response shrinks to ~50KB.

8. **Use `select` instead of `include: true`** in `reporting.service.ts:73-76` and `inventory.service.ts:106-110` — Select only needed columns from `material` and `location` instead of full rows.

### P2 — Medium (fix before scale)

9. **Implement list virtualization** in `DataTable.tsx` — Use `react-window` or `react-virtual` for large data tables.

10. **Add React Query / SWR caching** — Replace the bare `useApi` hook with a caching library for request deduplication, stale-while-revalidate, and automatic background refresh.

11. **Batch `recomputeBalance` in `postGoodsReceipt`** — Collect unique (materialId, locationId) pairs, compute aggregates in a single query, then batch upsert.

12. **Move `GlobalPreferencesApplier` outside route `<Outlet>`** — Prevent the settings API call from firing on every navigation.

13. **Add rate limiting** — Register `@fastify/rate-limit` with sensible defaults (e.g., 100 requests/minute per IP).

14. **Fix `if (!alertsOn) return []` ordering in `lowStock()`** — Move the check before fetching materials and locations.

### P3 — Low (improve quality)

15. **Fix 18 lint warnings** — Remove unused imports/variables across frontend files.

16. **Replace `JSON.parse(JSON.stringify())` in mock layer** — Use `structuredClone()` or shallow cloning with lazy deep-copy.

17. **Build `Map` lookup caches in mock layer** — Replace `findMaterial/findLocation/findSupplier` linear scans with `Map.get()`.

18. **Add connection pool configuration** — Set explicit `connection_limit` on the Prisma client.

19. **Add performance/load tests** — Use `artillery` or `k6` to benchmark report endpoints under load.

20. **Add Sentry or error tracking** — For production observability.

---

## 11. Verification Steps

After implementing fixes, verify with:

1. **Bundle analysis:** `npm run build` → verify JS bundle < 400 KB
2. **Report performance:** Load test `/reports/inventory` with 10,000 materials / 100,000 transactions → target < 2s
3. **Dashboard load:** Browser DevTools → Network tab → verify 4 parallel requests < 500ms total
4. **Table rendering:** 1,000-row DataTable → smooth 60fps scrolling
5. **Memory:** Chrome DevTools → Memory tab → verify no memory growth on navigation loops

---

## 12. Files Modified/Reviewed

**Files audited (build/lint/test):**
- `apps/frontend/package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`
- `apps/backend/package.json`, `tsconfig.json`, `schema.prisma`, migration SQL files

**Files audited (source code):**
- Backend: `server.ts`, `config.ts`, `db.ts`, `authorization.ts`, `report.service.ts`, `reporting.service.ts`, `inventory.service.ts`, `settings.service.ts`, `reporting.routes.ts`
- Frontend: `main.tsx`, `App.tsx`, `auth.tsx`, `client.ts`, `exportReport.ts`, `useApi.ts`, `useSettings.tsx`, `Dashboard.tsx`, `DataTable.tsx`, `AppShell.tsx`, `GlobalPreferencesApplier.tsx`, `mockApi.ts`, `report-query.schema.ts`

**Build artifacts produced:**
- Frontend: `dist/` (1.5MB JS, 45.6KB CSS)
- Backend: `dist/` (52 files, 332KB)

**Prisma:** Client generated successfully (v5.22.0)
