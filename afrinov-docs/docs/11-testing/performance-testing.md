# Performance Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Planned — no performance tests exist.** Intent: load-test the
transaction-heavy paths (issue, receive) and the report-heavy paths
(movement history, stock value, month-end) at a multiple of current volume.
*Unverified:* the earlier sizing basis (the `Project Material Issued` sheet
had 4,514 rows) comes from the July workbook and has not been re-checked
against the workbook now in the repository root.

## Evidence
- `afrinov-platform/apps/backend/package.json`, `afrinov-platform/apps/frontend/package.json` — no load-testing tool or script
