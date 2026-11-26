<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-06-009</b></td>
<td align="center"><b><i>Security Architecture (Overview)</i></b><br><i>System Architecture</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-06-009 updated=2026-11-26 by="Ntokozo Maselala" body=603d20d9ec02 -->

# Security Architecture (Overview)

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

See `10-security/` for the full detail; this is the architectural summary.

- **Authentication:** email + password (bcrypt, cost 12) exchanged at
  `POST /api/v1/auth/login` for a JWT signed with `JWT_SECRET`, valid 12
  hours. Every authenticated request re-checks in the database that the
  user is still active. SSO is not implemented (*Unverified* whether the
  business has one).
- **Authorization:** role-based. Roles map to permission codes
  (`shared/permissions.ts`); the seed writes that mapping to the database
  and each request loads the user's permissions from it. Each mutating
  route calls `requirePermission(...)` itself — it is a per-route call, not
  shared middleware applied by default.
- **Audit:** most master-data changes and several stock actions write an
  `AuditLogEntry` from the service. Issues, transfers, adjustments,
  purchase-order creation and goods-receipt create/post write none (the
  ledger row still records the actor), and some audit writes happen after,
  not inside, the business transaction (TD-008).
- **Secrets** (`DATABASE_URL`, `JWT_SECRET`, `SEED_ADMIN_PASSWORD`) come
  from environment variables; `.env` files are git-ignored. In production
  the server refuses to start with a missing or known placeholder
  `JWT_SECRET`.
- **HTTP hardening:** CORS allow-list, `@fastify/helmet` security headers
  with a `default-src 'none'` CSP, per-IP rate limits (separate, stricter
  budget for login), 1 MB body limit, 30 s request timeout.

## Evidence
- `afrinov-platform/apps/backend/src/modules/identity/identity.service.ts:7-33`
- `afrinov-platform/apps/backend/src/server.ts:78-178`
- `afrinov-platform/apps/backend/src/shared/authorization.ts:21-71`
- `afrinov-platform/apps/backend/src/shared/config.ts:42-77`
- `afrinov-platform/apps/backend/src/db/seed.ts:120-145` — role/permission rows
- `afrinov-platform/.gitignore` — `.env`
