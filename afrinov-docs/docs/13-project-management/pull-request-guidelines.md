# Pull Request Guidelines

Each PR references the Functional Requirement(s) it implements, includes
tests (see `11-testing/test-traceability.md`), and — for anything touching
inventory balance logic — includes at least one test asserting the
"balance equals sum of transactions" invariant. Architecture-affecting PRs
link to or add an ADR in `00-governance/decision-log.md`.
