# Error Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** working tree, 2026-10-29

Standard error envelope for every non-2xx response:
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Cannot issue <requested> × <SKU>: only <available> available.",
    "details": { "materialId": "…", "locationId": "…", "requested": "<requested>", "available": "<available>" },
    "requestId": "req-42"
  }
}
```
`details` and `requestId` are optional. `requestId` is the correlation id for
the request: it matches the `x-request-id` response header (set on every
response, success or error) and the `requestId` field of the server log line
for that request, so a user-reported reference can be traced to one log entry.
For validation failures `details` holds Zod's flattened issues. Quantities in
`details` are strings.

`message` is always safe to display: it never contains a stack trace, a
filesystem path, a SQL statement, a database table name, a connection string
or a raw driver message. Unexpected faults are answered with the fixed
`Internal server error`; the detail is logged, not returned.

## Standard codes
| HTTP status | Code | Meaning |
|---|---|---|
| 400 | VALIDATION_ERROR | Request shape/values invalid, or a business validation (e.g. inactive material, return larger than what is still out) |
| 400 | BAD_REQUEST | The request could not be parsed (malformed JSON, unsupported content type) |
| 401 | UNAUTHENTICATED | No/invalid/expired token, inactive account, or wrong login |
| 403 | FORBIDDEN | Authenticated but missing the permission (`Missing permission: <code>`) |
| 404 | NOT_FOUND | Resource doesn't exist (also any route not registered, e.g. procurement when switched off) |
| 409 | CONFLICT | Duplicate (supplier, recipient, SKU, codes), already reversed, concurrent change, stock moved during a count |
| 409 | INVALID_STATE | Action not allowed in the record's current state (e.g. approving a non-pending PO, reversing a reversal) |
| 422 | INSUFFICIENT_BALANCE | The movement would take stock below zero |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |
| 500 | INTERNAL_ERROR | Unexpected server fault — logged, generic message returned to client |
| 503 | SERVICE_UNAVAILABLE | The database (or another required dependency) is unreachable or timed out. A retryable availability fault, distinct from a 500 defect |

Business-rule violations return a specific code and a human-readable
message naming the item (SKU) and quantities. The original intent to name
the location in the message (e.g. "from D-1") is not implemented; the
location id is in `details`. Checking out more of a tool than is on the shelf
is refused with the same insufficient-balance error.

## Unmatched routes and malformed bodies
- A route that is not registered answers 404 with the envelope above
  (`code: NOT_FOUND`), not Fastify's default `{ message, error, statusCode }`
  body. This keeps every failure classifiable by `code` on the client.
- A malformed JSON body, or a body sent with the wrong content type, answers
  400 with a `code` (Fastify's own `FST_ERR_*` refusal, mapped to
  `BAD_REQUEST`/`VALIDATION_ERROR`). It is the caller's mistake and is logged
  at `warn`, not `error`.

## Database faults
`classifyPrismaError` (`shared/errors.ts`) maps Prisma's error codes onto the
contract: unreachable/timeout codes (`P1000`–`P1003`, `P1008`, `P1010`,
`P1017`) become 503 `SERVICE_UNAVAILABLE`; unique violations (`P2002`) and
foreign-key violations (`P2003`) become 409 `CONFLICT`; a missing row
(`P2025`) becomes 404 `NOT_FOUND`; malformed values (`P2000`, `P2005`–`P2007`,
`P2011`–`P2013`, `P2019`) become 400 `VALIDATION_ERROR`. The raw driver
message is never returned. Any other Prisma code falls through to the generic
500 `INTERNAL_ERROR`.

## Evidence
- `afrinov-platform/apps/backend/src/shared/errors.ts` — factory, `classifyPrismaError`, `toErrorEnvelope`
- `afrinov-platform/apps/backend/src/server.ts` — `onSend` request-id hook, `setNotFoundHandler`, central `setErrorHandler`
- `afrinov-platform/apps/backend/src/openapi/document.ts` — `Error` schema (`code`, `message`, `details`, `requestId`)
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts` — insufficient-balance message
- `afrinov-platform/apps/backend/src/modules/inventory/stock-count.service.ts` — stock-count conflict
- `afrinov-platform/apps/frontend/src/lib/errorPresentation.ts` — the client-side mapping of these codes to user-facing copy
- Tests: `apps/backend/src/shared/errors.test.ts`, `apps/backend/src/server.test.ts`, `apps/frontend/src/api/client.test.ts`, `apps/frontend/src/lib/errorPresentation.test.ts`
