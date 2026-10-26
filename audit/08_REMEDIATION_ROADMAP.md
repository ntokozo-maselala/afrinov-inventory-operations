# 08 — Remediation roadmap

## Authorization and scope

The owner approved implementation of work packages 1–6 on 2026-10-26, including the configuration unit-test seam and real PostgreSQL integration-test seam. The approval covers the application and migration work below. It does not authorize deployment, release, production database access, or production infrastructure changes. Work package numbering below is the approved implementation sequence; it is distinct from the earlier audit-priority order.

The package-to-finding map and acceptance criteria were recorded before production-code changes. The only application-code scope is the six packages below. No new runtime dependency is planned; the SEC-02 dependency updates are limited to patched compatible versions and the vulnerable input path.

| WP | Finding(s) | Risk and affected area | Approved change | RED/GREEN acceptance evidence | Boundaries and material risk |
|---|---|---|---|---|---|
| 1 | SEC-01 | An invalid `NODE_ENV` bypasses production-only checks; short signing secrets can be accepted in production. `shared/config.ts` and config tests. | Runtime-validate the environment allowlist and enforce a documented minimum JWT secret length in production. Keep the default environment behavior explicit. | Unit tests reject unknown labels and short production secrets, accept valid settings, and prove error messages do not contain secret values. Existing config/server startup tests pass. | A production secret shorter than the new threshold will fail startup and needs a planned rotation/session-impact decision before deployment. No production secret is read or changed here. |
| 2 | DATA-01 | Concurrent stock movements can pass the same balance check or race the materialized balance. Inventory movements and every balance-changing writer. | Use one transaction-scoped material/location serialization protocol before invariant reads and ledger writes; acquire multi-key locks in stable order. Include issue returns and count adjustments, and keep all existing stock writers on the protocol. | Dedicated PostgreSQL races prove that oversubscribed issues, transfers, adjustments, returns and counts cannot violate available stock or ledger/balance equality; failure rollback and existing sequential behavior pass. | Application behavior and ledger format remain unchanged. PostgreSQL advisory-lock serialization can reduce throughput for the same material/location; it does not serialize unrelated keys. |
| 3 | DATA-02, DATA-04 | Reposting one receipt can duplicate effects; separate receipts can race the same PO line and exceed ordered quantity. Goods receipt posting. | Atomically claim a submitted receipt inside its existing transaction and serialize/check affected PO lines before incrementing quantities. | Dedicated PostgreSQL tests prove same-receipt concurrency yields one post and one conflict, distinct-receipt concurrency cannot exceed the PO cap, effects occur once, and failures roll back receipt, ledger and PO changes. | No idempotency contract is added for legitimate repeated receipts. Existing sequential conflict/validation behavior is preserved. |
| 4 | SEC-02 | Vulnerable Zod and fast-uri versions are in production dependency paths; report filter arrays are unbounded. Backend query schemas and lockfile. | Bound report filter arrays and move to advisory-fixed dependency versions with compatibility changes limited to what the backend requires. | Query-limit unit/API contract tests pass; typecheck and backend regression suites pass; fresh full and production-only dependency audits are recorded. | Zod crosses a major version boundary. Any incompatible API behavior discovered is documented and corrected only within backend validation compatibility. No unrelated package refresh. |
| 5 | DATA-03 | Inventory balances can reference missing material/location rows because the database lacks the declared foreign keys. Prisma migration/schema. | Add a forward migration for both foreign keys, with a preflight that reports/refuses orphan rows and no automatic data deletion. | Disposable PostgreSQL migration rehearsal succeeds on clean and populated data, invalid references are rejected, and the orphan check is exercised. | No production database is inspected or migrated. Existing orphan data, if any, must be resolved by the data owner before deployment. Migration is forward-only and requires a corrective migration or restore plan if later changes are needed. |
| 6 | AUD-01 | User/role changes can commit while their audit write fails. Identity service. | Put each covered user mutation and its audit record in one Prisma transaction. | PostgreSQL integration tests inject audit-write failure and prove the mutation rolls back; success creates one corresponding audit row. Existing identity behavior passes. | Existing audit payloads and authorization remain unchanged. No historical audit records are synthesized. |

## Explicitly outside this authorization

- SEC-03 changes to Compose port publishing, database roles, credentials or host/network rules are deferred until the deployment owner confirms the actual topology and authorizes those changes.
- SEC-04/SEC-05 topology hardening, SEC-06 token-storage/CSP redesign, ARCH-01 administrator policy, ARCH-02 idempotency policy, OPS-01 deployment/recovery evidence, and DOC-01 documentation drift are residual findings. This implementation does not decide their product or operational policy.
- No deployment, release, production database access, migration, backup/restore operation, service restart or production infrastructure change is authorized.

## Behavior-preservation requirements

- Preserve the append-only signed transaction ledger, current API payloads, status meanings, permission checks, audit fields and valid repeated business operations.
- Do not rewrite historical transactions to repair concurrency results; use audited reversals/corrections under an approved data-repair process.
- Do not add idempotency rejection for legitimate repeated receipts or retries without a product contract.
- The stock serialization rule must cover every balance-changing path, including opening balances, receipts, procurement receipts, tool loans, stock counts and material/location movements, or be shown not to touch the protected stock balance.
- Migration code must reject/report orphan data without deleting it.

## Verification and rollback approach

1. Establish the clean-revision baseline and record failed, skipped and environment-blocked checks in `05_TESTING_AND_QUALITY.md`.
2. For each approved behavior, add a focused failing test, verify the failure reason, implement the smallest fix, then refactor and rerun related suites. Record the red/green results in `09_IMPLEMENTATION_LOG.md`.
3. Use unit tests for configuration and validation; use a newly created, disposable PostgreSQL target for transaction, race and migration assertions. Do not use the existing `.env.test` target until its state is positively established as disposable.
4. Rehearse forward migration behavior on clean and representative data; inspect the orphan report before constraints are added.
5. Reassess release readiness only after acceptance evidence is attached. A successful code change does not authorize deployment.

## Exit status

Implementation is authorized and in progress. No production change is included. Package completion and residual risks will be recorded here and in the implementation log as evidence is collected.
