// In-process domain event dispatcher (ADR-001: no message broker at v1 scale).
// Handlers run synchronously within the caller's request. For side-effects that
// don't need to be in the same transaction (e.g. cache invalidation) wrap in
// setImmediate or a queue — but at Afrinov's current scale, sync is fine.

export type DomainEvent =
  | { type: 'SupplierCreated'; supplierId: string }
  | { type: 'PurchaseOrderCreated'; purchaseOrderId: string }
  | { type: 'PurchaseOrderApproved'; purchaseOrderId: string }
  | { type: 'PurchaseOrderCancelled'; purchaseOrderId: string }
  | { type: 'GoodsReceived'; goodsReceiptId: string; purchaseOrderId: string | null }
  | { type: 'InventoryIncreased'; materialId: string; locationId: string; quantity: number }
  | { type: 'InventoryIssued'; materialId: string; locationId: string; quantity: number }
  | { type: 'InventoryTransferred'; materialId: string; fromLocationId: string; toLocationId: string; quantity: number }
  | { type: 'InventoryAdjusted'; materialId: string; locationId: string; quantity: number }
  | { type: 'StockThresholdReached'; materialId: string };

export type DomainEventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;

const handlers = new Map<string, DomainEventHandler[]>();

export function registerDomainEventHandler<E extends DomainEvent>(
  type: E['type'],
  handler: DomainEventHandler<E>,
): void {
  const list = handlers.get(type) ?? [];
  list.push(handler as DomainEventHandler);
  handlers.set(type, list);
}

export async function dispatchDomainEvents(events: DomainEvent[]): Promise<void> {
  for (const event of events) {
    const list = handlers.get(event.type) ?? [];
    for (const handler of list) {
      await handler(event);
    }
  }
}