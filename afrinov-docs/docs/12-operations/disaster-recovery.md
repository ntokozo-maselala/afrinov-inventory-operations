# Disaster Recovery

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Planned.** Define RPO/RTO targets with the business before go-live.
*Unverified* proposed default in the absence of a stated requirement:
RPO ≤ 24h via daily backup, RTO ≤ 1 business day. Write the recovery
runbook once the hosting environment is chosen. Recovery from the
workbook is possible only up to the go-live date (opening balances are
imported once; see `07-data/migration-strategy.md`).

## Evidence
- `afrinov-platform/apps/backend/src/modules/migration/opening-balance.service.ts:1-9`
