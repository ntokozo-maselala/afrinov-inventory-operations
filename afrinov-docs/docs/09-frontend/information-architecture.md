<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-09-004</b></td>
<td align="center"><b><i>Information Architecture</i></b><br><i>Frontend Reference</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-09-004 updated=2026-11-26 by="Ntokozo Maselala" body=27e2d6299186 -->

# Information Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

The sidebar groups, as implemented:

```
Overview
 `- Dashboard                     /

Store
 |- Stock                         /stock
 |- Issue stock                   /stock/issue      (inventory:issue)
 |- Receive stock                 /stock/receive    (inventory:receive)
 |- Return stock                  /stock/return     (inventory:return)
 |- Count stock                   /stock/count      (inventory:count)
 |- Order stock                   /stock/orders     (stores:order; unless VITE_PROCUREMENT_ENABLED=false)
 `- Tools                         /tools

Reports
 |- Stock status                  /reports/stock-status
 |- Stock used                    /reports/consumption
 |- Procurement savings           /reports/procurement-savings (sales:view; unless VITE_PROCUREMENT_ENABLED=false)
 |- Stock report                  /reports/stock-report
 `- Movements                     /movements

Operations
 |- Materials                     /materials
 |- Locations                     /locations
 |- Recipients                    /recipients
 `- Suppliers                     /suppliers

Sales
 |- Projects                      /projects
 `- Sales RFQ                     /sales-rfqs           (sales:view; unless VITE_PROCUREMENT_ENABLED=false)

Production
 `- Labour rates                  /labour-rates         (labourRates:view; unless VITE_PROCUREMENT_ENABLED=false)

Procurement                       (unless VITE_PROCUREMENT_ENABLED=false)
 |- RFQ                           /rfqs                 (procurement:manage)
 |- New purchase order            /purchase-orders/new  (procurement:manage)
 `- Purchase orders               /purchase-orders      (orders:view; project orders only, ADR-021)

Account
 `- Settings                      /settings  (General, Notifications, Inventory, Purchase orders*,
                                              Appearance, Users, Security, System, Data, History)
```
\* Purchase-order settings only when procurement is on.

Items marked with a permission are shown only to roles that hold it; the
rest are shown to every signed-in user. Transfers and adjustments are
actions launched from a row on the Stock page (`StockActionForm`); reversals
and returns of a single movement are launched from its detail drawer on
Movements (`TransactionDrawer`). Neither has its own page. A purchase order's
page and its edit page are reached from the Purchase orders list.

**Planned** (from the original design, not built): Documents, and
supplier/location merge tooling.

This replaces the flat page list from the first prototype with navigation
grouped by business area. *Unverified:* that this grouping is the one the
business owner asked for.

## Evidence
- `afrinov-platform/apps/frontend/src/hooks/useNavGroups.tsx`
- `afrinov-platform/apps/frontend/src/App.tsx`
- `afrinov-platform/apps/frontend/src/components/StockActionForm.tsx`, `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx`
