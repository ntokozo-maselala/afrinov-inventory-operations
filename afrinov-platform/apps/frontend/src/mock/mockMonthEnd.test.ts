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

describe('computeMonthEnd boundaries and totals', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const calculate = (stock: MockMaterial[], ledger: MockInventoryTransaction[], month = '2026-09') => computeMonthEnd(month, {
    materials: stock, transactions: ledger, locations, bands: { urgentBelowPercent: 25, warningBelowPercent: 60 }, currency: 'USD',
    consumption: (from, to) => computeConsumption({ from, to }, { materials: stock, transactions: ledger, projects: [] }),
  }, now);
  const item = (id: string, overrides: Partial<MockMaterial> = {}): MockMaterial => ({
    id, sku: `CON-${id}`, name: `Item ${id}`, category: 'CONSUMABLES', unitOfMeasure: 'each',
    requiredStock: '10', unitCost: '2', active: true, ...overrides,
  });
  const movement = (materialId: string, quantity: number, postedAt: string, type = 'RECEIPT', locationId = 'l-1') => ({
    ...tx(`${materialId}-${postedAt}-${locationId}`, type, quantity, postedAt, locationId), materialId,
  });

  it.each(['', '2026-00', '2026-13', '2026-9', '2026-09-01', ' 2026-09'])('rejects malformed month %j', (month) => {
    expect(() => calculate([], [], month)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR', message: 'Month must be YYYY-MM' }));
  });

  it('includes historical opening stock and the last millisecond of the month, excluding next midnight', () => {
    const r = calculate([item('1')], [
      movement('1', 5, '2026-08-31T23:59:59.999Z'),
      movement('1', 2, '2026-09-30T23:59:59.999Z'),
      movement('1', 100, '2026-10-01T00:00:00.000Z'),
    ]);
    expect(r.categories[0]!.items[0]).toMatchObject({ currentStock: 7, value: 14, percentOfRequired: 0.7, reorderQuantity: 3 });
    expect(r.categories[0]!.used).toEqual([]);
  });

  it('moves stock between locations without changing the total and counts returns against usage', () => {
    const r = calculate([item('1')], [
      movement('1', 10, '2026-08-01T00:00:00.000Z'),
      movement('1', -4, '2026-09-01T00:00:00.000Z', 'TRANSFER_OUT'),
      movement('1', 4, '2026-09-01T00:00:00.000Z', 'TRANSFER_IN', 'l-2'),
      movement('1', -3, '2026-09-02T00:00:00.000Z', 'ISSUE'),
      movement('1', 1, '2026-09-03T00:00:00.000Z', 'RETURN'),
    ]);
    expect(r.categories[0]!.items[0]).toMatchObject({ currentStock: 8, location: 'A-1 (4), B-2 (4)', value: 16 });
    expect(r.categories[0]!.used).toEqual([{ sku: 'CON-1', name: 'Item 1', location: 'A-1 (4), B-2 (4)', used: 2, value: 4 }]);
    expect(r.total.usedValue).toBe(4);
  });

  it('retains consumed inactive items in usage after their last stock is issued', () => {
    const r = calculate([item('1', { active: false, category: 'TOOLS' })], [
      movement('1', 3, '2026-08-01T00:00:00.000Z'),
      movement('1', -3, '2026-09-02T00:00:00.000Z', 'ISSUE'),
    ]);
    expect(r.categories).toEqual([{
      category: 'TOOLS', items: [], value: 0, urgent: 0, warning: 0, itemsInStock: 0,
      used: [{ sku: 'CON-1', name: 'Item 1', location: '', used: 3, value: 6 }], usedValue: 6,
    }]);
    expect(r.total).toEqual({ items: 0, itemsInStock: 0, value: 0, urgent: 0, warning: 0, usedValue: 6 });
  });

  it('orders categories and SKUs, retains inactive deficits, and distinguishes missing and zero prices', () => {
    const stock = [item('tool', { category: 'TOOLS' }), item('10', { active: false }),
      item('2', { requiredStock: '0', unitCost: undefined }), item('1', { unitCost: '0' }), item('empty', { active: false })];
    const r = calculate(stock, [movement('10', -1, '2026-09-01T00:00:00.000Z', 'ADJUSTMENT', 'missing'),
      movement('2', 4, '2026-09-01T00:00:00.000Z'), movement('1', 12, '2026-09-01T00:00:00.000Z')]);
    expect(r.categories.map((c) => c.category)).toEqual(['CONSUMABLES', 'TOOLS']);
    expect(r.categories[0]!.items.map((i) => i.sku)).toEqual(['CON-1', 'CON-2', 'CON-10']);
    expect(r.categories[0]!.items[0]).toMatchObject({ unitCost: 0, value: 0, reorderQuantity: -2, status: 'OK' });
    expect(r.categories[0]!.items[1]).toMatchObject({ unitCost: null, value: null, percentOfRequired: null, reorderQuantity: null, status: 'NOT_SET' });
    expect(r.categories[0]!.items[2]).toMatchObject({ currentStock: -1, location: '—', status: 'URGENT' });
    expect(r.total).toEqual({ items: 4, itemsInStock: 2, value: -2, urgent: 2, warning: 0, usedValue: 0 });
  });

  it.each([[2.4999, 'URGENT'], [2.5, 'WARNING'], [5.9999, 'WARNING'], [6, 'OK']] as const)(
    'applies configured status thresholds to %s units', (quantity, status) => {
      const r = calculate([item('1')], [movement('1', quantity, '2026-09-01T00:00:00.000Z')]);
      expect(r.categories[0]!.items[0]!.status).toBe(status);
    },
  );

  it('rounds fractional quantities, ratios and money without changing input fixtures', () => {
    const stock = [item('1', { requiredStock: '3', unitCost: '1.23' })];
    const ledger = [movement('1', 1.23456, '2026-09-01T00:00:00.000Z')];
    const before = JSON.stringify({ stock, ledger });
    const r = calculate(stock, ledger);
    expect(r.categories[0]!.items[0]).toMatchObject({ currentStock: 1.2346, value: 1.52, percentOfRequired: 0.4115, reorderQuantity: 1.7654 });
    expect(JSON.stringify({ stock, ledger })).toBe(before);
    expect(calculate(stock, ledger)).toEqual(r);
  });

  it('returns leap-month dates and zero totals for an empty inventory', () => {
    const r = calculate([], [], '2024-02');
    expect(r).toMatchObject({ from: '2024-02-01', to: '2024-02-29', currency: 'USD', generatedAt: now.toISOString(), categories: [],
      total: { items: 0, itemsInStock: 0, value: 0, urgent: 0, warning: 0, usedValue: 0 } });
  });
});
