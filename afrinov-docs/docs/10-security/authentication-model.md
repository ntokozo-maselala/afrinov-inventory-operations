# Authentication Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Element | Intended | Implemented |
|---|---|---|
| Login | Email/username + password | Email + password (`POST /api/v1/auth/login`) |
| Hashing | bcrypt/argon2, sufficient work factor | bcrypt, cost 12 |
| Session | Session or short-lived JWT + refresh token | JWT (HS256), 12 hours, no refresh token |
| Revocation | Logout invalidates the session/token | **Planned.** Logout removes the token from the browser only; deactivating a user blocks them on their next request (database check on every request) |
| Brute force | Lockout or rate limiting | Rate limit: 5 login requests per minute per IP. No account lockout |
| Inactivity timeout | — | **Planned.** The `security.sessionTimeoutMinutes` setting can be edited but nothing enforces it (TD-010) |

The token is kept in the browser's `localStorage` under `afrinov.token`.

## Evidence
- `afrinov-platform/apps/backend/src/modules/identity/identity.service.ts:7-33`
- `afrinov-platform/apps/backend/src/server.ts:105-108,114-178`
- `afrinov-platform/apps/frontend/src/api/client.ts:29-37`
- `afrinov-platform/apps/backend/src/modules/settings/settings.service.ts:192` — `security.sessionTimeoutMinutes` (only read by the settings pages)
