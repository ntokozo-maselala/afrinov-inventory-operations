# Security Requirements

- All access authenticated; no anonymous read or write.
- All mutating actions authorized server-side by role.
- All mutating actions logged to the audit trail with actor, before/after,
  and timestamp.
- Passwords hashed (never plain text, never logged).
- Transport encrypted (HTTPS only).
- Sensitive configuration (DB credentials, signing keys) in environment
  variables/secret manager, never in source control.
