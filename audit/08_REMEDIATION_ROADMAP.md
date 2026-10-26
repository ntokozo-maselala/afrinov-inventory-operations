# 08 — Remediation roadmap

No remediation was implemented during this audit. This sequence keeps behavior changes small and separates application correctness from deployment changes. Owners and dates are not assigned in the repository; name them before scheduling release work.

| Order | Finding | Priority and dependency | Smallest safe change | Required approval | Acceptance evidence |
|---|---|---|---|---|---|
| 1 | SEC-01 | Release blocker; first | Runtime-validate NODE_ENV and enforce an explicit JWT key strength policy; make API-doc production behavior fail closed | Backend owner and security owner; approve session/key rotation plan | Unit tests reject invalid labels and weak production keys; production configuration probe fails closed; valid environment starts |
| 2 | DATA-01 | Release blocker; design before implementation | Add one shared transaction-level material/location serialization mechanism and route every balance-changing operation through it | Inventory domain owner and DBA | Disposable PostgreSQL races for issue, transfer, adjustment, return and stock count preserve ledger/balance/no-negative invariants |
| 3 | DATA-02 | Release blocker; may proceed in parallel with DATA-01 | Conditionally claim receipt state or lock the receipt row before ledger effects inside the existing transaction | Procurement owner and DBA | Two concurrent posts yield one success/one conflict, one ledger set and one PO increment; rollback and sequential duplicate tests pass |
| 4 | SEC-03 | Release blocker if Compose is the deployment path; confirm topology first | Stop publishing the production DB port; split migration/owner and restricted application DB roles | Infrastructure owner and DBA | External DB access is blocked; runtime role cannot administer DB; app CI/integration works with least privilege |
| 5 | SEC-02 | High security priority; check compatibility | Bound report filter arrays; update Zod and fast-uri through a reviewed compatible dependency plan | Backend owner and security owner | Production/full npm audit clean or accepted; query limits tested; OpenAPI and API compatibility verified |
| 6 | DATA-03 | High data-integrity priority; preflight first | Add a forward migration for material/location foreign keys after orphan check | DBA and inventory data owner | Preflight is clean or resolved; clean and populated migration rehearsal passes; invalid references are rejected |
| 7 | AUD-01 | Medium | Put user mutation and corresponding audit entry in one transaction | Identity/security owner | Injected audit insert failure rolls back user/role change; success writes one audit entry |
| 8 | ARCH-01 | Medium; policy decision first | Define minimum active admin and break-glass recovery policy; implement transactionally if required | Product/admin owner and security owner | Self-demotion, last-admin and concurrent admin-change tests match approved recovery policy |
| 9 | OPS-01 | Release gate; external owner required | Document actual topology, backup schedule, retention, restore process, RPO/RTO, alerts and release rollback/correction steps | Infrastructure owner and business continuity owner | Successful isolated restore, accepted recovery objectives, alert proof, migration/deployment rehearsal |
| 10 | DOC-01 | Low; after operational facts confirmed | Reconcile runtime and integration test documentation | Documentation owner | Instructions match Dockerfile, current integration config and verified commands |
| 11 | ARCH-02 | Product decision required | Define retry semantics per write endpoint before adding idempotency keys | Product and API owners | Contract documents accepted duplicate behavior; API/integration tests cover timeout retry and legitimate repeated operations |
| 12 | SEC-04 / SEC-05 | Conditional hardening | Lock down production CORS wildcard; configure known trusted proxies/shared rate-limit storage if topology requires | Security and infrastructure owners | Production config tests and topology tests prove origin and per-client throttling behavior |

## Behavior-preservation requirements

- Preserve the append-only signed transaction ledger, current API payloads, status meanings, permission checks, audit semantics and valid repeated business operations.
- Do not rewrite historical transactions to repair concurrency results; use audited reversals/corrections under an approved data-repair process.
- Do not add uniqueness constraints or idempotency rejection until product semantics for legitimate duplicate receipts and retries are approved.
- Validate migration changes against representative existing data, and retain forward corrective migration steps because the repository has no down migrations.

## Verification and rollback approach

1. Add focused unit tests for input/state behavior, then PostgreSQL integration tests in an isolated disposable database for concurrency and transaction rollback.
2. Rehearse schema changes on a copy and inspect orphan/preflight reports before applying constraints.
3. Release config and dependency changes separately from ledger locking changes where practical; use controlled rollout and monitor conflicts, database errors and balance reconciliation.
4. Keep application rollback compatible with any forward database migration. Where the schema cannot be rolled back, provide a corrective forward migration and tested restore process.
5. Close each finding only when its objective acceptance evidence in 07 is attached to the change/release record.

## Phase 8 exit

The roadmap orders urgent configuration, integrity and deployment work before improvements and documentation. It records dependencies, behavior-preservation rules, approvals, verification and rollback expectations. No fixes were applied; implementation requires a separate explicit authorization.
