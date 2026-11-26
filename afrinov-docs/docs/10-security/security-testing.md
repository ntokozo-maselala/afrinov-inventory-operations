<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-10-007</b></td>
<td align="center"><b><i>Security Testing</i></b><br><i>Security</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-10-007 updated=2026-11-26 by="Ntokozo Maselala" body=16bf1d478733 -->

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
