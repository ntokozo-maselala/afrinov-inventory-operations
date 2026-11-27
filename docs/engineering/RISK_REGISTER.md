<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-ENG-008</b></td>
<td align="center"><b><i>Risk register</i></b><br><i>Engineering Assurance</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-ENG-008 updated=2026-11-27 by="Ntokozo Maselala" body=bb31690d0223 -->

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
| OPS-01 | High (release gate) | No deployment workflow, backup/restore runbook, restore evidence, or alerting in the repository | No deployment workflow; backup service with off-site copy, restore test, Dashboard warnings and a CI drill (ADR-037); not yet set up on a production host | Operators cannot reliably recover data or roll back a failed release | Supply topology, production backup and restore evidence, RPO/RTO, alerting proof | Platform/operations owner | Open — backups built, production setup and evidence needed |
| SEC-03 | High if Compose is deployed on a reachable host | Compose publishes PostgreSQL on all interfaces and the API uses the superuser account | `docker-compose.yml` port mapping `5432:5432`; `POSTGRES_USER` used by the API. 2026-11-27: seen in practice on a developer machine (`0.0.0.0:5432` and `[::]:5432` listening) | Direct database attack; API compromise inherits superuser rights | Confirm deployment; restrict ingress; separate migration and runtime DB roles | Platform/operations owner | **Partly fixed** 2026-11-27 (PRR-04): the production overlay already bound the database and API to `127.0.0.1` (`!override`); now `docker-compose.yml` does too, so a stack started without the overlay is closed to the network (`docker compose config` checked for the file alone, with the overlay, and the test profile). Open: the API still connects as the database owner; separate migration and runtime roles need a design decision |
| GATE-02 | Medium | `main` is not protected: no branch protection, and the one ruleset ("Restrictions") is disabled. The gates run on every pull request but nothing requires them to pass, or a pull request at all, before a change reaches `main` | `gh api repos/…/branches/main/protection` → 404 "Branch not protected"; `gh api repos/…/rulesets` → `enforcement: disabled` (2026-11-27). Already listed as owner action in `IMPLEMENTATION_ROADMAP.md`, Priority 1 | A change that fails typecheck, tests, migration drift or secret scanning can still be pushed or merged to `main`, from which production is installed (`deployment.md`, "Installing a new version") | Require the checks in `CI_CD_ARCHITECTURE.md` on `main`, block force pushes and deletion; with one maintainer, require the pull request and checks rather than a second reviewer | Repository owner | **Open — owner action** (a repository setting; not changed by the review) |
| SEC-08 | Low (alerts rated High by CodeQL) | Four open CodeQL alerts on a public repository: a polynomial regular expression in `cleanWebsite` (`procurement/supplier-fields.ts`, alert 5) and incomplete Markdown escaping in three import reports (`migration/workbook-report.ts`, `vendor-list.ts`, `reconciliation.ts`, alerts 1–3) | `gh api …/code-scanning/alerts?state=open` (2026-11-27). The API caps `website` at 200 characters, so the regex was not reachable remotely; the reports are written by operator-run import tools from a trusted workbook. Measured: the old regex took 11, 46, 182 and 720 ms for 5k, 10k, 20k and 40k separators | Event-loop stall if a long value ever reached the regex (vendor-list import); a report value ending in `\` could break a Markdown table | Linear trim in `cleanWebsite`; one `mdCell` that escapes backslashes before pipes (`migration/markdown.ts`) | Backend owner | **Fixed in code** 2026-11-27 (PRR-03), with `supplier-fields.test.ts` (old output kept for every mix of separators; linear-time check) and `markdown.test.ts`. The alerts close when CodeQL next runs on `main` |
| SUPPLY-02 | Low | ESLint 9 is out of support upstream ("This version is no longer supported", `npm ci`, 2026-11-27); ESLint 10 is held back because `eslint-plugin-react@7.37.5` peers `eslint` ≤ 9 | `npm view eslint-plugin-react@latest peerDependencies.eslint` | No security fixes for a development-only tool; nothing ships in the runtime image (`npm prune --omit=dev`) | Move to ESLint 10 when the plugin supports it (`AGENTS.md`, "Held back") | Engineering productivity | Accepted — blocked upstream; re-check with `npm outdated` |
| DATA-03 | Medium | `inventory_balances` foreign keys missing from migrations | Drift check emitted two `AddForeignKey` statements | Orphan balance rows; misleading reports | Migration `20260101000027` with orphan preflight | Backend owner | **Fixed & verified** |
| AUD-01 | Medium | A business change (user, material, project, setting) could commit without its audit record | Source review + failure-injection tests reproduced the orphaned change in each service | Administrative and inventory changes with no audit history | Wrap each mutation and its audit record in one transaction | Backend owner | **Fixed & verified** |
| SEC-06 | Medium (conditional) | SPA stores bearer token in `localStorage`; production CSP undefined in this repo | Token persistence confirmed; no injection sink found; host CSP unknown | XSS or unsafe third-party script could exfiltrate a reusable token | Define host CSP; review token lifetime/storage in a scoped frontend package | Frontend/host owner | Open — out of scope |
| ARCH-01 | Medium | Last active administrator can demote or deactivate themselves | `identity.service.ts` update has no last-admin guard | Administrative lockout; recovery needs direct DB access | `UserService.update` refuses a change that leaves no active Admin, or that brings two or more down to one (`MIN_ADMINS` = 2), under the `afrinov:admins` lock; nobody deactivates themselves or removes their own Admin role (`identity.service.ts`, `identity.service.test.ts`) | Product + backend owner | **Fixed & verified** 2026-11-11 (ADR-036, commit `a35db69`) |
| SEC-05 | Medium (conditional) | Rate limiting may key all clients as the proxy; counters are per-process | `server.ts` rate-limit config; `trustProxy` from `TRUST_PROXY` (addresses only) and a per-account limit (ADR-036); in-memory store | Shared-IP lockout if `TRUST_PROXY` is left unset behind a proxy; weak cluster-wide enforcement | Set `TRUST_PROXY` to the proxy (`12-operations/reverse-proxy.md`); shared store only if more than one process | Platform owner | Mitigated in code — needs `TRUST_PROXY` set at deployment |
| SUPPLY-01 | Medium | Actions referenced by mutable tags | Workflow inspection | Upstream tag move could inject code into CI | Pin to commit SHAs; least-privilege `permissions` | Engineering productivity | **Fixed & verified** |
| GATE-01 | Medium | No dependency-audit, secret-scan, or migration-drift gate | Workflow inspection | Vulnerable dependency, leaked secret, or schema drift could merge unnoticed | `security-ci.yml` + `migration-drift` job | Engineering productivity | **Fixed & verified** |
| ARCH-02 | Low | No idempotency contract for repeated POSTs | Inventory mutations now accept an `Idempotency-Key` and replay the stored response; procurement/master-data writes do not | A client retry of an inventory mutation replays instead of duplicating; other writes can still duplicate | Extend the same key contract to the remaining write endpoints | Product + backend owner | Partly resolved 2026-10-29 — inventory covered; rest open |
| DOC-01 | Low | Operations documentation drift (Node version, test env loading) | Prior audit comparison | Operators may follow incorrect instructions | Update alongside the next source change | Backend owner | Open |
| SEC-04 | Low | `CORS_ALLOW_ANY=true` can be enabled in production | `config.ts` returns `true` in every environment | Broad browser cross-origin access if explicitly enabled | Refused in production: `loadConfig()` will not start with `CORS_ALLOW_ANY=true`, and `resolveCorsOrigin` ignores it there (`src/shared/config.ts`; `security.regression.test.ts`) | Backend owner | **Fixed & verified** 2026-11-26 |

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
