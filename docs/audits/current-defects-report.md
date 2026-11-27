<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-AUD-021</b></td>
<td align="center"><b><i>Current Defects Report</i></b><br><i>Audit Report</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-AUD-021 updated=2026-11-27 by="Ntokozo Maselala" body=e2c23c72ade9 -->

# Current Defects Report

**Status:** DRAFT · **Owner:** Product/Engineering · **Baseline:** `a69749d`, 2026-11-27 · **Edition:** 4 (edition 1 at `d1f25a3`, edition 2 at `9d01ef5`, edition 3 at `02e4146`)

## Summary

This report extracts every defect the repository's documents record as open or partly
resolved, as of commit `a69749d` (27 Nov 2026, the merge of PR #222). Each entry is quoted
from its source document and cited. Where an entry names code, the code was read at
`a69749d` to see whether the defect is still there. Nothing here comes from outside the
repository, except GitHub settings and alert lists, and npm registry data (for SUPPLY-02
and `npm audit`), which are named as such where used.

- **11 defects are confirmed in the code.** The highest rated is still SEC-03, "High if
  Compose is deployed on a reachable host", now narrowed to its second half: the API
  connects to the database as its owner. The open port is fixed.
- **12 are open but cannot be confirmed from the repository.** They wait on a business
  decision, a deployment, or work the owner deferred. The two release blockers are here:
  the credential in git history (SEC-07 / TD-026) and the missing production evidence
  (OPS-01). They are the only things the production readiness assessment still names as
  blocking a release.
- **6 closed and 1 narrowed since edition 3** (section 3). Three are old entries closed
  by the production readiness review of 27 Nov 2026 (TD-020, TD-021, TD-023). Three are
  defects that review found and fixed in the same week (TD-029, SEC-08, GATE-02). SEC-03
  is narrowed.
- **3 of the 11 in the code are new**, found by that review and recorded in its audit and
  the risk register (PRR-05, PRR-06, SUPPLY-02). All are low priority.
- **6 documentation defects** from the 26 Nov 2026 standardisation are unchanged.

## Scope and method

- **Read:** the defect registers the repository keeps, and the open items in its audits:

| Source | What it holds | As of |
|---|---|---|
| `afrinov-docs/docs/13-project-management/technical-debt.md` (TD-) | The register the documentation guide names for defects | Entries updated to 2026-11-27 (TD-020, TD-021, TD-023, TD-029) |
| `docs/engineering/RISK_REGISTER.md` (SEC-, OPS-, GATE-, SUPPLY-, ARCH-, DOC-) | Engineering risks, extending `audit/07_FINDINGS_AND_READINESS.md` | Updated to 2026-11-27 (SEC-03, GATE-02, SEC-08, SUPPLY-02) |
| `docs/audits/system/production-readiness-audit.md` (PRR-) | The production readiness review of 27 Nov 2026 | 2026-11-27, baseline `71395dc` |
| `docs/engineering/EXCEPTIONS.md` (EX-) | Accepted deviations from a gate | Unchanged since edition 3 |
| `docs/audits/system/FAILURE_REGISTER.md` (F-) | Build and environment failures, re-verified 2026-10-29 | Unchanged since edition 3 |
| `docs/audits/system/CODEBASE_AUDIT_REPORT.md` (AUD-0nn) | A dated audit; where each finding is tracked now is in the appendix | 2026-10-21 |
| `docs/document-control/STANDARDISATION_REPORT.md` (O) | Documentation defects | Unchanged since edition 3 |

- **What moved since edition 3:** `git log 02e4146..a69749d` over every source above lists
  only the commits of PRs #220, #221 and #222, the production readiness review and its
  follow-ups. No other change touched the registers.
- **Checked against code:** every entry in section 1, and every closure in section 3,
  was looked up again at `a69749d`, because those PRs changed some of the cited files
  (`inventory.service.ts`, `schema.prisma`, `docker-compose.yml`) and line numbers moved.
  The result is in section 1's column **At `a69749d`**:
  - **Present**: the code still shows the defect.
  - **Partly**: some of what is recorded is still there; the rest is not.

  Section 2's entries were not checked against code: each waits on a person, a
  deployment (SEC-05's `TRUST_PROXY`, for example, is set on the production host) or a
  route-by-route review, and its **Waiting on** column says which, or "Not re-checked".
- **Read from outside the repository:** branch protection on `main`, open CodeQL alerts,
  and the state of PRs #220 to #222, through `gh api`; the latest
  `eslint-plugin-react` and its peer range (SUPPLY-02), through `npm view`; and
  `npm audit --package-lock-only`, which asks the npm registry about the lockfile. Each
  is named where used.
- **Not examined:** any running system, production host or database; the stock
  workbook; anything not written in the repository or its GitHub settings. A defect not
  listed here may still exist.
- Severity and impact are given **as the source records them**. The technical-debt
  register records impact, not severity; the readiness audit records a priority (P1–P4).
- **Left out:** PRR-09 (`GET /` answers without sign-in with the environment name and
  version), which the readiness audit records as informational, not a defect.

## 1. Defects confirmed in the code

| ID | Defect, as recorded | Severity / impact, as recorded | Recorded status | At `a69749d` | Source |
|---|---|---|---|---|---|
| SEC-03 | The API connects to PostgreSQL as the database owner. Until 2026-11-27 the base Compose file also published PostgreSQL on every interface | High if Compose is deployed on a reachable host | Partly fixed 2026-11-27 (PRR-04); open: separate migration and runtime roles need a design decision | **Partly.** Both Compose files now bind the database to `127.0.0.1` (`docker-compose.yml:16`, `docker-compose.prod.yml:13`); the API still connects as `POSTGRES_USER` (`docker-compose.yml:54`) | `RISK_REGISTER.md` |
| SEC-06 | The browser app stores the bearer token in `localStorage`; production CSP undefined in this repository | Medium (conditional). "XSS or unsafe third-party script could exfiltrate a reusable token" | Open — out of scope | **Present.** `apps/frontend/src/api/client.ts:58`, `:61` | `RISK_REGISTER.md` |
| TD-004 | Module boundaries are not enforced: `inventory` and `procurement` import each other; procurement writes ledger rows; reporting reads other modules' tables | "Harder to split or change modules" | Open (docs corrected 2026-10-09) | **Present.** `procurement/goods-receipt.service.ts:6` imports `InventoryService`; `inventory/stock-receipt.service.ts:12` imports from procurement | `technical-debt.md` |
| TD-006 | Ledger and audit immutability is application convention only: no GRANT, REVOKE or trigger in the migrations | "Direct SQL can edit history" | Open (docs corrected) | **Present.** No migration grants, revokes or creates a trigger. The words appear only in SQL comments about the app's own role permissions (migrations `…030`, `…045`, `…052`, `…066`) and in one migration README | `technical-debt.md` |
| TD-007 | Domain events are dispatched but no handler is registered; `SupplierCreated` and `PurchaseOrderCreated/Approved/Cancelled` are declared but never dispatched | "Dead code; misleading design" | Open (docs corrected) | **Present.** No application code calls `registerDomainEventHandler`; the four events appear only in `src/shared/events.ts` | `technical-debt.md` |
| TD-011 | Unused fields: `purchase_orders.shipped_*` kept unused; `GoodsReceiptStatus.DRAFT` never produced | "Confusing contract" | Partly resolved | **Present.** `shippedAt` and `shippedById` (`schema.prisma:598-599`) are used nowhere in `src`; `DRAFT` is still in the enum (`schema.prisma:1055`), and receipts are created SUBMITTED or POSTED (`goods-receipt.service.ts:174`, `stock-receipt.service.ts:172`). The lines moved from edition 3's because new schema comments were added (TD-020) | `technical-debt.md` |
| TD-012 | Inventory report currency comes from the `REPORT_CURRENCY` environment variable; all other reports use the `general.defaultCurrency` setting | "Reports can disagree on currency" | Open | **Present.** `reporting/report.service.ts:168` and `inventory/inventory.service.ts:1146` (the register cites line 138; edition 3, 1142). "All other reports" is still too wide: the procurement savings report fixes its currency at `ZAR` (`reporting/procurement-savings.service.ts:20`) | `technical-debt.md` |
| TD-015 | Client role checks duplicate server permissions by role name; the menu is now filtered by permission | "UI and server can drift" | Partly resolved | **Present, as recorded.** Role names in `apps/frontend/src/hooks/usePermissions.ts:3-14` | `technical-debt.md` |
| PRR-05 | `/reports/movement-history` reads `limit` with `Number()`, not `pageLimit` | P4 | Deferred: change with the next edit to the route | **Present.** `reporting/reporting.routes.ts:69`. The service falls back to 200 for a value that isn't a positive number, so it gives no 5xx; `limit=abc` answers 200 where the rule in `AGENTS.md` would answer 400 | `production-readiness-audit.md` |
| PRR-06 | Test fixtures used category values the schema does not have | P3 | Partly fixed (the category-filter test) | **Partly.** `reporting.service.test.ts:164-165` still seed `FASTENERS` and `ELECTRICAL`, and `:509-510` expect them in the stock value; the filter test asks for a real category and checks that `ELECTRICAL` is refused (`:431`) | `production-readiness-audit.md` |
| SUPPLY-02 | ESLint 9 is out of support upstream; ESLint 10 is held back because `eslint-plugin-react` peers `eslint` ≤ 9 | Low | Accepted — blocked upstream | **Present.** The lockfile has `eslint` 9.39.5; `eslint-plugin-react@7.37.5` (latest) still peers `^3 … ^9.7` (`npm view`, 2026-11-27). Development only: the runtime image prunes dev dependencies | `RISK_REGISTER.md` (PRR-08 in the audit) |

*Paths under `src/` and `prisma/` are in `afrinov-platform/apps/backend/`.*

## 2. Open, but not confirmable from the repository

| ID | Defect, as recorded | Severity / impact, as recorded | Recorded status | Waiting on | Source |
|---|---|---|---|---|---|
| SEC-07 / TD-026 / EX-01 | A real bootstrap admin password is in reachable git history (commit `db1501ac0b`); the repository is public | High. "Account takeover if the account still exists or the password is reused" | Open — action required | Rotating the password or deleting the account wherever it was used, then reviewing the scanning baseline. Not visible in the repository. A release blocker in `PRODUCTION_READINESS_ASSESSMENT.md` | `RISK_REGISTER.md`, `technical-debt.md`, `EXCEPTIONS.md` |
| OPS-01 | No deployment workflow, backup/restore runbook, restore evidence, or alerting in the repository; a backup service with an off-site copy, a restore test, Dashboard warnings and a CI drill are built (ADR-037), not yet set up on a production host | High (release gate) | Open — backups built, production setup and evidence needed | Production topology, backup and restore evidence from a production host, RPO/RTO, alerting proof. The other release blocker | `RISK_REGISTER.md` |
| SEC-05 | Rate limiting may count every client as the proxy; counters are per process | Medium (conditional) | Mitigated in code — needs `TRUST_PROXY` set at deployment | The deployment setting | `RISK_REGISTER.md` |
| TD-001 | Location and supplier free-text clean-up during migration is a manual review; ambiguous cases need a business decision | "Delays migration sign-off" | Open | Business decisions on the location spellings | `technical-debt.md` |
| TD-002 | How `Sheet1` (836 rows), `Consumables Box` and `Consumables Tracking Main` overlap with `Consumables Main` is not understood | "Blocks migration completeness" | Open | Clarification of the workbook's sheets | `technical-debt.md` |
| TD-003 | No confirmed approval rule for purchase orders; the setting exists, the business rule is unconfirmed | "Blocks Procurement go-live" | Open | The business rule | `technical-debt.md` |
| TD-027 | The stock floor's first layer is a convention repeated in 14 paths, with no single posting function | "Each new stock path must repeat the order by hand" | Open; deferred by the owner on 2026-11-23 | The next path that moves stock, or a guard or race test catching a wrong one | `technical-debt.md` |
| DOC-01 | Operations documentation drift (Node version, test environment loading) | Low | Open | A named location; the source records none. The Node-version wording was corrected in the platform and backend READMEs, the onboarding guide and `task_context.md` on 2026-11-27 (PR #220), but the register was not updated, and "test environment loading" was not checked | `RISK_REGISTER.md` |
| TD-008 | Audit gaps: issue, transfer, adjustment, PO creation and goods receipt write no audit entry | "FR-SEC-003 only partly met" | Partly resolved 2026-10-28 | A path-by-path review. Not re-checked | `technical-debt.md` |
| TD-014 | Reads of materials, locations, racks, projects, recipients, suppliers, settings and the full ledger need sign-in only, no permission; unit costs readable by every role | "Weaker than deny-by-default design" | Open (docs corrected) | A decision on which roles may read what. Partly re-checked by the readiness review: an account with only `view:reports` read 38 GET routes, settings, suppliers and materials (with unit costs) among them (`production-readiness-audit.md`, "Security") | `technical-debt.md` |
| TD-019 | Lists other than `/reports/inventory` are unbounded or `limit`-capped | "Large lists" | Partly resolved 2026-10-29 | A route-by-route review. Not re-checked | `technical-debt.md` |
| ARCH-02 | No idempotency contract for repeated POSTs beyond inventory movements | Low | Partly resolved 2026-10-29 — inventory covered; rest open | Not re-checked. A later record (ADR-042, `AGENTS.md`) extends the key to creating suppliers, purchase orders and RFQs | `RISK_REGISTER.md` |

## 3. Closed or narrowed since edition 3

Edition 3 (`02e4146`) listed TD-020, TD-021 and TD-023 as present in the code, and SEC-03
as partly present. The production readiness review of 27 Nov 2026 closed the three and
narrowed SEC-03, and in the same week found and closed three defects no earlier edition
listed. Closures from editions 1 to 3 are in edition 3 (`git show 14e861c:docs/audits/current-defects-report.md`, section 3).

| ID | Earlier edition said | Now (`a69749d`) | Closed by |
|---|---|---|---|
| TD-020 | Edition 3: present. Schema comments said the schema is "derived from" the docs and that `inventory_balances` is "never written by application code" / refreshed by a trigger | Fixed: the comments say the migrations build the schema and CI checks it, that `recomputeBalance` writes balances from the ledger in the same transaction (the demo seed in a step of its own), and that there is no trigger (`schema.prisma:1-14`). Comment only; drift check empty | PR #220 |
| TD-021 | Edition 3: present. `task_context.md` said "Phase 1 … is next" | Fixed: phases, stack versions, workflows, Node version, roles and the settings rule brought up to date; "is next" no longer appears | PR #220 |
| TD-023 | Edition 3: present. `audit.routes.ts` had no test | Fixed: `src/modules/audit/audit.routes.test.ts` (sign-in, refusal to every role without `view:audit_log`, what each permission mix is shown, bound filter values, `limit` bounds). Stock counts have had unit tests since 2026-11-17 | PR #220 |
| TD-029 | Not listed (found 2026-11-27). Eleven list and report routes answered 500 to an unknown `?category=` or `?type=` | Fixed: `enumFilter` (`src/shared/query-filters.ts`) at each cast site answers 400; a Movements report still ignores `?type=`. `integration/query-filters.real-http.test.ts` fails 11 of its 23 tests on the old code | PR #220 |
| SEC-08 | Not listed (found 2026-11-27). Four open CodeQL alerts rated High: a polynomial regex in `cleanWebsite`, incomplete Markdown escaping in three import reports | Fixed and closed by CodeQL: alerts 1, 2, 3 and 5 `fixed` at 2026-11-27T07:23:24Z, the first scan of `main` after the merge; no alert open (`gh api …/code-scanning/alerts`) | PR #220 |
| GATE-02 | Not listed (found 2026-11-27). `main` had no branch protection, and Backend and Frontend CI could not be required | Fixed: `main` requires a pull request, an up-to-date branch and eleven checks, admins included (`gh api …/branches/main/protection`); Backend and Frontend CI report on every pull request (`CI_CD_ARCHITECTURE.md`, "Branch protection") | PRs #220, #221 and the setting |
| SEC-03, in part | Edition 3: partly present; `docker-compose.yml:11-12` mapped `5432:5432` | Narrowed: both Compose files bind the database and API to `127.0.0.1`; the database-owner part remains (section 1) | PR #220 |

## 4. Documentation defects

From the documentation standardisation of 26 Nov 2026 (`STANDARDISATION_REPORT.md`,
open issues), as that report records them. The report has not changed since edition 3,
so the counts are its own, not recounted.

| ID | Defect | Needs |
|---|---|---|
| O4 | 100 documents were last verified against the code on 2026-10-09 | Re-verification by each document's owner |
| O5 | Four documents use status values outside the convention ("In progress", "Production prototype", "Complete — basis for the refactoring plan", "Completed for repository evidence available on this date") | The owner's choice of the conventional value |
| O6 | Three product names in the documents ("Afrinov Inventory Platform" 15, "Afrinov Inventory & Operations Platform" 8, "Afrinov OMS" 2); the screens say Afrinov OMS since 2026-11-13 | A decision on the name, then one pass |
| O7 | Spelling is mixed, mostly American with British forms in places | A decision on a house spelling |
| O8 | 88 documents have no status line, which the documentation guide asks for | Owners and statuses from the people responsible |
| O11 | Long inline code in some documents runs past a phone screen | A content edit by the owner |

## 5. Environment notes

Recorded as confirmed in `FAILURE_REGISTER.md`, each with a workaround, and not marked
resolved. They concern the machine or network, not the product.

| ID | Recorded | Workaround recorded |
|---|---|---|
| F-05 | No `package.json` at the repository root, so `npm` there fails; the workspace root has no combined `dev` script | Run commands from `afrinov-platform/` (`npm run dev:backend`, `npm run dev:frontend`) |
| F-06 | In a restricted network, Prisma's engine download and `npm audit` cannot reach their hosts | Allow the registry and Prisma binary hosts, or use a cache or mirror |
| F-10 | On a machine whose PowerShell policy blocks `npm.ps1`, `npm` fails | Use `npm.cmd` |

## Appendix: the 21 Oct 2026 audit findings today

Where each finding of `CODEBASE_AUDIT_REPORT.md` (AUD-001 to AUD-016) is tracked now.

| Finding | Tracked as | Current state |
|---|---|---|
| AUD-001 Unknown `NODE_ENV` bypasses production policy | SEC-01 (`audit/07`) | Fixed in code: `src/shared/config.ts` refuses any other value |
| AUD-002 Concurrent stock-outs can go below zero | DATA-01 (`audit/07`), ADR-047 | Fixed: balance lock before the read and a database constraint (ADR-047); TD-027 records what remains |
| AUD-003 Compose publishes PostgreSQL | SEC-03 | **Narrowed 2026-11-27:** the port is bound to `127.0.0.1` in both Compose files; the database-owner part stays open (section 1) |
| AUD-004 No backup or tested restore | OPS-01 | Section 2 |
| AUD-005 Backend on Node 20 | TD-018 | Resolved 2026-10-28 (register) |
| AUD-006 User update returns a password hash | TD-028 | Fixed 2026-11-26 (PR #215) |
| AUD-007 Read routes bypass role permissions | TD-014 | Section 2 |
| AUD-008 Audit history omits operations; some audits non-atomic | TD-008, AUD-01 | Section 2, partly resolved |
| AUD-009 Balance foreign keys missing | TD-005, DATA-03 | Resolved 2026-10-28 (register) |
| AUD-010 Immutability by convention only | TD-006 | Section 1, present |
| AUD-011 Eight dev/build advisories | F-08 | Resolved 2026-10-29 (register); `npm audit --package-lock-only` reports 0 at `a69749d` (npm registry, 2026-11-27) |
| AUD-012 Production SPA hosting and rollback undefined | OPS-01 | Section 2 |
| AUD-013 No monitoring, alerting or service objectives | OPS-01 | Section 2 |
| AUD-014 Token in `localStorage` for 12 hours | SEC-06 | Section 1, present |
| AUD-015 Domain events have no handlers | TD-007 | Section 1, present |
| AUD-016 Browser test used a fixed credential, not in CI | TD-017 | Resolved (register); the browser tests are now a required check on `main` |
