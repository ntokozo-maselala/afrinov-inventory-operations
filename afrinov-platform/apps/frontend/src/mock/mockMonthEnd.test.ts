// The frontend-only month-end report, which mirrors the backend's.
import { describe, it, expect } from 'vitest';
import { computeMonthEnd } from './mockMonthEnd';
import { computeConsumption } from './mockConsumption';
import type { MockInventoryTransaction, MockLocation, MockMaterial } from './types';

const tx = (id: string, type: string, quantity: number, postedAt: string, locationId = 'l-1'): MockInventoryTransaction =>
  ({ id, type, materialId: 'disc', locationId, quantity: String(quantity), postedAt, actorId: 'u' }) as MockInventoryTransaction;

const materials = [
  { id: 'disc', sku: 'CON-0001', name: 'Disc', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '100', unitCost: '10', active: true },
  { id: 'old', sku: 'CON-0002', name: 'Old', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '0', active: false },
] as unknown as MockMaterial[];
const locations = [{ id: 'l-1', name: 'A-1' }, { id: 'l-2', name: 'B-2' }] as MockLocation[];
const transactions = [
  tx('r1', 'RECEIPT', 40, '2026-09-02T08:00:00Z'),
  tx('r2', 'RECEIPT', 10, '2026-09-03T08:00:00Z', 'l-2'),
  tx('i1', 'ISSUE', -25, '2026-09-20T08:00:00Z'),
  tx('r3', 'RECEIPT', 85, '2026-10-01T00:00:00Z'),
];

const run = (month: string) => computeMonthEnd(month, {
  transactions, materials, locations, bands: { urgentBelowPercent: 20, warningBelowPercent: 40 }, currency: 'ZAR',
  consumption: (from, to) => computeConsumption({ from, to }, { transactions, materials, projects: [] }),
}, new Date('2026-10-09T10:00:00Z'));

describe('computeMonthEnd (mock)', () => {
  it('rebuilds stock as at the end of the month, ignoring later movements', () => {
    const r = run('2026-09');
    const disc = r.categories[0]!.items.find((i) => i.sku === 'CON-0001')!;
    expect(disc).toEqual({
      sku: 'CON-0001', name: 'Disc', location: 'A-1 (15), B-2 (10)', requiredStock: 100, currentStock: 25, unitCost: 10,
      value: 250, percentOfRequired: 0.25, reorderQuantity: 75, status: 'WARNING',
    });
    expect(r.categories[0]!.used).toEqual([{ sku: 'CON-0001', name: 'Disc', location: 'A-1 (15), B-2 (10)', used: 25, value: 250 }]);
    expect(r.categories[0]!.items.map((i) => i.sku)).toEqual(['CON-0001']); // inactive with no stock is left out
    expect(run('2026-10').categories[0]!.items[0]).toMatchObject({ currentStock: 110, status: 'OK', reorderQuantity: -10 });
  });

  it('refuses a month that has not started', () => {
    expect(() => run('2026-11')).toThrow();
  });
});
