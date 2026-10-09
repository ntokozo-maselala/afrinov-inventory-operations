import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type Material } from '@prisma/client';
import { MonthEndService } from './month-end.service.js';

const mocks = vi.hoisted(() => ({
  balances: vi.fn(), materials: vi.fn(), locations: vi.fn(), setting: vi.fn(), consumption: vi.fn(),
}));
vi.mock('../../shared/db.js', () => ({ prisma: {
  inventoryTransaction: { groupBy: mocks.balances },
  material: { findMany: mocks.materials }, location: { findMany: mocks.locations },
} }));
vi.mock('../settings/settings.service.js', () => ({ SettingsService: { getValue: mocks.setting } }));
vi.mock('./consumption.service.js', () => ({ ConsumptionService: { report: mocks.consumption } }));

type ReportMaterial = Pick<Material, 'id' | 'sku' | 'name' | 'category' | 'requiredStock' | 'unitCost' | 'active'>;
const material = (id: string, overrides: Partial<ReportMaterial> = {}): ReportMaterial => ({
  id, sku: `CON-${id}`, name: `Item ${id}`, category: 'CONSUMABLES',
  requiredStock: new Prisma.Decimal(10), unitCost: new Prisma.Decimal(2), active: true, ...overrides,
});
const balance = (materialId: string, quantity: number | null, locationId = 'a') => ({
  materialId, locationId, _sum: { quantity: quantity === null ? null : new Prisma.Decimal(quantity) },
});
const used = (sku: string, value: number | null, category = 'CONSUMABLES') => ({ sku, name: sku, category, used: 3, value });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
  mocks.balances.mockResolvedValue([]);
  mocks.materials.mockResolvedValue([]);
  mocks.locations.mockResolvedValue([{ id: 'a', name: 'A-1' }, { id: 'b', name: 'B-2' }]);
  mocks.setting.mockImplementation(async (key: string) => ({
    'general.defaultCurrency': 'USD', 'inventory.urgentBelowPercent': 20, 'inventory.warningBelowPercent': 40,
  })[key]);
  mocks.consumption.mockResolvedValue({ items: [] });
});
afterEach(() => vi.useRealTimers());

describe('MonthEndService.report', () => {
  it('requests all ledger history strictly before next month and usage within the chosen month', async () => {
    const report = await MonthEndService.report('2026-09');
    expect(mocks.balances).toHaveBeenCalledExactlyOnceWith({
      by: ['materialId', 'locationId'], where: { postedAt: { lt: new Date('2026-10-01T00:00:00Z') } }, _sum: { quantity: true },
    });
    expect(mocks.consumption).toHaveBeenCalledExactlyOnceWith({ from: '2026-09-01', to: '2026-09-30' });
    expect(report).toEqual({
      month: '2026-09', from: '2026-09-01', to: '2026-09-30', generatedAt: '2026-10-09T10:00:00.000Z',
      currency: 'USD', bands: { urgentBelowPercent: 20, warningBelowPercent: 40 }, categories: [],
      total: { items: 0, itemsInStock: 0, value: 0, urgent: 0, warning: 0, usedValue: 0 },
    });
  });

  it.each(['', '2026-00', '2026-11', '2026-9'])('rejects %j before reading any dependencies', async (month) => {
    await expect(MonthEndService.report(month)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });

  it('combines locations, ignores zero and null balances, and rounds fractional stock and money', async () => {
    mocks.materials.mockResolvedValue([material('1', { requiredStock: new Prisma.Decimal(3), unitCost: new Prisma.Decimal(1.23) })]);
    mocks.balances.mockResolvedValue([balance('1', 0.23456, 'b'), balance('1', 1, 'a'), balance('1', 0, 'empty'), balance('1', null, 'null')]);
    mocks.consumption.mockResolvedValue({ items: [used('CON-1', 3.69)] });
    const category = (await MonthEndService.report('2026-09')).categories[0]!;
    expect(category.items).toEqual([{
      sku: 'CON-1', name: 'Item 1', location: 'A-1 (1), B-2 (0.2346)', requiredStock: 3, currentStock: 1.2346,
      unitCost: 1.23, value: 1.52, percentOfRequired: 0.4115, reorderQuantity: 1.7654, status: 'OK',
    }]);
    expect(category.used).toEqual([{ sku: 'CON-1', name: 'CON-1', location: 'A-1 (1), B-2 (0.2346)', used: 3, value: 3.69 }]);
  });

  it('retains inactive stock and deficits, omits inactive empty items, and sorts SKUs numerically', async () => {
    mocks.materials.mockResolvedValue([
      material('10', { active: false }), material('2', { active: false }), material('3', { active: false }), material('1'),
    ]);
    mocks.balances.mockResolvedValue([balance('10', -2, 'missing'), balance('2', 12), balance('3', 0)]);
    const category = (await MonthEndService.report('2026-09')).categories[0]!;
    expect(category.items.map((i) => i.sku)).toEqual(['CON-1', 'CON-2', 'CON-10']);
    expect(category.items[0]).toMatchObject({ location: '', currentStock: 0, status: 'URGENT' });
    expect(category.items[1]).toMatchObject({ location: 'A-1', currentStock: 12, reorderQuantity: -2, status: 'OK' });
    expect(category.items[2]).toMatchObject({ location: '—', currentStock: -2, value: -4, reorderQuantity: 12, status: 'URGENT' });
    expect(category).toMatchObject({ itemsInStock: 1, urgent: 2, warning: 0, value: 20 });
  });

  it('keeps missing prices distinct from zero prices and unset required stock distinct from shortages', async () => {
    mocks.materials.mockResolvedValue([
      material('1', { unitCost: null, requiredStock: new Prisma.Decimal(0) }),
      material('2', { unitCost: new Prisma.Decimal(0) }),
    ]);
    mocks.balances.mockResolvedValue([balance('1', 5), balance('2', 2)]);
    const report = await MonthEndService.report('2026-09');
    expect(report.categories[0]!.items[0]).toMatchObject({ unitCost: null, value: null, percentOfRequired: null, reorderQuantity: null, status: 'NOT_SET' });
    expect(report.categories[0]!.items[1]).toMatchObject({ unitCost: 0, value: 0, percentOfRequired: 0.2, status: 'WARNING' });
    expect(report.total).toEqual({ items: 2, itemsInStock: 2, value: 0, urgent: 0, warning: 1, usedValue: 0 });
  });

  it.each([[2.4999, 'URGENT'], [2.5, 'WARNING'], [5.9999, 'WARNING'], [6, 'OK']] as const)(
    'uses configured status boundaries at stock %s', async (quantity, status) => {
      mocks.setting.mockImplementation(async (key: string) => ({
        'general.defaultCurrency': 'EUR', 'inventory.urgentBelowPercent': 25, 'inventory.warningBelowPercent': 60,
      })[key]);
      mocks.materials.mockResolvedValue([material('1')]);
      mocks.balances.mockResolvedValue([balance('1', quantity)]);
      const report = await MonthEndService.report('2026-09');
      expect(report.categories[0]!.items[0]!.status).toBe(status);
      expect(report.currency).toBe('EUR');
      expect(report.bands).toEqual({ urgentBelowPercent: 25, warningBelowPercent: 60 });
    },
  );

  it('keeps usage-only categories, sorts usage, and totals categories without counting unpriced usage', async () => {
    mocks.materials.mockResolvedValue([material('tool', { category: 'TOOLS' }), material('1')]);
    mocks.balances.mockResolvedValue([balance('tool', 4), balance('1', 1)]);
    mocks.consumption.mockResolvedValue({ items: [used('OLD-10', null, 'PROJECT_MATERIAL'), used('CON-1', 2.35), used('OLD-2', 3.45, 'PROJECT_MATERIAL')] });
    const report = await MonthEndService.report('2026-09');
    expect(report.categories.map((c) => c.category)).toEqual(['CONSUMABLES', 'PROJECT_MATERIAL', 'TOOLS']);
    expect(report.categories[1]).toMatchObject({ items: [], itemsInStock: 0, value: 0, usedValue: 3.45 });
    expect(report.categories[1]!.used).toEqual([
      { sku: 'OLD-2', name: 'OLD-2', location: '', used: 3, value: 3.45 },
      { sku: 'OLD-10', name: 'OLD-10', location: '', used: 3, value: null },
    ]);
    expect(report.total).toEqual({ items: 2, itemsInStock: 2, value: 10, urgent: 1, warning: 0, usedValue: 5.8 });
  });

  it('propagates dependency failures instead of returning a partial report', async () => {
    const failure = new Error('Ledger unavailable');
    mocks.balances.mockRejectedValue(failure);
    await expect(MonthEndService.report('2026-09')).rejects.toBe(failure);
  });
});
