# Pull Request Guidelines

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Each PR references the Functional Requirement(s) it implements, includes
tests (see `11-testing/test-traceability.md`), and — for anything touching
inventory balance logic — includes at least one test asserting the
"balance equals sum of transactions" invariant. Architecture-affecting PRs
link to or add an ADR in `00-governance/decision-log.md`.

*Unverified* as current practice. Integration tests that assert the
balance-equals-ledger invariant exist (`11-testing/integration-testing.md`);
pull requests and branch names do not cite FR IDs (`branching-strategy.md`).
