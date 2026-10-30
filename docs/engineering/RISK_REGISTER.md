# Risk register

Prioritised risks with evidence, impact, remediation, owner and status. This
extends the prior audit (`audit/07_FINDINGS_AND_READINESS.md`); it does not
replace it. Status reflects what was verified in this workstream.

Severity is the prior audit's rating where one exists. "Owner" is the
accountable role; where the repository does not identify a person, the role is
named so it can be assigned.

| ID | Severity | Risk | Evidence | Impact | Remediation | Owner | Status |
|---|---|---|---|---|---|---|---|
| SEC-07 | High | Bootstrap admin password committed in reachable Git history; repository is public | gitleaks finding at commit `db1501ac0b`; file removed from tree but blob remains in history | Account takeover if the account still exists or the password is reused | Rotate the password / delete the account; confirm no reuse; record outcome | Application/security owner | **Open — action required** |
| OPS-01 | High (release gate) | No deployment workflow, backup/restore runbook, restore evidence, or alerting in the repository | No deployment workflow; no runbook; no restore drill found | Operators cannot reliably recover data or roll back a failed release | Supply topology, backup/restore evidence, RPO/RTO, alerting proof | Platform/operations owner | Open — external evidence needed |
| SEC-03 | High if Compose is deployed on a reachable host | Compose publishes PostgreSQL on all interfaces and the API uses the superuser account | `docker-compose.yml` port mapping `5432:5432`; `POSTGRES_USER` used by the API | Direct database attack; API compromise inherits superuser rights | Confirm deployment; restrict ingress; separate migration and runtime DB roles | Platform/operations owner | Partly resolved 2026-10-30 — Compose publishes PostgreSQL on 127.0.0.1 only; separate DB roles still open (needs hosting) |
| DATA-03 | Medium | `inventory_balances` foreign keys missing from migrations | Drift check emitted two `AddForeignKey` statements | Orphan balance rows; misleading reports | Migration `20260101000027` with orphan preflight | Backend owner | **Fixed & verified** |
| AUD-01 | Medium | A business change (user, material, project, setting) could commit without its audit record | Source review + failure-injection tests reproduced the orphaned change in each service | Administrative and inventory changes with no audit history | Wrap each mutation and its audit record in one transaction | Backend owner | **Fixed & verified** |
| SEC-06 | Medium (conditional) | SPA stores bearer token in `localStorage`; production CSP undefined in this repo | Token persistence confirmed; no injection sink found; host CSP unknown | XSS or unsafe third-party script could exfiltrate a reusable token | Define host CSP; review token lifetime/storage in a scoped frontend package | Frontend/host owner | Open — out of scope |
| ARCH-01 | Medium | Last active administrator can demote or deactivate themselves | `identity.service.ts` update has no last-admin guard | Administrative lockout; recovery needs direct DB access | Agree a last-admin policy and recovery route; enforce transactionally | Product + backend owner | **Fixed & verified** 2026-10-30 — refused with 409 inside the transaction, serialised by an advisory lock (unit tests) |
| SEC-05 | Medium (conditional) | Rate limiting may key all clients as the proxy; counters are per-process | `server.ts` rate-limit config; no `trustProxy`; in-memory store | Shared-IP lockout or weak cluster-wide enforcement | Confirm topology; trust only known proxies; shared store if required | Platform owner | Partly resolved 2026-10-30 — `TRUST_PROXY` setting added; per-account lockout added (PRA-09); value and shared store depend on hosting |
| SUPPLY-01 | Medium | Actions referenced by mutable tags | Workflow inspection | Upstream tag move could inject code into CI | Pin to commit SHAs; least-privilege `permissions` | Engineering productivity | **Fixed & verified** |
| GATE-01 | Medium | No dependency-audit, secret-scan, or migration-drift gate | Workflow inspection | Vulnerable dependency, leaked secret, or schema drift could merge unnoticed | `security-ci.yml` + `migration-drift` job | Engineering productivity | **Fixed & verified** |
| ARCH-02 | Low | No idempotency contract for repeated POSTs | Inventory mutations now accept an `Idempotency-Key` and replay the stored response; procurement/master-data writes do not | A client retry of an inventory mutation replays instead of duplicating; other writes can still duplicate | Extend the same key contract to the remaining write endpoints | Product + backend owner | Partly resolved 2026-10-29 — inventory covered; rest open |
| DOC-01 | Low | Operations documentation drift (Node version, test env loading) | Prior audit comparison | Operators may follow incorrect instructions | Update alongside the next source change | Backend owner | Open |
| SEC-04 | Low | `CORS_ALLOW_ANY=true` can be enabled in production | `config.ts` returns `true` in every environment | Broad browser cross-origin access if explicitly enabled | Reject in production or record a reviewed exception | Backend owner | **Fixed & verified** 2026-10-30 — `loadConfig` refuses it in production |

### Added by the production readiness assessment (2026-10-30)

See `docs/audits/production-readiness/` for evidence and the remaining items.

| ID | Severity | Risk | Evidence | Impact | Remediation | Owner | Status |
|---|---|---|---|---|---|---|---|
| PRA-01 | High | Production start path seeded demo business data and rewrote demo materials on every restart | `seed.ts` `main()`; Compose command; probe found 12 materials, 27 movements after seeding | Fictitious stock in the system of record, undeletable under ADR-002 | Bootstrap-only seed; demo behind `--demo`, refused in production (ADR-022); CI check | Backend owner | **Fixed & verified** 2026-10-30 |
| PRA-05 | High | No password change, reset or forced first-login change | No route or field existed | A leaked or admin-chosen password could not be replaced in the product | Change, admin reset, forced change, session cut-off (ADR-023) | Backend + frontend owner | **Fixed & verified** 2026-10-30 |
| PRA-06 | High | Creator could approve their own purchase order; auto-approve ignored limits | `approve()` had no creator check | One person could commit spend unreviewed | Approver ≠ creator; auto-approve bounded by the submitter's authority (ADR-021) | Business owner + backend | **Implemented & verified** 2026-10-30 — policy confirmation pending |
| PRA-07 | Medium | PO edit and approval could interleave | No row lock in `update`/`approve` | Order approved at a total nobody checked | `SELECT … FOR UPDATE` in both | Backend owner | **Fixed & verified** 2026-10-30 (concurrent integration test) |
| PRA-08 | Medium | No metrics or alerting; request IDs were per-process counters | `req-1` in logs | Incidents hard to detect and trace | UUID request IDs done; central logs, uptime check and alerts need hosting | Platform owner | Partly resolved 2026-10-30 |
| PRA-09 | Medium | Sign-ins not audited; no per-account lockout | No audit or lockout code | Credential attacks invisible | Every attempt audited; 5 failures lock 15 min (ADR-023) | Backend owner | **Fixed & verified** 2026-10-30 |
| PRA-11 | Medium | Session timeout setting was enforced nowhere | Setting not read | Shared PCs stayed signed in for 12 h | Browser idle sign-out driven by the setting | Frontend owner | **Fixed & verified** 2026-10-30 |
| PRA-14 | Medium | No database CHECK constraints behind the invariants | No application CHECK constraints | Out-of-band writes could store negative stock or invalid orders | Migration `20260101000032` with preflight | Backend owner | **Fixed & verified** 2026-10-30 |
| PRA-16 | Low | Login timing revealed which emails have accounts | Early return before bcrypt | Account enumeration | Dummy bcrypt comparison for unknown emails | Backend owner | **Fixed** 2026-10-30 |
| PRA-18 | Low | No database statement timeout | Pool config | Runaway queries starve the pool | `statement_timeout` 30 s (`DB_STATEMENT_TIMEOUT_MS`); pagination and baseline still open | Backend owner | Partly resolved 2026-10-30 |
| PRA-19 | Low | No automated check that every route authenticates | Manual scan only | A new route could ship open | `src/route-guard.test.ts` | Backend owner | **Fixed & verified** 2026-10-30 |

## Residual risks introduced by this workstream

- The new `migration-drift` gate can fail on a pre-existing drift elsewhere in
  the schema if one exists. Verified clean as of this change; if it fires, treat
  it as a real finding, not a flaky gate.
- The gitleaks baseline suppresses exactly one known historical finding. If that
  fingerprint no longer matches (for example after a history rewrite), the gate
  will surface the finding again — which is the intended, safe direction.
- The AUD-01 transaction wrapping changes the failure mode of an audit write
  from "change committed, caller sees error" to "nothing committed, caller sees
  error". This is the intended behaviour, but it means an audit-write fault now
  blocks the administrative change. That is correct for an accountability
  system.

## Not claimed

No production environment was accessed. No live credentials were tested. No
DAST, penetration test, or infrastructure assessment was performed. The absence
of a finding for an area that was not assessed is not evidence that the area is
safe.
