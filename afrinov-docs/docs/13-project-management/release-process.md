<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-13-008</b></td>
<td align="center"><b><i>Release Process</i></b><br><i>Project Management</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-13-008 updated=2026-11-26 by="Ntokozo Maselala" body=49ece97886dd -->

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
