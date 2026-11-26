<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-14-003</b></td>
<td align="center"><b><i>Prototype Validation</i></b><br><i>Validation</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-14-003 updated=2026-11-26 by="Ntokozo Maselala" body=1b6991462d5b -->

# Prototype Validation

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Before building beyond Milestone 1, validate the domain model
(`03-domain/`) against 3–5 real historical transactions pulled directly
from the workbook (e.g. a `FS&I Issued` receipt row, a `Tools Issued`
check-out row, a `Project Material Issued` row referencing `AFRI-1341`) by
walking them through the proposed data model by hand and confirming every
field has a home and every business rule holds.

*Unverified:* whether this walk-through was done is not recorded in the
repository. The workbook import's dry run now performs a mechanical
version of it for every Main-sheet row (`07-data/migration-strategy.md`).
