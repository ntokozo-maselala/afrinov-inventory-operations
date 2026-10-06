// Unit test for the inventory-balance recompute helper.
//
// This is the public entry point that the seed (and any future bulk
// import / migration) uses to keep `inventory_balances` in lockstep
// with the `inventory_transactions` ledger.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/db.js', () => ({
  prisma: {
    inventoryTransaction: { aggregate: vi.fn() },
    inventoryBalance: { upsert: vi.fn() },
  },
}));

import { recomputeBalancesFor } from './balances.js';
import { prisma } from '../../shared/db.js';

const aggregate = prisma.inventoryTransaction.aggregate as unknown as ReturnType<typeof vi.fn>;
const upsert = prisma.inventoryBalance.upsert as unknown as ReturnType<typeof vi.fn>;

describe('recomputeBalancesFor', () => {
  it('aggregates the matching transactions and upserts the balance row', async () => {
    aggregate.mockResolvedValue({
      _sum: { quantity: { toString: () => '42.5' } },
    });
    upsert.mockClear();
    upsert.mockResolvedValue(undefined);

    await recomputeBalancesFor('m-1', 'l-1');

    expect(aggregate).toHaveBeenCalledWith({
      where: { materialId: 'm-1', locationId: 'l-1' },
      _sum: { quantity: true },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as {
      where: { materialId_locationId: { materialId: string; locationId: string } };
      create: { materialId: string; locationId: string; quantity: { toString(): string } };
      update: { quantity: { toString(): string } };
    };
    expect(arg.where).toEqual({ materialId_locationId: { materialId: 'm-1', locationId: 'l-1' } });
    expect(arg.create.materialId).toBe('m-1');
    expect(arg.create.locationId).toBe('l-1');
    expect(arg.create.quantity.toString()).toBe('42.5');
    expect(arg.update.quantity.toString()).toBe('42.5');
  });

  it('treats a null aggregate sum as zero (no transactions)', async () => {
    aggregate.mockResolvedValue({ _sum: { quantity: null } });
    upsert.mockClear();
    upsert.mockResolvedValue(undefined);

    await recomputeBalancesFor('m-2', 'l-2');

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as {
      create: { quantity: { toString(): string } };
    };
    expect(arg.create.quantity.toString()).toBe('0');
  });
});
