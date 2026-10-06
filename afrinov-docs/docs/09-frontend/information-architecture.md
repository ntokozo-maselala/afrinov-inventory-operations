# Information Architecture

```
Dashboard

Procurement
 |- Suppliers
 |- Purchase Orders
 `- Goods Receipts

Inventory
 |- Materials
 |- Stock (current balances)
 |- Movements (history)
 |- Transfers
 `- Adjustments

Tools
 |- Check Out / Check In
 `- Currently Checked Out

Reports
 |- Stock Value
 |- Low Stock / Reorder
 |- Project Consumption
 `- Movement History

Documents            (future)

Administration
 |- Users & Roles
 |- Locations
 |- Suppliers (merge/cleanup tooling)
 `- Settings
```

This replaces the flat page list from the first prototype (Dashboard,
Inventory Items, PO, Reports, Documents, Settings, Supplier) with navigation
grouped by business domain (`03-domain/bounded-contexts.md`), which is the
concrete UI expression of the scope change requested by the business owner.
