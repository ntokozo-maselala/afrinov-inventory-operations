// Real-HTTP + real-database tests for stock status and the re-order list:
// an item received from a supplier and then mostly issued shows as URGENT,
// with that supplier, and the downloaded Excel file lists it to re-order.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { ADMIN_EMAIL, client, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface StatusRow { sku: string; status: string; onHand: string; percentOfRequired: number | null; reorderQuantity: string; lastSupplier: { name: string } | null }

describe('stock status and re-order list over real HTTP', () => {
  const run = runId();
  const sku = `IT-RO-${run}`;
  const supplierName = `IT Re-order Supplier ${run}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let token: string;

  beforeAll(async () => {
    server = await startServer();
    token = await login(server.port, ADMIN_EMAIL, requireAdminPassword());
    api = client(server.port, token);
    const m = await api<{ id: string }>('POST', '/materials', { sku, name: `Re-order disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: 100, unitCost: 42.05 });
    expect(m.status).toBe(200);
    const loc = await api<{ id: string }>('POST', '/locations', { name: `IT re-order rack ${run}`, type: 'RACK' });
    const sup = await api<{ id: string }>('POST', '/suppliers', { name: supplierName });
    const rcp = await api<{ id: string }>('POST', '/recipients', { name: `IT re-order fitter ${run}`, type: 'WORKER' });
    expect((await api('POST', '/stock-receipts', { supplierId: sup.body.id, deliveryRef: `INV-${run}`, lines: [{ materialId: m.body.id, locationId: loc.body.id, quantity: 50 }] })).status).toBe(201);
    expect((await api('POST', '/inventory-issues', { recipientId: rcp.body.id, lines: [{ materialId: m.body.id, locationId: loc.body.id, quantity: 39 }] })).status).toBe(201);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('grades the item URGENT with its re-order quantity and last supplier', async () => {
    const res = await api<StatusRow[]>('GET', '/reports/stock-status?status=URGENT');
    expect(res.status).toBe(200);
    expect(res.body.find((r) => r.sku === sku)).toMatchObject({
      status: 'URGENT', onHand: '11', percentOfRequired: 11, reorderQuantity: '89', lastSupplier: { name: supplierName },
    });
    expect((await api('GET', '/reports/stock-status?status=SOON')).status).toBe(400);
  });

  it('downloads the re-order list as an Excel file listing the item', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/reports/reorder-list/export`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toMatch(/afrinov-reorder-list-\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Re-order list')!;
    let found: unknown[] | null = null;
    ws.eachRow((r) => { const v = (r.values as unknown[]).slice(1); if (v[0] === sku) found = v; });
    expect(found).not.toBeNull();
    expect(found!.slice(3, 11)).toEqual(['Urgent', 11, 100, 0.11, 89, 42.05, 3742.45, supplierName]);
  });
});
