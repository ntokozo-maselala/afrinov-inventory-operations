# Security Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

- **Automated authorization and authentication tests** run in the
  standard unit suite (`npm test`, and in CI):
  - `src/shared/authorization.test.ts` — unauthenticated, inactive,
    missing-permission and allowed cases of `requirePermission`.
  - `src/shared/permissions.test.ts` — role grants (e.g. only ADMIN and
    STORE_CONTROLLER can reverse; VIEWER is read-only).
  - `src/security.regression.test.ts` — placeholder JWT secrets rejected in
    production, login rate limit (429, query-string bypass, separate
    budget), deactivated or deleted users rejected with a still-valid token.
  - `src/modules/inventory/inventory.routes.test.ts` and
    `src/server.test.ts` — 401/403 responses on selected routes.
  - `integration/auth.real-http.test.ts` — login and token use against a
    real database.
  A test that every route enforces a permission does not exist.
- **Dependency vulnerability scanning in CI: Planned.** Neither workflow
  runs `npm audit` or another scanner. `npm audit` findings are open
  (see `task_context.md` at the repository root).
- **Manual review** of any endpoint that touches money/value (stock
  valuation, future finance integration) before release: *Unverified* — a
  process, not evidenced in the repository.

## Evidence
- `afrinov-platform/apps/backend/src/shared/authorization.test.ts:41-116`
- `afrinov-platform/apps/backend/src/shared/permissions.test.ts:8-43`
- `afrinov-platform/apps/backend/src/security.regression.test.ts:62-286`
- `.github/workflows/backend-ci.yml`, `.github/workflows/frontend-ci.yml`
