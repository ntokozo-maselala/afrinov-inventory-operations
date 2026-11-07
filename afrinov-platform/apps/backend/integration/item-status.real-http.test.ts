// Real-HTTP + real-database tests for an item's status (ADR-033): a change is on
// Movements with no quantity and a reason, moves no stock, happens only on its
// own route, and agrees with the record the check reads.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';
import { checkItemStatus } from '../src/modules/inventory/item-status-check.js';

interface Row { type: string; quantity: string | null; locationName: string; reasonCode: string | null; reasonNote: string | null; actorName: string; materialSku: string }

describe('item status over real HTTP', () => {
  const run = runId();
  const sku = `IT-ST-${run}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let location: string;
  let token: string;

  const history = async (query: string) => (await api<Row[]>('GET', `/inventory-transactions?${query}`)).body;
  const ofItem = () => history(`materialId=${materialId}`);
  const setStatus = (active: boolean, reasonCode: string, note?: string) => api('PATCH', `/materials/${materialId}/status`, { active, reasonCode, note });

  beforeAll(async () => {
    server = await startServer();
    token = await login(server.port, ADMIN_EMAIL, requireAdminPassword());
    api = client(server.port, token);
    location = (await api<{ id: string }>('POST', '/locations', { name: `IT status ${run}`, type: 'RACK' })).body.id;
    materialId = (await api<{ id: string }>('POST', '/materials', { sku, name: `Status item ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each' })).body.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('adds one row to the item\'s history, with no quantity, saying who and why', async () => {
    const res = await setStatus(false, 'SUPERSEDED', 'Replaced by the new range');
    expect(res.status).toBe(200);
    const rows = await ofItem();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'ITEM_DEACTIVATED', quantity: null, locationName: 'All locations',
      reasonCode: 'SUPERSEDED', reasonNote: 'Replaced by the new range', materialSku: sku,
    });
    expect(rows[0]!.actorName).toBeTruthy();
  });

  it('adds no second row when the same request comes again', async () => {
    expect((await setStatus(false, 'SUPERSEDED', 'Replaced by the new range')).status).toBe(200);
    expect(await ofItem()).toHaveLength(1);
  });

  it('adds a row of its own for reactivating, and keeps the first', async () => {
    expect((await setStatus(true, 'BACK_IN_USE')).status).toBe(200);
    expect((await ofItem()).map((r) => r.type)).toEqual(['ITEM_REACTIVATED', 'ITEM_DEACTIVATED']);
  });

  it('refuses a change with no reason, or Other with no note, and changes nothing', async () => {
    expect((await api('PATCH', `/materials/${materialId}/status`, { active: false })).status).toBe(400);
    expect((await setStatus(false, 'OTHER')).status).toBe(400);
    expect((await setStatus(false, 'BACK_IN_USE')).status).toBe(400);
    expect((await api<{ active: boolean }>('GET', `/materials/${materialId}`)).body.active).toBe(true);
    expect(await ofItem()).toHaveLength(2);
  });

  it('refuses active on the general update, rather than ignoring it', async () => {
    const res = await api<{ error: { message: string } }>('PATCH', `/materials/${materialId}`, { active: false, name: 'Changed' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/status route/);
    const item = (await api<{ active: boolean; name: string }>('GET', `/materials/${materialId}`)).body;
    expect(item).toMatchObject({ active: true, name: `Status item ${run}` });
  });

  it('leaves stock figures alone', async () => {
    const stock = await prisma.inventoryBalance.findMany({ where: { materialId } });
    const ledger = await prisma.inventoryTransaction.count({ where: { materialId } });
    await setStatus(false, 'OBSOLETE');
    await setStatus(true, 'DEACTIVATED_IN_ERROR');
    expect(await prisma.inventoryBalance.findMany({ where: { materialId } })).toEqual(stock);
    expect(await prisma.inventoryTransaction.count({ where: { materialId } })).toBe(ledger);
  });

  it('agrees across the list, its totals and the download', async () => {
    const query = `materialId=${materialId}`;
    const rows = await history(query);
    const summary = (await api<{ total: number; byType: Record<string, number> }>('GET', `/inventory-transactions/summary?${query}`)).body;
    expect(summary.total).toBe(rows.length);
    expect(summary.byType).toMatchObject({ ITEM_DEACTIVATED: 2, ITEM_REACTIVATED: 2 });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/inventory-transactions/export?${query}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.getWorksheet('Movements')!;
    const body = [];
    for (let r = 5; r <= ws.rowCount; r += 1) body.push(ws.getRow(r));
    expect(body).toHaveLength(rows.length);
    expect(body.map((r) => r.getCell(2).value)).toContain('Item deactivated');
    expect(body.every((r) => r.getCell(6).value === null)).toBe(true);
  });

  it('is left out where a filter asks for what a status change does not have', async () => {
    expect(await history(`materialId=${materialId}&locationId=${location}`)).toEqual([]);
    expect(await history(`materialId=${materialId}&report=issued`)).toEqual([]);
    expect(await history(`materialId=${materialId}&type=ADJUSTMENT`)).toEqual([]);
    expect((await history(`q=${sku}`)).length).toBeGreaterThan(0);
  });

  it('names the change in Other changes too', async () => {
    const rows = (await api<Array<{ entityId: string; summary: string }>>('GET', '/activity?entityType=Material&limit=50')).body;
    expect(rows.filter((r) => r.entityId === materialId).map((r) => r.summary)).toContain(`Reactivated item ${sku} Status item ${run}`);
  });

  it('keeps every item in step with its record', async () => {
    const report = await checkItemStatus(prisma);
    expect(report.mismatched).toEqual([]);
  });
});
