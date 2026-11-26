<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-03-006</b></td>
<td align="center"><b><i>Domain Overview</i></b><br><i>Domain Model</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-03-006 updated=2026-11-26 by="Ntokozo Maselala" body=5085f281553c -->

# Domain Overview

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Domains identified
| Domain | Responsibility | Backend module | Status |
|---|---|---|---|
| Procurement | Suppliers, purchase orders, goods receipts | `procurement/` | Implemented; purchase orders and goods receipts on unless `PROCUREMENT_ENABLED=false` |
| Inventory | Materials, locations, racks, ledger, balances, counts | `inventory/` | Implemented |
| Operations | Projects and recipients ("Issued To") | `operations/` | Implemented: projects are a full master record, not reference-only |
| Reporting | Read-only reports and Excel/PDF exports | `reporting/` | Implemented |
| Identity & Access | Users, roles, permissions; audit log | `identity/`, `audit/` | Implemented |
| Document Management (future) | Delivery notes, invoices, PO documents as attachments | — | **Planned** |

## Potential future domains (not built now)
Finance, Sales, Manufacturing, Asset Management (for `Office Device List`).

## Why these boundaries
They mirror the business process observed in the spreadsheet: a
supplier-facing side (Procurement), a stock-facing side (Inventory), and a
consumption-facing side (Operations/Projects) — the same three-part shape
SAP uses across Purchasing → Materials Management → Production/Plant
Maintenance (see `05-sap-study/sap-lessons-for-afrinov.md`), scaled down to
what Afrinov needs. *Unverified:* that these match the business owner's
intent (Milestone 0 review, `14-validation/stakeholder-review.md`).

## Evidence
- `afrinov-platform/apps/backend/src/modules/` — module folders
- `afrinov-platform/apps/backend/src/server.ts:269-271` — procurement gate
- `afrinov-platform/apps/backend/src/shared/config.ts:84-86` — `PROCUREMENT_ENABLED`
