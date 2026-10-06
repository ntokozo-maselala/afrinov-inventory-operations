# Error Model

Standard error envelope for every non-2xx response:
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Cannot issue 20 units of M16X40 8.8 BLACK HEX SET SCREW from D-1: only 12 available.",
    "details": { "materialId": "...", "locationId": "...", "requested": 20, "available": 12 }
  }
}
```

## Standard codes
| HTTP status | Code | Meaning |
|---|---|---|
| 400 | VALIDATION_ERROR | Request shape/values invalid |
| 401 | UNAUTHENTICATED | No/invalid credentials |
| 403 | FORBIDDEN | Authenticated but not permitted |
| 404 | NOT_FOUND | Resource doesn't exist |
| 409 | CONFLICT | e.g. duplicate supplier name, tool already checked out |
| 422 | INSUFFICIENT_BALANCE | Business-rule violation on a stock action |
| 500 | INTERNAL_ERROR | Unexpected server fault — logged, generic message returned to client |

Business-rule violations (insufficient balance, tool already checked out,
PO not editable outside DRAFT) always return a specific code and a
human-readable message referencing real entity names, following the AS-IS
lesson that people on the shop floor need to understand *why* an action
failed, not just that it did.
