<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-12-010</b></td>
<td align="center"><b><i>Monitoring</i></b><br><i>Operations</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-12-010 updated=2026-11-26 by="Ntokozo Maselala" body=df9ee579dd88 -->

# Monitoring

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Implemented:** health checks for an external monitor to poll —
`GET /health` (process alive) and `GET /health/ready` (database reachable;
503 when not), at the root and under `/api/v1`. The Settings → System page
shows API status from `/api/v1/health`.

**Planned** (no metrics are collected): request latency and error rate per
endpoint; count of refused `INSUFFICIENT_BALANCE` attempts (stock-out
proxy); count of materials below Required Stock (available on demand from
`/reports/stock-value` and the Stock status page, not as a metric); count
of receipts without a purchase order.

## Evidence
- `afrinov-platform/apps/backend/src/server.ts:211-222`
- `afrinov-platform/apps/backend/src/modules/health/health.routes.ts:17-33`
- `afrinov-platform/apps/frontend/src/pages/SettingsSections.tsx` — `GET /health`
