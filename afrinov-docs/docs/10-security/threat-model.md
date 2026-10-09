# Threat Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Threat | Relevant because | Mitigation (intended) | Status in code |
|---|---|---|---|
| Unauthorized stock modification | Direct DB/API tampering with a balance | ADR-002: no direct balance writes; DB grants restrict `inventory_transactions` to INSERT-only | API: no endpoint sets a balance or edits a ledger row. DB grants: **Planned** — no GRANT/REVOKE in migrations (TD-006) |
| Privilege escalation | A Technician performing Approver-only actions | Server-side role checks on every mutating endpoint | Met (`requirePermission` on every mutating route) |
| Account compromise | Shared shop-floor terminals, weak passwords | Password policy, session timeout, audit trail | Partial: minimum password length 8 on user creation; login rate limit; no lockout; session timeout not enforced (TD-010) |
| Broken access control | Endpoint forgetting an authorization check | Shared middleware applied by default (deny-by-default) | Not as intended: checks are per-route calls; several reads need only authentication (TD-014) |
| Audit log tampering | Someone covering their tracks after a bad edit | Append-only table, no UPDATE/DELETE grant on `audit_log_entries` | No API path edits it; no DB grant restriction (TD-006) |
| Injection (SQL etc.) | Any user-input field | Parameterised queries/ORM throughout | Met: Prisma queries; the few raw queries use tagged templates (parameterised) |
| Sensitive data exposure | Stock value, supplier pricing could be commercially sensitive | Role-gated reporting | Partial: reports need `view:reports`, which every role (including VIEWER) holds; material unit costs are readable by any signed-in user via `/materials` |
| Cross-site requests from other origins | Browser-based SPA with bearer token | — | CORS allow-list; credentialed wildcard only with explicit `CORS_ALLOW_ANY=true` |

## Evidence
- `afrinov-platform/apps/backend/prisma/migrations/` — no GRANT, REVOKE or TRIGGER
- `afrinov-platform/apps/backend/src/modules/identity/user.routes.ts:7-12` — password minimum 8
- `afrinov-platform/apps/backend/src/server.ts:78-83,114-138`
- `afrinov-platform/apps/backend/src/shared/config.ts:126-141`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts:70` — tagged-template raw query
- `afrinov-platform/apps/backend/src/shared/permissions.ts:42-91`
