# Module Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

```
afrinov-platform/apps/backend/
├── src/
│   ├── index.ts              # entry point: validate config, start server
│   ├── server.ts             # Fastify setup: CORS, helmet, JWT, rate limits, error handler, routes
│   ├── modules/
│   │   ├── identity/         # login, /auth/me, users and their roles
│   │   ├── inventory/        # materials, locations, racks, stock items, ledger, movements, counts
│   │   ├── procurement/      # suppliers, purchase orders, goods receipts
│   │   ├── operations/       # projects, recipients ("Issued To")
│   │   ├── reporting/        # read-only reports and Excel/PDF exports
│   │   ├── settings/         # typed settings catalog and its API
│   │   ├── audit/            # GET /audit
│   │   ├── health/           # /api/v1/health, /api/v1/health/ready
│   │   └── migration/        # workbook reading, mapping, opening balances, reconciliation
│   ├── shared/               # config, db, errors, events, permissions, authorization, decimal, ids,
│   │                         # version, inventory/balances, inventory/stock-status
│   ├── openapi/              # OpenAPI document served at /api/docs
│   └── db/                   # migrate.ts (runs prisma migrate deploy), seed.ts
├── prisma/                   # schema.prisma, migrations/
├── integration/              # integration tests against a real database
└── scripts/                  # import-workbook.ts, diag-login.ts, diagnostic.ts (not built)
```

There is no `suppliers/` module (suppliers live in `procurement/`), no
`documents/` module (document management is **Planned**), and no
`infrastructure/` folder (bootstrap is `server.ts`). The procurement
routes for purchase orders and goods receipts are registered only when
`PROCUREMENT_ENABLED=true`; supplier routes are always registered.

## Module boundary rule
*Intended:* a module depends only on another module's public interface and
never reaches into another module's tables; `reporting` owns no write path.

*As implemented:* `reporting` has no write path (verified). The other rules
are not enforced and are currently broken (TD-004):

| From | Depends on | How |
|---|---|---|
| `inventory/inventory.service.ts` | `settings` | imports `SettingsService` |
| `inventory/stock-receipt.service.ts` | `procurement` | imports `generateGRNumber`; writes `goods_receipts` |
| `procurement/goods-receipt.service.ts` | `inventory` | imports `InventoryService` (so inventory ↔ procurement depend on each other) |
| `procurement/procurement.service.ts` | inventory tables | inserts `inventory_transactions` and recomputes balances when receiving a whole order |
| `reporting/*` | inventory, master-data and settings | reads tables directly with Prisma; imports `SettingsService` |
| `shared/inventory/stock-status.ts` | `settings` | shared code importing a module |
| `db/seed.ts` | `inventory` | imports `modules/inventory/balances.js` |

## Evidence
- `afrinov-platform/apps/backend/src/` — folder layout
- `afrinov-platform/apps/backend/src/server.ts:246-278` — route registration; procurement gate at :269-271
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:15`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts:11,72`
- `afrinov-platform/apps/backend/src/modules/procurement/goods-receipt.service.ts:4`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:324-335`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.ts:11`
- `afrinov-platform/apps/backend/src/db/seed.ts` — import of `../modules/inventory/balances.js`
