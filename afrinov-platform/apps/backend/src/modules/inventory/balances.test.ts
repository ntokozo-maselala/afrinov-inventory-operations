// Unit test for the inventory-balance recompute helper.
//
// This is the public entry point that the seed (and any future bulk
// import / migration) uses to keep `inventory_balances` in lockstep
// with the `inventory_transactions` ledger.
import { describe, expect, it, vi } from 'vitest';

// The root client offers only $transaction: the lock, the sum and the write
// must all run on the transaction's client, or the advisory lock (held only
// until its transaction ends) would be gone before the sum is read.
const { tx, transactions } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    inventoryTransaction: { aggregate: vi.fn() },
    inventoryBalance: { upsert: vi.fn() },
  };
  return { tx, transactions: vi.fn(async (work: (t: typeof tx) => unknown) => work(tx)) };
});
vi.mock('../../shared/db.js', () => ({ prisma: { $transaction: transactions } }));

import { recomputeBalancesFor } from './balances.js';

const executeRaw = tx.$executeRaw;
const aggregate = tx.inventoryTransaction.aggregate;
const upsert = tx.inventoryBalance.upsert;

type UpsertArg = {
  where: { materialId_locationId_heldForProject: { materialId: string; locationId: string; heldForProject: string } };
  create: { materialId: string; locationId: string; heldForProject: string; quantity: { toString(): string } };
  update: { quantity: { toString(): string } };
};

describe('recomputeBalancesFor', () => {
  it('aggregates the matching Stores transactions and upserts the Stores balance row', async () => {
    aggregate.mockResolvedValue({
      _sum: { quantity: { toString: () => '42.5' } },
    });
    upsert.mockClear();
    upsert.mockResolvedValue(undefined);

    await recomputeBalancesFor({ materialId: 'm-1', locationId: 'l-1', heldForProject: null });

    expect(aggregate).toHaveBeenCalledWith({
      where: { materialId: 'm-1', locationId: 'l-1', heldForProject: null },
      _sum: { quantity: true },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as UpsertArg;
    // Stores stock is '' on the balance row, so it can be part of the key.
    expect(arg.where).toEqual({ materialId_locationId_heldForProject: { materialId: 'm-1', locationId: 'l-1', heldForProject: '' } });
    expect(arg.create.materialId).toBe('m-1');
    expect(arg.create.locationId).toBe('l-1');
    expect(arg.create.heldForProject).toBe('');
    expect(arg.create.quantity.toString()).toBe('42.5');
    expect(arg.update.quantity.toString()).toBe('42.5');
  });

  it('keeps stock held for a project apart from Stores stock', async () => {
    aggregate.mockResolvedValue({ _sum: { quantity: { toString: () => '6' } } });
    upsert.mockClear();
    upsert.mockResolvedValue(undefined);

    await recomputeBalancesFor({ materialId: 'm-1', locationId: 'l-1', heldForProject: 'AFRI-1325' });

    expect(aggregate).toHaveBeenCalledWith({
      where: { materialId: 'm-1', locationId: 'l-1', heldForProject: 'AFRI-1325' },
      _sum: { quantity: true },
    });
    const arg = upsert.mock.calls[0]![0] as UpsertArg;
    expect(arg.where.materialId_locationId_heldForProject.heldForProject).toBe('AFRI-1325');
    expect(arg.create.heldForProject).toBe('AFRI-1325');
  });

  it('takes the balance lock before it sums the ledger (ADR-047)', async () => {
    const order: string[] = [];
    executeRaw.mockReset();
    executeRaw.mockImplementation(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      order.push(`${sql.join('?')} ${values.join(',')}`);
      return 1;
    });
    aggregate.mockImplementation(async () => { order.push('aggregate'); return { _sum: { quantity: null } }; });
    upsert.mockResolvedValue(undefined);

    await recomputeBalancesFor({ materialId: 'm-3', locationId: 'l-3', heldForProject: null });

    expect(order).toHaveLength(2);
    expect(order[0]).toMatch(/pg_advisory_xact_lock/);
    expect(order[0]).toContain('afrinov:inventory-balance:m-3:l-3:');
    expect(order[1]).toBe('aggregate');
  });

  it('holds the lock until the balance is written: lock, sum and write run in one transaction (ADR-047)', async () => {
    transactions.mockClear();
    aggregate.mockResolvedValue({ _sum: { quantity: null } });
    upsert.mockClear();
    upsert.mockResolvedValue(undefined);

    await recomputeBalancesFor({ materialId: 'm-4', locationId: 'l-4', heldForProject: null });

    expect(transactions).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('treats a null aggregate sum as zero (no transactions)', async () => {
    aggregate.mockResolvedValue({ _sum: { quantity: null } });
    upsert.mockClear();
    upsert.mockResolvedValue(undefined);

    await recomputeBalancesFor({ materialId: 'm-2', locationId: 'l-2', heldForProject: null });

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as { create: { quantity: { toString(): string } } };
    expect(arg.create.quantity.toString()).toBe('0');
  });
});
