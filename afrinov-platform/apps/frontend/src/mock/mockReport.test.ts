import { describe, expect, it } from 'vitest';
import { buildReport, isReversedPair, type ReportQuery } from './mockReport';
import type { MockInventoryTransaction } from './types';

const query: ReportQuery = {
  range: 'ALL', category: [], locationId: [], supplierId: [], materialId: [],
  stockStatus: 'ALL', itemStatus: 'ACTIVE', page: 1, pageSize: 50,
};

function report(transactions: MockInventoryTransaction[], overrides: Partial<ReportQuery> = {}) {
  return buildReport({ ...query, ...overrides }, {
    materials: [{ id: 'm-1', sku: 'A-1', name: 'Bolts', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '0', unitCost: '2', active: true }],
    locations: [{ id: 'l-1', name: 'Main', type: 'STOREROOM', active: true }],
    suppliers: [], purchaseOrders: [], transactions,
  });
}

function movement(id: string, quantity: string, overrides: Partial<MockInventoryTransaction> = {}): MockInventoryTransaction {
  return {
    id, postedAt: '2026-09-01T08:00:00Z', type: 'ISSUE', materialId: 'm-1',
    locationId: 'l-1', quantity, actorId: 'u-1', ...overrides,
  };
}

describe('isReversedPair', () => {
  it.each([
    [{}, false], [{ reversesId: null, reversedById: null }, false],
    [{ reversesId: 'original' }, true], [{ reversedById: 'reversal' }, true],
  ] as const)('handles reversal links and older payloads: %j', (row, expected) => {
    expect(isReversedPair(row)).toBe(expected);
  });
});

describe('report reversal accounting', () => {
  it.each([
    ['RECEIPT', '4', 'receipts'], ['ISSUE', '-4', 'issues'],
    ['TRANSFER_OUT', '-4', 'transfers'], ['TRANSFER_IN', '4', 'transfers'],
    ['ADJUSTMENT', '4', 'adjustments'], ['ADJUSTMENT', '-4', 'adjustments'],
  ] as const)('excludes reversed %s (%s) from summaries while retaining linked history', (type, quantity, bucket) => {
    const result = report([
      movement('original', quantity, { type }),
      movement('reversal', String(-Number(quantity)), { type, reversesId: 'original' }),
      movement('effective', quantity, { type }),
    ]);
    expect(result.movementSummary[bucket]).toEqual({ count: 1, quantity: 4 });
    expect(result.movementSummary.total).toEqual({ count: 1, quantity: 4 });
    expect(result.movements).toHaveLength(3);
    expect(result.movements.find((row) => row.id === 'original')).toMatchObject({ reversesId: null, reversedById: 'reversal' });
    expect(result.movements.find((row) => row.id === 'reversal')).toMatchObject({ reversesId: 'original', reversedById: null });
    expect(result.movements.find((row) => row.id === 'effective')).toMatchObject({ reversesId: null, reversedById: null });
  });

  it.each([
    ['2026-09-01', '2026-09-02', 'original'],
    ['2026-09-02', '2026-09-03', 'reversal'],
  ])('excludes a reversed entry even when its counterpart is outside %s to %s', (from, to, visibleId) => {
    const result = report([
      movement('original', '-4'),
      movement('reversal', '4', { reversesId: 'original', postedAt: '2026-09-02T08:00:00Z' }),
    ], { range: 'CUSTOM', from, to });
    expect(result.movements.map((row) => row.id)).toEqual([visibleId]);
    expect(result.movementSummary.issues).toEqual({ count: 0, quantity: 0 });
    expect(result.movementSummary.total).toEqual({ count: 0, quantity: 0 });
  });

  it('retains current stock value when a signed issue and reversal cancel', () => {
    const result = report([
      movement('receipt', '10', { type: 'RECEIPT' }),
      movement('original', '-4'),
      movement('reversal', '4', { reversesId: 'original' }),
    ]);
    expect(result.inventory[0]).toMatchObject({ quantity: 10, inventoryValue: 20 });
    expect(result.movementSummary.total).toEqual({ count: 1, quantity: 10 });
  });
});
