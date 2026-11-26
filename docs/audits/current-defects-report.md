<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-AUD-021</b></td>
<td align="center"><b><i>Current Defects Report</i></b><br><i>Audit Report</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-AUD-021 updated=2026-11-26 by="Ntokozo Maselala" body=3c516b4c3f54 -->

# Current Defects Report

**Status:** DRAFT · **Owner:** Product/Engineering · **Baseline:** `d1f25a3`, 2026-11-26

## Summary

This report extracts every defect the repository's documents record as open or partly
resolved, as of commit `d1f25a3` (26 Nov 2026). Each entry is quoted from its source
document and cited. Where an entry names code, the code was read at `d1f25a3` to see
whether the defect is still there. Nothing here comes from outside the repository.

- **13 defects are confirmed in the code.** The most serious is **AUD-006**:
  `PATCH /users/:id` returns the stored password hash. No register tracks it; it is
  recorded only in the 21 Oct 2026 system audit.
- **12 are open but cannot be confirmed from the repository.** They wait on a
  business decision, a deployment, or work the owner deferred. This group includes
  the two High items: the credential in git history (SEC-07 / TD-026) and the
  missing production evidence (OPS-01).
- **4 are recorded as open but are fixed in the repository**: three in the code
  (TD-024, TD-025, ARCH-01) and one in documentation (TD-016), and part of a fifth
  (TD-011). The registers need updating.
- **6 documentation defects** come from the 26 Nov 2026 standardisation.

## Scope and method

- **Read:** the defect registers the repository keeps, and the open items in its audits:

| Source | What it holds | As of |
|---|---|---|
| `afrinov-docs/docs/13-project-management/technical-debt.md` (TD-) | The register the documentation guide names for defects | Last verified 2026-10-28; entries updated to 2026-11-23 |
| `docs/engineering/RISK_REGISTER.md` (SEC-, OPS-, ARCH-, DOC-) | Engineering risks, extending `audit/07_FINDINGS_AND_READINESS.md` | Updated with ADR-036 and ADR-037 |
| `docs/engineering/EXCEPTIONS.md` (EX-) | Accepted deviations from a gate | — |
| `docs/audits/system/FAILURE_REGISTER.md` (F-) | Build and environment failures, re-verified 2026-10-29 | 2026-10-29 |
| `docs/audits/system/CODEBASE_AUDIT_REPORT.md` (AUD-0nn) | A dated audit; where each finding is tracked now is in the appendix | 2026-10-21 |
| `docs/document-control/STANDARDISATION_REPORT.md` (O) | Documentation defects | 2026-11-26 |

- **Checked against code:** entries that name a file, a line, a setting or a
  behaviour were looked up at `d1f25a3` by reading the source and migrations. The
  result is in the column **At `d1f25a3`**:
  - **Present**: the code still shows the defect.
  - **Partly**: some of what is recorded is still there; the rest is not.
  - **Fixed**: the repository no longer shows it, though the register says open.
  - **Not re-checked**: the entry needs a person, a deployment or a route-by-route
    review, not a code search.
- **Not examined:** any running system, production host or database; the stock
  workbook; anything not written in the repository. A defect not listed here may
  still exist.
- Severity and impact are given **as the source records them**. The technical-debt
  register records impact, not severity.

## 1. Defects confirmed in the code

| ID | Defect, as recorded | Severity / impact, as recorded | Recorded status | At `d1f25a3` | Source |
|---|---|---|---|---|---|
| AUD-006 | User update response returns a password hash: the update re-reads the full user and `PATCH` sends it as it is | Medium, P1. "ADMIN caller can collect bcrypt hashes for offline cracking or credential reuse" | Static path verified (2026-10-21); in no register | **Present.** `identity.service.ts:250-253` re-reads the user with `include` (every column, `passwordHash` among them) and returns it (`:274`, `:277`); `user.routes.ts:96-97` sends it with no response schema or field selection. Callers need `manage:users` | `CODEBASE_AUDIT_REPORT.md` |
| SEC-03 | Compose publishes PostgreSQL on all interfaces and the API uses the superuser account | High if Compose is deployed on a reachable host | Open — applicability unknown | **Partly.** `docker-compose.yml:11-12` still maps `5432:5432`; the production overlay binds the database and API to `127.0.0.1` (`docker-compose.prod.yml:13`, `:18`); the API still connects as `POSTGRES_USER` (`docker-compose.yml:50`) | `RISK_REGISTER.md` |
| SEC-06 | The browser app stores the bearer token in `localStorage`; production CSP undefined in this repository | Medium (conditional). "XSS or unsafe third-party script could exfiltrate a reusable token" | Open — out of scope | **Present.** `apps/frontend/src/api/client.ts:58-62` | `RISK_REGISTER.md` |
| SEC-04 | `CORS_ALLOW_ANY=true` can be enabled in production | Low. "Broad browser cross-origin access if explicitly enabled" | Open — low, opt-in | **Present.** `src/shared/config.ts:139` returns `true` before the environment is considered | `RISK_REGISTER.md` |
| TD-004 | Module boundaries are not enforced: `inventory` and `procurement` import each other; procurement writes ledger rows; reporting reads other modules' tables | "Harder to split or change modules" | Open (docs corrected 2026-10-09) | **Present.** `procurement/goods-receipt.service.ts:6` imports `InventoryService`; `inventory/stock-receipt.service.ts:12` imports from procurement | `technical-debt.md` |
| TD-006 | Ledger and audit immutability is application convention only: no GRANT, REVOKE or trigger in the migrations | "Direct SQL can edit history" | Open (docs corrected) | **Present.** No migration grants, revokes or creates a trigger; the one match (migration `20260101000052`) is a comment | `technical-debt.md` |
| TD-007 | Domain events are dispatched but no handler is registered; `SupplierCreated` and `PurchaseOrderCreated/Approved/Cancelled` are declared but never dispatched | "Dead code; misleading design" | Open (docs corrected) | **Present.** No application code calls `registerDomainEventHandler`; the four events appear only in `src/shared/events.ts` | `technical-debt.md` |
| TD-011 | Unused model and fields: `purchase_orders.shipped_*` kept unused; `GoodsReceiptStatus.DRAFT` never produced; `createPOSchema` accepts `unitPrice`, silently dropped | "Confusing contract" | Open | **Partly.** `shipped_at` and `shipped_by_id` (`schema.prisma:590-591`) are not used in `src`; `DRAFT` is still in the enum (`schema.prisma:1047`). The `unitPrice` part is out of date: it is now stored (`procurement.service.ts:600`) | `technical-debt.md` |
| TD-012 | Inventory report currency comes from the `REPORT_CURRENCY` environment variable; all other reports use the `general.defaultCurrency` setting | "Reports can disagree on currency" | Open | **Present.** `reporting/report.service.ts:168` and `inventory/inventory.service.ts:1142` (the register cites line 138). "All other reports" is too wide: the procurement savings report fixes its currency at `ZAR` (`reporting/procurement-savings.service.ts:20`) | `technical-debt.md` |
| TD-015 | Client role checks duplicate server permissions by role name; the menu is now filtered by permission | "UI and server can drift" | Partly resolved | **Present, as recorded.** Role names in `apps/frontend/src/hooks/usePermissions.ts:3-11` | `technical-debt.md` |
| TD-020 | Schema comments say the schema is "derived from" the docs and that `inventory_balances` is "never written by application code" / refreshed by a trigger; the code upserts it and there is no trigger | "Misleading in-code documentation" | Open | **Present.** `prisma/schema.prisma:2`, `:6`, `:1478` | `technical-debt.md` |
| TD-021 | `task_context.md` says "Phase 1 … is next"; phases 1–3 are implemented | "Stale orientation doc" | Open | **Present.** `task_context.md:28-29` | `technical-debt.md` |
| TD-023 | Untested: `src/modules/audit/audit.routes.ts`; stock counts only by integration tests | "Critical paths without fast tests" | Partly resolved | **Present, as recorded.** `src/modules/audit/` has no test for `audit.routes.ts` | `technical-debt.md` |

*Paths under `src/` and `prisma/` are in `afrinov-platform/apps/backend/`.*

## 2. Open, but not confirmable from the repository

| ID | Defect, as recorded | Severity / impact, as recorded | Recorded status | Waiting on | Source |
|---|---|---|---|---|---|
| SEC-07 / TD-026 / EX-01 | A real bootstrap admin password is in reachable git history (commit `db1501ac0b`); the repository is public | High. "Account takeover if the account still exists or the password is reused" | Open — action required | Rotating the password or deleting the account wherever it was used, then reviewing the scanning baseline. Not visible in the repository | `RISK_REGISTER.md`, `technical-debt.md`, `EXCEPTIONS.md` |
| OPS-01 | Recorded as "no deployment workflow, backup/restore runbook, restore evidence, or alerting in the repository"; the register's own evidence adds that a backup service with an off-site copy, a restore test, Dashboard warnings and a CI drill are built (ADR-037), not yet set up on a production host | High (release gate) | Open — backups built, production setup and evidence needed | Production topology, backup and restore evidence from a production host, RPO/RTO, alerting proof | `RISK_REGISTER.md` |
| SEC-05 | Rate limiting may count every client as the proxy; counters are per process | Medium (conditional) | Mitigated in code — needs `TRUST_PROXY` set at deployment | The deployment setting | `RISK_REGISTER.md` |
| TD-001 | Location and supplier free-text clean-up during migration is a manual review; ambiguous cases need a business decision | "Delays migration sign-off" | Open | Business decisions on the location spellings | `technical-debt.md` |
| TD-002 | How `Sheet1` (836 rows), `Consumables Box` and `Consumables Tracking Main` overlap with `Consumables Main` is not understood | "Blocks migration completeness" | Open | Clarification of the workbook's sheets | `technical-debt.md` |
| TD-003 | No confirmed approval rule for purchase orders; the setting exists, the business rule is unconfirmed | "Blocks Procurement go-live" | Open | The business rule | `technical-debt.md` |
| TD-027 | The stock floor's first layer is a convention repeated in 14 paths, with no single posting function | "Each new stock path must repeat the order by hand" | Open; deferred by the owner on 2026-11-23 | The next path that moves stock, or a guard or race test catching a wrong one | `technical-debt.md` |
| DOC-01 | Operations documentation drift (Node version, test environment loading) | Low | Open | A named location; the source records none | `RISK_REGISTER.md` |
| TD-008 | Audit gaps: issue, transfer, adjustment, PO creation and goods receipt write no audit entry | "FR-SEC-003 only partly met" | Partly resolved 2026-10-28 | A path-by-path review. Not re-checked: `inventory.service.ts` now has 3 audit writes and `procurement.service.ts` 10, so the list may be out of date | `technical-debt.md` |
| TD-014 | Reads of materials, locations, racks, projects, recipients, suppliers, settings and the full ledger need sign-in only, no permission; unit costs readable by every role | "Weaker than deny-by-default design" | Open (docs corrected) | A route-by-route review. Not re-checked | `technical-debt.md` |
| TD-019 | Lists other than `/reports/inventory` are unbounded or `limit`-capped | "Large lists" | Partly resolved 2026-10-29 | A route-by-route review. Not re-checked | `technical-debt.md` |
| ARCH-02 | No idempotency contract for repeated POSTs beyond inventory movements | Low | Partly resolved 2026-10-29 — inventory covered; rest open | Not re-checked. A later record (ADR-042, `AGENTS.md`) extends the key to creating suppliers, purchase orders and RFQs | `RISK_REGISTER.md` |

## 3. Recorded open, fixed in the repository

The registers still list these as open. The repository at `d1f25a3` no longer shows
them: TD-024, TD-025, ARCH-01 and part of TD-011 were fixed in the code, TD-016 in a
migration's README (documentation). The register entries need updating by their owners.

| ID | Recorded as | At `d1f25a3` | Source |
|---|---|---|---|
| TD-016 | The initial migration's README names `20260101000000_location_management`; the folder is `20260101000001_location_management` | The README names `20260101000001_location_management` (`prisma/migrations/20260101000000_initial/README.md:7`, `:14`); `docs/audits/documentation-inventory.md` records the correction on 2026-10-22 | `technical-debt.md` |
| TD-024 | `projects.status` is free text; allowed values exist only in `project.service.ts` | Migration `20260101000057_project_status_decides` adds `projects_status_check` (the five statuses) and `projects_active_follows_status` | `technical-debt.md` |
| TD-025 | Dashboard tile notes hard-code "below 20%/40% of required" though the bands are settings | `apps/frontend/src/pages/Dashboard.tsx:295-296` read `urgentBelowPercent` and `warningBelowPercent`; commit `cc8336c` (2026-10-13) | `technical-debt.md` |
| ARCH-01 | The last active administrator can demote or deactivate themselves | `identity.service.ts:247-248` refuses a change that leaves fewer than `MIN_ADMINS` (2, `:306`) active Admins (ADR-036) | `RISK_REGISTER.md` |
| TD-011, in part | `createPOSchema` accepts `unitPrice`, silently dropped | Stored on the order line (`procurement.service.ts:600`); the rest of TD-011 stands (section 1) | `technical-debt.md` |

## 4. Documentation defects

From the documentation standardisation of 26 Nov 2026 (`STANDARDISATION_REPORT.md`,
open issues).

| ID | Defect | Needs |
|---|---|---|
| O4 | 100 documents were last verified against the code on 2026-10-09 | Re-verification by each document's owner |
| O5 | Four documents use status values outside the convention ("In progress", "Production prototype", "Complete — basis for the refactoring plan", "Completed for repository evidence available on this date") | The owner's choice of the conventional value |
| O6 | Three product names in the documents ("Afrinov Inventory Platform" 15, "Afrinov Inventory & Operations Platform" 8, "Afrinov OMS" 2); the screens say Afrinov OMS since 2026-11-13 | A decision on the name, then one pass |
| O7 | Spelling is mixed, mostly American with British forms in places | A decision on a house spelling |
| O8 | 88 documents have no status line, which the documentation guide asks for | Owners and statuses from the people responsible |
| O11 | Long inline code in some documents runs past a phone screen | A content edit by the owner |

This report adds one: the technical-debt and risk registers list five entries as
open that the repository shows fixed (section 3).

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
| AUD-001 Unknown `NODE_ENV` bypasses production policy | SEC-01 (`audit/07`) | Fixed in code: `src/shared/config.ts:43-45` refuses any other value |
| AUD-002 Concurrent stock-outs can go below zero | DATA-01 (`audit/07`), ADR-047 | Fixed: balance lock before the read and a database constraint (ADR-047); TD-027 records what remains |
| AUD-003 Compose publishes PostgreSQL | SEC-03 | Section 1, partly |
| AUD-004 No backup or tested restore | OPS-01 | Section 2 |
| AUD-005 Backend on Node 20 | TD-018 | Resolved 2026-10-28 (register) |
| AUD-006 User update returns a password hash | Not tracked | **Section 1, present** |
| AUD-007 Read routes bypass role permissions | TD-014 | Section 2 |
| AUD-008 Audit history omits operations; some audits non-atomic | TD-008, AUD-01 | Section 2, partly resolved |
| AUD-009 Balance foreign keys missing | TD-005, DATA-03 | Resolved 2026-10-28 (register) |
| AUD-010 Immutability by convention only | TD-006 | Section 1, present |
| AUD-011 Eight dev/build advisories | F-08 | Resolved 2026-10-29 (register) |
| AUD-012 Production SPA hosting and rollback undefined | OPS-01 | Section 2 |
| AUD-013 No monitoring, alerting or service objectives | OPS-01 | Section 2 |
| AUD-014 Token in `localStorage` for 12 hours | SEC-06 | Section 1, present |
| AUD-015 Domain events have no handlers | TD-007 | Section 1, present |
| AUD-016 Browser test used a fixed credential, not in CI | TD-017 | Resolved (register) |
