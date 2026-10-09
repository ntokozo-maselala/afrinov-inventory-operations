# Information Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

The sidebar groups, as implemented:

```
Overview
 `- Dashboard                     /

Operations
 |- Stock                         /stock   (issue, receive, count at /stock/issue, /stock/receive, /stock/count)
 |- Rack                          /racks
 |- Locations                     /locations
 |- Project                       /projects
 |- Recipients                    /recipients
 |- Movements                     /movements
 `- Suppliers                     /suppliers

Procurement                       (only when VITE_PROCUREMENT_ENABLED=true)
 |- Purchase orders               /purchase-orders
 `- Goods receipts                /goods-receipts

Catalogue
 `- Materials                     /materials

Insights
 |- Inventory report              /reports/inventory
 |- Stock status                  /reports/stock-status
 |- Stock used                    /reports/consumption
 `- Month-end report              /reports/month-end

Account
 `- Settings                      /settings  (General, Notifications, Inventory, Purchase orders*,
                                              Appearance, Users, Security, System, Data, History)
```
\* Purchase-order settings only when procurement is enabled.

Transfers and adjustments (and a quick single-item issue) are actions
launched from the Stock and material detail pages (`StockActionForm`);
reversals and returns are launched from a movement's detail drawer
(`TransactionDrawer`). None has its own page. Every group is shown to every
role (no navigation item is filtered by permission; TD-015).

**Planned** (from the original design, not built): a Tools section (check
out / check in, currently checked out), Documents, and supplier/location
merge tooling.

This replaces the flat page list from the first prototype with navigation
grouped by business area. *Unverified:* that this grouping is the one the
business owner asked for.

## Evidence
- `afrinov-platform/apps/frontend/src/hooks/useNavGroups.tsx:26-73`
- `afrinov-platform/apps/frontend/src/App.tsx:114-162`
- `afrinov-platform/apps/frontend/src/components/StockActionForm.tsx`, `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx`
