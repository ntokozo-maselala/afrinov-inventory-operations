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
