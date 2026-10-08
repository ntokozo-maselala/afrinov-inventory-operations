// Unit tests for the pure analytics functions in dashboardMetrics.
//
// These functions compute derived metrics from raw API data (movements,
// inventory lines, purchase orders, suppliers) and are intentionally
// free of side-effects so they can be unit-tested in isolation.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURRENCY,
  computePOKpis,
  computePOSupplierDistribution,
  computePOStatusDistribution,
  computeSupplierKpis,
  computeTopInventoryItems,
  computeInventoryValueTrend,
  categoryLabel,
  statusLabel,
  statusTone,
} from '../lib/dashboardMetrics';
import type { ReportMovementRow, ReportInventoryLine } from '../mock/mockReport';
import type { PurchaseOrderSummary } from '../hooks/useDashboardData';
import type { MockSupplier } from '../mock/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const currency = 'ZAR';

const inventoryLines: ReportInventoryLine[] = [
  {
    materialId: 'm-1', sku: 'SKU-001', name: 'Bolt M8', description: null,
    category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'PCS', unitCost: 5,
    requiredStock: 10, active: true, locationId: 'l-1', locationName: 'Rack A',
    locationType: 'RACK', quantity: 20, inventoryValue: 100, status: 'IN_STOCK',
    lastUpdated: '2026-09-01',
  },
  {
    materialId: 'm-2', sku: 'SKU-002', name: 'Cable 1mm', description: null,
    category: 'TOOLING_PPE_ELECTRICAL', unitOfMeasure: 'MTR', unitCost: 10,
    requiredStock: 50, active: true, locationId: 'l-2', locationName: 'Store B',
    locationType: 'STOREROOM', quantity: 30, inventoryValue: 300, status: 'IN_STOCK',
    lastUpdated: '2026-09-01',
  },
  {
    materialId: 'm-3', sku: 'SKU-003', name: 'Paint Red', description: null,
    category: 'CONSUMABLES', unitOfMeasure: 'LTR', unitCost: 20,
    requiredStock: 25, active: false, locationId: 'l-3', locationName: 'Store C',
    locationType: 'STOREROOM', quantity: 5, inventoryValue: 100, status: 'LOW_STOCK',
    lastUpdated: '2026-09-01',
  },
];

const purchaseOrders: PurchaseOrderSummary[] = [
  {
    id: 'po-1', number: 'PO-001', status: 'DRAFT', supplierId: 'sup-1',
    supplier: { name: 'Acme Corp' }, createdAt: '2026-09-01T00:00:00Z',
    lines: [
      { id: 'l-1', material: { sku: 'SKU-001', unitCost: '5', name: 'Bolt M8' }, orderedQty: '100', receivedQty: '10' },
    ],
  },
  {
    id: 'po-2', number: 'PO-002', status: 'RECEIVED', supplierId: 'sup-2',
    supplier: { name: 'Beta Ltd' }, createdAt: '2026-09-02T00:00:00Z',
    lines: [
      { id: 'l-2', material: { sku: 'SKU-002', unitCost: '10', name: 'Cable 1mm' }, orderedQty: '50', receivedQty: '50' },
    ],
  },
  {
    id: 'po-3', number: 'PO-003', status: 'CANCELLED', supplierId: 'sup-1',
    supplier: { name: 'Acme Corp' }, createdAt: '2026-09-03T00:00:00Z',
    lines: [],
  },
  {
    id: 'po-4', number: 'PO-004', status: 'PENDING_APPROVAL', supplierId: 'sup-3',
    supplier: { name: 'Gamma Supplies' }, createdAt: '2026-09-04T00:00:00Z',
    lines: [
      { id: 'l-3', material: { sku: 'SKU-003', unitCost: '20', name: 'Paint Red' }, orderedQty: '10', receivedQty: '0' },
    ],
  },
];

const suppliers: MockSupplier[] = [
  { id: 'sup-1', name: 'Acme Corp', active: true },
  { id: 'sup-2', name: 'Beta Ltd', active: true },
  { id: 'sup-3', name: 'Gamma Supplies', active: false },
  { id: 'sup-4', name: 'Delta Goods', active: true },
];

const movements: ReportMovementRow[] = [
  { id: 't-1', postedAt: '2026-09-01T08:00:00Z', type: 'RECEIPT', materialId: 'm-1',
    materialSku: 'SKU-001', materialName: 'Bolt M8', category: 'FASTENERS_SLUGS_INSULATION',
    locationId: 'l-1', locationName: 'Rack A', quantity: 20, actorName: 'John', reasonCode: null, reasonNote: null,
    projectNumber: null, referenceType: null, referenceId: null,
  },
  { id: 't-2', postedAt: '2026-09-02T08:00:00Z', type: 'ISSUE', materialId: 'm-1',
    materialSku: 'SKU-001', materialName: 'Bolt M8', category: 'FASTENERS_SLUGS_INSULATION',
    locationId: 'l-1', locationName: 'Rack A', quantity: -5, actorName: 'Jane', reasonCode: null, reasonNote: null,
    projectNumber: null, referenceType: null, referenceId: null,
  },
  { id: 't-3', postedAt: '2026-09-03T08:00:00Z', type: 'RECEIPT', materialId: 'm-2',
    materialSku: 'SKU-002', materialName: 'Cable 1mm', category: 'TOOLING_PPE_ELECTRICAL',
    locationId: 'l-2', locationName: 'Store B', quantity: 30, actorName: 'John', reasonCode: null, reasonNote: null,
    projectNumber: null, referenceType: null, referenceId: null,
  },
];

// ── DEFAULT_CURRENCY ────────────────────────────────────────────────────────

describe('DEFAULT_CURRENCY', () => {
  it('is ZAR', () => {
    expect(DEFAULT_CURRENCY).toBe('ZAR');
  });
});

// ── computePOStatusDistribution ─────────────────────────────────────────────

describe('computePOStatusDistribution', () => {
  it('returns empty array when no purchase orders', () => {
    expect(computePOStatusDistribution([])).toEqual([]);
  });

  it('groups POs by status with count, value, and share', () => {
    const result = computePOStatusDistribution(purchaseOrders);
    // DRAFT, RECEIVED, CANCELLED, PENDING_APPROVAL — 4 distinct statuses
    expect(result).toHaveLength(4);

    const draft = result.find((r) => r.status === 'DRAFT');
    expect(draft).toBeTruthy();
    expect(draft!.count).toBe(1);
    expect(draft!.value).toBe(500); // 100 × 5
  });

  it('sorts by value descending', () => {
    const result = computePOStatusDistribution(purchaseOrders);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.value).toBeLessThanOrEqual(result[i - 1]!.value);
    }
  });

  it('labels are human-readable for known statuses', () => {
    const result = computePOStatusDistribution(purchaseOrders);
    const draft = result.find((r) => r.status === 'DRAFT');
    expect(draft!.label).toBe('Draft');
  });
});

// ── computePOSupplierDistribution ─────────────────────────────────────────

describe('computePOSupplierDistribution', () => {
  it('returns empty array when no purchase orders', () => {
    expect(computePOSupplierDistribution([], suppliers)).toEqual([]);
  });

  it('aggregates orders, total value, and received value per supplier', () => {
    const result = computePOSupplierDistribution(purchaseOrders, suppliers);
    expect(result).toHaveLength(3);

    const acme = result.find((s) => s.supplierId === 'sup-1');
    expect(acme).toBeTruthy();
    expect(acme!.orderCount).toBe(2);
    expect(acme!.totalValue).toBe(500); // 500 + 0 (cancelled has no lines)
    // PO-1 receivedQty=10 × unitCost=5 → 50; PO-3 has no lines
    expect(acme!.receivedValue).toBe(50);
    expect(acme!.supplierName).toBe('Acme Corp');
  });

  it('sorts by totalValue descending', () => {
    const result = computePOSupplierDistribution(purchaseOrders, suppliers);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.totalValue).toBeLessThanOrEqual(result[i - 1]!.totalValue);
    }
  });
});

// ── computePOKpis ───────────────────────────────────────────────────────────

describe('computePOKpis', () => {
  it('returns empty-state KPIs when no purchase orders', () => {
    const result = computePOKpis([]);
    expect(result).toHaveLength(4);
    expect(result.every((k) => k.value === '\u2014')).toBe(true);
  });

  it('correctly counts open, pending approval, completed, and cancelled POs', () => {
    const result = computePOKpis(purchaseOrders, currency);
    // DRAFT + SUBMITTED are open → 2
    expect(result[0]).toMatchObject({ label: 'Open Purchase Orders', value: '2' });
    expect(result[0]!.helper).toContain('of 4');

    const pending = result.find((k) => k.label === 'Pending Approval');
    expect(pending!.value).toBe('1');

    const completed = result.find((k) => k.label === 'Completed Orders');
    expect(completed!.value).toBe('1');

    const cancelled = result.find((k) => k.label === 'Cancelled');
    expect(cancelled!.value).toBe('1');
  });

  it('formats total PO value as currency', () => {
    const result = computePOKpis(purchaseOrders, currency);
    const total = result.find((k) => k.label === 'Total PO Value');
    // 500 + 500 + 0 + 200 = 1200; ZAR locale format
    expect(total!.value).toBe('R\u00a01\u00a0200,00');
  });

  it('includes received and pending value in the helper', () => {
    const result = computePOKpis(purchaseOrders, currency);
    const total = result.find((k) => k.label === 'Total PO Value');
    expect(total!.helper).toContain('received');
    expect(total!.helper).toContain('pending');
  });
});

// ── computeSupplierKpis ─────────────────────────────────────────────────────

describe('computeSupplierKpis', () => {
  it('returns empty-state KPIs when no suppliers', () => {
    const result = computeSupplierKpis([], purchaseOrders);
    expect(result).toHaveLength(4);
    expect(result.every((k) => k.value === '\u2014')).toBe(true);
  });

  it('counts active suppliers correctly', () => {
    const result = computeSupplierKpis(suppliers, purchaseOrders, currency);
    const active = result.find((k) => k.label === 'Active Suppliers');
    expect(active!.value).toBe('3');
    expect(active!.helper).toContain('4 total');
  });

  it('computes purchase volume and average order value', () => {
    const result = computeSupplierKpis(suppliers, purchaseOrders, currency);
    const volume = result.find((k) => k.label === 'Purchase Volume');
    // 500 + 500 + 0 + 200 = 1200
    expect(volume!.value).toBe('R\u00a01\u00a0200,00');
    expect(volume!.helper).toContain('4 orders');

    const avg = result.find((k) => k.label === 'Avg. Order Value');
    // 1200 / 4 = 300
    expect(avg!.value).toBe('R\u00a0300,00');
  });

  it('identifies the top supplier by purchase volume', () => {
    const result = computeSupplierKpis(suppliers, purchaseOrders, currency);
    const top = result.find((k) => k.label === 'Top Supplier');
    // Both Acme Corp and Beta Ltd have totalValue 500; Acme appears first in PO list
    expect(top!.value).toBe('Acme Corp');
  });
});

// ── computeTopInventoryItems ────────────────────────────────────────────────

describe('computeTopInventoryItems', () => {
  it('returns empty array when no inventory', () => {
    expect(computeTopInventoryItems([], 'value')).toEqual([]);
  });

  it('sorts by value descending', () => {
    const result = computeTopInventoryItems(inventoryLines, 'value');
    expect(result).toHaveLength(3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.inventoryValue).toBeLessThanOrEqual(result[i - 1]!.inventoryValue);
    }
    expect(result[0]!.name).toBe('Cable 1mm'); // value 300
  });

  it('sorts by quantity descending', () => {
    const result = computeTopInventoryItems(inventoryLines, 'quantity');
    expect(result[0]!.quantity).toBeGreaterThanOrEqual(result[1]!.quantity);
    expect(result[0]!.name).toBe('Cable 1mm'); // qty 30
  });

  it('sorts by shortfall descending', () => {
    const result = computeTopInventoryItems(inventoryLines, 'shortfall');
    // m-1: shortfall = max(0, 10-20) = 0
    // m-2: shortfall = max(0, 50-30) = 20
    // m-3: shortfall = max(0, 25-5) = 20
    expect(result[0]!.shortfall).toBe(20);
    expect(result[0]!.name).toBe('Cable 1mm');
  });

  it('respects the limit parameter', () => {
    const result = computeTopInventoryItems(inventoryLines, 'value', 2);
    expect(result).toHaveLength(2);
  });

  it('computes shortfall as max(0, requiredStock - quantity)', () => {
    const result = computeTopInventoryItems(inventoryLines, 'shortfall');
    const paint = result.find((i) => i.materialId === 'm-3');
    expect(paint!.shortfall).toBe(20); // 25 - 5
  });
});

// ── computeInventoryValueTrend ──────────────────────────────────────────────

describe('computeInventoryValueTrend', () => {
  it('returns empty array when no movements', () => {
    expect(computeInventoryValueTrend([], [], 1000)).toEqual([]);
  });

  it('reconstructs historical value from baseline', () => {
    // baseline = 1000
    // m-1: RECEIPT, qty 20, cost 5 → +100
    // m-2: ISSUE, qty 5, cost 5 → -25
    // m-3: RECEIPT, qty 30, cost 10 → +300
    // baseline walk-back: 1000 - 100 + 25 - 300 = 625
    const result = computeInventoryValueTrend(movements, inventoryLines, 1000);
    expect(result).toHaveLength(3);
    // Day 1 (2026-09-01): 625 + 100 = 725
    expect(result[0]!.value).toBe(725);
    // Day 2 (2026-09-02): 725 - 25 = 700
    expect(result[1]!.value).toBe(700);
    // Day 3 (2026-09-03): 700 + 300 = 1000
    expect(result[2]!.value).toBe(1000);
  });

  it('never returns negative values', () => {
    const movement: ReportMovementRow = movements[0]!;
    const result = computeInventoryValueTrend([movement], inventoryLines, 10);
    expect(result.every((p) => p.value >= 0)).toBe(true);
  });

  it('labels each point as cumulative', () => {
    const result = computeInventoryValueTrend(movements, inventoryLines, 1000);
    expect(result.every((p) => p.isCumulative)).toBe(true);
  });
});

// ── categoryLabel ───────────────────────────────────────────────────────────

describe('categoryLabel', () => {
  it('maps known categories to human-readable labels', () => {
    expect(categoryLabel('FASTENERS_SLUGS_INSULATION')).toBe('Fasteners, Slugs & Insulation');
    expect(categoryLabel('TOOLING_PPE_ELECTRICAL')).toBe('Tooling, PPE & Electrical');
    expect(categoryLabel('PROJECT_MATERIAL')).toBe('Project Material');
    expect(categoryLabel('CONSUMABLES')).toBe('Consumables');
    expect(categoryLabel('TOOLS')).toBe('Tools');
  });

  it('falls back to the raw value for unknown categories', () => {
    expect(categoryLabel('UNKNOWN_CATEGORY')).toBe('UNKNOWN_CATEGORY');
  });
});

// ── statusLabel ─────────────────────────────────────────────────────────────

describe('statusLabel', () => {
  it('maps known statuses to labels', () => {
    expect(statusLabel('IN_STOCK')).toBe('In stock');
    expect(statusLabel('LOW_STOCK')).toBe('Low stock');
    expect(statusLabel('OUT_OF_STOCK')).toBe('Out of stock');
  });

  it('falls back to the raw status for unknown values', () => {
    expect(statusLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});

// ── statusTone ─�───────────────────────────────────────────────────────────

describe('statusTone', () => {
  it('maps statuses to correct tones', () => {
    expect(statusTone('IN_STOCK')).toBe('success');
    expect(statusTone('LOW_STOCK')).toBe('warning');
    expect(statusTone('OUT_OF_STOCK')).toBe('danger');
  });

  it('defaults to neutral for unknown statuses', () => {
    expect(statusTone('UNKNOWN')).toBe('neutral');
  });
});


describe('inventory value trend with signed reversals', () => {
  it.each([
    ['ISSUE', -4], ['RECEIPT', 4], ['ADJUSTMENT', 4], ['ADJUSTMENT', -4],
    ['TRANSFER_IN', 4], ['TRANSFER_OUT', -4],
  ])('restores value after a %s of %i is reversed on a later day', (type, quantity) => {
    const original: ReportMovementRow = {
      ...movements[0]!, id: 'original', type: String(type), quantity: Number(quantity),
      postedAt: '2026-09-01T08:00:00Z', reversedById: 'reversal',
    };
    const reversal: ReportMovementRow = {
      ...original, id: 'reversal', postedAt: '2026-09-02T08:00:00Z',
      quantity: -Number(quantity), reversesId: 'original', reversedById: null,
    };
    // m-1 costs 5 per unit; pass newest first as the API does.
    const input = [reversal, original];
    const trend = computeInventoryValueTrend(input, inventoryLines, 100);
    expect(trend.map(({ date, value }) => ({ date, value }))).toEqual([
      { date: '2026-09-01', value: 100 + Number(quantity) * 5 },
      { date: '2026-09-02', value: 100 },
    ]);
    expect(input).toEqual([reversal, original]);
  });

  it('nets an issue and its reversal on the same day without hiding a positive adjustment', () => {
    const base = movements[0]!;
    const trend = computeInventoryValueTrend([
      { ...base, id: 'before', postedAt: '2026-09-01T08:00:00Z', quantity: 0 },
      { ...base, id: 'issue', postedAt: '2026-09-02T08:00:00Z', type: 'ISSUE', quantity: -4, reversedById: 'undo' },
      { ...base, id: 'undo', postedAt: '2026-09-02T09:00:00Z', type: 'ISSUE', quantity: 4, reversesId: 'issue' },
      { ...base, id: 'adjust', postedAt: '2026-09-02T10:00:00Z', type: 'ADJUSTMENT', quantity: 2 },
    ], inventoryLines, 110);
    expect(trend.map((point) => point.value)).toEqual([100, 110]);
  });
});
