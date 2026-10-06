# Threat Model

| Threat | Relevant because | Mitigation |
|---|---|---|
| Unauthorized stock modification | Direct DB/API tampering with a balance | ADR-002: no direct balance writes anywhere; DB grants restrict INSERT-only on `inventory_transactions`, no UPDATE/DELETE |
| Privilege escalation | A Technician performing Approver-only actions | Server-side role checks on every mutating endpoint |
| Account compromise | Shared shop-floor terminals, weak passwords | Password policy, session timeout, audit trail to detect anomalous activity |
| Broken access control | Endpoint forgetting an authorization check | Shared middleware applied by default (deny-by-default), not opt-in per route |
| Audit log tampering | Someone covering their tracks after a bad edit | Append-only table, no application-level DELETE/UPDATE grant on `audit_log_entries` |
| Injection (SQL etc.) | Any user-input field | Parameterised queries/ORM throughout, no string-concatenated SQL |
| Sensitive data exposure | Stock value, supplier pricing could be commercially sensitive | Role-gated reporting (e.g. Viewer role scoped appropriately) |
