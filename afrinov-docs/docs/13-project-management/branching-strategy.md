# Branching Strategy

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Intended: trunk-based development with short-lived feature branches, one
branch per functional requirement where practical (FR IDs in branch names
or PR titles, e.g. `fr-inv-003-stock-issue`), merged via reviewed pull
request.

As practised (from the repository's branches): short-lived branches off
`main` named after the roadmap phase and feature, e.g. `phase-1-issue-stock`,
`phase-2-stock-count`, `phase-3-month-end`, plus fix branches such as
`fix-migration-test`; merged through GitHub pull requests. Functional
requirement IDs are not used in branch names. CI runs on pull requests
(`12-operations/ci-cd.md`). *Unverified:* whether review is required
before merge (branch protection is configured on GitHub, not in the
repository).

## Evidence
- `git branch -a` at 4e6d76f
- `git log --merges` — e.g. a9823e5 "Merge pull request #3 … phase-1-foundations"
- `workbook-replacement-roadmap.md` (repository root) — phases
