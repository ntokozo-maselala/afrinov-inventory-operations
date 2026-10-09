# Release Process

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Planned — no release process is implemented in the repository** (no
deploy jobs, no staging environment, no tags or changelog for releases).
Intent: deploy to staging automatically on merge; run the full
E2E/acceptance suite; manually review any change to inventory
transaction/balance logic before promoting to production; release during a
low-activity window until confidence is established, since the shop floor
depends on the system during working hours.

Go-live itself is planned in `workbook-replacement-roadmap.md` (repository
root, "Cutover and go-live").

## Evidence
- `.github/workflows/` — CI only
- `git tag` — no tags at 4e6d76f
