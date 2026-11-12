# Authentication

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** feature/audit-p1-go-live-safety (ADR-036), 2026-11-11

- **JWT.** `POST /api/v1/auth/login` with `{ email, password }` returns
  `{ token, user }`. The token is signed HS256 with `JWT_SECRET` by
  `@fastify/jwt`, carries `sub`, `email`, `name`, `roles` and `auth_time`
  (when the sign-in began), and lasts the idle time in
  `security.sessionTimeoutMinutes`. Clients send `Authorization: Bearer <token>`.
  `GET /api/v1/auth/me` returns the token's user, with `mustChangePassword`.
- **Renewal (ADR-035).** `POST /api/v1/auth/refresh` with a valid token returns
  `{ token, user }`: a token for the idle time from now, for the same sign-in,
  with the account's roles as they are now. It is refused with 401 once the
  sign-in is 12 hours old, or when the account has been deactivated. Any request
  with a token older than the idle time in force now is refused with 401, so a
  shorter setting applies at once to everyone signed in.
- **Every authenticated request** verifies the token and then checks in
  the database that the user still exists and is active; a deactivated
  user is refused with 401 on the next request, without waiting for the
  token to expire. A sign-in that began before the account's password last
  changed is refused with 401 too (ADR-036).
- **Passwords (ADR-036).** `POST /api/v1/auth/password` with
  `{ currentPassword, newPassword }` changes your own (8 to 128 characters,
  not the one in use), ends every other sign-in and returns `{ token, user }`.
  An Admin sets a temporary password for someone else with
  `POST /api/v1/users/:id/password`; until that person chooses their own, only
  `/auth/me`, `/auth/refresh` and `/auth/password` answer them (403
  otherwise).
- **Credentials:** email (stored lower case) and password, hashed with
  bcrypt at cost 12; passwords are never returned. Wrong email, wrong
  password and inactive account all give the same
  `401 UNAUTHENTICATED "Invalid credentials"`.
- **No anonymous access** to any endpoint that reads or writes business
  data; only login and the health checks are public.
- **Accounts are created by an administrator** (`POST /users`); there is no
  self-registration (ADR-006).
- **Login rate limit:** 5 requests per minute per IP on
  `/api/v1/auth/login` and `/api/v1/auth/password`, counted separately from
  the general limit (`RATE_LIMIT_AUTH`), and 10 wrong passwords per account in
  15 minutes. Behind a proxy, `TRUST_PROXY` names it so the address counted is
  the person's (`12-operations/reverse-proxy.md`).
- **Planned:** server-side logout/revocation (logging out only discards the
  token in the browser).

## Evidence
- `afrinov-platform/apps/backend/src/modules/identity/auth.routes.ts:5-26`
- `afrinov-platform/apps/backend/src/modules/identity/identity.service.ts:7-33`
- `afrinov-platform/apps/backend/src/server.ts:105-108,114-178`
- `afrinov-platform/apps/backend/src/shared/authorization.ts:21-30`
- `afrinov-platform/apps/frontend/src/api/client.ts:29-37,65` — token in `localStorage`
