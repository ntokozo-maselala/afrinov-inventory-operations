# Domain Overview

## Domains identified
| Domain | Responsibility |
|---|---|
| Procurement | Suppliers, purchase orders, the buying side of the loop |
| Inventory | Materials, locations, balances, movements — the core ledger |
| Operations | Projects and workshop consumption context (reference only, v1) |
| Reporting | Cross-domain read views: stock value, movement history, alerts |
| Identity & Access | Users, roles, permissions, audit |
| Document Management (future) | Delivery notes, invoices, PO documents as first-class attachments |

## Potential future domains (not built now)
Finance, Sales, Manufacturing, Asset Management (for `Office Device List`).

## Why these boundaries
They mirror the actual business process observed in the spreadsheet: a
supplier-facing side (Procurement), a stock-facing side (Inventory), and a
consumption-facing side (Operations/Projects) — the same three-part shape
SAP uses across Purchasing → Materials Management → Production/Plant
Maintenance (see `05-sap-study/sap-lessons-for-afrinov.md`), scaled down to
what Afrinov actually needs.
