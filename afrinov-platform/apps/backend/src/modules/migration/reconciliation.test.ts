// Reconciliation of the platform against the workbook plan. Made-up data.
import { describe, it, expect } from 'vitest';
import { reconcile, renderReconciliation, type PlatformItem } from './reconciliation.js';
import type { MappedImport, PlannedMaterial } from './mapping.js';

const material = (sku: string, extra: Partial<PlannedMaterial> = {}): PlannedMaterial => ({
  sku, name: `Item ${sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: 0, unitCost: 10,
  oldProductIds: [], balances: [{ location: 'A-1', quantity: 5 }], ...extra,
});

const plan = (materials: PlannedMaterial[]): MappedImport => ({ materials, locations: [], problems: [] });

const imported = (sku: string, extra: Partial<PlatformItem> = {}): PlatformItem => ({
  sku, category: 'CONSUMABLES', unitCost: 10, opening: { 'A-1': 5 }, current: { 'A-1': 5 }, ...extra,
});

describe('reconcile', () => {
  it('matches when the platform holds exactly what was planned', () => {
    const r = reconcile(
      plan([material('CON-0001'), material('TPE-0001', { category: 'TOOLING_PPE_ELECTRICAL', unitCost: 2.5, balances: [{ location: 'E-2', quantity: 4 }] })]),
      [imported('con-0001'), imported('TPE-0001', { category: 'TOOLING_PPE_ELECTRICAL', unitCost: 2.5, opening: { 'E-2': 4 }, current: { 'E-2': 1 } })],
      '2026-10-01',
    );
    expect(r.differences).toEqual([]);
    expect(r.categories.find((c) => c.category === 'CONSUMABLES')).toEqual({
      category: 'CONSUMABLES', items: { workbook: 1, platform: 1 }, units: { workbook: 5, platform: 5 }, value: { workbook: 50, platform: 50 }, currentValue: 50,
    });
    // Issued since the import: the opening balance still matches, the value on hand is lower.
    expect(r.categories.find((c) => c.category === 'TOOLING_PPE_ELECTRICAL')).toMatchObject({ value: { workbook: 10, platform: 10 }, currentValue: 2.5 });
  });

  it('lists missing items, other categories, changed prices and quantities', () => {
    const r = reconcile(
      plan([
        material('CON-0001'),
        material('CON-0002'),
        material('CON-0003'),
        material('CON-0004', { unitCost: null }),
        material('CON-0005', { balances: [{ location: 'A-1', quantity: 5 }, { location: 'B-2', quantity: 1 }] }),
      ]),
      [
        imported('CON-0002', { category: 'PROJECT_MATERIAL' }),
        imported('CON-0003', { unitCost: 12 }),
        imported('CON-0004', { unitCost: 3 }),
        imported('CON-0005', { opening: { 'A-1': 4, 'C-3': 2 } }),
      ],
    );
    expect(r.differences.map((d) => [d.kind, d.sku, d.detail])).toEqual([
      ['MISSING', 'CON-0001', 'Not in the platform'],
      ['CATEGORY', 'CON-0002', 'Consumables in the workbook, Project Material in the platform'],
      ['PRICE', 'CON-0003', 'R10 in the workbook, R12 in the platform'],
      ['PRICE', 'CON-0004', 'no price in the workbook, R3 in the platform'],
      ['QUANTITY', 'CON-0005', 'A-1: 5 in the workbook, 4 opening balance in the platform'],
      ['QUANTITY', 'CON-0005', 'B-2: 1 in the workbook, 0 opening balance in the platform'],
      ['UNEXPECTED_BALANCE', 'CON-0005', 'C-3: opening balance of 2 that the workbook does not have'],
    ]);
    expect(r.categories.find((c) => c.category === 'CONSUMABLES')?.items).toEqual({ workbook: 5, platform: 3 });
    expect(r.categories.find((c) => c.category === 'PROJECT_MATERIAL')?.items).toEqual({ workbook: 0, platform: 1 });
  });

  it('treats location names that differ only in case or spacing as one, as the import does', () => {
    const r = reconcile(plan([material('CON-0001', { balances: [{ location: 'MAIN  STORE', quantity: 5 }] })]), [imported('CON-0001', { opening: { 'Main Store': 5 } })]);
    expect(r.differences).toEqual([]);
  });

  it('ignores rounding below a ten-thousandth', () => {
    const r = reconcile(plan([material('CON-0001', { balances: [{ location: 'A-1', quantity: 0.1 + 0.2 }] })]), [imported('CON-0001', { opening: { 'A-1': 0.3 } })]);
    expect(r.differences).toEqual([]);
  });
});

describe('reconciliation report', () => {
  it('says plainly whether it reconciles', () => {
    const meta = { file: 'w.xlsm', database: 'afrinov', generatedAt: new Date('2026-10-09T08:00:00Z') };
    const ok = renderReconciliation(reconcile(plan([material('CON-0001')]), [imported('CON-0001')], '2026-10-01'), meta);
    expect(ok).toContain('**Reconciled: every item, unit and rand matches the workbook.**');
    expect(ok).toContain('Opening balances dated 2026-10-01.');

    const bad = renderReconciliation(reconcile(plan([material('CON-0001')]), []), meta);
    expect(bad).toContain('**1 differences**');
    expect(bad).toContain('**No opening balances have been imported into this database.**');
    expect(bad).toContain('## Items not in the platform (1)');
  });
});
