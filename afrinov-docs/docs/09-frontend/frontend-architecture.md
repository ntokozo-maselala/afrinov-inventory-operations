# Frontend Architecture

Single-page application consuming the REST API (`08-api/`). Structured by
domain, mirroring the backend modules, so a feature lives in one place:

```
src/
├── features/
│   ├── inventory/     # materials, locations, transactions, balances, issue/receive/transfer/adjust UI
│   ├── procurement/   # suppliers, purchase orders
│   ├── tools/          # check-out/check-in UI (distinct flow from consumable issue)
│   ├── reporting/      # dashboards, stock value, movement history, project consumption
│   └── admin/          # users, roles, master-data management (locations/suppliers merge tooling)
├── shared/
│   ├── api-client/
│   ├── components/
│   └── auth/
```
