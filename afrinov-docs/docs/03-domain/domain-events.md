# Domain Events

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Business-meaningful things that happened — the vocabulary the system should
think and log in, independent of any particular messaging technology.

The code has an in-process dispatcher (`shared/events.ts`) and dispatches
some of these events, but **no handler is registered anywhere**, so
dispatching has no effect today and the "Consumed by" column is intent, not
behaviour (TD-007).

| Event | Raised by (in code) | Intended consumer | Status |
|---|---|---|---|
| `SupplierCreated` | — | Reporting | Declared in `DomainEvent`, never dispatched |
| `PurchaseOrderCreated` | — | Reporting | Declared, never dispatched |
| `PurchaseOrderApproved` | — | Reporting | Declared, never dispatched |
| `PurchaseOrderCancelled` | — | Reporting | Declared, never dispatched |
| `GoodsReceived` | goods-receipt posting; counter receipt | Procurement, Reporting | Dispatched, no handler (the PO is updated directly instead) |
| `InventoryIncreased` | counter receipt; return; stock item with opening quantity | Reporting | Dispatched, no handler |
| `InventoryIssued` | issue | Reporting, Operations | Dispatched, no handler |
| `InventoryTransferred` | transfer | Reporting | Dispatched, no handler |
| `InventoryAdjusted` | adjustment; stock count | Reporting | Dispatched, no handler |
| `StockThresholdReached` | issue, when `inventory.enableStockAlerts` is on and the item is URGENT or WARNING | Reporting/Procurement | Dispatched, no handler |
| `MaterialCreated` / `MaterialDeactivated` | — | Reporting | **Planned** (not in the `DomainEvent` type) |
| `LocationCreated` / `LocationMerged` | — | Reporting | **Planned** |
| `ToolCheckedOut` / `ToolCheckedIn` | — | Reporting | **Planned** |
| `UserCreated` / `RoleAssigned` | — | Audit log | **Planned** (user changes are written to the audit log directly) |

Reversals, purchase-order receive-all, and the opening-balance import raise
no events.

## Note on implementation weight
At Afrinov's current scale, these events do not require a message broker.
The dispatcher runs handlers synchronously in the caller's request
(ADR-001). The value here is the **vocabulary**: naming what happened in
business terms.

## Evidence
- `afrinov-platform/apps/backend/src/shared/events.ts:6-38`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:343-361,425-427,483-491,530-532,620-622`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts:115-119`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-count.service.ts:97,110`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-item.service.ts:136-145`
