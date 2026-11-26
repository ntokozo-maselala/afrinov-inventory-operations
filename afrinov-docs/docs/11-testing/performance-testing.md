<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-11-006</b></td>
<td align="center"><b><i>Performance Testing</i></b><br><i>Testing</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-11-006 updated=2026-11-26 by="Ntokozo Maselala" body=2cb7a4da9297 -->

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
