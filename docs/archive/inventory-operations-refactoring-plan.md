# Refactoring Plan — Inventory Operations Alignment

**Date:** 2026-10-06
**Scope:** The ten fixes classified in `domain-gap-analysis.md` (K2, K3,
K5, K6, K8, K9, K10, K11, K13, K14) plus documentation and ADRs.
**Explicitly out of scope:** new movement types, stocktake/stock-request
workflows, attachments, first-class allocation, notification delivery,
procurement expansion, API renames, architecture changes.

Every change below is small, independently reversible, and gated by the
existing quality gates (typecheck, lint, unit tests, build).

---

## Change 1 — Self-registration endpoint (K2)

- **Problem:** `POST /auth/register` is referenced by `server.ts`
  rate-limit config and the Signup page, but no route exists. Live-mode
  signup fails with `NOT_AVAILABLE` — a wired, user-visible flow is
  broken.
- **Current:** `auth.routes.ts` registers only `/auth/login` and
  `/auth/me`; `authService.signup()` throws `NOT_AVAILABLE` in live mode.
- **Target:** `POST /api/v1/auth/register` that validates
  `{name, email, password}`, checks the new
  `security.allowSelfRegistration` setting (default **false**), creates
  the user with the least-privilege `VIEWER` role, writes an audit
  entry, and returns `201 { user }`. Disabled → `403
  REGISTRATION_DISABLED`; duplicate email → `409 CONFLICT`. The
  frontend `signup()` calls it and, on success, signs the user in so
  the existing post-signup navigation keeps working.
- **Why necessary:** repairs a P0 broken workflow without weakening
  security — the feature is fail-closed by default and only becomes
  available when an operator explicitly enables it in Settings →
  Security.
- **Dependencies:** new setting `security.allowSelfRegistration` in the
  settings catalog (seeded idempotently by `ensureSeeded`).
- **Risk:** Low. Default-off means zero behaviour change until an
  operator opts in. New `VIEWER`-only accounts cannot mutate anything.
- **Migration strategy:** none — additive route + additive setting row.
- **Validation strategy:** unit tests: 400 on bad payload, 403 when
  disabled, 409 on duplicate, 201 + VIEWER role when enabled, audit
  entry written. Frontend: signup maps `REGISTRATION_DISABLED` to the
  existing `NOT_AVAILABLE` UI message.
- **Rollback strategy:** remove the route registration and the setting
  catalog entry; frontend falls back to the previous `NOT_AVAILABLE`
  error. No data change to reverse.

## Change 2 — Health endpoints under `/api/v1` (K5)

- **Problem:** the frontend Settings → System page calls
  `GET /api/v1/health`; the backend mounts `/health` at the root only,
  so the page always reports the API as offline.
- **Current:** root `/health` + `/health/ready` in `server.ts`; nothing
  under the `/api/v1` prefix.
- **Target:** the same two handlers registered inside the `/api/v1`
  prefixed router via a new `modules/health/health.routes.ts`.
- **Why necessary:** operators rely on the status indicator; a false
  "offline" signal is a P1 operational defect.
- **Dependencies:** none.
- **Risk:** Very low — additive, unauthenticated, read-only.
- **Migration strategy:** none.
- **Validation strategy:** HTTP tests assert `GET /api/v1/health` → 200
  and `GET /api/v1/health/ready` reflects DB state (200/503).
- **Rollback strategy:** remove the route registration.

## Change 3 — PO list authorization (K6)

- **Problem:** `GET /api/v1/purchase-orders` requires only
  authentication; any role (including `VIEWER`) can enumerate PO
  numbers, statuses, and line quantities, while `GET
  /purchase-orders/:id` requires `view:purchase_order`.
- **Current:** `procurement.routes.ts:90` — `preHandler:
  [app.authenticate]` only.
- **Target:** add `requirePermission(req, PermissionCode.ViewPurchaseOrder)`
  to the list endpoint, matching the detail endpoint.
- **Why necessary:** closes an information-disclosure gap (P1); the
  permission already exists and is granted to the roles that legitimately
  work with POs (ADMIN, STORE_CONTROLLER, PROCUREMENT).
- **Dependencies:** none.
- **Risk:** Low. `VIEWER`/`APPROVER` lose PO-list access — but they
  already cannot open a PO detail, so no working workflow is broken.
  The frontend PO page handles 403 via its existing error state.
- **Migration strategy:** none.
- **Validation strategy:** HTTP test: authenticated user without
  `view:purchase_order` → 403; with it → 200.
- **Rollback strategy:** remove the `requirePermission` line.

## Change 4 — User-lookup permission (K10)

- **Problem:** `GET /api/v1/users/lookup` (used by the issue form for
  recipient selection and by TransactionDrawer for actor reassignment)
  requires `update:inventory_transaction` — a mislabelled code that
  grants a write permission as a side effect of a read.
- **Current:** `user.routes.ts:31` requires `UpdateInventoryTransaction`.
- **Target:** new permission code `view:users`, granted to `ADMIN`,
  `STORE_CONTROLLER`, `TECHNICIAN` (the roles that perform inventory
  operations involving people). `/users/lookup` requires `view:users`.
- **Why necessary:** least-privilege correction; the seed provisions the
  new code automatically (`ensurePermissions`/`ensureRoles` iterate the
  shared catalog).
- **Dependencies:** `permissions.ts` catalog + role matrix.
- **Risk:** Low. PROCUREMENT/APPROVER/VIEWER lose the lookup — none of
  them have a UI flow that calls it (verified: only the issue form and
  TransactionDrawer call `/users/lookup`, both gated behind
  issue/update permissions).
- **Migration strategy:** none — seed upserts the new permission and
  re-syncs role grants idempotently.
- **Validation strategy:** HTTP test: user without `view:users` → 403;
  STORE_CONTROLLER → 200. Existing permission-matrix tests still pass.
- **Rollback strategy:** revert the permission code and route change;
  seed re-syncs on next run.

## Change 5 — Migration timestamp collision (K8)

- **Problem:** `20260101000000_initial` and
  `20260101000000_location_management` share a timestamp prefix; Prisma
  ordering between them is undefined.
- **Current:** two directories with identical prefixes.
- **Target:** rename the second to `20260101000001_location_management`.
- **Why necessary:** reproducible migrations are a production-readiness
  requirement.
- **Dependencies:** none. The migration body is fully idempotent
  (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, guarded
  `UPDATE`s), so databases that already recorded the old name simply
  re-apply it as a no-op.
- **Risk:** Low.
- **Migration strategy:** directory rename only; no SQL change.
- **Validation strategy:** `prisma migrate status`/`deploy` against a
  fresh database (operator-run; not available in this environment —
  recorded as a known environmental limitation).
- **Rollback strategy:** rename back.

## Change 6 — Supplier name uniqueness at DB level (K9)

- **Problem:** supplier-name uniqueness is enforced only by an app-layer
  `findFirst` check; concurrent creates can insert case-variant
  duplicates.
- **Current:** `Supplier` has `@@index([name])` (non-unique);
  `SupplierService.create` checks case-insensitively.
- **Target:** new migration `20260101000002_supplier_name_uniqueness`:
  `CREATE EXTENSION IF NOT EXISTS citext;` + `CREATE UNIQUE INDEX
  suppliers_name_ci_key ON suppliers (citext(name));`. The app-layer
  check stays (it produces the friendly 409).
- **Why necessary:** closes a concurrency race at the only authoritative
  boundary (the database).
- **Dependencies:** none. **Operator note:** if a database already
  contains case-insensitive duplicate names, the index creation fails —
  duplicates must be merged first (documented in the migration header
  and DEPLOYMENT.md).
- **Migration strategy:** additive migration; Prisma schema comment
  updated to point at the DB-level constraint.
- **Validation strategy:** integration test (DB-gated, deferred to a
  live environment); unit tests for the app-layer 409 path already
  exist and continue to pass.
- **Rollback strategy:** `DROP INDEX suppliers_name_ci_key;` — the
  app-layer check remains as the fallback.

## Change 7 — Negative-stock toggle read inside the transaction (K13)

- **Problem:** `issue()` and `adjust()` read
  `inventory.enableNegativeStockPrevention` **before** opening the
  transaction; a toggle change between read and commit can let a
  negative-balance write succeed.
- **Current:** `inventory.service.ts:210` and `:323` read the setting
  outside `prisma.$transaction`.
- **Target:** read it inside the transaction callback via
  `SettingsService.getValue(key, tx)` (the overload already exists).
- **Why necessary:** the invariant "available stock must not become
  invalid" must hold for the whole operation, not just at validation
  time.
- **Dependencies:** none (the tx-aware overload exists since the
  settings refactor).
- **Risk:** Very low; tests mock `setting.findUnique` on both the
  transaction client and the global client (same object), so existing
  settings-integration tests remain valid.
- **Migration strategy:** none.
- **Validation strategy:** existing settings-integration tests
  (toggle on/off) must still pass; behaviour is unchanged for the
  single-process case.
- **Rollback strategy:** move the read back above the transaction.

## Change 8 — Fail-closed frontend permission check (K11)

- **Problem:** `usePermissions().hasPermission` returns `true` for any
  unrecognised permission string — client-side gating can over-show UI.
- **Current:** `usePermissions.ts:55` `default: return true`.
- **Target:** `default: return false` (deny-by-default, mirroring the
  server).
- **Why necessary:** defence in depth; server enforcement is unchanged,
  so no user loses any capability they actually have.
- **Dependencies:** `useNavGroups.tsx` filters nav items through
  `hasPermission` — currently no nav item carries a `permissions`
  array, so navigation is unaffected.
- **Risk:** Low. Any component passing an unknown code to
  `hasPermission` loses its UI affordance — verified: only the four
  known codes (`materials:manage`, `procurement:manage`,
  `orders:approve`, `users:manage`) are used.
- **Migration strategy:** none.
- **Validation strategy:** update `usePermissions.test.tsx` to assert
  `false` for unknown codes.
- **Rollback strategy:** revert the default.

## Change 9 — Lint warning + security settings UI (K14 + Change 1 UI)

- **Problem:** `SettingsSections.tsx:375` has a stale-closure lint
  warning (missing `reload` dependency); the new
  `security.allowSelfRegistration` setting needs an operator-visible
  toggle.
- **Target:** add `reload` to the effect's dependency array; render a
  `BooleanField` for `security.allowSelfRegistration` in
  `SettingsSecurity`.
- **Risk:** Very low.
- **Validation:** lint passes with 0 warnings; settings page renders
  the new toggle (verified by existing settings tests + typecheck).

## Change 10 — CI quality gate (K3)

- **Problem:** nothing gates merges; regressions can land unverified.
- **Target:** `.github/workflows/ci.yml` running, on push and PR:
  `npm ci`, `typecheck`, `lint`, `test`, `build` across workspaces —
  exactly the gates verified in the baseline (none require a live DB).
- **Why necessary:** the prompt's production-readiness gate requires an
  automated quality gate; the unit suites are the verified signal.
- **Risk:** Very low — no runtime impact.
- **Rollback:** delete the workflow file.

## Change 11 — Documentation & ADRs

- **ADR-005** (afrinov-docs decision log): self-registration is
  opt-in, default-off, least-privilege.
- **ADR-006**: ledger actor-reassignment is retained as an audited
  administrative correction; quantity immutability is the enforced
  invariant (no endpoint can alter a posted quantity).
- **ADR-007**: movement-type mapping — consumption = ISSUE-to-project;
  write-off = ADJUSTMENT with SCRAP/LOSS; no new enum values without
  an approved requirement.
- Required docs (`PRODUCT.md`, `DOMAIN-MODEL.md`, `ARCHITECTURE.md`,
  `DATABASE.md`, `API.md`, `SECURITY.md`, `TESTING.md`,
  `DEPLOYMENT.md`) written to describe what the system **actually does**,
  cross-linking the detailed `afrinov-docs` tree.

## Sequencing & verification

1. Changes 1–4 (backend routes/permissions) → backend tests.
2. Changes 5–6 (migrations) → schema inspection (no DB available here).
3. Change 7 (service) → inventory service tests.
4. Changes 8–9 (frontend) → frontend tests + lint.
5. Change 10 (CI) → workflow lint by GitHub syntax.
6. Full gate run: `typecheck`, `lint`, `test`, `build` — all must
   match or beat the baseline (299 backend + 277 frontend tests,
   0 lint errors, 0 new warnings).
7. Final Verification Report (Output E) records before/after state.

## Global rollback

Each change is an independent, revertible unit. No change alters
existing data, existing API contracts, or existing behaviour for
currently-working flows. The only user-visible behaviour changes are
the intended defect fixes (403s where authorization was previously
missing, a working status indicator, a working — but default-off —
signup route).
