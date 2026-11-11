# Authentication Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** b673e3f + ADR-035 and ADR-036, 2026-11-11

| Element | Intended | Implemented |
|---|---|---|
| Login | Email/username + password | Email + password (`POST /api/v1/auth/login`) |
| Hashing | bcrypt/argon2, sufficient work factor | bcrypt, cost 12 |
| Session | Session or short-lived JWT + refresh token | JWT (HS256) for the idle time, renewed by `POST /auth/refresh` while the person is active; a sign-in ends 12 hours after it began (ADR-035) |
| Revocation | Logout invalidates the session/token | **Planned.** Logout removes the token from the browser only; deactivating a user blocks them on their next request (database check on every request) |
| Brute force | Lockout or rate limiting | 5 sign-in requests per minute per address (the proxy named in `TRUST_PROXY`), and 10 wrong passwords per account in 15 minutes (ADR-036) |
| Password change | Users change their own; administrators reset | Anyone changes their own with the current one; an Admin sets a temporary password that must be changed at the next sign-in. Either ends the account's other sign-ins (ADR-036) |
| Administrator lockout | — | A change that leaves no active Admin is refused, and nobody deactivates or demotes themselves (ADR-036) |
| Inactivity timeout | — | `security.sessionTimeoutMinutes` (60; 5 to 720). The server refuses a token older than the idle time in force now, so a shorter setting applies at once; the screen renews the token at most once a minute while the person works, warns in the last minute and ends the session when it runs out (ADR-035) |

The token is kept in the browser's `localStorage` under `afrinov.token`.

## Evidence
- `afrinov-platform/apps/backend/src/modules/identity/identity.service.ts:7-33`
- `afrinov-platform/apps/backend/src/server.ts:105-108,114-178`
- `afrinov-platform/apps/frontend/src/api/client.ts:29-37`
- `afrinov-platform/apps/backend/src/modules/identity/session-policy.ts` — idle time, 12-hour limit, `auth_time`
- `afrinov-platform/apps/backend/src/modules/identity/session.ts` — token issue; `auth.routes.ts` — `POST /auth/refresh`
- `afrinov-platform/apps/frontend/src/components/SessionKeeper.tsx`, `src/lib/session.ts` — renewal, warning, sign-out
