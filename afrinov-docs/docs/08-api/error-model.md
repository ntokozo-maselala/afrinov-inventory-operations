# Error Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Standard error envelope for every non-2xx response:
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Cannot issue <requested> × <SKU>: only <available> available.",
    "details": { "materialId": "…", "locationId": "…", "requested": "<requested>", "available": "<available>" }
  }
}
```
`details` is optional; for validation failures it holds Zod's flattened
issues. Quantities in `details` are strings.

## Standard codes
| HTTP status | Code | Meaning |
|---|---|---|
| 400 | VALIDATION_ERROR | Request shape/values invalid, or a business validation (e.g. inactive material, return larger than what is still out) |
| 401 | UNAUTHENTICATED | No/invalid/expired token, inactive account, or wrong login |
| 403 | FORBIDDEN | Authenticated but missing the permission (`Missing permission: <code>`) |
| 404 | NOT_FOUND | Resource doesn't exist (also any route not registered, e.g. procurement when switched off) |
| 409 | CONFLICT | Duplicate (supplier, recipient, SKU, codes), already reversed, concurrent change, stock moved during a count |
| 409 | INVALID_STATE | Action not allowed in the record's current state (e.g. approving a non-pending PO, reversing a reversal) |
| 422 | INSUFFICIENT_BALANCE | The movement would take stock below zero |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |
| 500 | INTERNAL_ERROR | Unexpected server fault — logged, generic message returned to client |

Business-rule violations return a specific code and a human-readable
message naming the item (SKU) and quantities. The original intent to name
the location in the message (e.g. "from D-1") is not implemented; the
location id is in `details`. "Tool already checked out" is **Planned** with
the tool feature.

## Evidence
- `afrinov-platform/apps/backend/src/shared/errors.ts:2-33`
- `afrinov-platform/apps/backend/src/server.ts:150-153,180-199` — 401 shape and central handler
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:317-322` — insufficient-balance message
- `afrinov-platform/apps/backend/src/modules/inventory/stock-count.service.ts:67-72`
