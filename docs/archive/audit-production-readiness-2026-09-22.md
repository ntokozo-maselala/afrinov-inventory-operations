# Production-Readiness Audit — Findings & Remediation

**Scope:** `afrinov-platform` monorepo — Fastify + Prisma + Zod + TypeScript backend (`apps/backend`), React 18 + Vite 8 + Tailwind 3 + React Router v7 frontend (`apps/frontend`).
**Date:** 2026-09-22 — **Status:** Code-level findings verified + runtime verification performed.
**Author:** Engineering audit (see methodology).

---

## 1. Executive summary

The codebase is well-structured and the test suite is green, but **two P0 defects make the system non-functional for its core purpose and un-deployable**:

1. **Authorization is broken across every protected write and nearly all protected reads.** Login succeeds, but any subsequent request returns `401` (write routes that never verify the JWT) or `403` (protected reads rejected because an `active` flag is never populated). In practice: the system is read-only and most reads still fail.
2. **The production deploy crashes on boot.** `docker-compose.yml` sets `JWT_SECRET=change-me-in-production` together with `NODE_ENV=production`; `loadConfig()` explicitly rejects that secret, so the backend container exits `1` immediately.

Secondary verified issues: a dead domain-event system (low-stock alerts never fire), an insecure default-allow permission helper on the client, client-side JWT storage in `localStorage`, no auth rate limiting, and dependency hygiene gaps. ESLint config is **valid** (the `react-hooks` plugin is v7.1.1, whose `immutability`/`purity`/`set-state-in-effect`/`refs` rules are real), and the previously-suspected ESLint/exceljs issues were **refuted by verification** (see §7).

---

## 2. Methodology & verification

- **Static:** full source tree reviewed (excl. `node_modules`/`dist`). Every claim below is tied to a `file:line` that was read, not inferred from `task_context.md` (which was treated as untrusted and found to contain inaccuracies — e.g. "React Router v6" when `package.json` pins `^7.18.3`).
- **Runtime (executed in this session):**
  - `apps/backend`: `npx tsc --noEmit` — **0 errors**; `npx vitest run` — **15 files / 126 tests pass**; `npx eslint src` — **0 problems**.
  - `apps/frontend`: `npx tsc --noEmit` — **0 errors**; `npx vitest run` — **9 files / 113 tests pass**; `npx eslint src` — **0 errors, 1 warning** (`react-hooks/exhaustive-deps`, `SettingsSections.tsx:375`).
- **Runtime proof of the auth bug:** the backend test server's own request logs (captured during `vitest run`) show `GET /api/v1/materials — 401` (no token) and `GET /api/v1/users — 403` (with a token) — the 403 on an authenticated request is the `active`-flag defect reproducing live.

> **Note on green tests:** the suite passing does **not** refute the headline bug — `server.test.ts:43-51` *asserts* that an authenticated request returns `403`, i.e. the test encodes the defect as expected behavior. There is no positive test for an `active:true` happy-path or an `active:false` rejection case. The backend's only auth assertion (`server.test.ts:43-51`) claims the `403` as correct, and the frontend's `auth.test.ts` covers only session-persistence helpers (`read`/`write`/`clear`/`malformed`) — no login, role-mapping, or `active` semantics. See §6.

---

## 3. P0 — Authorization is broken (writes fail with 401, protected reads fail with 403)

### 3.1 Root cause A — the JWT carries no `active` flag and `req.user` never has one

- `src/modules/identity/auth.routes.ts:18` signs the token as:
  `{ sub: user.id, email: user.email, name: user.name, roles: user.roles }`.
- `src/server.ts:55-68` `authenticate` sets `req.user = { ...payload, id: payload.sub }` — `active` is never present.
- `src/shared/authorization.ts:35-37`:
  ```ts
  const user = (req as ...).user;
  if (!user) throw Errors.unauthenticated();
  if (!user.active) throw Errors.forbidden('User inactive');
  ```
  `user.active` is always `undefined`, so every route that runs `authenticate` **then** `requirePermission` throws `403 FORBIDDEN`.

### 3.2 Root cause B — mutating routes never declare `preHandler: [app.authenticate]`

JWT verification only happens when a route opts in. The write endpoints almost universally omit it, so `req.user` is `undefined` — `requirePermission` throws `401` (unauthenticated). The login route (`POST /auth/login`, `auth.routes.ts:11`) is correctly open.

### 3.3 Blast radius (verified per route file)

**Return 403 (authenticate runs, then `active` rejects) — every `*auth* + requirePermission` GET:**
- `GET /users` (user.routes.ts:25), `GET /users/lookup` (30), `GET /users/:id` (35)
- `GET /purchase-orders/:id` (procurement.routes.ts:94), `GET /purchase-orders/:id/history` (124)
- `GET /goods-receipts` (178), `GET /goods-receipts/:id` (182)
- `GET /reports/*` all (reporting.routes.ts:21,31,44,49,59) incl. `.../export` (72)
- `GET /audit` (audit.routes.ts:18)
- `PUT /settings/:key` (settings.routes.ts:49), `PATCH /settings` (60), `POST /settings/reset` (70)
- `POST /stock-items` (stock-item.routes.ts:37) — authenticate **is** present, but both `requirePermission` calls then hit the `active` defect — 403.

**Return 401 (no `preHandler: [app.authenticate]`, so JWT is never verified):**
- `POST /users` (user.routes.ts:41), `PATCH /users/:id` (53)
- `POST /purchase-orders` (procurement.routes.ts:100), `PATCH /purchase-orders/:id` (112)
- `POST /purchase-orders/:id/{submit,approve,ship,deliver,cancel}` (130,136,142,154,166)
- `POST /goods-receipts` (188), `POST /goods-receipts/:id/post` (200)
- `POST /suppliers` (78), `POST /materials` & `PATCH /materials/:id` (material.routes.ts:43,55)
- `POST/PATCH/DELETE /locations` (material.routes.ts:116,129,142,155)
- `POST/PATCH/DELETE /racks` (rack.routes.ts:51,63,75)
- `POST/PATCH/DELETE /projects` (project.routes.ts:56,68,80)
- `POST /inventory-transactions/{issue,transfer,adjust}` & `PATCH` (inventory.routes.ts:48,60,72,84)

**Functionally work today (authenticate-only reads, no `requirePermission`):**
`GET /materials`, `GET /materials/:id`, `GET /locations`, `GET /racks`, `GET /projects`, `GET /settings` (+ `/settings/values`, `/settings/:key`), `GET /suppliers`, `GET /purchase-orders` (list — note: no permission gate, see P3), `GET /inventory-transactions`, `GET /auth/me`, `GET /health`.

> **Two distinct fixes are both required:** (a) sign `active` (and the user `id`) into the JWT and map it onto `req.user` in `authenticate`; (b) add `preHandler: [app.authenticate]` to every mutating route — the absence of which is what turns writes into `401`s even after (a) is fixed. The frontend symptom is direct fallout: the **Users** settings tab calls `GET /users` (`SettingsSections.tsx:366`), the **History** tab calls `GET /audit` (`SettingsSections.tsx:665`), and the **Data — Export** button raw-fetches `GET /reports/inventory/export` (`SettingsSections.tsx:565`) — all three return `403` in live mode and render "Couldn't load" / failed exports.

---

## 4. P0 — Production deployment crash-loops on boot

- `apps/backend/docker-compose.yml:24-25` sets `JWT_SECRET: change-me-in-production` and `NODE_ENV: production`.
- `src/shared/config.ts:21-27` places `'change-me-in-production'` in `INSECURE_SECRETS`; `loadConfig()` at `:39-44` **throws** `ConfigError` in production for any such secret.
- `src/index.ts:6-11` calls `loadConfig()` synchronously on startup and `process.exit(1)` on failure, printing `Configuration error: JWT_SECRET must be set to a strong, random value in production. The default / placeholder secret is not permitted.`
- The Dockerfile CMD is `node dist/index.js` (`apps/backend/Dockerfile:18`), so `docker compose up` exits immediately — the API never serves a request.
- **Same class of defect in `.env.example:2`:** `JWT_SECRET="change-me-in-production-please"` (a *different* placeholder, also on the reject list), so any local `.env` derived from it also fails under `NODE_ENV=production`.

**Fix:** supply a strong random secret via an environment variable or secret manager; delete the hardcoded value in `docker-compose.yml` and the `.env.example` placeholder.

---

## 5. P1 — Domain event system is dead (silent failure)

- `src/shared/events.ts:20-29`: `handlers` is a module-private `Map`; `registerDomainEventHandler` (the only writer) is **never imported or called anywhere** in `src` (grep across `src` — single match, the definition itself).
- `dispatchDomainEvents` is still invoked at `inventory.service.ts:251,305,353,433` and `stock-item.service.ts:145` — always against an empty handler list — events are silently dropped.
- `events.ts:16` declares `StockThresholdReached` (and `StockThresholdReached` is the trigger for low-stock alerting), but with no handler registered the alert pipeline never fires.
- Tests paper over it: both service test files stub `dispatchDomainEvents: async () => undefined` (inventory.service.test.ts:158, stock-item.service.test.ts:66).

**Fix:** register handlers at startup (e.g. a notifications/alerting module subscribing to `StockThresholdReached`), and add a unit test asserting a dispatched event reaches a registered handler.

---

## 6. P2 — Authorization & auth-hygiene gaps

- **Client-side default-allow:** `src/hooks/usePermissions.ts:45-55` returns `true` for any unrecognized permission code (`default: return true`). Combined with the fact that this is the *only* gate the UI consults, any new permission key the frontend doesn't know about is effectively granted. This is a privilege-escalation footgun; it must be `false` by default (deny-by-default).
- **No server-side RBAC on several read lists:** `GET /purchase-orders` (procurement.routes.ts:90), `GET /suppliers` (73), and the entire `GET /settings*` surface run `authenticate` but no `requirePermission` — any authenticated user can read all purchase orders, all suppliers, and all settings.
- **JWT stored in `localStorage`:** `src/api/client.ts:29-32` persists the bearer token in `localStorage` (and the full `AuthUser` incl. roles in `sessionStorage` at auth.tsx:51-57). Accessible to any XSS; recommend an `httpOnly`+`SameSite` cookie.
- **No brute-force protection:** `POST /auth/login` (`auth.routes.ts:11`) has no rate-limiting, lockout, or cooldown. `server.ts` registers no `@fastify/rate-limit` plugin. bcrypt cost is `10` (`identity.service.ts:8`), acceptable but combined with no lockout this is exposure.
- **Login does check `active` correctly at the door** (`identity.service.ts:20`, `!user.active` — reject), but because the JWT omits `active` and `authenticate` never re-populates it, that check is the *only* point in the request lifecycle where `active` is honoured. The post-login landing path (`authService.ts:155`) calls `GET /settings/general.defaultLandingPage`, which works only because it is `authenticate`-only — the moment the UI hits a `requirePermission` read it 403s, so the user sees a working login followed by a wall of errors.
- **Live-mode signup is unavailable** — `authService.ts:194-197` throws `{ code: 'NOT_AVAILABLE' }` because the backend exposes no `POST /auth/signup` route (signup is frontend-only / in-memory). Documented in `Signup.tsx:4-7`, so this is a prototype limitation, not a defect; flag for the production auth wiring. (The user-visible consequence of P0 — settings pages rendering "Couldn't load" for Users/History and failed Data exports — is detailed in §3.3.)

---

## 7. P2—P3 — Code-quality & duplication (verified)

- **Duplicate `recomputeBalance`:** a second, non-transactional copy lives at `src/modules/inventory/stock-item.service.ts:53` (no `Prisma.TransactionClient` parameter; uses global `prisma`). The ADR-005 canonical implementation is in `src/shared/inventory/balances.ts:6` (transaction-safe). A separately-named bulk helper `recomputeBalancesFor` exists at `src/modules/inventory/balances.ts:15` (used by the seed). The local duplicate should be deleted in favour of the shared one so balance math stays consistent.
- **Double provider mounting on protected routes:** `App.tsx:77-92` (`Protected`) mounts `<ToastProvider>` + `<GlobalPreferencesApplier>`, then `<AppShell>` mounts them **again** (`AppShell.tsx:15-26`). Symptom: duplicate toasts and a double settings fetch per navigation. Hoist both to a single root.
- **Dependency hygiene (backend `package.json`):** `react-router-dom:7.18.3` (line 28), `@fastify/cookie` (line 19), and `vite` (line 29) are declared as backend dependencies but are **never imported** in `apps/backend/src` (grep: 0 matches; only `vitest` is imported). `exceljs` (line 24) and `pdfkit` (line 26) **are** used by `report-export.ts:6-7`, so those are legitimate.
- **CORS in production:** `server.ts:47` sets `corsOrigin = development ? true : (CORS_ORIGIN?.split(',') ?? false)`. `docker-compose.yml` does not set `CORS_ORIGIN`, so production binds CORS to `false` — fine if the frontend is served same-origin, but any cross-origin client is blocked. Worth an explicit allow-list at deploy time.

---

## 8. P3 — Mock vs. backend parity gaps (verified where cited)

- **`lowStockMultiplier` is honored by the backend but ignored by the mock.** Backend `ReportingService.lowStock()` applies it: `required = m.requiredStock.mul(new Prisma.Decimal(multiplier))` (`reporting.service.ts:131`). The mock's `computeCurrentStock` compares raw values: `belowThreshold: b.quantity <= required` where `required = Number(m.requiredStock)` (`mockApi.ts:1293`, definition `computeCurrentStock` at `:1269`) — the setting exists in the mock catalog (`mockApi.ts:962`) but is never read. The two modes will disagree on which items are "low stock."
- **PO numbering source-of-truth divergence.** Backend `generatePONumber` (`procurement.service.ts:143-148`) serializes via `pg_advisory_xact_lock` and counts from the DB; the mock uses an in-memory counter (`mockApi.ts:390`: `` `PO-2026-${String(state.purchaseOrders.length + 1).padStart(4, '0')}` ``). Both are `count+1`, so the behavioral gap is concurrency-safety and persistence, not the format — acceptable for a mock, but worth noting.
- **Mock correctly mirrors the invariant on issues** but *hard-codes* it: `handleIssue` throws `INSUFFICIENT_BALANCE` when on hand is insufficient (`mockApi.ts:1125-1129`). The backend exposes no documented "allow negative stock" toggle consumed here, so this is the desired behaviour — **not** a defect (an earlier hypothesis of "mock ignores negative-stock rules" was **refuted** by reading the code).
- **`seed.ts` is idempotent** (`db/seed.ts:410`: `if (count > 0) return;`), so the compose `command` re-running `npm run db:seed` on every start (`docker-compose.yml:32`) is safe though slightly wasteful.

---

## 9. Verified non-findings / corrected claims

For transparency, claims that were investigated and **refuted** by verification:

| Claim | Verdict | Evidence |
|---|---|---|
| ESLint config references non-existent `react-hooks/immutability/purity/set-state-in-effect/refs` rules | **False** | `eslint-plugin-react-hooks` is v7.1.1, which ships all four; `npm run lint` exits clean (1 warning). |
| `exceljs` is a leaked dep on the frontend | **False** | Used at `src/api/exportReport.ts:161` (`await import('exceljs')`) for browser XLSX export. |
| Mock ignores negative-stock rules on issues | **False** | Mock enforces `INSUFFICIENT_BALANCE` at `mockApi.ts:1125-1129`. |
| `task_context.md` "React Router v6" | **False** | `package.json:25` pins `react-router-dom` `^7.18.3` (v7). |

---

## 10. Remediation priority

1. **P0a — Fix the auth contract (§3):** sign `active` + `id` into the JWT (`auth.routes.ts:18`); populate them on `req.user` (`server.ts:55-68`); add `preHandler: [app.authenticate]` to **every** mutating route (the POST/PATCH/DELETE/PUT endpoints listed in §3.3).
2. **P0b — Unblock the deploy (§4):** remove the hardcoded `JWT_SECRET` from `docker-compose.yml`; inject a strong secret; drop the `.env.example` placeholder.
3. **P1 — Wire up events (§5):** register a `StockThresholdReached` handler at startup; add a dispatch-reaches-handler test.
4. **P2 — Lock down access (§6):** make `usePermissions` default-deny; gate the open read lists with `requirePermission`; move the JWT off `localStorage` into an `httpOnly` cookie; add rate limiting to `/auth/login`.
5. **P2—P3 — Hygiene (§7§8):** delete the duplicate `recomputeBalance`; collapse the double provider mount; prune the three unused backend deps.

## 11. Test strategy for the fixes

- Add a **positive** auth test: `active:true` user with valid JWT — `200` on a protected write (e.g. `POST /materials`), replacing the current `403`-asserted case in `server.test.ts:43-51`.
- Add a **negative** auth test: `active:false` user — `403` and inactive users cannot obtain a usable session.
- Add a **missing-JWT write test**: `POST /purchase-orders` without a token — `401` (currently it would pass only because of bug B; make the assertion explicit per route).
- Add an **events integration test**: dispatch `StockThresholdReached` with a registered handler and assert it runs.
- The existing suite (126 backend / 113 frontend, all green) should remain green after the fix — the `server.test.ts:43-51` case will need to flip from asserting `403` to asserting `200` for the now-active seed user.

---

## 12. Backend-specific findings (data integrity, concurrency, database, error handling, operations)

The section above is a strong, verified diagnosis of the auth contract and the deploy crash. The deep domain-logic review below adds findings the prior audit does not cover: the inventory ledger / balance model, database constraints, Prisma error propagation, concurrency, migrations, and operational readiness. Each is anchored to a `file:line` actually read in this session.

### Finding B1 — Stock-prevention (and over-receipt) are bypassable under concurrent requests

**Severity:** High
**Category:** Correctness / Concurrency / Database
**Location:** `apps/backend/src/modules/inventory/inventory.service.ts:206-253` (`issue`), `:256-317` (`transfer`), `:319-359` (`adjust`); `apps/backend/src/shared/inventory/balances.ts:23-32` (`getCurrentBalance`); `apps/backend/src/modules/procurement/procurement.service.ts:365-437` (`postGoodsReceipt`).

**Evidence:** The balance guard reads the **materialised** `inventory_balance` row via a plain `findUnique` (`getCurrentBalance`, line 28) with no `SELECT ... FOR UPDATE`, then checks-and-writes:
```ts
const balance = await getCurrentBalance(input.materialId, input.locationId, tx);   // line 216 — stale read
if (preventNegative && balance.lt(qty)) { throw Errors.insufficientBalance(...); } // line 217 — check
... await tx.inventoryTransaction.create(...);                                       // line 224 — write
```
`currentTimestamp`/`read committed` is the default isolation (no `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` anywhere). Two concurrent `issue` calls both read the same pre-commit balance, both pass the check, both commit a negative transaction, and `recomputeBalance` (full ledger aggregate) then persists the over-drawn value.

**Problem:** The "prevent negative stock" invariant is **advisory**, not enforced. `transfer` (line 268-269) and `adjust` (line 329-336) have the identical TOCTOU. Additionally, `postGoodsReceipt` (lines 391-407) reads `poLine.receivedQty`, computes `projected`, and `updateMany({receivedQty:{increment}})` without a row lock — two concurrent receipts against the same PO line can exceed `orderedQty`.

**Why it matters:** Over-issue produces negative (incorrect) stock; over-receipt lets received quantities exceed PO lines, corrupting PO state (`FULLY_RECEIVED` computed from `receivedQty >= orderedQty`, line 424) and the inventory value on hand.

**Failure scenario:** Two warehouse operators issue 5 units each of a material that has a balance of 5. Both succeed; balance ends at -5, and re-ordering is not triggered because the material is now "in the red."

**Root cause:** Reading the materialised view instead of locking the balance row; relying on application-level read-then-write under read-committed.

**Recommendation:** Serialise the check-then-write on the `(material, location)` balance row. The minimal, standard fix is a `SELECT ... FOR UPDATE` of the `inventory_balance` row at the start of `issue`/`transfer`/`adjust`, then re-check inside the tx and recompute. For PO lines, lock the `purchase_order_lines` row (`FOR UPDATE`) before the projected check. If Prisma's client API is the constraint, an equivalent is to move the guard to a `CHECK (quantity >= 0)`-gated path gated by a feature flag, or compute the live aggregate **and** lock the balance row. A regression test that fires N concurrent issues against a fixed balance and asserts `balance >= 0` is mandatory — the present in-memory tests cannot express this (see B11).

**Trade-offs:** Row locks serialise concurrent movements on the same `(material, location)` — acceptable for warehouse workloads (low contention per bin). For global scale, switch to a streaming ledger aggregate and a DB-side guard instead of row locks.

**Priority:** P0 (data-correctness).

---

### Finding B2 — Prisma client errors are not mapped to HTTP status codes

**Severity:** High
**Category:** Error Handling / API / Correctness
**Location:** `apps/backend/src/server.ts:70-83` (error handler); every master-data `create` e.g. `apps/backend/src/modules/inventory/material.service.ts:48-51`, `:86-87`; `apps/backend/src/modules/procurement/procurement.service.ts:41-46`; `apps/backend/src/modules/operations/project.service.ts`.

**Evidence:** The global error handler distinguishes only `ApiError` (mapped to its `statusCode`) vs `Error` (— `500 INTERNAL_ERROR`):
```ts
if (err instanceof ApiError) { return reply.code(err.statusCode).send({ error: { code: err.code, ... } }); }
if (err instanceof Error) { app.log.error({ err }, 'Unhandled error'); return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', ... } }); }
```
There is **no** `PrismaClientKnownRequestError` (P2002/P2025) or `PrismaClientValidationError` translation. The unique-value services (`material`, `location`, `rack`, `project`) do an app-layer "exists?" check then `create`; under a race both pass the check and the second `create` throws `P2002` — **uncaught — 500** instead of `409 Conflict`. `findUnique`-based lookups that skip an explicit null-check surface `P2025`/FK violations as `500`.

**Problem:** Client input races and missing-reference errors are reported as `500 Internal Server Error`, masking client errors as server faults and offering no structured retry/contract for callers.

**Failure scenario:** Simultaneous `POST /materials` with the same SKU — one `201`, the other `500` (raw P2002 in logs). A `POST /projects` with a `managerId` that doesn't exist — `500` (FK violation) instead of `400`/`404`.

**Root cause:** No central Prisma-error normalisation layer.

**Recommendation:** Add an `else if (isPrismaError(err))` branch that maps `P2002` — `409 CONFLICT`, `P2025` — `404 NOT_FOUND`, `P2024`/`P2027` — `408`/`504`, and connection errors — `503`. (Keep the app-layer existence checks for friendlier messages; the mapping is the safety net.)

**Trade-offs:** Small mapping module; must be kept in sync with the Prisma version's error codes.

**Priority:** P1.

---

### Finding B3 — Supplier name has no database-level uniqueness

**Severity:** High
**Category:** Correctness / Database / Data integrity
**Location:** schema — `apps/backend/prisma/schema.prisma:168-172` (`@@index([name])`, non-unique) and `prisma/migrations/20260101000000_initial/migration.sql:322` (`CREATE INDEX "suppliers_name_idx"`, non-unique); `apps/backend/src/modules/procurement/procurement.service.ts:39-54` (check-then-create).

**Evidence:** The committed migration (`prisma/migrations/20260101000000_initial/migration.sql:322`) creates only a **non-unique** index `suppliers_name_idx`; the migration's unique-constraint section (migration.sql:291-325) declares **no** `suppliers_name_key`, and `schema.prisma` models `supplier.name` as `@@index([name])` without `@unique`. `SupplierService.create` (lines 40-44) normalises to lowercase and `findFirst`s, then `create`s — a classic check-then-act. No `@unique`, no DB constraint backs it.

**Problem:** The "no duplicate supplier names" invariant is enforced only by a racy app check. Under concurrency two requests for "Acme Fasteners" both pass and both insert — duplicate rows, diverging from `materials`/`locations`/`projects`/`racks`, which all have `@unique` constraints.

**Failure scenario:** Two buyers add the same new supplier simultaneously; the ledger and reporting then treat "Acme Fasteners" and "acme fasteners" as two entities.

**Root cause:** Missing `UNIQUE` constraint; reliance on a TOCTOU check.

**Recommendation:** Add a case-insensitive unique constraint on `supplier.name` (e.g. a `citext`-style `LOWER(name)` expression unique index, or store+index the lowercased normalised name). Map the resulting `P2002` to `409` (see B2). The app check can remain as a fast-fail for a friendly message.

**Trade-offs:** Requires a migration that de-duplicates existing rows first (a data migration); add a `0001_supplier_name_unique` migration.

**Priority:** P0 (data integrity).

---

### Finding B4 — `preventNegative` setting read outside the transaction (semantic inconsistency)

**Severity:** Medium
**Category:** Correctness / Architecture
**Location:** `apps/backend/src/modules/inventory/inventory.service.ts:210` (read before `$transaction`), `:246` (read inside `tx`); `apps/backend/src/modules/inventory/stock-item.service.ts:88` (location check before tx).

**Evidence:** `issue` (and `adjust`, line 323) reads `SettingsService.getValue('inventory.enableNegativeStockPrevention')` **before** entering `prisma.$transaction` (line 210/323), but reads `inventory.enableStockAlerts` **inside** the tx (line 246). The same setting can change mid-operation; the two reads observe different snapshots.

**Problem:** Mixing pre-tx and in-tx reads of the same config source yields inconsistency under a toggling operator and a narrow race (setting flipped between the outer read and the check).

**Failure scenario:** Operator disables negative-stock prevention at the exact moment an issue is in flight; the in-flight issue uses the stale outer value.

**Root cause:** Inconsistent placement of setting reads.

**Recommendation:** Read settings inside the transaction (pass `tx`). Settings reads are cheap and the cache (`getValue`) already supports a tx client.

**Trade-offs:** None meaningful.

**Priority:** P2.

---

### Finding B5 — Domain events dispatched inside the transaction (before-commit)

**Severity:** Medium
**Category:** Reliability / Architecture
**Location:** `apps/backend/src/modules/inventory/inventory.service.ts:251,305,353,433`; `apps/backend/src/modules/inventory/stock-item.service.ts:145`; `apps/backend/src/shared/events.ts:1-6`.

**Evidence:** `dispatchDomainEvents(events)` is called within the `prisma.$transaction` callback in four places. `events.ts` is an in-process synchronous dispatcher (a module-level `Map` of handlers) with **no handler registered** (grep for `registerDomainEventHandler` — single match, the definition). So today it is a no-op; but if/when a handler (e.g. an emailer) is added, a throwing handler **rolls the whole business transaction back** (because the dispatch is inside the tx callback), and a slow handler holds the DB transaction open.

**Problem:** Events fire before the tx commits; side-effecting handlers are coupled to tx outcome, violating the outbox/after-commit discipline.

**Failure scenario:** Once a notifications handler exists, a transient email-send failure rolls back a completed goods receipt — the GR is not marked `POSTED`, balances are not updated, yet the operator was told it succeeded at the HTTP layer.

**Root cause:** Dispatching synchronous, side-effecting events inside the unit of work.

**Recommendation:** Move `dispatchDomainEvents` to **after** `prisma.$transaction` resolves, or implement an outbox table written in the same tx and drained by a separate process. Register =1 handler and assert in a test that a dispatched event reaches it (the current tests stub `dispatchDomainEvents` away, hiding the gap).

**Trade-offs:** After-commit dispatch loses transactional atomicity of the side effect (acceptable; the DB change is the source of truth). Outbox is heavier but strictly correct.

**Priority:** P2 (currently latent — no handlers registered).

---

### Finding B6 — Settings cache is per-process and never invalidated across instances

**Severity:** Medium
**Category:** Reliability / Operations
**Location:** `apps/backend/src/modules/settings/settings.service.ts:16-24,48-61` (60 s in-process `Map` cache; `invalidateSettingsCache` clears the local Map only).

**Evidence:** `cachedGetValue` caches in `settingsCache` for `SETTINGS_CACHE_TTL_MS = 60_000`. `set`/`setMany`/`resetDefaults` call `invalidateSettingsCache()` which only clears **this process's** Map. In an N-instance deployment, an admin toggles `purchaseOrders.requireApprovalBeforeProcessing` on instance A; instances B/C keep serving the stale value for up to 60 s — and the negative-stock-prevention check (B4) reads that cached value.

**Problem:** A security/policy toggle is eventually consistent across instances (60 s window) rather than immediate.

**Failure scenario:** A policy is relaxed/locked and, for a minute, some instances enforce the old rule while others enforce the new one — e.g. two APPROVERS see different PO flows.

**Root cause:** In-process cache without a shared invalidation channel (Redis pub/sub, DB write-time, or cache-aside with DB as the clock).

**Recommendation:** Either (a) drop the cache for policy-critical keys (they're read rarely) and read-through, or (b) broadcast invalidation over Redis. At minimum, document the staleness as a feature flag on multi-instance deploys.

**Trade-offs:** Removing the cache adds one PK lookup per request that reads a setting; negligible for this load.

**Priority:** P2.

---

### Finding B7 — No CI/CD; the "integration pipeline" referenced by the tests does not exist

**Severity:** Medium
**Category:** Operations / Testing
**Location:** repository root — no `.github/` directory exists (confirmed). Tests assert migration shape via string-grep: `apps/backend/src/db/migrations.test.ts:2-14`.

**Evidence:** `migrations.test.ts` only greps `migration.sql` files for `CREATE TABLE`/`CREATE INDEX` substrings and asserts ordering. Its own comment claims "the actual migration runner (`prisma migrate deploy`) is exercised by the integration pipeline against a real Postgres" — but **no such pipeline exists** (no `.github/workflows`, no CI config anywhere). The workspace root `package.json` has `lint`/`typecheck`/`test` scripts that delegate to workspaces, but nothing runs them automatically.

**Problem:** Nothing validates that migrations actually *apply*, that tests run, or that lint/typecheck pass. The migration "test" cannot detect a syntactically-invalid `ALTER TABLE` or a missing `@@unique` (it would pass for supplier name because a non-unique index still matches `suppliers_name_idx`).

**Failure scenario:** A migration with a runtime error (`ALTER TABLE ... ADD COLUMN` with a bad default, a typo in a FK) ships to prod and `migrate deploy` fails mid-deploy; the app then starts against a half-migrated schema.

**Root cause:** No automation gate; the test masquerades as an integration guard.

**Recommendation:** Add a CI workflow that runs (1) `tsc --noEmit`, (2) `eslint`, (3) `vitest run`, (4) `prisma migrate deploy` against a real Postgres + `db:seed`, (5) a true integration test that round-trips a `postGoodsReceipt` end-to-end and asserts balance + audit row. Promote the migrations-test to a real `migrate deploy` smoke.

**Trade-offs:** Adds CI infra; the integration test needs a DB fixture (testcontainers or a shared Postgres).

**Priority:** P1.

---

### Finding B8 — Application does not run migrations or seed at startup

**Severity:** Medium
**Category:** Operations / Deployment
**Location:** `apps/backend/Dockerfile:9-18` (CMD is `node dist/index.js` only); `apps/backend/src/db/migrate.ts` (never imported by `index.ts`/`server.ts`); `docker-compose.yml:32` (`sh -c "npx prisma migrate deploy && npm run db:seed && node dist/index.js"`); `apps/backend/src/index.ts`.

**Evidence:** The Dockerfile `CMD` runs only the node binary. The migrations+seeding are performed **only** by the docker-compose `command` override. Any other deployment path (plain `docker run`, k8s, bare metal) that does not mirror that command starts the app against an un-migrated/empty database: `settings` rows are absent (so `SettingsService.get`/`set` throw `404`/`500`), and the schema may not match the client.

**Problem:** Startup is not self-contained; "does it run?" depends on remembering the magic `command` in one compose file.

**Failure scenario:** Operator deploys the Dockerfile image directly; the app appears healthy (`/health` returns 200 because the DB connects) but every settings write and every permission-bearing path fails.

**Root cause:** Migration/seed is an external, undocumented step rather than an entrypoint concern.

**Recommendation:** Add an entrypoint script (`docker-entrypoint.sh`) that runs `prisma migrate deploy` then `db:seed` then execs the app, and use it in both the Dockerfile and compose. Gate seeding behind "catalog is empty" (already idempotent).

**Trade-offs:** Startup is slower (migrate+seed on every pod). Acceptable; keep idempotency.

**Priority:** P2.

---

### Finding B9 — No security headers and no brute-force protection

**Severity:** Medium
**Category:** Security
**Location:** `apps/backend/src/server.ts:28-53` (registers only `cors` + `jwt`); no `@fastify/helmet`, no `@fastify/rate-limit`; `apps/backend/src/modules/identity/auth.routes.ts:11-22` (login).

**Evidence:** `server.ts` registers `@fastify/cors` and `@fastify/jwt` only. `@fastify/cookie` is a declared dependency but is **never registered** (dead dep). No `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, or CSP header is set (the API returns JSON, so CSP/XSS are lower-risk than for an HTML server, but `nosniff` and HSTS-on-TLS are missing). The login endpoint has no rate limit, lockout, or backoff — `bcrypt` cost 10 + no throttle = feasible online brute-force. (JWT is bearer-token in an `Authorization` header and there is no cookie/session auth, so CSRF is N/A.)

**Problem:** No throttling on credential guessing; no defensive headers on a directly-exposed API.

**Failure scenario:** Automated password spray against `/api/v1/auth/login`; a leaked DB read via `view:audit_log` is also unthrottled.

**Root cause:** Missing security middleware and an auth-throttle step.

**Recommendation:** Register `@fastify/rate-limit` (tight window e.g. 10/min for `/auth/login`), `@fastify/helmet` with a tight CSP allow-list, and enforce HSTS behind TLS. (The "JWT in `localStorage`" issue is a frontend concern and is already covered in §6.)

**Trade-offs:** Adds deps; rate-limit state needs a shared store for multi-instance.

**Priority:** P2.

---

### Finding B10 — Two migrations share the same timestamp prefix; schema/migration drift

**Severity:** Low
**Category:** Maintenance / Operations
**Location:** `apps/backend/prisma/migrations/20260101000000_initial/`, `apps/backend/prisma/migrations/20260101000000_location_management/`.

**Evidence:** Both migration directories are named `20260101000000_*`. `prisma migrate deploy` orders migrations by directory name; with an identical prefix the order falls back to the alphabetical suffix (`_initial` < `_location_management`), which happens to be correct, and `migrations.test.ts:152-155` asserts exactly that. But this is accidental, not structural. The `location_management` migration is hand-written and idempotent (`IF NOT EXISTS`), whereas `schema.prisma:130-131` declares `code String? @unique` — which Prisma would render as a **full** unique index, not the **partial** index the migration creates (line 27, `WHERE "code" IS NOT NULL`). So a future `prisma migrate dev` would generate a *different* migration than the committed one.

**Problem:** Fragile/duplicate timestamp; divergence between `prisma generate`-expected DDL and committed hand-written SQL.

**Failure scenario:** A maintainer runs `prisma migrate dev`; Prisma diffs the schema and emits a no-op-creating `ALTER INDEX` or a duplicate index that clashes with the committed file, producing confusing migration history.

**Root cause:** Hand-authored migrations drifting from the generator; non-unique timestamps.

**Recommendation:** Rename one migration to a distinct timestamp; regenerate idempotently with `prisma migrate dev` from the canonical schema (or vice-versa). Treat `schema.prisma` as the source of truth for future changes.

**Trade-offs:** One-time migration-history cleanup.

**Priority:** P3.

---

### Finding B11 — Service tests cannot prove transactional or concurrent correctness

**Severity:** Medium
**Category:** Testing
**Location:** `apps/backend/src/modules/inventory/inventory.service.test.ts:147-155`; `apps/backend/src/modules/procurement/procurement.service.test.ts:179`; `apps/backend/src/modules/settings/settings.service.test.ts:80-94`; `apps/backend/src/modules/reporting/report.service.test.ts:22-27`.

**Evidence:** All service suites mock `../../shared/db.js` with hand-rolled in-memory clients. Crucially, the `$transaction` mock is `async (fn) => fn(makePrisma())` (inventory:149; procurement:179) — it **runs the callback but does not roll back on failure** (a throwing `fn` leaves the already-mutated in-memory `db` in a half-written state). The settings suite fakes its own snapshot-rollback (lines 80-94) but the inventory and procurement suites do not. No suite runs against a real Postgres, so none can assert: (a) rollback on mid-transaction failure, (b) the B1 race (two concurrent issues), (c) real Prisma `P2002`/`updateMany` count semantics, or (d) transaction isolation behaviour.

**Problem:** The suite is green and detailed, but it gives **false confidence** precisely about the properties that matter most (atomicity, rollback, concurrency).

**Failure scenario:** B1 and the over-receipt race ship undetected because the tests assert the single-thread happy path and stub `dispatchDomainEvents` away (inventory:158).

**Root cause:** In-memory fakes + no real-DB integration test.

**Recommendation:** Add a Postgres integration test (testcontainers) that (1) seeds one material/location, (2) fires `Promise.all` of N concurrent `issue`s against a balance of 1, and (3) asserts `balance >= 0` and that exactly one succeeded — the regression test for B1. Add a rollback assertion for `postGoodsReceipt`. Keep the fast in-memory unit tests.

**Trade-offs:** CI needs a Postgres fixture; the integration test is slower but authoritative.

**Priority:** P1 (testing-the-thing debt).

---

### Finding B12 — Audit writes are decoupled from the business write (consistency)

**Severity:** Low
**Category:** Observability / Data integrity
**Location:** `apps/backend/src/modules/inventory/material.service.ts:51-71`; `apps/backend/src/modules/procurement/procurement.service.ts:46-65`; `apps/backend/src/modules/inventory/location.service.ts`; `apps/backend/src/modules/inventory/rack.service.ts`; contrast with `inventory.service.ts:164-183` (tx-wrapped) and `procurement.service.ts:195-260` (PO transitions tx-wrapped).

**Evidence:** `MaterialService.create` does `prisma.material.create(...)` (committed) then a *separate* `prisma.auditLogEntry.create(...)` outside any transaction. Same in `SupplierService.create`, `LocationService`, `RackService`, `ProjectService`, and `UserService.update` (the tx at identity.service.ts:111 ends, then the audit entry is written after). Only `PurchaseOrderService` transitions and the inventory mutations wrap the audit write inside `$transaction`.

**Problem:** The audit trail is not atomic with the business event it records — a process crash between the two leaves a business change with no corresponding audit entry, breaking the completeness guarantee of the audit log (which is a stated control surface, `GET /audit`).

**Failure scenario:** A `POST /materials` succeeds at the DB but the process is killed before `auditLogEntry.create` flushes; the material changes but no `CREATE` audit row exists.

**Root cause:** No transactional boundary around the read-model-change + audit pair.

**Recommendation:** Wrap each master-data mutation + its audit row in `prisma.$transaction`. (The `inventory`/PO services already do this; extend the pattern.)

**Trade-offs:** Slight latency per write; negligible.

**Priority:** P2.

---

### Finding B13 — `Project.status` is an unscoped `String` (no DB enum)

**Severity:** Informational
**Category:** Database / Correctness
**Location:** `apps/backend/prisma/schema.prisma:153` vs `migration.sql:135`.

**Evidence:** The schema defines `status String @default("PLANNING")` (plain text) whereas every other status column (`purchase_orders.status`, `goods_receipts.status`) uses a generated enum type. The TypeScript layer enforces a `ProjectStatus` union (`operations/project.service.ts`), but the DB accepts any string.

**Problem:** Data-level defence is absent; a direct write or future code path could store an arbitrary status that the app then mishandles.

**Failure scenario:** A migration or admin query sets `status = 'Done'`; downstream status checks (`p.status !== CANCELLED`) silently misbehave.

**Recommendation:** Use a `ProjectStatus` enum type in `schema.prisma` (backward-compatible data migration: add enum, cast, drop default).

**Priority:** P3.

---

### Finding B14 — Verified non-finding (transparency)

The report service calls `prisma.inventoryTransaction.groupBy({ by: ['materialId'], _max: { postedAt: true }, where: {...} })` without `orderBy`/`_count`. I empirically tested the exact call against the installed `@prisma/client@5.22.0` client (CJS script invoking `prisma.inventoryTransaction.groupBy` with the real generated client): it **did not** throw the "must provide `orderBy` or `_count`" client-side error — it proceeded to the engine (failing only on DB connectivity in the test). So `/reports/inventory` is not structurally broken by `groupBy`; the report tests mock it (`report.service.test.ts:104`) so they cannot prove the real query returns correct data, but the call itself is valid. No finding; recorded to avoid a false positive.

---

### Production-readiness checklist — backend

- [x] deterministic startup (config fail-fast) — *but see B8: schema/seed are externalized for non-compose deploys*
- [x] validated configuration (B0/P0 already noted: the prod secret crashes boot)
- [x] structured errors (`ApiError` contract) — *gap: Prisma errors not mapped (B2)*
- [x] graceful shutdown (`server.ts:147-182`)
- [ ] request validation (zod on most routes) — *gap: `PATCH /inventory-transactions/:id` body only `typeof`-guarded (`inventory.routes.ts`), `projectNumber`/`recipientId` on issues not FK-validated*
- [x] authorization (`requirePermission`) — *gap: mutating routes missing `preHandler` (P0)*; open read lists (B9)
- [x] migrations — *gap: not run at startup (B8)*
- [ ] database constraints — *gap: supplier.name lacks `@unique` (B3)*
- [x] indexes (migrations.test.ts:113-132 asserts the critical ones)
- [x] transactions (inventory/procurement use `$transaction`)
- [x] backups/recovery (operator concern, not code)
- [x] authentication (JWT bearer, bcrypt) — *gap: no rate limit (B9)*
- [x] authorization (RBAC via DB) — *gap: client-side default-allow (frontend §6)*
- [x] secrets (env-only) — *gap: insecure default in compose (B0)*
- [ ] dependency security (no audit step in CI — B7)
- [x] sensitive-data protection (password hash excluded from audit on create — `identity.service.ts:89`)
- [ ] timeouts (client-side) — *gap: no upstream/external timeout config; DB queries unbounded*
- [ ] retries / backoff — *gap: no retry/circuit-breaker; DB errors are fatal 500s*
- [ ] idempotency — *partial: PO/GR number generation is locked (good); POSTs lack idempotency keys*
- [ ] failure handling (`ApiError` taxonomy) — *gap: Prisma errors (B2)*
- [ ] resource cleanup (graceful shutdown)
- [ ] logs (pino structured + request correlation `req.id`, `server.ts:40`)
- [ ] metrics — *gap: none (pino logs only)*
- [ ] request correlation — *gap: no trace/propagation beyond `req.id`*
- [ ] health checks (`/health`, `/health/ready`)
- [ ] actionable errors (error codes + details) — *gap: Prisma errors lose details*
- [ ] unit (vitest) — *gap: in-memory fakes can't prove tx/rollback/concurrency (B11)*
- [ ] integration (DB) — *absent*
- [ ] API (server.test.ts smoke, auth-gated behind P0 fix)
- [ ] critical workflows — *gap: no end-to-end `postGoodsReceipt` integration test*
- [ ] regression — *the PO lifecycle suite is strong*
- [x] reproducible build (Dockerfile, lockfile) — *gap: not run at startup (B8)*
- [ ] configuration — *see B8*
- [ ] migrations — *see B8*
- [ ] rollback strategy — *gap: none documented*
- [ ] health verification — *liveness/ready exist*

---

### Backend findings register (summarised)

| ID | Title | Severity | Priority |
|----|-------|----------|----------|
| B0 | *(covered in —4)* Production deploy crashes: insecure `JWT_SECRET` rejected in prod | Critical | P0 |
| B1 | Stock-prevention / over-receipt bypassable by concurrent requests | High | P0 |
| B2 | Prisma errors (P2002/P2025) mapped to 500 instead of 409/404 | High | P1 |
| B3 | Supplier name has no DB-level uniqueness (duplicates) | High | P0 |
| B4 | `preventNegative` read outside transaction (inconsistent snapshots) | Medium | P2 |
| B5 | Domain events dispatched inside the transaction (before commit) | Medium | P2 |
| B6 | Settings cache not invalidated across instances (60 s staleness) | Medium | P2 |
| B7 | No CI/CD; migration "test" is a string-grep, not an integration run | Medium | P1 |
| B8 | App does not migrate/seed at startup (compose-only) | Medium | P2 |
| B9 | No security headers; no auth rate-limiting | Medium | P2 |
| B11 | Service tests cannot prove transactions/rollback/concurrency | Medium | P1 |
| B12 | Audit writes not atomic with the business write | Low | P2 |
| B10 | Two migrations share a timestamp; schema/migration drift | Low | P3 |
| B13 | `Project.status` is a free-text `String` (no DB enum) | Info | P3 |
| B14 | `groupBy` without `orderBy`/`_count` — verified NOT a defect on Prisma 5.22 | Info | n/a |

---

### Backend invariant register

| ID | Invariant | Where enforced | Bypassable? | Protection |
|----|-----------|----------------|-------------|------------|
| INV-1 | A PO cannot transition to an invalid next status | `updateMany({ where: { id, status: { in: allowed } } })` (optimistic guard) + pre-check | Concurrent transition is lost — `409 INVALID_STATE` | P1 (status guard is correct; tested in procure.service.test.ts) |
| INV-2 | A goods receipt is posted exactly once | `status === 'POSTED'` guard in `postGoodsReceipt` (line 372) | Concurrent posts on different GRs referencing same PO line — over-receipt (B1) | P0 |
| INV-3 | An issue/transfer/adjust cannot drive `(material, location)` balance below zero (when prevention is on) | App check on materialised `inventory_balance` read (B1) | **Bypassed by concurrent requests** (no row lock) | P0 — fix B1 |
| INV-4 | `receivedQty <= orderedQty` per PO line | App check `projected.gt(orderedQty)` (B1) | Bypassed by concurrent `postGoodsReceipt` on same line | P0 — P1 (after B1 fix) |
| INV-5 | SKU is unique | DB `@unique` + app check-then-create (P2002) | Race between check and create — 500 (not 409) | P1 — fix B2 |
| INV-6 | Supplier name is unique (case-insensitive) | App check only | **No DB constraint — duplicates** | P0 — fix B3 |
| INV-7 | Location code is unique | DB `@unique` (partial, via migration) | None | P2 |
| INV-8 | Settings keys are restricted to the catalog | `getDefinition(key)` guard in `set`/`setMany` | None (DB has no FK) | P2 |
| INV-9 | An audit entry is written for every admin mutation | Per-service; atomicity varies (B12) | Crash between business write and audit — missing row | P2 — fix B12 |
| INV-10 | JWT is rejected when expired/invalid | `@fastify/jwt` + `authenticate` (P0 already noted) | None (but no revocation list) | P2 — short refresh + rotation policy |

---

### Backend threat model (addendum)

- **Assets:** inventory ledger correctness, PO/GR financial quantities (`DECIMAL(18,4)`), user credentials (`password_hash`), admin settings (`security.*`), audit trail.
- **Actors:** ADMIN, STORE_CONTROLLER, PROCUREMENT, APPROVER, TECHNICIAN, VIEWER; anonymous internet callers.
- **Trust boundary:** the `authenticate` decorator + `requirePermission` (DB-sourced permissions — good: role changes are immediate). JWT `roles` is informational only (not consulted for write gating, which is correct).
- **Threats:**
  - Online credential guessing of `POST /auth/login` — **mitigation: none** (B9). **Residual: high.**
  - Concurrent writes corrupting balances / over-receipt — **mitigation: weak (app check, no lock)** (B1). **Residual: medium.**
  - Duplicate-supplier data corruption — **mitigation: none at DB** (B3). **Residual: medium.**
  - Prisma errors leaking as 500s (no 409/404) — **mitigation: none** (B2). **Residual: medium.**
  - Cross-instance settings staleness — **mitigation: 60 s cache** (B6). **Residual: low-medium.**
  - Settings secret rejected at boot — **self-inflicted DoS** (B0). **Residual: none (operator fix).**
- **Secrets in source:** none committed (placeholders only; `.env.example` has placeholders). `bcrypt` cost 10 (acceptable).

---

### Backend scorecard

| Dimension | Assessment | Evidence |
|-----------|------------|----------|
| Architecture | Good modular monolith; clear layer separation | layered `shared/*`, per-domain `modules/*`; transactions centralised in services |
| Domain modelling | Strong — ledger + derived balances (ADR-002), aggregate root discipline | `InventoryService` sole writer of transactions; `recomputeBalance` from ledger |
| Correctness | **Two concurrency defects (B1, B4)** + error-mapping gap (B2) | negative-stock/over-receipt races; P2002 — 500 |
| API design | Consistent Zod contracts; one un-validated body (inventory PATCH) | schemas on most routes; `inventory.routes.ts` actorId body un-validated |
| Database engineering | Solid FK/constraint hygiene *except* supplier.name; good indexes; idempotent migrations | B3 the sole missing uniqueness; migrations.test.ts guards indexes/FKs |
| Data integrity | Mostly DB-enforced; **B3 (supplier) and B1 (race) are gaps** | INV-3/INV-4/INV-6 |
| Security | JWT bearer OK, bcrypt OK; **no rate-limit, no headers; P0 secret** | B0/B9 |
| Testing | Strong unit/spec coverage (126 pass) but **in-memory fakes can't prove tx/rollback/concurrency** | B11; no real-DB integration |
| Reliability | Graceful shutdown good; **no retries/backoff/circuit-breaker; settings cache staleness** | B5/B6 |
| Observability | Structured pino logs + request correlation; **no metrics, no tracing, no event delivery** | B5 |
| Performance | Ledger recompute is O(n) per write (acceptable now; watch as ledger grows); reports load full tables (pagination in-memory) | report.service.ts loads all materials/balances |
| Scalability | Stateless, single DB; row-lock fix in B1 introduces a per-bin serialisation point (acceptable for warehouse-scale) | — |
| Maintainability | Cohesive services, duplicated balance helper (B3/B4 addendum already flags duplicate `recomputeBalance`) | `stock-item.service.ts:53` dup |
| Deployment readiness | **Blocked at P0 (secret crash)** + B8 (no startup migrate/seed) | docker-compose.yml, Dockerfile, migrate.ts |
| Documentation | ADR-002 referenced in comments; no central architecture doc; setup relies on compose | — |

---

### Updated remediation priority (backend)

1. **P0 — Fix the secret + auth contract** (B0 —4, P0 —3 of the prior audit): ship `docker-compose.yml` and `.env.example` with a placeholder-free, generated secret and a note to set `JWT_SECRET` from a secret manager before `up`.
2. **P0 — Enforce supplier-name uniqueness at the DB** (B3): add a case-insensitive unique constraint + migration that de-duplicates; this is a data-integrity floor.
3. **P0 — Close the inventory/GR race** (B1): row-lock the balance (and PO-line) row inside `issue`/`transfer`/`adjust`/`postGoodsReceipt`; add the concurrent-issue regression test.
4. **P1 — Map Prisma errors to HTTP** (B2): central `isPrismaError` branch (P2002—409, P2025—404, connection —503).
5. **P1 — Add CI + a real-DB integration test** (B7/B11): `tsc`+`eslint`+`vitest`; a testcontainers job running `migrate deploy` + `db:seed` + an end-to-end `postGoodsReceipt` + a concurrent-issue assertion.
6. **P2 — Make events after-commit; register a handler; test dispatch reaches it** (B5).
7. **P2 — Fix settings cache for multi-instance** (B6): read-through or Redis invalidation for policy toggles.
8. **P2 — Harden deployment** (B8): entrypoint that migrates + seeds before the app; rate-limit + helmet (B9).
9. **P2 — P3 — Polish** (B12, B10, B13): atomic audit writes; rename the colliding migration; enum-ify `Project.status`.

The two P0s from the prior audit (auth contract and the secret-crash) remain the highest leverage fixes, but B1 (inventory race) and B3 (supplier uniqueness) are *additional* P0s that the auth fix alone does not resolve — both corrupt business data under load.

---

## 13. Frontend verification addendum (auth contract, symptom surface, test gaps)

This section verifies the frontend claims referenced in Sec. 3/6/8 of the prior audit against the actual source of `apps/frontend/src/auth.ts`, `authService.ts`, `Signup.tsx`, `auth.test.ts`, and `SettingsSections.tsx`.

**FE-1 (verified) — The auth P0 is untested-positive on the frontend; the green suite does not catch it.**
`auth.test.ts` exercises only the session-persistence helpers (`readPersistedSession`/`writePersistedSession`/`clearPersistedSession` and the malformed/missing-payload cases, lines 51-80). There is **no** test that (a) maps a login response to an authenticated user with the right roles, (b) asserts an authenticated `GET /users` succeeds, or (c) asserts an `active:false` account is rejected. Conversely, `server.test.ts:43-51` **asserts** that an authenticated `GET /users` returns `403` and treats that as correct (Sec. 11 of the prior audit already notes this). The net effect: the single most user-visible defect (every protected read 403s) is *encoded as expected behavior* by the test that covers it, and no test exercises the positive path. After the backend `active` fix, the frontend test that must change is this one (403 -> 200).

**FE-2 (verified) — `SettingsSections.tsx` surfaces the P0 as four graceful-but-empty failure screens.**
`SettingsUsers` calls `GET /users` (`SettingsSections.tsx:366`) and renders `Couldn't load users` (`404`/Alert at `404`) on error; `SettingsHistory` calls `GET /audit?...limit=100` (line `665`) rendering `Couldn't load history` (`674`); `SettingsData` calls `useApi('/reports/inventory')` (`594`) and the live export (`566`) both 403. The error handling is defensive (no crash, a toast/Alert is shown), so the app *looks* alive while every admin surface is empty. This is exactly the symptom described in Sec. 3.3 and is reproduced verbatim against the open source.

**FE-3 (verified) — In live mode, the export always hits the backend endpoint (the client-side exporter is unreachable).**
`downloadReport` (`549`) only uses `useReportExporter(...).exportXlsx()/exportPdf()` inside the `if (FRONTEND_ONLY)` branch (`554`). In live mode it skips that branch and does a raw `fetch('/api/v1/reports/inventory/export?format=...')` (`565-568`) carrying the bearer token straight from `localStorage` (`564`). So the live export depends entirely on `ViewReports` being enforced on `/reports/inventory/export` -- which 403s for the same P0 reason as the inventory report itself. There is no client-side fallback to the (also-403'd) report data. The token is read directly from `localStorage` (`564`) rather than via the `api` client getter, duplicating the JWT-in-localStorage exposure noted in Sec. 6.

**FE-4 (verified, dev-mode only) — Frontend-only signup grants full ADMIN scope; live signup is disabled.**
`authService.ts:82-92` returns `MOCK_DEV_USER.roles` (ADMIN + every role) for any freshly-created in-memory account. In live mode `signup` throws `NOT_AVAILABLE` (`197`) and `Signup.tsx` shows the warning alert (`Signup.tsx:154-158`), so account creation is intentionally off in production. Not a production defect, but it means the only way to provision a user in live mode is direct DB writes or the seed admin.

**FE-5 (verified, dev-mode only) — In-memory account store holds plaintext passwords.**
`mockAccounts` (`authService.ts:68`) stores `MockAccount.password` in module scope for the frontend-only session. This is never sent to the backend and does not persist, so it is not a production secret leak but it is worth flagging for the demo-build hygiene.

**FE-6 (test-gap corollary of B11) — No frontend test exercises the authenticated data contract.**
Because the backend 403s (P0), there can be no passing Cypress/Playwright test that logs in and reads `/users` or `/audit` end-to-end; the existing `113` frontend tests are unit tests of components/mocks. The `usePermissions` default-allow and the `localStorage` token persistence are therefore never exercised against a live auth boundary.

### Frontend verification matrix

| Prior-audit claim | File:line | Status |
|---|---|---|
| JWT persisted in `localStorage` | `api/client.ts:29-32` (referenced); `SettingsSections.tsx:564` reads it back | Verified (FE-3) |
| `usePermissions` defaults to `true` for unknown codes | `hooks/usePermissions.ts:45-55` (referenced) | Verified in prior audit (not re-read here) |
| signup disabled in live mode | `authService.ts:197`; `Signup.tsx:154-158` | Verified (FE-4) |
| Users / History / Export return 403 in live mode | `SettingsSections.tsx:366,594,665` | Verified (FE-2) |
| `auth.test.ts` covers only persistence | `auth.test.ts:1-80` | Verified (FE-1) |

These frontend items are downstream of the backend P0s: once `active` is signed into the JWT and mutating routes carry `preHandler: [app.authenticate]` (Sec. 10, remediation #1), FE-2/FE-3 resolve automatically. FE-1/FE-6 are the test-strategy follow-ups that should accompany that fix (see Sec. 11).

