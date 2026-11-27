<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-ENG-013</b></td>
<td align="center"><b><i>Remediation plan</i></b><br><i>Engineering Assurance</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-ENG-013 updated=2026-11-27 by="Ntokozo Maselala" body=7d54db683184 -->

# Remediation plan

**Status:** DRAFT · **Owner:** Product/Engineering · **Baseline:** `71395dc`, 2026-11-27

What the production readiness review of 2026-11-27 found, what was changed on the
branch `chore/production-readiness-review`, and what is left, in order. The evidence
for each finding is in
[`production-readiness-audit.md`](../audits/system/production-readiness-audit.md);
command output is in [`VERIFICATION_EVIDENCE.md`](VERIFICATION_EVIDENCE.md).

Priorities: **P0** critical (security, data or operational threat now), **P1** high
(a serious readiness gap), **P2** medium, **P3** low, **P4** informational. Register
IDs (TD-, SEC-, GATE-, SUPPLY-) are where each finding is tracked from now on; the
PRR- IDs are this review's.

## Change register

| ID | Finding | Priority | Change | Files affected | Tests | Status |
|---|---|---|---|---|---|---|
| PRR-01 | `main` unprotected | P1 | Branch protection enabled at the owner's request: pull request, six always-run checks, up to date, admins included, no force push or deletion | Repository setting; `CI_CD_ARCHITECTURE.md` | Read back with `gh api …/branches/main/protection` | **Partly fixed** 2026-11-27: Backend and Frontend CI not yet required (GATE-02) |
| PRR-02 | Eleven routes answer 500 to an unknown enum filter | P2 | `enumFilter` checks the value before Prisma; 400 VALIDATION_ERROR | `src/shared/query-filters.ts` (new); `modules/inventory/inventory.service.ts`, `material.service.ts`, `material.routes.ts`; `modules/reporting/reporting.service.ts`, `consumption.service.ts` | `query-filters.test.ts` (new, 9); `integration/query-filters.real-http.test.ts` (new, 22; 11 fail on the old code); probe 88 → 0 5xx | **Fixed & verified** (TD-029) |
| PRR-03 | Four High-rated CodeQL alerts | P2 | `cleanWebsite` trims by walking in from each end; one `mdCell` escapes `\` before `\|` | `modules/procurement/supplier-fields.ts`; `modules/migration/markdown.ts` (new), `workbook-report.ts`, `vendor-list.ts`, `reconciliation.ts` | `supplier-fields.test.ts` (new, 5: the old output for 4,096 mixes, a linear-time check); `markdown.test.ts` (new, 7) | **Fixed in code**; alerts close on the next CodeQL run on `main` (SEC-08) |
| PRR-04 | Base Compose file published the database and API on every interface | P2 | Both bound to `127.0.0.1` | `apps/backend/docker-compose.yml`; `deployment.md`, `apps/backend/README.md` (one sentence each) | `docker compose config` for the file alone, with the overlay, and with the test profile | **Fixed & verified** (SEC-03, part) |
| PRR-05 | `Number(q['limit'])` on `/reports/movement-history` | P4 | None | — | Probe: no 5xx | Deferred: change with the next edit to the route |
| PRR-06 | Fixtures used categories the schema lacks | P3 | The category-filter test uses a real category and checks the refusal | `modules/reporting/reporting.service.test.ts` | That file 35 / 35 | **Partly fixed**: the other fixture values remain |
| PRR-07 | TD-020, TD-021, TD-023 needed no decision | P3 | Schema comments corrected; `task_context.md` brought up to date; `GET /audit` tested | `prisma/schema.prisma` (comments only); `task_context.md`; `modules/audit/audit.routes.test.ts` (new, 12) | Drift check empty; `audit.routes.test.ts` 12 / 12 | **Fixed & verified** |
| PRR-08 | ESLint 9 out of support | P4 | None | — | — | Accepted — blocked upstream (SUPPLY-02) |
| PRR-09 | `GET /` shows environment and version without sign-in | P4 | None | — | — | Informational |

Documentation changed with the code: the two registers, this plan, the audit, the
readiness assessment, the evidence and security records, the indexes, `AGENTS.md`,
`CHANGELOG.md` and the release process.

## Traceability

| ID | Finding → evidence | Decision | Implementation | Validation | Documentation |
|---|---|---|---|---|---|
| PRR-02 | Probe: 88 × 500 on 3 parameters of 11 routes; the log shows Prisma's "Invalid value for argument" | Check at each place a string becomes an enum, not at each route: the cast is the defect, and one check there covers every route that reaches it. An empty value stays "no filter", as `pageLimit` does | `enumFilter(raw, Enum, name)` at 6 cast sites and the `/locations` route | Real-HTTP test fails 11 / 22 on the old code, passes 22 / 22; probe rerun 0 × 5xx in 11,343 calls; Postman 1,223 / 1,223 | TD-029; `AGENTS.md` (query parameters) |
| PRR-03 | CodeQL alerts 1, 2, 3, 5; timing 11 → 720 ms as the length doubles three times | Replace the regex rather than suppress the alert; one escaping helper for the three copies | Linear trim; `mdCell` | Same output as the old regex for every 4-part mix of separators and text; 200,000 separators in under 500 ms; tables read back as written | SEC-08 |
| PRR-04 | `netstat`: `0.0.0.0:5432`, `[::]:5432` on a developer machine; `docker-compose.yml:12`, `:78` | Secure by default: the overlay already did this in production; nothing reached these ports from the network (CI uses its own services; the API uses the Compose network) | `127.0.0.1:` on both mappings | `docker compose config` shows `127.0.0.1` in all three ways the file is used | SEC-03; `deployment.md`; backend README |
| PRR-07 | Registers TD-020, TD-021, TD-023 | Fix: comment, document and test only, nothing that changes behaviour | As in the change register | Drift empty; new tests pass; every fact in `task_context.md` checked against the code | TD-020, TD-021, TD-023 marked resolved |

## Behaviour that changed

One, intended: a list or report asked for with a `?category=` or `?type=` value its
enum does not have now answers **400 VALIDATION_ERROR** ("category must be one of …")
instead of **500 INTERNAL_ERROR**. Every value the enum has, and an empty value, list
exactly as before. The frontend sends only enum values (`Locations.tsx`,
`Consumption.tsx`, `exportReorderList.ts`, `Materials.tsx`), so no screen changes.

The developer stack started from `docker-compose.yml` now answers on this machine
only. Containers already running keep their old ports until they are recreated.

## Outstanding work, in order

### P0

None open in the code. SEC-07 would be P0 if the committed password is still in use
anywhere; that can only be known by the owner (below).

### P1 — before a production release

| Item | Why | Done when | Needs |
|---|---|---|---|
| **SEC-07** rotate the bootstrap password from history | It is readable by anyone in the public repository | The account is rotated or removed wherever it was used; recorded in `EXCEPTIONS.md` | Owner action |
| **GATE-02 / PRR-01** require Backend and Frontend CI on `main` | Protection is on, but a change can still merge with failing unit, integration or browser tests | Both workflows report on every pull request under distinct job names, and their five checks are required (`CI_CD_ARCHITECTURE.md`, "Branch protection") | A workflow change, then the setting |
| **OPS-01** production evidence | No production host, restore or alerting has been shown | `deployment.md` Parts 1–9 done on the real host; a restore test signed off; RPO/RTO agreed; alerting proven | Owner and operator; a host |
| Merge this branch | The fixes above exist only here | CI green on the pull request | Approval to commit and open the pull request |

### P2 — soon after, each a decision first

| Item | Recommendation | Why it needs approval |
|---|---|---|
| SEC-03 rest: the API connects as the database owner | A runtime role without DDL or ownership, migrations as the owner | Changes the deployment and the database's roles |
| TD-006: ledger and audit rows are immutable by convention only | `REVOKE UPDATE, DELETE` from the runtime role once it exists; a trigger as the alternative | A migration and an operational change; follows SEC-03 |
| TD-014: reads need sign-in only; unit costs readable by every role | Decide which roles read costs, then gate those reads | Changes what people see |
| TD-012: the inventory report's currency comes from `REPORT_CURRENCY`, the rest from the setting | Read `general.defaultCurrency` everywhere, retire the variable | Changes a report's output |
| SEC-06: bearer token in `localStorage`; host CSP undefined | Set a strict CSP on the static host first (cheap, no code); review token storage after | Host owner; token storage is an authentication change |
| SEC-05: rate-limit counters per process | Set `TRUST_PROXY` at deployment (`reverse-proxy.md`); a shared store only with more than one process | Deployment setting |

### P3 / P4 — when the area is next touched

- TD-027: one posting function for every stock path (deferred by the owner,
  2026-11-23).
- TD-004 module boundaries, TD-007 unused domain events, TD-011 unused columns and
  enum value, TD-015 role-name checks in the frontend, ARCH-02 idempotency on the
  remaining writes.
- PRR-05 (`pageLimit` on movement history), PRR-06 (the remaining fixture values),
  PRR-08 (ESLint 10 when it can be had), the in-range dependency patches.

## Not attempted

- No change to authentication, authorisation, business rules, API contracts other
  than PRR-02's refusal, or the database schema.
- No dependency was added, removed or upgraded.
- Nothing was deployed, and no production system or data was touched.
- No repository setting was changed (PRR-01 is listed for the owner).
