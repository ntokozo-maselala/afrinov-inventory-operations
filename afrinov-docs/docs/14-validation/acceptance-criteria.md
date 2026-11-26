<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-14-001</b></td>
<td align="center"><b><i>Acceptance Criteria (Go-Live)</i></b><br><i>Validation</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-14-001 updated=2026-11-26 by="Ntokozo Maselala" body=b66d242b35b4 -->

# Acceptance Criteria (Go-Live)

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

- All v1 Business Requirements (`02-business-analysis/business-requirements.md`)
  implemented and passing their acceptance scenarios.
- Migration reconciliation report shows zero unexplained variance between
  migrated balances and the source workbook's final `Current Stock` values.
- UAT completed with sign-off from Store Controller and business owner.
- No open Severity-1 technical debt items touching balance correctness.

*Status at 4e6d76f:* BR-008 (tool tracking) is not implemented, so the
first criterion is not met unless tools are moved out of v1; the
reconciliation report can be produced with
`npm run import:workbook -- --reconcile` (`07-data/migration-strategy.md`).
UAT sign-off is *Unverified*.
