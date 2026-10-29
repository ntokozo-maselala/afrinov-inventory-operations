# Error Handling and User Feedback

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** working tree, 2026-10-29

This document is the operating guide for how the platform behaves when
something goes wrong: the error taxonomy, the backend contract, the frontend
presentation rules, logging and correlation, safe retry rules, and a
failure-scenario matrix with the tests that prove each row.

The contract itself lives in [`../08-api/error-model.md`](../08-api/error-model.md).
This page is the "how to work on it" companion.

## 1. Taxonomy

Errors are grouped by who is responsible and whether retrying can help. The
frontend maps the stable `code` (never the message) to approved copy.

| Class | Codes | Retryable | Who acts |
|---|---|---|---|
| Client validation | `VALIDATION_ERROR`, `BAD_REQUEST` | No (fix the input) | User |
| Authentication | `UNAUTHENTICATED` | No (sign in again) | User |
| Authorization | `FORBIDDEN` | No | User asks an administrator |
| Missing resource | `NOT_FOUND` | No | User navigates away |
| Business rule | `CONFLICT`, `INVALID_STATE`, `INSUFFICIENT_BALANCE` | No (change the request) | User |
| Throttling | `TOO_MANY_REQUESTS` | Yes, after a wait | User |
| Availability | `SERVICE_UNAVAILABLE`, `NETWORK_ERROR`, `TIMEOUT` | Yes | User retries; ops investigates |
| Unexpected defect | `INTERNAL_ERROR` | Maybe | Ops investigates |

Expected operational errors (validation, permissions, business rules) are
distinct from unexpected programming defects (`INTERNAL_ERROR`). The former
are logged at `warn` with a specific code; the latter at `error` with a stack
trace, and are the only class that should page someone.

## 2. Backend contract

- One envelope for every non-2xx response:
  `{ error: { code, message, details?, requestId? } }`.
- `code` is stable and machine-readable; the frontend switches on it.
- `message` is human-readable and already safe. Business-rule messages are
  shown verbatim by the client; nothing else is.
- Unexpected faults return the fixed `Internal server error`; the detail goes
  to the log only.
- Every response carries `x-request-id` (the Fastify request id), and every
  error body repeats it as `requestId`.
- Unmatched routes use the envelope too (`setNotFoundHandler`), so a mistyped
  URL is `NOT_FOUND`, not a Fastify default body.
- Malformed JSON and wrong content types are 400 (`FST_ERR_*` mapped to
  `BAD_REQUEST`), logged at `warn`.
- Database faults are classified by `classifyPrismaError` into
  `SERVICE_UNAVAILABLE` (503), `CONFLICT` (409), `NOT_FOUND` (404) or
  `VALIDATION_ERROR` (400); the raw driver text never leaves the process.

## 3. Frontend presentation rules

All user-facing error text is chosen in
`apps/frontend/src/lib/errorPresentation.ts`. Nothing else may render an
error message from an exception.

- The client switches on `code`. The server's `message` is shown only for the
  domain-wording codes (`VALIDATION_ERROR`, `CONFLICT`, `INVALID_STATE`,
  `INSUFFICIENT_BALANCE`), and even then only after a safety check that
  rejects anything resembling a stack trace, a path, a driver error or an
  internal identifier.
- That substitution happens in two places, deliberately. The API client
  (`api/client.ts`) replaces the server message with its own fixed copy for
  every non-domain code *at the boundary*, so a screen that renders
  `err.message` directly still cannot show server text. `presentError` then
  adds the richer heading/retry/tone layer for components that use it.
- Unknown or malformed errors fall back to the generic
  "Something didn't go as expected" message. `presentError` never throws and
  never returns raw text.
- The API client tolerates a missing, empty or non-JSON body and derives a
  code from the HTTP status.
- `ErrorState` renders a full-page or inline failure; `StaleDataNotice`
  renders the non-blocking warning when a refresh failed but earlier data is
  still on screen. The two are mutually exclusive per data source.
- Retry is offered only for retryable classes. `FORBIDDEN` and `NOT_FOUND`
  never show a retry button.

### Channel choice
| Situation | Channel |
|---|---|
| Field-level validation | Inline, under the field (`Field error=`) |
| Short-lived operation feedback | Toast (`useToast`) |
| Recoverable page/data failure | Inline `ErrorState` panel |
| Unavailable page content | Full-page `ErrorState` |
| Failed refresh with data on screen | `StaleDataNotice` |
| Serious failure needing action | Inline panel, never a toast alone |
| Session expiry | Redirect to sign-in with an explanatory `Alert` |
| Unexpected render failure | `ErrorBoundary` fallback |

## 4. Error boundaries

`ErrorBoundary` wraps every route (via `RouteBoundary` in `App.tsx`) and the
sign-in page. It:

- shows a calm fallback inside the app shell, so the sidebar and header stay
  usable;
- reports the failure to the diagnostics sink with the boundary name;
- resets only on an explicit user action or a route change (the boundary is
  keyed by path), never by itself.

It does **not** catch asynchronous failures, event-handler errors or server
faults. Those are covered by the API client, the diagnostics sink
(`unhandledrejection`/`error` listeners installed in `main.tsx`) and the
backend contract respectively.

## 5. Logging, correlation and observability

- Every request has a Fastify request id, echoed as `x-request-id` and in the
  error `requestId`. A user can quote it to support; it identifies exactly one
  log line.
- Expected failures log at `warn` with `{ requestId, code, statusCode }`.
- Unexpected defects log at `error` with the stack (`app.log.error({ err,
  requestId })`).
- Passwords, tokens, cookies, connection strings and sensitive request bodies
  are never logged. Error responses never echo request bodies.
- Client-side failures are captured by the diagnostics sink
  (`src/lib/diagnostics.ts`), which keeps a bounded in-memory buffer and
  prints to the console in development only. It deliberately does not send
  anything over the network — see "Known limitations".

## 6. Safe retry and mutation reconciliation

- **Never auto-retry a mutation.** Stock issues, adjustments, receipts and
  reversals are not idempotent; a retry after a network interruption could
  double-post. Retries are always an explicit user action.
- **A failed read may be retried** freely (they are idempotent). Retry
  buttons are shown only for retryable classes.
- **Unknown mutation outcome:** if a request fails after being sent (network
  error or timeout), the UI does not claim success or failure. The user is
  told the outcome is unconfirmed and is directed to check the record
  (e.g. Movements) before repeating.
- **Duplicate submission prevention:** submit buttons disable while a mutation
  is in flight; a second click cannot issue a second request.
- **Stale data:** a failed refresh keeps the last good data visible with a
  `StaleDataNotice`. The figures are labelled as not freshly confirmed; they
  are never presented as current.

## 7. Development versus production

- In development, `reportError` also prints the raw error to the console, and
  Vite's own overlay still shows build and module errors. Developer
  diagnostics stay useful.
- In production, no framework overlay, stack trace or build diagnostic is
  ever rendered in the application UI. The user sees only approved copy.

## 8. How to add a new error

1. Add the code to `Errors` in `apps/backend/src/shared/errors.ts` with the
   right HTTP status and a safe, user-appropriate default message.
2. Add the code to `../08-api/error-model.md`.
3. Add a case to `titleFor` in
   `apps/frontend/src/lib/errorPresentation.ts`. Decide `retryable` and
   `tone` deliberately. If the server owns the wording, add the code to
   `DOMAIN_MESSAGE_CODES`; otherwise supply client copy in `SAFE_MESSAGES`
   (`api/client.ts`) so screens that render `err.message` stay safe.
4. Add a unit test to `errorPresentation.test.ts` (mapping) and, if the
   backend emits it, to `apps/backend/src/shared/errors.test.ts`.
5. If the failure is reachable from a page, extend
   `e2e/error-handling.spec.ts`.

## 9. Failure-scenario matrix

| Scenario | Technical cause | HTTP | User-facing message | Recovery | Diagnostic evidence | Tests |
|---|---|---|---|---|---|---|
| Backend unavailable | DB unreachable (`P1001`…) or proxy 502/503 | 503 | "We're having trouble connecting" | "Try again" | `warn` "Database error", `code: SERVICE_UNAVAILABLE` | `errors.test.ts`, `client.test.ts`, `errorPresentation.test.ts`, `e2e/error-handling.spec.ts` |
| Connection lost | `fetch` rejects | — | "Connection interrupted" | "Retry" | client `NETWORK_ERROR` | `client.test.ts`, `e2e` |
| Request timeout | 20s abort | — | "This is taking longer than expected" | "Try again" | client `TIMEOUT` | `client.test.ts` |
| Invalid form input | Zod failure | 400 | "A few details need attention" + field guidance | Fix fields | `warn` "ApiError", `code: VALIDATION_ERROR` | `errorPresentation.test.ts` |
| Permission denied | Missing permission | 403 | "You don't have access to this action" | Contact admin | `warn` "ApiError", `code: FORBIDDEN` | `errorPresentation.test.ts`, `server.test.ts` |
| Session expired | Token rejected | 401 | "Your session has ended" | Sign in again | `warn`, `code: UNAUTHENTICATED` | `auth.test.tsx`, `client.test.ts`, `e2e` |
| Record missing | `P2025` / no row | 404 | "We couldn't find that record" | Navigate back | `warn`, `code: NOT_FOUND` | `errors.test.ts`, `server.test.ts` |
| Unknown route | No handler | 404 | "We couldn't find that record" | Navigate back | `info` "Route not found" | `server.test.ts` |
| Business-rule conflict | Stock below zero, duplicate, bad state | 409/422 | Server's own wording | Change the request | `warn`, `code` set | `errorPresentation.test.ts`, `e2e` |
| Rate limited | Too many requests | 429 | "Too many requests" | Wait, retry | `warn`, `code: TOO_MANY_REQUESTS` | `errors.test.ts`, `client.test.ts` |
| Unexpected defect | Unhandled throw | 500 | "Something didn't go as expected" + reference | Retry; contact admin | `error` with stack + requestId | `errors.test.ts`, `server.test.ts` |
| Render failure | Component throws | — | Boundary fallback | "Try again" | diagnostics `boundary:<name>` | `ErrorBoundary.test.tsx` |
| Malformed error body | Non-JSON / no envelope | any | Status-derived copy | Depends | client fallback path | `client.test.ts` |
| Stale refresh | Reload fails with data shown | any | "Could not refresh" notice | "Try again" | client error retained | `useApi` (`stale`) |

## 10. Known limitations and outstanding risks

- **No server-side error-collection endpoint.** The client diagnostics sink is
  in-memory and console-only in development; nothing is shipped off-box. The
  integration point is `reportError` in `src/lib/diagnostics.ts`. Wiring a real
  collector is a follow-up that needs a destination and a retention decision.
- **No circuit breaker or offline queue.** The application is a single
  browser client against one API. The evidence for those patterns is absent;
  the simpler bounded retry plus explicit user retry is what is implemented.
- **Mutation reconciliation is advisory.** The UI tells the user the outcome
  is unconfirmed and points them at the record to check; it does not
  automatically reconcile against the server. A server-side idempotency key
  per mutation would let it do so and is the recommended next step for
  inventory mutations.
- **Integration/E2E tests require infrastructure.** The backend integration
  suite and the Playwright suite need a PostgreSQL 16 `_test` database and
  installed browsers (see `docs/audits/system/FAILURE_REGISTER.md` F-07).
  Both suites were executed against that live stack on 2026-10-29 and passed
  (backend 124 passed / 3 conditional skips; Playwright 7/7), so the matrix
  rows are covered end to end and not by unit tests alone.
