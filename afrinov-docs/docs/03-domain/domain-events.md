# Domain Events

Business-meaningful things that happened — the vocabulary the system should
think and log in, independent of any particular messaging technology.

| Event | Raised by | Consumed by |
|---|---|---|
| `SupplierCreated` | Procurement | Reporting |
| `PurchaseOrderCreated` | Procurement | Reporting |
| `PurchaseOrderApproved` | Procurement | Reporting |
| `PurchaseOrderCancelled` | Procurement | Reporting |
| `GoodsReceived` | Inventory (on posting a Goods Receipt) | Procurement (update PO received qty/status), Reporting |
| `InventoryIncreased` | Inventory (Receipt/Transfer-In/positive Adjustment) | Reporting |
| `InventoryIssued` | Inventory (Issue) | Reporting, Operations (project consumption) |
| `InventoryTransferred` | Inventory | Reporting |
| `InventoryAdjusted` | Inventory | Reporting |
| `StockThresholdReached` | Inventory (computed on transaction posting) | Reporting/Procurement (surface as a reorder candidate) |
| `MaterialCreated` / `MaterialDeactivated` | Inventory | Reporting |
| `LocationCreated` / `LocationMerged` | Inventory (admin) | Reporting |
| `ToolCheckedOut` / `ToolCheckedIn` | Inventory | Reporting |
| `UserCreated` / `RoleAssigned` | Identity & Access | Audit log |

## Note on implementation weight
At Afrinov's current scale, these events do not require a message broker —
they can be function calls or an in-process event dispatcher within the
modular monolith (ADR-001). The value here is the **vocabulary**: naming
what happened in business terms keeps the domains decoupled even inside one
codebase.
