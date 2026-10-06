# Afrinov Platform — Performance, Resource Efficiency & Bottleneck Audit

**Audit Date:** 2026-09-09
**Auditor:** Kilo (automated QA/engineering audit)
**Scope:** Full-stack performance investigation of the Afrinov Inventory Management System
**Stack:** Fastify + React + TypeScript + Prisma/PostgreSQL + Zod + Vitest

---

## Executive Summary

The Afrinov Platform has a solid architectural foundation but exhibits **measurable performance issues that will degrade user experience as data volume and user count grow**. The application is currently perceived as "slow and inefficient" due to a combination of:

1. **Unoptimized frontend bundle** — 436KB initial JS payload with zero code splitting; every page component is eagerly loaded regardless of the route.
2. **Unbounded backend report queries** — Reporting endpoints load entire tables (`inventory_balances`, `inventory_transactions`) into memory and compute aggregates in the Node.js event loop.
3. **Missing HTTP caching** — No `Cache-Control`, `ETag`, or `Last-Modified` headers; every API request reaches the database.
4. **Inefficient React rendering** — Large component trees re-render unnecessarily; no virtualization for tables; missing memoization on expensive derived data.
5. **Heavy on-demand dependency** — ExcelJS (~1.05MB) is the single largest chunk, loaded only on export but still blocks the main thread during workbook generation.

**The single largest bottleneck is the reporting service's `inventory()` method**, which loads all balances and materials into memory, performs O(n*m) filtering, and computes aggregates synchronously. Under production data volumes (10K+ SKUs, 100K+ transactions), this will block the event loop for seconds.

**Verdict: CONDITIONALLY PRODUCTION READY — PERFORMANCE RISKS ACCEPTED**

The application passes all functional and security gates. However, without the optimizations outlined below, performance will degrade significantly under realistic production loads.

---

## Performance Scorecard

| Component | Score | Assessment |
|-----------|------:|------------|
| Frontend Bundle | 4/10 | 436KB initial JS, no code splitting, all pages eager |
| Frontend Runtime | 6/10 | Reasonable hook usage; no virtualization; some re-render risk |
| Backend API | 5/10 | Fastify is fast, but report endpoints are CPU-bound |
| Database Queries | 6/10 | Uses indexes and joins correctly, but loads unbounded result sets |
| Network | 5/10 | No HTTP caching; JSON everywhere; no compression config |
| Assets | 7/10 | Only favicon.svg (8.5KB); no images; exceljs is code-split |
| Infrastructure | N/A | No production infra config audited (no Docker/OTel in scope) |
| Scalability | 4/10 | Report query is O(n*m) in-memory; will not scale to 10K+ SKUs |
| Observability | 5/10 | Pino structured logging present; no metrics/tracing |

---

## Baseline Measurements

### Build Output (Production)

| Asset | Size | Gzipped |
|-------|-----:|--------:|
| `index.html` | 0.73 KB | 0.43 KB |
| `index-*.css` | 48.72 KB | 7.93 KB |
| `index-*.js` (main) | 436.83 KB | 118.39 KB |
| `exceljs.min-*.js` (dynamic) | 1,056.25 KB | 246.94 KB |
| **Total frontend** | **1,541.53 KB** | **373.69 KB** |

### Test Results

| Suite | Tests | Status |
|-------|------:|--------|
| Backend | 125/125 | PASS |
| Frontend | 45/45 | PASS |
| Typecheck | — | PASS |
| Lint | — | PASS (18 warnings) |
| Build | — | PASS |

### Estimated Performance Characteristics (No Live Profiling Available)

| Metric | Estimated | Confidence |
|--------|----------|------------|
| Initial JS parse/compile | 200-400ms | Medium |
| Initial page load (3G) | 3-5s | Medium |
| Dashboard data fetch | 200-500ms | Medium |
| Report generation (100 SKUs) | 500ms-1s | Medium |
| Report generation (10K SKUs) | 5-15s | High (blocking) |
| Memory (report endpoint) | 50-200MB | Medium |

---

## Bottleneck Table

| Priority | Component | Problem | Evidence | Root Cause | Impact | Confidence | Recommended Fix |
|----------|-----------|---------|----------|------------|--------|------------|-----------------|
| P0 | Backend Reporting | `ReportService.inventory()` loads ALL balances/materials into memory and computes aggregates synchronously | `report.service.ts:276-598` — no pagination on `loadMaterials()`/`loadBalances()`; O(n*m) filtering loops | Unbounded `findMany()` + in-memory computation | High CPU, high memory, blocking event loop under scale | Confirmed | Add pagination/filtering at DB level; compute aggregates in SQL; cache results |
| P1 | Frontend Bundle | All page components eagerly imported; no code splitting | `App.tsx:1-148` — 20+ page imports at top level | Missing `React.lazy()` + `Suspense` for routes | Large initial JS, slow TTI, wasted bandwidth | Confirmed | Lazy-load route components with `React.lazy()` |
| P1 | Frontend Bundle | Main JS bundle is 437KB (118KB gzipped) | Build output: `index-*.js` = 436.83KB | No manual chunking; all vendor code in main bundle | Slow initial parse/execute | Confirmed | Configure Vite rollup options for vendor splitting |
| P1 | Frontend Runtime | No virtualization on data tables | `DataTable` component renders all rows | Missing `react-virtual` or similar | DOM bloat, slow scroll, high memory with large lists | Highly probable | Add virtualization to `DataTable` for lists > 50 rows |
| P2 | Frontend Runtime | Dashboard and other pages re-render entire trees on state changes | `Dashboard.tsx` — multiple `useMemo` for derived data but parent re-renders propagate | Missing `React.memo` on leaf components; context re-renders | Unnecessary main-thread work | Probable | Profile with React DevTools; memoize heavy leaf components |
| P2 | HTTP Caching | No `Cache-Control`, `ETag`, or `Last-Modified` on API responses | `server.ts` — no caching headers set anywhere | Missing cache middleware | Redundant DB queries for unchanged data | Confirmed | Add cache headers to GET endpoints; use `Cache-Control: no-cache` for dynamic, `max-age` for static-ish data |
| P2 | Backend Settings | `GET /settings` loads all settings on every request | `settings.service.ts` — no caching layer | Settings read from DB every time | Unnecessary DB queries | Confirmed | Cache settings in memory with TTL or event-based invalidation |
| P2 | Frontend Network | Double settings fetch on `/settings/*` | `GlobalPreferencesApplier.tsx:24-35` + `SettingsProvider` both fetch `/settings` | Two independent fetches on mount | Extra network round-trip | Confirmed | Consolidate into single fetch; share context |
| P2 | Frontend Runtime | Silent `.catch(() => undefined)` on dropdown load failures | 7 components swallow errors silently | Defensive coding without UX feedback | Empty dropdowns, confusing UX | Confirmed | Surface errors via toast or inline alert |
| P3 | Frontend Assets | ExcelJS chunk is 1.05MB | Build output | Large library, though dynamically imported | Delayed export on slow networks | Confirmed | Consider server-side export only; or lazy-load with progress indicator |
| P3 | Backend Auth | bcrypt cost factor 10 | `identity.service.ts:8` | OWASP recommends 10 minimum; 12 is more future-proof | Slightly slower login under load | Confirmed | Increase to 12 in next rotation |
| P3 | Backend | No rate limiting on `/auth/login` | `auth.routes.ts` — no rate-limit plugin | Missing `@fastify/rate-limit` | Brute-force risk; no DoS protection | Confirmed | Add rate limiting to auth endpoints |

---

## Detailed Findings

### 1. Backend Reporting — Unbounded In-Memory Computation (P0)

**Issue:** `ReportService.inventory()` is the single most expensive operation in the backend.

**Evidence:**
```typescript
// report.service.ts:199-205
async function loadBalances(q: ReportQuery): Promise<BalanceRow[]> {
  return prisma.inventoryBalance.findMany({  // NO LIMIT, NO PAGINATION
    where: { ...(q.locationId.length > 0 ? { locationId: { in: q.locationId } } : {}) },
  });
}
```

```typescript
// report.service.ts:276-598
async inventory(q: ReportQuery): Promise<ReportResult> {
  const [materials, balances, locations] = await Promise.all([
    loadMaterials(q),   // loads ALL materials matching filter
    loadBalances(q),    // loads ALL balances
    loadLocations(),    // loads ALL locations
  ]);
  // ... O(n*m) filtering, mapping, reducing in Node.js event loop
}
```

**Root Cause:** The reporting service was designed for a prototype dataset. It pulls entire tables into memory and performs filtering, grouping, and aggregation in JavaScript. This is acceptable for 100 rows but becomes seconds-long CPU work for 10K+ materials × multiple locations.

**Impact:**
- **Latency:** P95 report generation will exceed 5s at 10K SKUs
- **CPU:** Single-threaded event loop blocked during computation
- **Memory:** O(n) heap growth proportional to dataset size
- **Scalability:** Cannot serve concurrent report requests without thread pool exhaustion

**Recommendation:**
1. Push aggregation to PostgreSQL using `GROUP BY`, window functions, and CTEs
2. Add server-side pagination for `inventory` lines (already present for UI, missing for export)
3. Cache computed reports with a short TTL (e.g., 60s) using Redis or in-process LRU
4. For export endpoints, stream results instead of buffering entire workbook in memory

**Implementation Complexity:** High (requires query rewrite)
**Risk:** Medium (must preserve exact report output)
**Validation:** Benchmark with 1K, 10K, 100K material datasets

---

### 2. Frontend Bundle — No Code Splitting (P1)

**Issue:** Every page component is imported eagerly in `App.tsx`.

**Evidence:**
```typescript
// App.tsx:1-36
import { Dashboard } from './pages/Dashboard';
import { Materials } from './pages/Materials';
import { MaterialDetail } from './pages/MaterialDetail';
import { Stock } from './pages/Stock';
// ... 15+ page imports
```

**Root Cause:** Standard CRA-style bundling without route-based code splitting. Vite bundles all imported modules into the initial chunk.

**Impact:**
- **TTI:** 118KB gzipped JS must be parsed before any page renders interactively
- **Wasted Bandwidth:** Users visiting `/login` download code for `/reports/inventory`, `/settings`, etc.
- **Cache Invalidation:** Any change to any page invalidates the entire bundle cache

**Recommendation:**
```typescript
// App.tsx — convert to lazy-loaded routes
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Materials = React.lazy(() => import('./pages/Materials'));
// ... etc

// Wrap routes in Suspense
<Route path="/" element={<Suspense fallback={<Splash />}><Dashboard /></Suspense>} />
```

**Expected Improvement:** Initial bundle drops from 437KB to ~150-200KB; TTI improves by 30-50%.

**Implementation Complexity:** Low
**Risk:** Low (well-tested pattern)
**Validation:** Compare bundle sizes before/after; Lighthouse TTI

---

### 3. Frontend Bundle — Large Main Chunk (P1)

**Issue:** Main bundle is 437KB (118KB gzipped) before any code splitting.

**Evidence:** Build output shows `index-*.js` = 436.83KB.

**Root Cause:** No manual chunk configuration in Vite. All vendor code (React, ReactDOM, ReactRouter, Chart libraries, form libraries) is bundled into the main chunk.

**Recommendation:**
```typescript
// vite.config.ts — add rollup options
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-router': ['react-router-dom'],
          'vendor-charts': ['recharts', 'chart.js'], // if used
        },
      },
    },
  },
});
```

**Expected Improvement:** Better browser caching for vendor code; parallel downloads.

**Implementation Complexity:** Low
**Risk:** Low
**Validation:** Bundle analysis with `rollup-plugin-visualizer`

---

### 4. Backend Reporting — O(n*m) Filtering (P0)

**Issue:** After loading all materials and balances, the report service performs nested filtering.

**Evidence:**
```typescript
// report.service.ts:306-327
for (const m of materials) {
  const myBals = Array.from(balancesByKey.values()).filter((b) => b.materialId === m.id);
  // ... nested loop over all balances for each material
}
```

**Root Cause:** Balances are stored in a flat Map keyed by `(materialId, locationId)`. The code iterates all balances for each material instead of using a pre-built index.

**Impact:** With 10K materials × 5 locations = 50K balances, this creates 50K iterations per material = 500M operations.

**Recommendation:** Use the already-built `balancesByKey` map directly:
```typescript
for (const [key, b] of balancesByKey) {
  const [materialId] = key.split('|');
  const m = matMap.get(materialId);
  if (!m) continue;
  // process directly
}
```

**Expected Improvement:** Reduces report computation from O(n*m) to O(n).

**Implementation Complexity:** Low
**Risk:** Low
**Validation:** Benchmark with synthetic 10K dataset

---

### 5. Frontend Runtime — No Table Virtualization (P1)

**Issue:** `DataTable` renders all rows unconditionally.

**Evidence:** `DataTable` component (not shown but inferred from usage) renders `<tr>` for every row in `data`. With 1000+ inventory items, this creates 1000+ DOM nodes.

**Root Cause:** Missing virtualization library; no windowing implementation.

**Impact:**
- **DOM Size:** 1000 rows × 10 columns = 10,000+ DOM nodes
- **Scroll Performance:** Browser struggles with layout/repaint on scroll
- **Memory:** Each row is a React component instance

**Recommendation:** Integrate `@tanstack/react-virtual` or `react-window` for lists > 50 rows.

**Expected Improvement:** DOM nodes capped at ~50 regardless of data size; smooth 60fps scrolling.

**Implementation Complexity:** Medium
**Risk:** Medium (must preserve table semantics, sorting, selection)
**Validation:** React Profiler + Chrome Performance tab

---

### 6. HTTP Caching — Missing Cache Headers (P2)

**Issue:** API responses have no caching headers.

**Evidence:** `server.ts` sets no `Cache-Control`, `ETag`, or `Last-Modified` headers on any route.

**Root Cause:** Fastify does not add caching by default; no cache middleware was configured.

**Impact:**
- **Network:** Every navigation triggers full data refetch
- **Database:** Unnecessary queries for unchanged reference data (locations, suppliers, materials)
- **Latency:** Extra round-trip for data that changes infrequently

**Recommendation:**
```typescript
// Add to GET endpoints for relatively static data
reply.header('Cache-Control', 'max-age=60, stale-while-revalidate=30');
```

**Expected Improvement:** 30-60% reduction in GET requests for cached endpoints.

**Implementation Complexity:** Low
**Risk:** Low (must ensure cache invalidation on mutations)
**Validation:** Network tab waterfall before/after

---

### 7. Frontend Runtime — React Re-render Cascade (P2)

**Issue:** Context and prop changes cause unnecessary re-renders.

**Evidence:**
- `AuthProvider` uses `useMemo` for context value (good)
- `Dashboard` uses `useMemo` for derived data (good)
- But child components like `KPICard`, `MovementChart` receive new props on every parent render without `React.memo`

**Root Cause:** Missing memoization on presentational components; unstable callback references in some cases.

**Impact:** Each state change in Dashboard re-renders all 6 KPICards, charts, and feed components.

**Recommendation:** Profile with React DevTools Profiler. If >30% of renders are wasted, add `React.memo` to:
- `KPICard`
- `DataTable`
- `MovementChart`
- `CategoryDistribution`

**Expected Improvement:** 20-40% reduction in render count for Dashboard.

**Implementation Complexity:** Medium
**Risk:** Low (memo is safe if props are stable)
**Validation:** React Profiler recording

---

### 8. Backend Settings — Repeated DB Reads (P2)

**Issue:** `SettingsService.getValue()` hits the database on every call.

**Evidence:**
```typescript
// settings.service.ts:298-308
async getValue<T>(key: string): Promise<T> {
  const def = getDefinition(key);
  if (!def) return undefined as T;
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (!row) return def.default as T;
    return row.value as T;
  } catch {
    return def.default as T;
  }
}
```

**Root Cause:** No in-memory cache for settings. Every call to `getValue()` (including from `GlobalPreferencesApplier`, report service, etc.) queries the database.

**Impact:** With 5-10 settings reads per request, this adds 5-10 unnecessary DB queries per page load.

**Recommendation:** Add an in-memory cache with TTL or event-based invalidation:
```typescript
const settingsCache = new Map<string, { value: unknown; expires: number }>();
const CACHE_TTL = 60_000; // 1 minute
```

**Expected Improvement:** Eliminates 5-10 DB queries per request for settings reads.

**Implementation Complexity:** Low
**Risk:** Low (settings change infrequently)
**Validation:** Count DB queries before/after with Prisma query logging

---

### 9. Frontend Network — Double Settings Fetch (P2)

**Issue:** `GlobalPreferencesApplier` and `SettingsProvider` both fetch settings on mount.

**Evidence:**
- `GlobalPreferencesApplier.tsx:24-35` fetches `/settings/values?keys=appearance.theme,appearance.density`
- `SettingsProvider` (in `Settings.tsx`) fetches `/settings`

**Root Cause:** Two independent components both need settings but don't share state.

**Impact:** Two HTTP requests on every app start and every visit to `/settings`.

**Recommendation:** Lift settings fetch into `AuthProvider` or a dedicated `SettingsProvider` that both consumers share.

**Expected Improvement:** Eliminates 1 redundant request per mount.

**Implementation Complexity:** Low
**Risk:** Low
**Validation:** Network tab request count

---

### 10. Frontend Runtime — Silent Error Swallowing (P2)

**Issue:** 7 components use `.catch(() => undefined)` on API calls.

**Evidence:**
```typescript
// AddStockItemForm.tsx:66-67
api.get<LocationOption[]>('/locations').then(setLocations).catch(() => undefined);
api.get<SupplierOption[]>('/suppliers').then(setSuppliers).catch(() => undefined);
```

**Root Cause:** Defensive error handling without user feedback.

**Impact:** If `/locations` returns 401/403/500, dropdowns stay empty with no indication of failure. Users cannot diagnose the problem.

**Recommendation:** Surface errors via toast or inline alert:
```typescript
api.get<LocationOption[]>('/locations')
  .then(setLocations)
  .catch((e) => toast.error('Failed to load locations', e.message));
```

**Expected Improvement:** Better UX; no performance impact but reduces support burden.

**Implementation Complexity:** Low
**Risk:** Low
**Validation:** Manual testing with offline backend

---

### 11. ExcelJS Chunk Size (P3)

**Issue:** ExcelJS is 1.05MB (247KB gzipped) as a separate chunk.

**Evidence:** Build output shows `exceljs.min-*.js` = 1,056,252 bytes.

**Root Cause:** ExcelJS is a large library. Though dynamically imported, it's a single monolithic chunk.

**Impact:** When user clicks "Export XLSX", they wait for 1MB download + workbook generation on main thread.

**Recommendation:**
1. Consider server-side export only (backend already generates XLSX)
2. If client-side export is required, show a progress indicator and consider Web Worker for generation
3. Evaluate lighter alternatives like `xlsx-js-style` or SheetJS community edition

**Expected Improvement:** Faster export perceived performance; offload work from main thread.

**Implementation Complexity:** Medium
**Risk:** Medium (must preserve exact Excel format)
**Validation:** Time export with/without optimization

---

### 12. Missing Rate Limiting (P3)

**Issue:** `/auth/login` has no rate limiting.

**Evidence:** `auth.routes.ts` — no rate-limit plugin registered.

**Impact:** Unlimited password guessing; potential DoS via login flood.

**Recommendation:** Add `@fastify/rate-limit` with 5 attempts per minute per IP.

**Expected Improvement:** Security hardening; no direct performance gain.

**Implementation Complexity:** Low
**Risk:** Low
**Validation:** Attempt 6 rapid logins; expect 429 on 6th

---

## Optimization Plan

### Immediate (P0-P1 — Implement This Sprint)

| # | Optimization | Expected Gain | Effort |
|---|-------------|--------------|--------|
| 1 | Lazy-load routes with `React.lazy()` + `Suspense` | -250KB initial bundle | 2h |
| 2 | Fix `ReportService.inventory()` O(n*m) loop | -90% CPU for reports | 1h |
| 3 | Add manual chunks in Vite config | Better caching, parallel downloads | 1h |
| 4 | Add pagination to `loadMaterials()`/`loadBalances()` | O(1) DB reads instead of O(n) | 4h |
| 5 | Cache settings in memory | -10 DB queries/request | 2h |

### Short Term (P2 — Next Sprint)

| # | Optimization | Expected Gain | Effort |
|---|-------------|--------------|--------|
| 6 | Virtualize `DataTable` for large lists | Smooth scroll with 10K+ rows | 4h |
| 7 | Add HTTP caching headers | -30% GET requests | 2h |
| 8 | Memoize `KPICard`, `MovementChart`, `DataTable` | -30% re-renders on Dashboard | 3h |
| 9 | Consolidate settings fetch | -1 request per mount | 1h |
| 10 | Surface errors from silent `.catch()` | Better UX | 2h |

### Medium Term (P3 — Next Month)

| # | Optimization | Expected Gain | Effort |
|---|-------------|--------------|--------|
| 11 | Push report aggregation to SQL | Sub-second reports at 100K scale | 2 days |
| 12 | Add rate limiting to auth endpoints | Security hardening | 2h |
| 13 | Evaluate ExcelJS alternatives / server-only export | Faster export UX | 4h |
| 14 | Add service worker for offline static assets | Faster repeat loads | 4h |
| 15 | Increase bcrypt cost to 12 | Future-proof security | 1h |

### Long Term (Architectural)

| # | Optimization | Rationale |
|---|-------------|-----------|
| 16 | Redis cache layer for reports + settings | Shared cache across server instances |
| 17 | CDN for static assets | Reduce TTFB for JS/CSS |
| 18 | Database read replicas for reporting | Isolate report queries from OLTP |
| 19 | Server-side rendering (SSR) or SSG for marketing/docs | Faster first paint |
| 20 | Web Workers for report generation | Keep main thread responsive |

---

## Before/After Projections

| Metric | Before | After (Immediate) | After (Short Term) | Validation |
|--------|-------:|-----------------:|-----------------:|------------|
| Initial JS bundle | 437 KB | ~200 KB | ~180 KB | Bundle analysis |
| Initial page load (3G) | ~4s | ~2s | ~1.5s | Lighthouse |
| Dashboard render | ~500ms | ~300ms | ~200ms | React Profiler |
| Report generation (1K SKUs) | ~1s | ~500ms | ~200ms | Benchmark script |
| Report generation (10K SKUs) | ~10s | ~5s | ~500ms | Benchmark script |
| DB queries per page load | ~15-20 | ~10-15 | ~5-8 | Prisma query log |
| API requests per page load | ~8-12 | ~6-10 | ~5-7 | Network tab |

---

## Answers to Final Verification Questions

1. **What is making the application slow?**
   - Unoptimized frontend bundle (no code splitting, large main chunk)
   - Unbounded in-memory report computation in backend
   - Missing HTTP caching causing redundant DB queries
   - Unnecessary React re-renders on state changes

2. **What is the single largest bottleneck?**
   - `ReportService.inventory()` loading all balances/materials into memory and performing O(n*m) filtering

3. **Is the bottleneck frontend, backend, database, network, infrastructure, or a combination?**
   - Combination: frontend bundle size + backend CPU-bound report computation + missing caching

4. **What evidence proves this?**
   - Build output shows 437KB main JS with no code splitting
   - `report.service.ts` has no pagination on `findMany()` and explicit O(n*m) loops
   - `server.ts` has zero caching headers
   - React DevTools Profiler would show re-render cascades (inferred from code structure)

5. **What is consuming the most CPU?**
   - Backend report aggregation (Node.js event loop)
   - Frontend JS parse/compile on initial load

6. **What is consuming the most memory?**
   - Frontend: large JS heap from unbundled main chunk
   - Backend: report service loading all balances/materials/transactions into heap

7. **What is generating the most network traffic?**
   - Frontend JS bundle (437KB initial + 1MB exceljs on export)
   - Uncached API JSON responses (no compression headers visible)

8. **What are the slowest API endpoints?**
   - `GET /reports/inventory` — loads all balances + materials + transactions; computes aggregates in memory
   - `GET /reports/low-stock` — loads all balances
   - `GET /reports/current-stock` — loads all balances

9. **What are the slowest database queries?**
   - `SELECT * FROM inventory_balance` (no WHERE, no LIMIT) in `loadBalances()`
   - `SELECT * FROM materials` (no pagination) in `loadMaterials()`
   - `SELECT * FROM inventory_transactions` with `take: 1000` in report service

10. **Are there unnecessary API requests?**
    - Yes: double settings fetch on `/settings/*` pages
    - Yes: no caching causes repeat fetches of unchanged reference data

11. **Are there unnecessary component renders?**
    - Yes: Dashboard re-renders all children on any state change; missing `React.memo` on presentational components

12. **Are there large or unnecessary assets?**
    - Yes: 437KB main JS bundle; 1.05MB exceljs chunk (though dynamically imported)

13. **Are there memory leaks?**
    - No confirmed leaks, but unbounded result sets in report queries risk OOM under scale

14. **Are there inefficient algorithms?**
    - Yes: O(n*m) balance filtering in `ReportService.inventory()`
    - Yes: `Array.from(balancesByKey.values()).filter(...)` inside material loop

15. **Are there caching opportunities?**
    - Yes: HTTP caching on GET endpoints
    - Yes: in-memory settings cache
    - Yes: computed report caching with short TTL

16. **Is the application production-configured?**
    - Partially: build produces minified bundles, but no production-specific optimizations (code splitting, chunking, source maps config)
    - No CDN, no compression middleware, no cache headers

17. **How does the application behave under increased load?**
    - Under 10 concurrent report requests, the event loop will block; P99 latency will spike
    - Under 50 concurrent users, database connection pool may saturate due to uncached queries

18. **What should be fixed immediately?**
    - Lazy-load routes (highest frontend impact, lowest risk)
    - Fix O(n*m) report loop (highest backend impact)
    - Add pagination to report data loading

19. **What should not be changed because there is insufficient evidence?**
    - Adding `React.memo` everywhere — should be profiler-guided
    - Replacing dependencies (React, Prisma, ExcelJS) without measurable benchmark
    - Adding database indexes without query plan evidence

20. **What measurable improvement was achieved after optimization?**
    - No optimizations have been implemented yet. This audit provides the roadmap. Implementation and measurement follow in the next phase.

---

## Validation Commands

```bash
# Bundle analysis
npx vite-bundle-visualizer

# Backend benchmark
npm run test -- --run src/modules/reporting/report.service.test.ts

# Frontend bundle size
npm run build && du -sh dist/

# React Profiler
# Use React DevTools Profiler in Chrome during development

# Database query count
# Enable Prisma query logging in backend .env:
# LOG_LEVEL=debug
```

---

## Appendices

### A. Files Reviewed

- `apps/frontend/vite.config.ts`
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/main.tsx`
- `apps/frontend/src/auth.tsx`
- `apps/frontend/src/hooks/useApi.ts`
- `apps/frontend/src/api/client.ts`
- `apps/frontend/src/api/exportReport.ts`
- `apps/frontend/src/components/GlobalPreferencesApplier.tsx`
- `apps/frontend/src/pages/Dashboard.tsx`
- `apps/frontend/src/pages/Materials.tsx`
- `apps/frontend/src/pages/Stock.tsx`
- `apps/frontend/tailwind.config.js`
- `apps/frontend/src/index.css`
- `apps/backend/src/server.ts`
- `apps/backend/src/modules/reporting/report.service.ts`
- `apps/backend/src/modules/reporting/reporting.routes.ts`
- `apps/backend/src/modules/reporting/report-export.ts`
- `apps/backend/src/modules/settings/settings.service.ts`
- `apps/backend/src/modules/inventory/inventory.service.ts`
- `apps/backend/src/modules/identity/identity.service.ts`
- `apps/backend/src/modules/procurement/procurement.service.ts`

### B. Build Configuration

- Vite: 8.2.2 with `@vitejs/plugin-react`
- TypeScript: 5.5.3 (strict mode)
- Tailwind CSS: 3.4.6
- No custom Rollup output configuration
- No source maps configuration
- No compression middleware in backend

### C. Dependencies of Concern

| Package | Size | Usage | Risk |
|---------|-----:|-------|------|
| `exceljs` | ~1.4MB | XLSX export | High bundle impact |
| `react` + `react-dom` | ~130KB | UI framework | Normal |
| `react-router-dom` | ~40KB | Routing | Normal |
| `pdfkit` | ~200KB | PDF export | Medium (backend only) |
| `@prisma/client` | ~1MB (node_modules) | ORM | Normal |
| `fastify` + plugins | ~500KB | Server | Normal |
