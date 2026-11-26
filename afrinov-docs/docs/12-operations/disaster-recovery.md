<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-12-005</b></td>
<td align="center"><b><i>Disaster Recovery</i></b><br><i>Operations</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-12-005 updated=2026-11-26 by="Ntokozo Maselala" body=d4005c4eaf0a -->

# Disaster Recovery

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Planned.** Define RPO/RTO targets with the business before go-live.
*Unverified* proposed default in the absence of a stated requirement:
RPO ≤ 24h via daily backup, RTO ≤ 1 business day. The backup and restore
steps are in `backup-and-recovery.md` (tested on a copy, 2026-11-11); fit them
to the host once it is chosen. Recovery from the
workbook is possible only up to the go-live date (opening balances are
imported once; see `07-data/migration-strategy.md`).

## Evidence
- `afrinov-platform/apps/backend/src/modules/migration/opening-balance.service.ts:1-9`
