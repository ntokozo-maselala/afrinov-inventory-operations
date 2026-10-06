# Component Architecture (Inventory module example)

```
inventory/
├── http/
│   ├── materials.routes.ts
│   ├── locations.routes.ts
│   ├── transactions.routes.ts
│   └── balances.routes.ts
├── application/
│   ├── receive-stock.usecase.ts
│   ├── issue-stock.usecase.ts
│   ├── transfer-stock.usecase.ts
│   ├── adjust-stock.usecase.ts
│   └── check-out-tool.usecase.ts
├── domain/
│   ├── material.entity.ts
│   ├── location.entity.ts
│   ├── inventory-transaction.entity.ts
│   ├── inventory-balance.ts          # derivation logic
│   └── rules/
│       ├── sufficient-balance.rule.ts
│       └── reorder-threshold.rule.ts
├── persistence/
│   ├── material.repository.ts
│   ├── location.repository.ts
│   └── inventory-transaction.repository.ts
└── events/
    └── inventory.events.ts            # InventoryIncreased, InventoryIssued, ...
```

Each use case is one business transaction from `03-domain/business-transactions.md`
— e.g. `receive-stock.usecase.ts` implements exactly the steps in
`04-processes/goods-receiving.md`, nothing more, nothing less.
