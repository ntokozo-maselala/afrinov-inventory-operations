# Resource Model

| Resource | Maps to | Key operations |
|---|---|---|
| Material | `materials` | list, get, create, update, deactivate |
| Location | `locations` | list, get, create, update, deactivate |
| Supplier | `suppliers` | list, get, create, update, deactivate |
| PurchaseOrder | `purchase_orders` (+lines) | list, get, create, submit, approve, cancel |
| GoodsReceipt | `goods_receipts` (+lines) | list, get, create (post) |
| InventoryTransaction | `inventory_transactions` | list, get (read-only; created only via action endpoints below) |
| InventoryIssue (action) | inserts InventoryTransaction(type=issue) | create |
| InventoryTransfer (action) | inserts two linked InventoryTransactions | create |
| InventoryAdjustment (action) | inserts InventoryTransaction(type=adjustment) | create |
| ToolCheckOut / ToolCheckIn (action) | inserts InventoryTransaction + updates tool holder state | create |
| Report: CurrentStock | derived view | get (filterable) |
| Report: MovementHistory | derived view | get (filterable) |
| Report: StockValue | derived view | get (filterable) |
| Report: ProjectConsumption | derived view | get (filterable by project) |
| Report: LowStock | derived view | get |
| User / Role | `users`, `roles` | list, get, create, update |
