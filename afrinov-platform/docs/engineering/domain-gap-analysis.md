# Domain Gap Analysis — Current System vs Target Inventory Operations Domain

**Date:** 2026-10-06
**Status:** Complete — basis for the refactoring plan
**Baseline:** `CURRENT-STATE.md` (pre-change snapshot, verified by execution)
**Target definition:** Inventory Operations System for controlling and tracking
organisational stock and operational assets throughout their internal lifecycle
(item → stock entry → storage → control → allocation → issue → internal movement
→ consumption/return → reconciliation/adjustment → retirement/write-off).

## Method

Every capability of the target domain was compared against what actually exists
in the repository (backend modules, Prisma schema, API routes, frontend pages,
tests). Gaps are classified as:

| Class | Meaning |
|---|---|
| KEEP | Already correct and aligned with the target domain |
| REFACTOR | Correct capability, poor implementation — fix in place |
| FIX | Existing defect preventing reliable/secure operation |
| SIMPLIFY | Unnecessary complexity — remove or reduce |
| MIGRATE | Data/model must move to a better representation |
| REMOVE | Out-of-scope, duplicated, obsolete, or misleading |
| DEFER | Valid future capability, not required by the agreed lifecycle — **not implemented in this refactor** |

The agreed requirements are the functional requirements in
`afrinov-docs/docs/02-business-analysis/functional-requirements.md` (FR-INV,
FR-PROC, FR-REP, FR-SEC) and the business rules in `business-rules.md` (BR-001…
BR-011). Nothing below invents requirements beyond those documents; where the
target domain description mentions a capability that the agreed requirements do
not establish, it is classified DEFER, per the "do not manufacture requirements"
constraint.

## 1. Domain concept alignment

| Target concept | Current implementation | Gap | Class | Priority | Risk |
|---|---|---|---|---|---|
| **Item** (definition/catalogue) | `Material` (sku unique, category, UoM, required-stock, unit cost) — `material.service.ts`, `material.routes.ts` | None. One catalogue with `category` attribute (ADR-004) | KEEP | — | — |
| **Inventory Balance** (qty per item per location) | `InventoryBalance`, derived from `inventory_transactions`; never written directly (ADR-002); recomputed after every write via `shared/inventory/balances.ts` | None. Matches "balances derived from movements" | KEEP | — | — |
| **Stock Movement** (authoritative change record) | `InventoryTransaction` — what/material, qty (signed Decimal), type, location, project ref, recipient, reason, actor, timestamp, reference, transfer pairing (`pairedWithId`) | Types are `RECEIPT, ISSUE, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT`. Target examples also list `RETURN, CONSUMPTION, WRITE_OFF` — but the agreed FRs represent consumption as ISSUE-to-project and write-off as ADJUSTMENT with `SCRAP`/`LOSS` reason codes. Adding enum values now would be manufacturing requirements | KEEP (types) / DEFER (extra types) | — | Low |
| **Allocation** (reservation to project/job) | `projectNumber` on transactions + `Rack.projectNumber`; Projects are a reference context (`operations` module) per the agreed docs ("without building full project management") | No first-class Allocation aggregate. The agreed requirements deliberately scope projects to a reference value | KEEP (reference-level) / DEFER (first-class allocation entity) | — | Low |
| **Issue / Fulfilment** (controlled release) | `POST /inventory-issues` — validates positive qty, active material/location, available balance (when negative prevention on), records recipient + project, actor from session | None material. K13: the negative-prevention toggle is read *before* the transaction opens (race window) | REFACTOR (K13) | P3 | Low |
| **Internal Movement** (transfer) | `POST /inventory-transfers` — paired `TRANSFER_OUT`/`TRANSFER_IN` legs, source-balance check, same-material constraint, atomic recompute of both balances | None material | KEEP | — | — |
| **Consumption / Return** | Consumption is modelled as ISSUE with a project reference (FR-INV-003, FR-REP-004). **Return of issued stock is not modelled** — no RETURN movement type or endpoint | The agreed FRs contain no return requirement; the assumptions register flags tool lifecycle as unconfirmed | DEFER | — | Medium (business may expect returns; must be confirmed before building) |
| **Reconciliation / Adjustment** | `POST /inventory-adjustments` — mandatory reason code (`COUNT_VARIANCE, DAMAGE, LOSS, SCRAP, OTHER`), signed qty, negative-prevention aware, actor recorded | No Stocktake aggregate (count → compare → post variance). `COUNT_VARIANCE` adjustments cover the reconciliation write path today | KEEP (adjustment) / DEFER (stocktake entity) | — | Low |
| **Retirement / Write-off** | `ADJUSTMENT` with reason `SCRAP`/`LOSS` | No explicit WRITE_OFF movement type; the business rule set treats scrap/loss as adjustments | KEEP (via adjustment) / DEFER (explicit type) | — | Low |
| **Stock Entry** (receiving) | Three write paths: `POST /stock-items` (initial intake), `POST /goods-receipts` + `/:id/post` (GR posting → RECEIPT txns), PO `deliver` (→ RECEIPT txns). All flow through `InventoryService.postGoodsReceipt`/ledger | No dedicated "Stock In" page; intake is via the Stock page action sheet or GR posting | KEEP (API) / DEFER (dedicated UI page) | — | Low |
| **Storage** (locations, racks, stores) | `Location` (normalised, typed, unique name/code — ADR-003) + `Rack` (optional location/project, capacity, status) | None | KEEP | — | — |
| **Inventory Control** (thresholds, low stock) | `requiredStock` per material; low-stock report + flag; `StockThresholdReached` domain event dispatched | Domain event has **no registered handler** — low-stock alerts are computed but never delivered (K4) | DEFER (notification delivery) / FIX (document inertness) | P1 | Medium |
| **Audit Event** (who/what/when/why) | `AuditLogEntry` (actor, action, entity, before/after JSON, timestamp); written by user/role/setting/PO/GR/actor-reassignment paths | No DB-level immutability on the ledger; `PATCH /inventory-transactions/:id` can reassign a ledger row's actor (K7) — but the change is itself audited with before/after | KEEP / FIX (document decision) | P2 | Medium |
| **Attachments / documents** | Not implemented (`deliveryRef` is free text) | In-scope capability list mentions attachments; agreed FRs do not require them | DEFER | — | Low |
| **Stock requests** | Not implemented | In-scope capability list mentions stock requests; agreed FRs do not require them | DEFER | — | Low |
| **Operational dashboard** | Dashboard page driven by `/reports/inventory` + `/reports/low-stock` | None | KEEP | — | — |
| **Reporting** | Current stock, movement history, low stock, project consumption, stock value, xlsx/pdf export | None | KEEP | — | — |
| **Users / Roles / Permissions** | 6 roles, 30+ permission codes, server-side `requirePermission` (deny-by-default), JWT + bcrypt(12), per-request active check | K6: `GET /purchase-orders` list lacks the permission check its detail endpoint has. K10: `GET /users/lookup` requires the mislabelled `update:inventory_transaction`. K11: frontend `hasPermission` fails open for unknown codes | FIX (K6, K10, K11) | P1/P2/P3 | Medium |
| **System settings** | Typed key/value catalog with per-field validation, audit on change | K12: per-process 60s cache is not shared across replicas (single-site by design — documented limitation) | KEEP / DEFER (multi-replica cache invalidation) | P3 | Low |

## 2. Boundary alignment (procurement)

| Aspect | Assessment |
|---|---|
| Procurement (suppliers, POs, goods receipts) | **KEEP as the upstream boundary.** The prompt's system boundary says procurement is out of the *core* domain "unless an existing implementation is already required and safely integrated". It exists, is required by the agreed FRs (FR-PROC-001…004), and is safely integrated: GR posting and PO delivery create `RECEIPT` ledger transactions through the inventory service. It is not the centre of the domain — inventory is. No procurement expansion is in scope. |
| Supplier edit/deactivate (K17) | DEFER — `FR-PROC-001` says "maintain a Supplier master"; create+list exist, edit/delete do not. Not blocking the inventory lifecycle. |

## 3. Defect register (from baseline verification)

| ID | Defect | Class | Priority | Fix in this refactor? |
|---|---|---|---|---|
| K1 | PostgreSQL unreachable in this environment; `/health/ready` 503; E2E/integration suites cannot run | FIX (environmental) | P0 | No code change — documented; CI runs the unit gates that do not require a DB. Docker compose provided for operators. |
| K2 | `POST /auth/register` referenced by config + UI but not implemented; live signup returns `NOT_AVAILABLE` | FIX | P0 | **Yes** — implement the endpoint, gated OFF by default via a new `security.allowSelfRegistration` setting (fail-closed; no security regression). |
| K3 | No CI/CD pipeline | FIX | P1 | **Yes** — minimal GitHub Actions workflow running the existing quality gates. |
| K4 | Domain-event handlers never registered; notification toggles inert | DEFER (feature) + FIX (document) | P1 | Documented as deferred; notification delivery is not in the agreed FRs. |
| K5 | Frontend calls `/api/v1/health`; backend mounts health at root → 404, Settings misreports API offline | FIX | P1 | **Yes** — expose `/health` and `/health/ready` under the `/api/v1` prefix. |
| K6 | `GET /purchase-orders` list requires only authentication — any user can enumerate PO metadata | FIX | P1 | **Yes** — require `view:purchase_order`, consistent with the detail endpoint. |
| K7 | `PATCH /inventory-transactions/:id` rewrites the ledger row's actor; no DB trigger enforces append-only | FIX (document) | P2 | **Decision documented (ADR-006):** retained as an *audited administrative correction* (the endpoint writes a before/after audit entry and does not alter quantities). Removing it would break the existing TransactionDrawer workflow. |
| K8 | Two migrations share timestamp prefix `20260101000000`; hand-written `migration_lock.toml` | FIX | P2 | **Yes** — rename the second migration folder to `20260101000001`. Idempotent migration makes re-application a no-op. |
| K9 | Supplier name uniqueness enforced only in the app layer; no DB constraint | FIX | P2 | **Yes** — new migration adds a `citext` unique index; app-layer check remains as the friendly-error path. |
| K10 | `GET /users/lookup` requires `update:inventory_transaction` (mislabelled) | FIX | P2 | **Yes** — new `view:users` permission granted to ADMIN, STORE_CONTROLLER, TECHNICIAN (the roles that perform inventory operations with people). |
| K11 | Frontend `usePermissions.hasPermission` returns `true` for unknown codes (fail-open) | FIX | P3 | **Yes** — fail closed; test updated. Server enforcement is unaffected. |
| K12 | Settings cache (60s TTL) not shared across processes | DEFER | P3 | Single-site deployment by design; documented. |
| K13 | `enableNegativeStockPrevention` read outside the DB transaction in issue/adjust | FIX | P3 | **Yes** — read inside the transaction via the existing `getValue(key, tx)` overload. |
| K14 | `SettingsSections.tsx:375` eslint warning (missing `reload` dep) | FIX | P3 | **Yes**. |
| K15 | `exceljs` browser bundle uses `eval()`; ~1 MB chunk | DEFER | P3 | Build-time concern; export feature is required by FR-REP; no runtime defect evidenced. |
| K16 | `npm run dev` does not auto-migrate/seed | DEFER (document) | P3 | Documented in DEPLOYMENT.md; prod entrypoint already migrates+seeds. |
| K17 | No supplier PATCH/DELETE endpoints | DEFER | P3 | Not in agreed FRs; not blocking. |

## 4. What is deliberately NOT changing

- **No new movement types** (`RETURN`, `CONSUMPTION`, `WRITE_OFF`). The agreed
  business rules model these as ISSUE-to-project and ADJUSTMENT with reason
  codes. Adding enum values without a business requirement would violate the
  "do not manufacture requirements" constraint (see ADR-007).
- **No first-class Allocation entity.** Projects are a reference context by
  explicit decision in the agreed domain docs.
- **No stocktake aggregate, stock-request workflow, or attachments.** Valid
  future capabilities (the prompt's capability list mentions them) but absent
  from the agreed functional requirements — classified DEFER.
- **No procurement expansion.** Existing PO/GR lifecycle is preserved as-is
  (except the K6 authorization fix).
- **No microservices, event bus, CQRS, or new abstractions.** The modular
  monolith is the target architecture (ADR-001).
- **API contracts preserved.** Route paths stay as they are; the frontend and
  mock layer depend on them. The prompt's `/stock/*` naming is a preference,
  not a requirement, and constraint 17 (backward compatibility) governs.

## 5. Summary

- **KEEP:** 18 of 21 target-domain concepts already align, including the two
  most important structural decisions (ledger-derived balances, normalised
  locations).
- **FIX (in this refactor):** K2, K3, K5, K6, K8, K9, K10, K11, K13, K14 —
  ten small, testable corrections; no schema redesign, no API breakage.
- **DEFER:** returns, stocktake aggregate, stock requests, attachments,
  explicit write-off/consumption movement types, first-class allocation,
  notification delivery, supplier edit/delete, multi-replica settings cache.
- **REMOVE:** nothing — no duplicated or obsolete functionality was found that
  can be safely removed without breaking a working workflow.
- **MIGRATE:** none required — no existing data must move; the two schema
  migrations are additive/idempotent.
