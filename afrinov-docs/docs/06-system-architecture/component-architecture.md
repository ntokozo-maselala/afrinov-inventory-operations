# Component Architecture (Inventory module example)

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

The inventory module as it exists in
`afrinov-platform/apps/backend/src/modules/inventory/` (tests omitted):

```
inventory/
├── material.routes.ts        # /materials and /locations routes (both live in this file)
├── material.service.ts       # material master create/update/list, with audit entries
├── location.service.ts       # location create/update/status/delete (delete only when unused)
├── rack.routes.ts            # /racks
├── rack.service.ts           # rack create/update/archive (archive = status INACTIVE)
├── stock-item.routes.ts      # POST /stock-items
├── stock-item.service.ts     # new material + optional opening RECEIPT in one transaction
├── inventory.routes.ts       # ledger reads and stock movements (issue, transfer, adjust,
│                             #   stock count, counter receipt, return, reversal)
├── inventory.service.ts      # issue, return, transfer, adjust, reverse, post goods receipt
├── stock-receipt.service.ts  # receiving at the counter without a purchase order
├── stock-count.service.ts    # count by location; differences posted as COUNT_VARIANCE adjustments
└── balances.ts               # recomputeBalancesFor() — used by the seed
```

Shared inventory helpers used by this and other modules live in
`src/shared/inventory/`:

```
shared/inventory/
├── balances.ts       # recomputeBalance(), getCurrentBalance() inside a Prisma transaction
└── stock-status.ts   # URGENT / WARNING / OK / NOT_SET classification and the setting-driven bands
```

Each service method that moves stock runs one Prisma transaction: it
validates the referenced material, location, recipient or project, checks
the no-negative-stock rule against the current balance, inserts
`inventory_transactions` rows, recomputes the affected balance rows, and in
some cases writes an audit entry and dispatches in-process domain events.

There is no tool check-out/check-in component; that capability is
**Planned** (see `04-processes/stock-issuing.md`). There are no separate
`application/`, `domain/` or `persistence/` folders: rules live in the
service files.

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/` — file list
- `afrinov-platform/apps/backend/src/modules/inventory/material.routes.ts:27-161` — material and location routes
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:70-170`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:289-364` — issue as an example of the transaction pattern
- `afrinov-platform/apps/backend/src/shared/inventory/balances.ts:6-32`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.ts:32-54`
