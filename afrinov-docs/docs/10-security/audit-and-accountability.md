# Audit & Accountability

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Accountability comes from two records (detail in `07-data/audit-model.md`):

- **The stock ledger.** Every stock movement records the signed-in user as
  `actor_id`, with time, type, quantity and reference. Rows are never
  edited; corrections are reversals with a mandatory reason (ADR-005).
- **The audit log.** Master-data changes, purchase-order transitions,
  counter receipts, stock counts, returns, reversals, the opening-balance
  import and settings changes write an entry with actor, action and (for
  most) before/after values.

*Intended:* every mutating action is logged. *As implemented:* stock
issues, transfers, adjustments, purchase-order creation and goods-receipt
creation/posting write no audit entry (the ledger still records the actor
for stock movements), and some entries are written outside the business
transaction (TD-008).

The audit log has no update or delete endpoint and is readable only with
`view:audit_log`, which only ADMIN holds (`GET /api/v1/audit`). Nothing in
the database prevents a direct UPDATE or DELETE (TD-006). This is the
direct fix for the AS-IS system's absence of "who changed this and when"
— flagged across `02-business-analysis/gap-analysis.md` as the
highest-value gap.

## Evidence
- `afrinov-platform/apps/backend/src/modules/audit/audit.routes.ts:17-37`
- `afrinov-platform/apps/backend/src/shared/permissions.ts:42-91`
- `afrinov-platform/apps/backend/prisma/schema.prisma:433-434` — `actor_id`, `posted_at`
