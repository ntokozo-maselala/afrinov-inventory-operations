import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerDomainEventHandler,
  dispatchDomainEvents,
  type DomainEvent,
  type DomainEventHandler,
} from './events.js';

describe('shared/events', () => {
  const calls: DomainEvent[] = [];

  beforeEach(() => {
    calls.length = 0;
  });

  it('invokes a registered handler for matching events', async () => {
    const handler: DomainEventHandler = vi.fn(async (event) => {
      calls.push(event);
    });
    registerDomainEventHandler('InventoryIssued', handler);
    await dispatchDomainEvents([
      { type: 'InventoryIssued', materialId: 'm-1', locationId: 'l-1', quantity: 3 },
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: 'InventoryIssued', materialId: 'm-1', locationId: 'l-1', quantity: 3,
    });
  });

  it('routes events to all handlers registered for the same type', async () => {
    const handlerA: DomainEventHandler = vi.fn();
    const handlerB: DomainEventHandler = vi.fn();
    registerDomainEventHandler('StockThresholdReached', handlerA as never);
    registerDomainEventHandler('StockThresholdReached', handlerB as never);
    const event: DomainEvent = { type: 'StockThresholdReached', materialId: 'm-1' };
    await dispatchDomainEvents([event]);
    expect(handlerA).toHaveBeenCalledWith(event);
    expect(handlerB).toHaveBeenCalledWith(event);
  });

  it('ignores events with no registered handler', async () => {
    const event: DomainEvent = { type: 'GoodsReceived', goodsReceiptId: 'gr-1', purchaseOrderId: null };
    await expect(dispatchDomainEvents([event])).resolves.toBeUndefined();
  });

  it('processes multiple events in order', async () => {
    const handler: DomainEventHandler = vi.fn(async (event) => {
      calls.push(event);
    });
    registerDomainEventHandler('InventoryAdjusted', handler);
    registerDomainEventHandler('InventoryTransferred', handler);
    await dispatchDomainEvents([
      { type: 'InventoryAdjusted', materialId: 'm-1', locationId: 'l-1', quantity: 2 },
      { type: 'InventoryTransferred', materialId: 'm-1', fromLocationId: 'l-1', toLocationId: 'l-2', quantity: 5 },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.type).toBe('InventoryAdjusted');
    expect(calls[1]!.type).toBe('InventoryTransferred');
  });

  it('dispatches an empty event list without error', async () => {
    await expect(dispatchDomainEvents([])).resolves.toBeUndefined();
  });

  it('awaits async handlers sequentially', async () => {
    const order: string[] = [];
    const handler: DomainEventHandler = vi.fn(async () => {
      order.push('handler');
    });
    registerDomainEventHandler('InventoryIssued', handler);
    await dispatchDomainEvents([
      { type: 'InventoryIssued', materialId: 'm-1', locationId: 'l-1', quantity: 1 },
    ]);
    order.push('after');
    expect(order).toEqual(['handler', 'after']);
  });
});
