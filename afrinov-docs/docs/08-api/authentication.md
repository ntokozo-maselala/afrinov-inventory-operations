# Authentication

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

- **JWT.** `POST /api/v1/auth/login` with `{ email, password }` returns
  `{ token, user }`. The token is signed HS256 with `JWT_SECRET` by
  `@fastify/jwt`, carries `sub`, `email`, `name` and `roles`, and expires
  after 12 hours. Clients send `Authorization: Bearer <token>`.
  `GET /api/v1/auth/me` returns the token's user.
- **Every authenticated request** verifies the token and then checks in
  the database that the user still exists and is active; a deactivated
  user is refused with 401 on the next request, without waiting for the
  token to expire.
- **Credentials:** email (stored lower case) and password, hashed with
  bcrypt at cost 12; passwords are never returned. Wrong email, wrong
  password and inactive account all give the same
  `401 UNAUTHENTICATED "Invalid credentials"`.
- **No anonymous access** to any endpoint that reads or writes business
  data; only login and the health checks are public.
- **Accounts are created by an administrator** (`POST /users`); there is no
  self-registration (ADR-006).
- **Login rate limit:** 5 requests per minute per IP on
  `/api/v1/auth/login`, counted separately from the general limit
  (`RATE_LIMIT_AUTH`).
- **Planned:** refresh tokens, server-side logout/revocation (logging out
  only discards the token in the browser), session timeout enforcement.

## Evidence
- `afrinov-platform/apps/backend/src/modules/identity/auth.routes.ts:5-26`
- `afrinov-platform/apps/backend/src/modules/identity/identity.service.ts:7-33`
- `afrinov-platform/apps/backend/src/server.ts:105-108,114-178`
- `afrinov-platform/apps/backend/src/shared/authorization.ts:21-30`
- `afrinov-platform/apps/frontend/src/api/client.ts:29-37,65` — token in `localStorage`
