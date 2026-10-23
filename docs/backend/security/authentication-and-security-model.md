# Authentication and security model

## Identity and token flow

The backend has local email/password accounts; no external identity provider,
OAuth/OIDC flow, session store, or password-reset service was found. Account
creation and role assignment are administrator-controlled through user routes
and the seed. Password hashes use `bcryptjs` cost 12 for new hashes. Login
looks up the lowercased email, rejects missing/inactive users, verifies the
hash, then signs an HMAC JWT with a 12-hour expiry.

Protected requests send `Authorization: Bearer <token>`. The shared Fastify
`authenticate` decorator verifies the token. It then queries the database for
the subject's current active state; database lookup failures propagate as
availability errors rather than being converted to 401. This makes
deactivation effective before JWT expiry. For permission-protected routes,
`requirePermission` queries role-permission relationships from PostgreSQL and
checks the requested permission. JWT role claims are informational, not the
permission authority.

There is no refresh-token, token revocation list, key ID/key rotation, issuer,
audience, or asymmetric key setup in the inspected code. Account deactivation
is the immediate revocation mechanism; otherwise a valid token lasts up to
12 hours.

## Route security boundaries

| Route group | Authentication | Authorization | Notes |
| --- | --- | --- | --- |
| `/`, `/health`, `/health/ready` | Public | None | Readiness queries DB; global rate limiting applies. |
| `/api/v1/health`, `/api/v1/health/ready` | Public | None | Same infrastructure checks mounted for frontend/API clients. |
| `POST /api/v1/auth/login` | Public | Login credentials | Strict login rate-limit budget; Zod validation. |
| `GET /api/v1/auth/me` | Bearer JWT | Active-account check | Returns current token identity summary. |
| Materials and locations reads | Bearer JWT | Route-specific permissions vary; material listing itself has no additional permission check | Active account required. |
| Inventory writes | Bearer JWT | Specific permission such as issue, transfer, receive, adjust, reverse | Service layer enforces stock/workflow rules after route auth/permission. |
| User/role administration | Bearer JWT | User-management permission | No self-registration route. |
| Procurement writes | Bearer JWT | Procurement/approval permissions per endpoint | Purchase orders and goods receipts can be unregistered by feature flag; supplier routes remain. |
| Reports, audit, settings, operations | Bearer JWT | Varies by route; settings reads permit authenticated users in some paths | Inspect the route's `preHandler` and `requirePermission` for the exact operation. |

The authoritative per-route controls are declared in each `*.routes.ts` file.
The route group table is a map, not a replacement for route-level review.

## HTTP and input controls

- `@fastify/helmet` applies security headers and a restrictive API content
  security policy. Cross-origin resource/opener/embedder policy headers are
  disabled to support the SPA/API arrangement.
- CORS uses an explicit comma-separated allow-list when configured; development
  has a fixed local-origin fallback. CORS is disabled outside development if
  the list is empty. Credentials are enabled.
- `CORS_ALLOW_ANY=true` overrides the allow-list in every environment and
  permits any origin with credential support. The code comments say this is
  for throwaway demos, but production is not prevented from enabling it.
- Fastify's global rate limiter uses a default 5/minute/IP for the login path
  and 1000/minute/IP elsewhere (higher defaults in tests). The source does not
  configure a shared Redis/store. No `trustProxy` option was found; if deployed
  behind a proxy, client-IP behavior and rate-limit grouping need verification.
- Fastify body size is limited to 1 MB and request timeout to 30 seconds.
- Many route inputs use Zod `safeParse`; validation is local to each route.
  Do not assume every endpoint has identical validation coverage.
- Unexpected errors are logged server-side and returned as generic 500s; API
  errors use shared status/code/message output. Tokens/passwords are not
  intentionally logged by the reviewed request hooks.

The Fastify listener uses HTTP. No TLS termination, certificate loading,
secure-cookie handling, or proxy deployment configuration is in the backend
source. Transport encryption must be supplied by an external platform and
verified there.

## Secrets and environment-dependent controls

`DATABASE_URL` and `JWT_SECRET` are required by `loadConfig()`. The environment
template's JWT value is a public placeholder and the production validator
rejects exact known placeholder strings. Direct reproduction found that a
one-character production JWT key is accepted; no minimum length or entropy
check exists. `NODE_ENV` is type-cast rather than validated, so values such as
`staging` are accepted and bypass the exact `production` branch for the
placeholder check. Both are confirmed config-policy gaps, not proof that a
particular deployment uses a weak key.

No secrets manager integration or key rotation process is configured in the
repository. Compose interpolates credentials from the invoking environment;
operators must supply them securely. Never copy real `.env` values into issue
reports, runbook output, logs, or documentation.

## Findings and confidence

The current findings are detailed in the
[audit register](../audits/backend-understanding-and-readiness-audit.md):

- **Medium, confirmed:** production accepts extremely short JWT secrets.
- **Medium, confirmed:** arbitrary `NODE_ENV` strings can bypass production
  secret rejection and expose API docs by default.
- **Medium, confirmed:** production can enable `CORS_ALLOW_ANY` with
  credentialed CORS.
- **Medium, operational risk:** local real-HTTP tests write to the `.env`
  database and do not guard the target.
- **Medium, potential:** concurrent stock deductions are not protected by an
  explicit locking/isolation strategy; a negative-balance race was not
  reproduced.

These items are findings for owners to prioritize; no application logic or
security behavior was changed in this audit.
