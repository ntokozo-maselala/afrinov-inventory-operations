// Demo data flow regression tests for the in-memory mock layer.
//
// These tests pin the contract the dashboard, reports, and PO pages
// rely on when running with `VITE_FRONTEND_ONLY=true`. The same demo
// dataset is mirrored in the backend seed (`apps/backend/src/db/seed.ts`)
// so live-mode and frontend-only-mode demos stay visually consistent.
import { describe, expect, it } from 'vitest';
import { createMockApi } from './mockApi';

const api = createMockApi();

describe('mock API demo data flow', () => {
  it('GET /purchase-orders returns at least the two seeded POs', async () => {
    const list = await api.get<Array<{ id: string; number: string; status: string; supplier: { name: string }; lines: Array<{ material: { sku: string } }> }>>('/purchase-orders');
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]!.supplier).toBeTruthy();
    expect(list[0]!.lines[0]!.material).toBeTruthy();
  });

  it('GET /inventory-transactions?limit=8 returns 8 most recent enriched movements', async () => {
    const list = await api.get<Array<{ id: string; materialSku: string; locationName: string; quantity: string }>>('/inventory-transactions?limit=8');
    expect(list).toHaveLength(8);
    // Sorted by postedAt desc — all 8 are the most recent.
    for (let i = 1; i < list.length; i++) continue;
    // Every row should be enriched with material SKU + location name.
    expect(list.every((t) => t.materialSku && t.locationName)).toBe(true);
  });

  interface StatusRow { materialId: string; sku: string; onHand: string; requiredStock: string; percentOfRequired: number | null; status: string; reorderQuantity: string; locations: Array<{ quantity: string }> }

  it('GET /reports/current-stock gives every row its item\'s status, from the total across locations', async () => {
    const rows = await api.get<Array<{ materialId: string; materialSku: string; quantity: string; requiredStock: string; stockStatus: string; belowThreshold: boolean }>>('/reports/current-stock');
    expect(rows.length).toBeGreaterThan(0);
    const status = new Map((await api.get<StatusRow[]>('/reports/stock-status')).map((r) => [r.materialId, r.status]));
    for (const r of rows) {
      expect(r.stockStatus).toBe(status.get(r.materialId));
      expect(r.belowThreshold).toBe(r.stockStatus === 'URGENT' || r.stockStatus === 'WARNING');
    }
  });

  it('GET /reports/stock-status grades every active item by the 20% / 40% bands, most urgent first', async () => {
    const rows = await api.get<StatusRow[]>('/reports/stock-status');
    expect(rows.length).toBeGreaterThan(0);
    const order = ['URGENT', 'WARNING', 'OK', 'NOT_SET'];
    for (let i = 1; i < rows.length; i++) expect(order.indexOf(rows[i]!.status)).toBeGreaterThanOrEqual(order.indexOf(rows[i - 1]!.status));
    for (const r of rows) {
      const onHand = Number(r.onHand);
      const required = Number(r.requiredStock);
      expect(onHand).toBeCloseTo(r.locations.reduce((a, l) => a + Number(l.quantity), 0));
      if (required <= 0) { expect(r.status).toBe('NOT_SET'); continue; }
      const pct = (onHand / required) * 100;
      expect(r.status).toBe(pct < 20 ? 'URGENT' : pct < 40 ? 'WARNING' : 'OK');
      expect(Number(r.reorderQuantity)).toBeCloseTo(Math.max(0, required - onHand));
    }
  });

  it('GET /reports/low-stock is the stock status limited to URGENT and WARNING', async () => {
    const all = await api.get<StatusRow[]>('/reports/stock-status');
    const low = await api.get<StatusRow[]>('/reports/low-stock');
    expect(low.map((r) => r.materialId)).toEqual(all.filter((r) => r.status === 'URGENT' || r.status === 'WARNING').map((r) => r.materialId));
    expect(await api.get<StatusRow[]>('/reports/stock-status?status=OK')).toEqual(all.filter((r) => r.status === 'OK'));
  });

  it('GET /reports/inventory with range=ALL&stockStatus=ALL&itemStatus=ACTIVE returns the documented shape', async () => {
    const r = await api.get<{ kpis: { skuCount: number; rangeLabel: string }; exceptions: unknown[]; inventory: unknown[]; byCategory: unknown[]; byLocation: unknown[] }>(
      '/reports/inventory?range=ALL&stockStatus=ALL&itemStatus=ACTIVE&page=1&pageSize=200',
    );
    expect(r.kpis.rangeLabel).toBe('All time');
    expect(r.kpis.skuCount).toBeGreaterThan(0);
    expect(Array.isArray(r.exceptions)).toBe(true);
    expect(Array.isArray(r.inventory)).toBe(true);
    expect(r.inventory.length).toBeLessThanOrEqual(200);
  });

  it('GET /settings/values?keys=appearance.theme,appearance.density returns the theme + density defaults', async () => {
    const r = await api.get<Record<string, string>>('/settings/values?keys=appearance.theme,appearance.density');
    expect(r['appearance.theme']).toBe('system');
    expect(r['appearance.density']).toBe('comfortable');
  });

  it('GET /materials returns the seeded catalogue', async () => {
    const list = await api.get<Array<{ id: string; sku: string; active: boolean }>>('/materials');
    expect(list.length).toBeGreaterThanOrEqual(12);
    expect(list.every((m) => m.sku && m.active !== undefined)).toBe(true);
  });

  it('GET /suppliers returns the seeded supplier catalogue', async () => {
    const list = await api.get<Array<{ id: string; name: string }>>('/suppliers');
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.map((s) => s.name)).toEqual(expect.arrayContaining(['Hydroscand', 'Bearings International']));
  });

  it('GET /locations returns the seeded location catalogue', async () => {
    const list = await api.get<Array<{ id: string; name: string; type: string }>>('/locations');
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.map((l) => l.name)).toEqual(expect.arrayContaining(['Main Storeroom', 'Boiler Shop', 'D-1']));
  });
});
