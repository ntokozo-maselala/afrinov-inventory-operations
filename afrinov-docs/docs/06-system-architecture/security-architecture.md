# Security Architecture (Overview)

See `10-security/` for the full detail; this is the architectural summary.

- Authentication: username/password (or SSO if the business already has
  one — TBD) issuing a session/JWT.
- Authorization: role-based, enforced in shared middleware, checked before
  every mutating use case executes (`architecture-principles.md` rule 6).
- Audit: every mutating use case writes an `AuditLogEntry` as part of the
  same transaction as the business change — never as an afterthought that
  can be skipped.
- Secrets (DB credentials, JWT signing key) via environment variables /
  secret manager, never committed to source control.
