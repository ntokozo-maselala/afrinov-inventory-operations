<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-12-008</b></td>
<td align="center"><b><i>Incident Management</i></b><br><i>Operations</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-12-008 updated=2026-11-26 by="Ntokozo Maselala" body=d7d1d5fa0a8c -->

# Incident Management

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Any incident that could have caused an incorrect stock balance (a
deployment bug, a failed migration, a database anomaly) is treated as high
severity regardless of user-visible impact. *Unverified* as an agreed
policy; no runbook or on-call arrangement is in the repository.

Post-incident checks available today:
- the ADR-002 invariant — each `inventory_balances` row equals the sum of
  its ledger rows (the query the integration helper `ledgerAndBalance()`
  runs);
- the import reconciliation, `npm run import:workbook -- --reconcile`,
  which compares the opening balances in the database with the workbook
  (`07-data/migration-strategy.md`).

A tool that repairs balances by recomputing all of them is **Planned**;
`recomputeBalancesFor()` exists for one material and location.

## Evidence
- `afrinov-platform/apps/backend/integration/helpers.ts:74-88`
- `afrinov-platform/apps/backend/scripts/import-workbook.ts:71-96`
- `afrinov-platform/apps/backend/src/modules/inventory/balances.ts:15-26`
