import { describe, expect, it } from 'vitest';
import { buildReport, isReversedPair } from './mockReport';
import type { ReportQuery } from '../api/reportTypes';
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

// Project Material Through the Store Roadmap, Phase 2, as the server reports it.
describe('stock held for a project', () => {
  it('names its holder on the line and totals it under that project, not the item\'s', () => {
    const result = buildReport(query, {
      materials: [
        { id: 'm-1', sku: 'A-1', name: 'Bolts', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '0', unitCost: '2', active: true },
        { id: 'p-1', sku: '1325-BEAM', name: 'Beam', category: 'PROJECT_MATERIAL', unitOfMeasure: 'each', requiredStock: '0', unitCost: '10', active: true, projectNumber: '1325' },
      ],
      locations: [{ id: 'l-1', name: 'Main', type: 'STOREROOM', active: true }],
      suppliers: [], purchaseOrders: [],
      projects: [{ projectNumber: '1402', name: 'Door rails', status: 'ACTIVE', active: true, createdAt: '2026-09-01T08:00:00Z', updatedAt: '2026-09-01T08:00:00Z' }],
      transactions: [
        movement('a', '1', { type: 'RECEIPT' }),
        movement('b', '2', { type: 'RECEIPT', heldForProject: '1402' }),
        movement('c', '3', { type: 'RECEIPT', materialId: 'p-1' }),
        movement('d', '4', { type: 'RECEIPT', materialId: 'p-1', heldForProject: '1325' }),
        movement('e', '6', { type: 'RECEIPT', materialId: 'p-1', heldForProject: '1402' }),
      ],
    });
    expect(result.inventory.filter((l) => l.sku === 'A-1').map((l) => [l.quantity, l.heldForProject])).toEqual([[1, null], [2, '1402']]);
    expect((result.byProject ?? []).map((p) => [p.projectNumber, p.name, p.skuCount, p.quantity, p.inventoryValue])).toEqual([
      ['1325', null, 1, 7, 70],
      ['1402', 'Door rails', 2, 8, 64],
    ]);
  });
});
