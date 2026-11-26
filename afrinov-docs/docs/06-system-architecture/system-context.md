<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-06-010</b></td>
<td align="center"><b><i>System Context</i></b><br><i>System Architecture</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-06-010 updated=2026-11-26 by="Ntokozo Maselala" body=a4418db5a15d -->

# System Context

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

```
                 AFRINOV USERS (Store Controller, Technicians,
                  Procurement, Project Leads, Management)
                              |
                       browser (React SPA)
                              |  HTTPS/JSON  /api/v1
                              v
                  AFRINOV INVENTORY & OPERATIONS PLATFORM
                      (Fastify API, one deployable)
                              |
      +--------------+--------+---------+-------------+
      |              |                  |             |
  Procurement     Inventory        Operations      Reporting
  (off unless   (ledger, master   (projects,     (read-only,
   enabled)      data, counts)     recipients)    Excel/PDF)
      +--------------+--------+---------+-------------+
                              |
                        PostgreSQL 16

  Stock workbook (.xlsm) --> import:workbook CLI (one-off, see 07-data)
```

## External systems (v1)
None. This platform is self-contained, replacing the stock workbook. No
live integration exists (suppliers are contacted outside the system; no
accounting system integration). The workbook enters once, through the
command-line import; reports leave as downloaded Excel or PDF files.

## Future integration points
Finance (stock valuation / GL posting), a document store for scanned
delivery notes/invoices (the future Document Management context). Neither
is built.

## Evidence
- `afrinov-platform/apps/frontend/src/api/client.ts:57-68` — browser calls `/api/v1`
- `afrinov-platform/apps/backend/src/server.ts:246-278` — modules behind one server; procurement gated
- `afrinov-platform/apps/backend/scripts/import-workbook.ts:1-18`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts:66-198` — exports
