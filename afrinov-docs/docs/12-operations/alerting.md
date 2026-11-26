<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-12-001</b></td>
<td align="center"><b><i>Alerting</i></b><br><i>Operations</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-12-001 updated=2026-11-26 by="Ntokozo Maselala" body=8e6ecea7d883 -->

# Alerting

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Operational alerts** (elevated error rate, downtime, failed migrations)
to engineering: **Planned** — nothing in the repository configures them.

**Business alerts** (material below Required Stock) surface inside the
product to the Store Controller/Procurement role: implemented as the
Stock status page, the dashboard's Urgent/Warning tiles and the re-order
list download, controlled by `inventory.enableStockAlerts`. Nothing sends
notifications, so the notification settings were retired (ADR-035); a
switch comes back with an alerts feature that reads it. The two audiences
should not share a channel.

## Evidence
- `afrinov-platform/apps/frontend/src/pages/Dashboard.tsx:295-296` (checked against the code at `f659e5d`, 2026-11-26)
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.service.ts:263-266`
- `afrinov-platform/apps/backend/src/modules/settings/settings.service.ts:183-185`
