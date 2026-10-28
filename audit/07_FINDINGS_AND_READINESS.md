# 07 — Findings and readiness verdict

## Executive summary

**Disposition: NOT PRODUCTION READY.**

The codebase has meaningful quality controls: backend/frontend unit suites pass, lint and frontend typecheck pass, the frontend and backend compile, CI includes a real-PostgreSQL integration job, and the application has explicit authentication, permissions and a signed inventory ledger.

Those results do not establish production readiness. Code inspection identified two concurrency hazards that can violate stock and receipt invariants, and a demonstrated runtime configuration bypass that can disable production-only JWT secret rejection. The supplied Compose topology also publishes PostgreSQL on every host interface and gives the API the initializer account, if that file is used as a reachable deployment. The real deployment topology, backup/restore process and production credentials are unknown. No production database was contacted and no real PostgreSQL integration or E2E suite was run.

The disposition is based on verified code paths and missing operational evidence. It does not claim that an external production system currently uses the risky configuration or has been compromised.

### Remediation authorization update — 2026-10-26

The owner approved application work packages 1–6 as mapped in `08_REMEDIATION_ROADMAP.md`. This includes SEC-01, DATA-01, DATA-02/DATA-04, SEC-02, DATA-03 and AUD-01. SEC-03 deployment configuration and all production changes remain outside that approval. The readiness verdict below remains the pre-remediation assessment until package acceptance evidence is recorded.

## Findings register

| ID | Severity | Category | Confidence | Status |
|---|---|---|---|---|
| DATA-01 | High | Data integrity / concurrency | High for hazard; not reproduced against PostgreSQL | Confirmed by source |
| DATA-02 | High | Data integrity / duplicate effects | High for hazard; not reproduced concurrently | Confirmed by source |
| DATA-04 | High | Procurement / over-receipt concurrency | High for race pattern; not reproduced concurrently | Confirmed by source |
| SEC-01 | High | Configuration / authentication | High | Probe reproduced |
| SEC-03 | High if Compose is deployed on an untrusted/reachable host | Infrastructure / database access | High for config; deployment applicability unknown | Conditional |
| SEC-02 | Medium local risk; upstream advisories include High severity | Dependency security | High for lockfile versions; exploitability not tested | Confirmed by npm audit |
| DATA-03 | Medium | Referential integrity / migration drift | High | Confirmed by schema/migration scan |
| AUD-01 | Medium | Auditability / transaction atomicity | High | Confirmed by source |
| OPS-01 | High release gate; evidence gap, not a demonstrated implementation defect | Backup / deployment readiness | High that repository evidence is absent; external state unknown | Unverified |
| SEC-04 | Low | CORS configuration | High | Confirmed conditional hardening risk |
| SEC-05 | Medium conditional | Availability / rate limiting | Medium | Depends on proxy/replica topology |
| SEC-06 | Medium conditional | Browser token exposure / XSS impact | High that localStorage is used; no injection sink found in searched sources | Confirmed architecture; host CSP unknown |
| ARCH-01 | Medium conditional | Administrator recovery | Medium-high | Confirmed behavior; business acceptance unknown |
| DOC-01 | Low | Operational documentation | High | Confirmed drift |
| ARCH-02 | Informational pending product decision | Retry/idempotency contract | Medium | Design question, not confirmed defect |

## Detailed findings

### DATA-01 — Concurrent stock movements can overdraw stock and stale the materialized balance

- **Severity/confidence:** High / high confidence in the race pattern; no live or disposable PostgreSQL race was run.
- **Affected:** apps/backend/src/modules/inventory/inventory.service.ts around 581–624, 751–786 and 812–839; apps/backend/src/shared/inventory/balances.ts:6–20, 23–32.
- **Evidence/reproduction:** issue, transfer and negative adjustment read the current balance, compare requested quantity and then insert signed rows. The helper uses an ordinary findUnique. Recompute aggregates the ledger then upserts. No shared row/advisory lock or conditional balance update is used by all those paths. Under Read Committed, two transactions can pass the same initial check. A two-request PostgreSQL test is required to demonstrate the exact final balance in the target version.
- **Expected vs actual:** requests consuming a shared stock balance should serialize or atomically reject oversubscription; independent checks can both succeed.
- **Impact/root cause:** negative stock and/or cached balance that does not equal the ledger sum; read-check-write is not mutually exclusive across requests.
- **Remediation:** use one consistent material/location locking or conditional update protocol around check and ledger write for every movement that affects the key. Include returns and counts where they touch the invariant.
- **Regression/acceptance:** in a disposable PostgreSQL database, race two issues whose total exceeds available stock and assert one rejects, ledger never goes below zero, and balance equals ledger sum. Repeat for transfer-out, negative adjustment and return; race counts against normal movements. Verify transaction rollback on injected failures.
- **Rollback:** deploy behind a controlled release, preserve existing ledger rows/API contracts, and roll back application binaries if required; do not reverse ledger history. Database isolation/constraint changes need a forward corrective migration.
- **Verification status:** source-reviewed; concurrent DB behavior not executed.

### DATA-02 — Concurrent goods receipt posts can duplicate stock and PO receipt quantities

- **Severity/confidence:** High / high confidence in the state-check race; no concurrent DB test run.
- **Affected:** apps/backend/src/modules/inventory/inventory.service.ts:847–922.
- **Evidence/reproduction:** a request reads GoodsReceipt status at 849–855 and rejects only if that snapshot is POSTED or DRAFT. It writes receipt ledger rows and increments PO line quantities at 880–917, then sets POSTED at 919–922. Two concurrent transactions may both read SUBMITTED before either status update commits.
- **Expected vs actual:** a submitted receipt should produce ledger and PO effects once; simultaneous requests can each apply effects.
- **Impact/root cause:** duplicate credited stock, overstated PO received quantity or an over-receipt.
- **Remediation:** claim the state with a conditional update/row lock at the start of the transaction. Make all effects and final status transition part of that same atomic transaction; return conflict when the claim fails.
- **Regression/acceptance:** concurrent POST calls against one submitted receipt in isolated PostgreSQL produce exactly one success, one conflict, one set of ledger entries and one PO increment. Sequential duplicate and failure rollback tests continue to pass.
- **Rollback:** revert application change if necessary; preserve ledger data and use audited reversal/correction for any duplicate already posted.
- **Verification status:** source-reviewed; existing sequential duplicate test was found, concurrent execution not run.

### DATA-04 — Concurrent goods receipts can exceed a purchase-order line quantity

- **Severity/confidence:** High / high confidence in the check-then-increment race; no concurrent PostgreSQL test was run during the audit.
- **Affected:** `apps/backend/src/modules/inventory/inventory.service.ts` around 894–912; PO line receipt quantity updates.
- **Evidence/reproduction:** each submitted goods receipt loads a purchase-order line, checks `receivedQty + receipt quantity <= orderedQty`, then increments `receivedQty`. Two different receipts for the same line can read the same remaining quantity, both pass, and both increment. DATA-02 is a separate race where two requests post the same receipt.
- **Expected vs actual:** concurrent receipt commits must preserve `receivedQty <= orderedQty`; independent checks can each observe available quantity and collectively exceed the ordered cap.
- **Impact/root cause:** over-receipt of a purchase-order line and divergence between procurement quantities and accepted stock.
- **Remediation:** serialize updates to each affected PO line inside the transaction before reading `receivedQty` and applying the cap check. Keep receipt status claim and all line/ledger updates atomic.
- **Regression/acceptance:** two distinct submitted receipts targeting one PO line race against the same remaining quantity; exactly one may consume the remaining capacity, the other conflicts, and final `receivedQty` never exceeds `orderedQty`. Existing sequential receipt behavior remains intact.
- **Rollback:** revert the application change if required; reconcile any already over-received line through an approved procurement correction process, not direct history rewriting.
- **Verification status:** source-reviewed; PostgreSQL reproduction pending.

### SEC-01 — Invalid NODE_ENV bypasses production-only secret checks

- **Severity/confidence:** High / high.
- **Affected:** apps/backend/src/shared/config.ts:42–62 and 93–97.
- **Evidence/reproduction:** nodeEnv is a type assertion from process.env, not runtime validation. Secret rejection and API-doc defaults compare exact strings. A local loadConfig probe with NODE_ENV=prod returned accepted and accepted a public test fixture rejected by exact production. No server or DB was started.
- **Expected vs actual:** invalid environment labels should fail startup; current code accepts them and follows non-production branches.
- **Impact/root cause:** a deployment typo may permit known weak signing secrets and enable development defaults, including API docs. Any nonempty unlisted weak secret is also accepted in exact production.
- **Remediation:** validate NODE_ENV against the runtime allowlist and reject unknown values. Enforce a minimum cryptographic strength/length policy or validate secret generation; avoid a denylist-only policy. Consider making API docs opt-in in production independently.
- **Regression/acceptance:** tests reject prod, staging-like typos and arbitrary invalid labels; exact production rejects weak/short secrets and accepts only the documented key policy; invalid startup fails before listening.
- **Rollback:** update deployment environment first; rotate JWT signing secret with an explicit user-session invalidation plan, since rotation invalidates existing tokens. Keep prior secret only during a defined rollout if a key rotation design supports it.
- **Verification status:** focused probe reproduced; no fix applied.

### SEC-03 — Compose can expose a superuser database to the host network

- **Severity/confidence:** High if the Compose file is deployed on a reachable host / high confidence in configuration / production applicability unknown.
- **Affected:** apps/backend/docker-compose.yml:8–12, 50, 74–80.
- **Evidence/reproduction:** main DB has port mapping 5432:5432 with no host IP. Backend connection uses POSTGRES_USER. Official Docker documentation states omitted host IP binds all interfaces; official Postgres image documentation states POSTGRES_USER creates a superuser. No Compose stack was started.
- **Expected vs actual:** production DB should not be directly exposed to untrusted networks and application runtime should have least privilege; this config publishes the DB and uses the initializer identity.
- **Impact/root cause:** reachable database could be attacked directly; API compromise inherits database superuser rights.
- **Remediation:** confirm actual deployment. If used beyond local development, remove DB host publishing, restrict ingress, create separate migration/owner and application runtime roles, and grant only required schema/table permissions.
- **Regression/acceptance:** inspect rendered deployment network policy without revealing secret values; verify DB port is unreachable externally and runtime DB role cannot create/drop roles or databases. Run app integration tests with the restricted role.
- **Rollback:** retain an operator-only administrative credential and a tested connection migration plan; roll back role/config changes if runtime grants prove insufficient.
- **Verification status:** configuration inspected; deployment use and network reachability unverified.

### SEC-02 — Dependency audit finds vulnerable production dependency paths

- **Severity/confidence:** Medium local risk; high confidence in audited lockfile versions. Advisory severities include High. Exploitability in this deployment was not tested.
- **Affected:** afrinov-platform/package-lock.json; apps/backend/package.json; apps/backend/src/modules/reporting/report-query.schema.ts:51–54.
- **Evidence:** npm audit returned four moderate and three high findings overall; npm audit --omit=dev returned one moderate and two high package findings. Zod 3.25.76 is affected by GHSA-mrhx-c7xc-m3w5. Report filter arrays have no maximum size and their routes require ViewReports. fast-uri 3.1.8 is affected by GHSA-w74x-v6f9-j3xg in the production dependency graph. The upstream advisories are linked in 03.
- **Expected vs actual:** production dependencies should be on patched versions and unbounded user-controlled arrays should have reasonable limits.
- **Impact/root cause:** oversized arrays may exhaust memory in vulnerable Zod versions; fast-uri advisory indicates URI parsing edge cases. Report access requires an authenticated account. No exploit attempt was made.
- **Remediation:** set justified query array limits and validate API compatibility; plan and test a patched Zod path (advisory fix crosses a major version), upgrade fast-uri through a compatible Fastify dependency update or override only after compatibility tests. Review and separately disposition dev-only findings.
- **Regression/acceptance:** audit production and full lockfile reports clean or document exceptions; oversized query arrays reject promptly; OpenAPI schemas and report filters remain compatible for accepted sizes; backend unit/integration suite passes.
- **Rollback:** revert dependency lockfile changes as a unit if compatibility breaks, while retaining the explicit input bounds if behaviorally compatible.
- **Verification status:** lockfile audit executed; no upgrade performed.

### DATA-03 — Inventory balance foreign keys are missing from migrations

- **Severity/confidence:** Medium / high.
- **Affected:** apps/backend/prisma/schema.prisma:526–537; prisma/migrations/20260101000000_initial/migration.sql:252–260.
- **Evidence:** Prisma schema declares material and location relations on InventoryBalance; initial table creation has only its composite primary key. No later migration adds the two foreign keys.
- **Expected vs actual:** deployed schema should enforce the relations represented in Prisma; it does not enforce them for this table.
- **Impact/root cause:** orphan balances may persist after out-of-band writes or an application defect and may mislead reports.
- **Remediation:** inspect every deployed DB for orphans, then add an explicit migration with the intended delete/update behavior.
- **Regression/acceptance:** migration succeeds on clean and representative populated DBs; invalid material/location references are rejected; orphan preflight output is reviewed and resolved.
- **Rollback:** forward-only corrective migration; if constraint creation fails, leave migration unapplied and resolve data before retrying.
- **Verification status:** schema/migration scan completed; no DB inspection or migration execution.

### AUD-01 — User changes can commit without their audit record

- **Severity/confidence:** Medium / high.
- **Affected:** apps/backend/src/modules/identity/identity.service.ts:74–95 and 100–135.
- **Evidence/reproduction:** create writes the user before a separate auditLogEntry.create. Update commits the user/role transaction and writes audit afterward. An audit insert failure can make the request fail after the administrative change committed.
- **Expected vs actual:** if audit is required for administrative changes, both should commit or roll back together; current flow can leave an unrecorded change.
- **Impact/root cause:** user creation/role/deactivation may lack corresponding audit history and caller receives an error despite committed effect.
- **Remediation:** make each user mutation and audit record atomic in one Prisma transaction.
- **Regression/acceptance:** inject audit write failure and assert the user and roles are unchanged; successful mutation creates exactly one audit entry.
- **Rollback:** revert transaction wrapper if needed; do not synthesize audit records without an approved historical correction process.
- **Verification status:** source-reviewed; failure injection not run.

### OPS-01 — Production deployment and recovery evidence is missing

- **Severity/confidence:** High release gate / high confidence repository evidence is absent; external processes unknown.
- **Affected:** repository delivery and operations evidence; no production deployment target found.
- **Evidence:** GitHub Actions has CI but no deployment workflow or target configuration. No backup/restore runbook, verified restore, RPO/RTO, production monitoring/alerting or deployment rollback rehearsal was identified.
- **Expected vs actual:** a production release needs an identified owner and tested recovery/deployment procedure; repository evidence does not establish one.
- **Impact/root cause:** operators may not be able to recover data or diagnose/roll back a failed release. This is an evidence gap, not proof no external backup exists.
- **Remediation:** deployment owner supplies actual topology, backup and restore evidence, operational ownership, migration/release procedure and rollback/correction plan.
- **Regression/acceptance:** successful restore in an isolated environment from a retained backup, accepted recovery objectives, alert delivery proof, deployment smoke test and migration rehearsal signed by owners.
- **Rollback:** not applicable to code; release remains blocked until evidence is reviewed.
- **Verification status:** repository evidence reviewed; external environment not accessible.

### ARCH-01 — Last administrator can remove their own or system admin access

- **Severity/confidence:** Medium / medium-high.
- **Affected:** apps/backend/src/modules/identity/identity.service.ts:100–135 and user routes.
- **Evidence/reproduction:** update accepts active and roleNames changes and contains no apparent guard for self-demotion or last-active-admin state. An authorized user administration request can remove the caller's ADMIN role or deactivate the last active administrator.
- **Expected vs actual:** if an administrative recovery path is required, at least one active administrator should remain or a documented break-glass path should exist; no such guard was found.
- **Impact/root cause:** accidental or malicious administrative lockout; recovery may depend on direct database access.
- **Remediation:** agree on last-admin policy and recovery route; enforce it transactionally if needed.
- **Regression/acceptance:** test last-admin deactivation/demotion, concurrent admin changes and authorized recovery behavior.
- **Rollback:** preserve a tested break-glass recovery procedure before enforcing the constraint.
- **Verification status:** source-reviewed; product policy and recovery procedure unknown.

### SEC-04 — CORS wildcard can be enabled in production

- **Severity/confidence:** Low / high.
- **Affected:** apps/backend/src/shared/config.ts:126–140 and apps/backend/src/server.ts:75–83.
- **Evidence:** CORS_ALLOW_ANY=true returns true in every environment; CORS plugin also sets credentials true.
- **Impact:** broad browser cross-origin access if explicitly enabled. Current bearer-token design means no demonstrated cookie CSRF path.
- **Remediation/acceptance:** reject the switch in production or document a reviewed exception; add configuration tests.
- **Verification status:** source-reviewed; no live browser test.

### SEC-05 — Rate limits may key all clients as the proxy

- **Severity/confidence:** Medium conditional / medium.
- **Affected:** apps/backend/src/server.ts:121–138 and request IP use; no trustProxy configuration found.
- **Evidence:** in-memory per-process rate limiting uses request IP. If deployed behind a reverse proxy without appropriate trusted proxy handling, clients may share the proxy IP; multiple replicas do not share counters.
- **Remediation/acceptance:** confirm network topology, configure only known trusted proxies, and use a shared store if cluster-wide enforcement is required. Test client-specific limits in the actual topology.
- **Verification status:** configuration inspected; deployment topology unknown.

### SEC-06 — Browser token storage makes XSS impact high

- **Severity/confidence:** Medium conditional / high confidence that the SPA stores bearer tokens in `localStorage`; no obvious injection sink was found in the searched application source.
- **Affected:** frontend authentication/token persistence and the production static host's security headers, which are not defined in this repository.
- **Evidence/reproduction:** the frontend persists the bearer token in browser local storage. Any successful same-origin script execution could read it. The audit did not identify an obvious script injection sink or inspect production Content Security Policy headers.
- **Impact/root cause:** an XSS defect or unsafe third-party script could expose a reusable bearer token until expiry or revocation.
- **Remediation:** retain as a security design risk for the frontend and static-host owner; review CSP and token lifetime/storage strategy in a separately scoped frontend security package.
- **Regression/acceptance:** host-level CSP and script-source policy are verified against the deployed origin; any storage redesign includes session renewal, logout, refresh and XSS/CSRF trade-off tests.
- **Verification status:** token storage confirmed; exploitability and production headers unverified. This finding is outside the approved work packages.

### DOC-01 — Operations documentation is stale

- **Severity/confidence:** Low / high.
- **Affected:** afrinov-docs/docs/06-system-architecture/deployment-architecture.md:7; docs/13-project-management/onboarding.md:246; apps/backend/README.md:183–203.
- **Evidence:** docs name node:20-alpine and say integration configuration loads .env; Dockerfile uses node:24-alpine and current integration config reads .env.test only with local/_test guards.
- **Impact/remediation:** operators may follow an incorrect runtime or unsafe/outdated test setup. Update docs alongside the next source/release procedure change.
- **Verification status:** documentation/source comparison completed.

### ARCH-02 — Duplicate request/idempotency behavior needs a product contract

- **Severity/confidence:** Informational / medium.
- **Affected:** inventory issue and stock receipt POST routes.
- **Evidence:** repeated valid POSTs create additional ledger records; no idempotency key or duplicate request contract was found. Legitimate repeated receipts are currently possible.
- **Impact/remediation:** clients retrying after a timeout may duplicate an operation. Decide at-most-once semantics per operation before implementing idempotency; do not reject legitimate repeated receipts by guesswork.
- **Verification status:** design concern, not a confirmed defect without a retry contract.

## Release blockers

1. Resolve DATA-01, DATA-02 and DATA-04 with isolated PostgreSQL concurrency tests and reviewed transaction/locking design.
2. Fix SEC-01 and verify configuration failure behavior before any production deployment.
3. Confirm the actual Compose/deployment topology; remove production DB network exposure and superuser use if applicable.
4. Provide production deployment, backup/restore and recovery evidence required by OPS-01.
5. Patch or explicitly accept the production dependency findings with security ownership.

## Evidence limitations and residual risks

The audit did not access a production host, production database, secret manager, CI run history, GitHub security alerts or network perimeter. No integration/E2E test, migration, seed, Docker build, restore drill, production configuration render or deployment was run during the audit. The configuration and concurrency defects are established from application source/probe, but real-world exploitability and deployment applicability remain unknown. The implementation evidence log records subsequent authorized work and any unavailable checks.

## Evidence references

- Prisma transaction isolation behavior: https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions
- PostgreSQL 16 transaction isolation: https://www.postgresql.org/docs/16/transaction-iso.html
- Official Postgres image user behavior: https://hub.docker.com/_/postgres
- Docker Compose published port host binding: https://docs.docker.com/reference/compose-file/services/
- Zod advisory: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- fast-uri advisory: https://github.com/advisories/GHSA-w74x-v6f9-j3xg

## Final readiness decision

**NOT PRODUCTION READY.** The verified concurrency hazards threaten core inventory correctness, configuration validation can bypass production-specific secret checks, and the only repository-provided deployment topology has a high-impact conditional database exposure. The absence of verified deployment and recovery evidence independently prevents a release-ready conclusion. Reassess after the release blockers are addressed and their acceptance evidence is collected.
