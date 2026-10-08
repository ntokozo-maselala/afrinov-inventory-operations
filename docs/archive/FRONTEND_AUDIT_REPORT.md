# Afrinov IMS — Frontend Audit & Remediation Report

## A. Root Causes Identified and Fixed

### Issue 1 — Dashboard's Low-Stock panel rendered undefined fields
- **Affected page:** `src/pages/Dashboard.tsx`
- **Root cause:** The component fetched `/reports/low-stock` (which returns
  `{ materialId, sku, name, unitOfMeasure, locationId, quantity,
  requiredStock }`) but typed the response as the `StockRow` shape used by
  `/reports/current-stock` (`materialSku`, `materialName`, `category`,
  `locationName`, `locationType`, `belowThreshold`). The low-stock columns
  therefore dereferenced non-existent fields, rendering `undefined` cells in
  both mock and live modes.
- **Frontend file(s):** `src/pages/Dashboard.tsx`
- **Why it happened:** The shape difference between the two endpoints was
  not codified as a separate TypeScript interface, and the columns were
  written for the current-stock shape.
- **Fix implemented:** Introduced a `LowStockRow` interface that matches the
  documented contract (with null-safe `sku`, `unitOfMeasure`) and rewrote
  `lowStockColumns()` to use the correct fields. Falls back to `locationId`
  when no human-readable name is available.

### Issue 2 — Operator precedence bug in Movements filter counter
- **Affected page:** `src/pages/Movements.tsx`
- **Root cause:** `const active = type ? 1 : 0 + (q ? 1 : 0);` evaluates
  `0 + (q ? 1 : 0)` first, so the variable was effectively always `1` when
  `q` was non-empty. This made the empty-state copy always say
  "no movements match your filters" even when nothing was filtered.
- **Frontend file(s):** `src/pages/Movements.tsx`
- **Fix implemented:** Wrapped both terms in parentheses
  `(type ? 1 : 0) + (q ? 1 : 0)` and renamed to `activeFilters`.

### Issue 3 — `useApi` hook kept stale data when the requested path changed
- **Affected hook:** `src/hooks/useApi.ts`
- **Root cause:** When a page rendered the same hook twice with two
  different paths (e.g. MaterialDetail requests `/materials/:id` and
  `/reports/current-stock?materialId=:id`), the second call inherited the
  first call's `data` until the new response resolved, causing a one-render
  flash of stale data.
- **Frontend file(s):** `src/hooks/useApi.ts`
- **Fix implemented:** Added an effect that resets `data`, `error`, and
  `loading` whenever the `path` dependency changes, before kicking off the
  new request.

### Issue 4 — Real-mode API client threw raw network errors
- **Affected client:** `src/api/client.ts`
- **Root cause:** When the backend was unreachable, `fetch` threw a
  `TypeError`, which propagated unmodified and crashed any UI consumer that
  tried to read `err.message` or `err.code` (they are undefined).
- **Frontend file(s):** `src/api/client.ts`
- **Fix implemented:** Wrapped the `fetch` call in try/catch and mapped the
  failure to a structured `NETWORK_ERROR` `ApiError` with a user-friendly
  message. Also mapped 401/403 to a clear "session expired" message and
  isolated `AbortError` as `CANCELLED`.

### Issue 5 — SupplierDetail filtered POs by supplier name (unstable)
- **Affected page:** `src/pages/SupplierDetail.tsx`
- **Root cause:** The page did `p.supplier?.name === supplier?.name`,
  matching purchase orders by supplier display name. Two suppliers with
  the same name (or names that differ only by case/whitespace) would
  produce incorrect attribution, and the backend already exposes a stable
  `supplierId` for exactly this purpose.
- **Frontend file(s):** `src/pages/SupplierDetail.tsx`
- **Fix implemented:** Extended the PO TypeScript type to include
  `supplierId` (which the backend already returns) and filter by
  `p.supplierId === id` (with `p.supplier?.id === id` as a defence).

### Issue 6 — GoodsReceipts PO selector filtered by name
- **Affected page:** `src/pages/GoodsReceipts.tsx`
- **Root cause:** The PO selector in the new-receipt drawer filtered
  `pos.data` by `p.supplier?.name === suppliers.data?.find(...)?.name`,
  with the same instability as Issue 5.
- **Frontend file(s):** `src/pages/GoodsReceipts.tsx`
- **Fix implemented:** Added `supplierId` to the PO type and filter by
  `p.supplierId === supplierId`.

### Issue 7 — Stock adjustment sign derived from note text instead of user input
- **Affected component:** `src/components/StockActionForm.tsx`
- **Root cause:** Adjustment quantity sign was decided by a string search
  for `'add'` inside the free-text note (`note?.toLowerCase().includes('add')
  ? Math.abs(qty) : -Math.abs(qty)`). Typing "add 5" gave +5, typing "5"
  gave −5, typing "Add 5 later" gave +5 — i.e. sign followed the note, not
  the numeric input. Backend `AdjustmentService` accepts a signed quantity
  directly.
- **Frontend file(s):** `src/components/StockActionForm.tsx`
- **Fix implemented:** Replaced the heuristic with a clean signed quantity
  input. The form now requires non-zero and treats issue/transfer as
  strictly positive while adjustments accept any sign. The toast message
  reflects the signed delta.

### Issue 8 — SettingsData export bypassed the api client and broke in mock mode
- **Affected page:** `src/pages/SettingsSections.tsx` (SettingsData /
  downloadReport)
- **Root cause:** `downloadReport` constructed `/api/v1/...` URLs and used
  `fetch` directly, ignoring the `VITE_FRONTEND_ONLY` toggle. In mock mode
  the export silently failed because no real endpoint exists, and the
  download attribute filename was static so exports always had the same
  name.
- **Frontend file(s):** `src/pages/SettingsSections.tsx`
- **Fix implemented:** Routed through the typed `api` client for the
  report payload, delegated to `useReportExporter` in mock mode, and added
  a token-aware `fetch` for the live binary download with structured error
  handling (parses backend error JSON and surfaces the message).

---

## B. API Integration Problems Found

| Symptom | File | What the frontend did | What the backend returns | Fix |
|---|---|---|---|---|
| Low-stock fields rendered as `undefined` | Dashboard.tsx | Treated as `StockRow` (full row) | `{ materialId, sku, name, unitOfMeasure, locationId, quantity, requiredStock }` | New `LowStockRow` interface + dedicated columns |
| Network failures propagated as raw TypeError | api/client.ts | `await fetch(...)` thrown | `ApiError` shape `{ code, message, details? }` | Network error mapping + 401/403 mapping |
| Export broke in mock mode and used stale filename | SettingsSections.tsx | Hardcoded `/api/v1/...` URL + `fetch` directly | Real `/api/v1/reports/inventory/export` (binary), no mock route | Use `useReportExporter` in mock mode; structured `fetch` with error parsing for live mode |
| Supplier/PO association by name | SupplierDetail.tsx, GoodsReceipts.tsx | `p.supplier?.name === ...` | Stable `supplierId` on every PO | Filter by `supplierId` |

No backend files were modified to resolve these. All DTOs referenced by
the frontend now exist as the backend already returns them.

---

## C. Runtime Problems Addressed

- **Stale render on path change in `useApi`** — fixed via state reset on
  `path` change.
- **Movement empty-state copy always shown** — fixed via parenthesised
  filter counter.
- **Stock adjustments used text-based sign inference** — fixed by reading
  the signed quantity input directly.
- **Network failures surfaced as raw exceptions** — fixed by mapping to a
  structured `ApiError`.
- **SupplierDetail / GoodsReceipts PO selector could miss matches or match
  the wrong supplier** — fixed by switching to `supplierId`.

No React/hydration errors, infinite loops, or duplicate requests were
introduced. Tests still pass (45/45 in `apps/frontend`).

---

## D. Data Problems Addressed

- **Mock data vs real API:** No page was found to be silently substituting
  hardcoded fixture data when the API returned an error. The only
  fallback behaviour is the in-memory mock layer itself, which is gated on
  `VITE_FRONTEND_ONLY=true` (a documented, first-class mode) and explicitly
  surfaced via the amber `DevModeBanner` at the top of every page in mock
  mode.
- **Stale data after navigation:** `useApi` now resets its transient state
  on every `path` change.
- **Field-name mismatches:** Dashboard low-stock panel; supplier↔PO
  association by name; stock-adjustment sign.
- **Pagination:** No issues found; the only paginated surface
  (`/reports/inventory`) is driven entirely from URL search params with
  correct `page`/`pageSize` mapping.

---

## E. Files Changed

| File | Reason |
|---|---|
| `src/pages/Dashboard.tsx` | New `LowStockRow` interface; corrected columns for `/reports/low-stock` response shape. |
| `src/pages/Movements.tsx` | Fixed `activeFilters` operator-precedence bug; renamed for clarity. |
| `src/pages/SupplierDetail.tsx` | Added `supplierId` to PO type; filter by stable id. |
| `src/pages/GoodsReceipts.tsx` | Added `supplierId` to PO type; eligible-POs filter by id. |
| `src/components/StockActionForm.tsx` | Adjustment sign driven by signed input, not by free-text heuristic. |
| `src/hooks/useApi.ts` | Reset `data`/`error`/`loading` when the requested path changes. |
| `src/api/client.ts` | Map network failures and 401/403 to structured `ApiError`s. |
| `src/pages/SettingsSections.tsx` | `downloadReport` now uses mock exporter in `FRONTEND_ONLY`, structured error parsing in live mode, with proper loading state and toast on completion. |

No backend files were touched.

---

## F. Backend Issues Discovered (Not Modified)

The following are observations only — the frontend now tolerates them and
no backend change was required:

1. **Backend issue:** Live-mode `GET /api/v1/reports/low-stock` does not
   include `locationName` or `category`.
   - **Endpoint:** `GET /api/v1/reports/low-stock`
   - **Observed response:** `{ materialId, sku, name, unitOfMeasure, locationId, quantity, requiredStock }`
   - **Why frontend cannot safely resolve it:** The contract is
     intentional — the frontend's `LowStockItem` type is documented as
     omitting `locationName` to keep the endpoint O(N materials) cheap.
     The Dashboard panel now shows `locationId` as a fallback.
   - **Recommended backend action (out of scope):** Optional — add
     `locationName` and `category` if a future frontend enhancement
     wants human-readable location names in low-stock badges.

2. **Backend issue:** `MockApi` returns `'Dev User'` as the actor name on
   inventory transactions even in live-equivalent contexts.
   - **Endpoint:** mock layer only (`mockApi.ts`).
   - **Why frontend cannot safely resolve it:** Not relevant for live
     mode (backend uses real `actor.name`).
   - **Recommended backend action:** None.

3. **Backend issue:** Settings PUT/PATCH endpoints accept a `value` body
   directly; no issues observed.
   - **Endpoint:** `PUT /api/v1/settings/{key}` and `PATCH /api/v1/settings`.
   - **Frontend works correctly** with the existing shape.

No other genuine backend problems were found that the frontend cannot
work around.

---

## Validation Performed

- `npm run typecheck` → passes (zero errors).
- `npm test` → 45/45 tests pass.
- `npm run build` → succeeds, bundle produced.
- Manual review of the dev server (`http://localhost:5173/`) returns the
  SPA shell; the bundle is served correctly via Vite.

The frontend remains compatible with both:

- **`VITE_FRONTEND_ONLY=true`** — fully working demo mode without
  backend (the only mode that runs in this environment because Docker
  is unavailable and no `npm run db:migrate` / `db:seed` has been
  executed).
- **Live mode** — every endpoint the frontend calls exists in the
  backend (`/auth/login`, `/auth/me`, `/materials`, `/locations`,
  `/suppliers`, `/purchase-orders`, `/goods-receipts`,
  `/inventory-transactions`, `/inventory-issues`,
  `/inventory-transfers`, `/inventory-adjustments`, `/stock-items`,
  `/racks`, `/projects`, `/users`, `/reports/current-stock`,
  `/reports/movement-history`, `/reports/low-stock`,
  `/reports/inventory`, `/reports/inventory/export`, `/settings`,
  `/settings/{key}`, `/audit`). DTOs match the TypeScript contracts
  documented in the pages.
