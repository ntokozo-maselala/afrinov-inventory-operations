// Real-HTTP + real-database tests for reports by room (racks and locations
// roadmap, Phase 5): with inside=true a location filter covers the room and
// the racks inside it; a plain locationId stays exactly that one location, as
// Count stock relies on.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Row { id: string; locationId: string }
interface Receipt { goodsReceiptId: string; number: string; transactionIds: string[] }

describe('reports by room over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let roomId: string;
  let rackId: string;
  let receipt: Receipt;

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: false });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const supplier = await api<{ id: string }>('POST', '/suppliers', { name: `IT Room Supplier ${run}` });
    const m = await api<{ id: string }>('POST', '/materials', { sku: `IT-ROOM-${run}`, name: `Room item ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each' });
    materialId = m.body.id;
    const room = await api<{ id: string }>('POST', '/locations', { name: `IT room ${run}`, type: 'STOREROOM' });
    const rack = await api<{ id: string }>('POST', '/locations', { name: `IT room rack ${run}`, type: 'RACK', parentId: room.body.id });
    expect([supplier.status, room.status, rack.status]).toEqual([201, 201, 201]);
    roomId = room.body.id;
    rackId = rack.body.id;
    // Stock is received onto the rack, never the room itself.
    const res = await api<Receipt>('POST', '/stock-receipts', {
      supplierId: supplier.body.id, deliveryRef: `ROOM-${run}`, receivedAt: new Date().toISOString().slice(0, 10),
      lines: [{ materialId, locationId: rackId, quantity: 7 }],
    });
    expect(res.status).toBe(201);
    receipt = res.body;
    const count = await api('POST', '/stock-counts', { locationId: rackId, lines: [{ materialId, expectedQuantity: 7, countedQuantity: 6 }] });
    expect(count.status).toBeLessThan(300);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('shows a rack’s movements under its room with inside=true, and not without it', async () => {
    const byRoom = await api<Row[]>('GET', `/inventory-transactions?materialId=${materialId}&locationId=${roomId}&inside=true`);
    expect(byRoom.body.map((r) => r.locationId)).toContain(rackId);
    expect(byRoom.body.some((r) => r.id === receipt.transactionIds[0])).toBe(true);
    const roomOnly = await api<Row[]>('GET', `/inventory-transactions?materialId=${materialId}&locationId=${roomId}`);
    expect(roomOnly.body).toEqual([]);
  });

  it('shows the delivery and the count under the room with inside=true', async () => {
    const receipts = await api<Array<{ id: string }>>('GET', `/stock-receipts?locationId=${roomId}&inside=true&q=ROOM-${run}`);
    expect(receipts.body.map((r) => r.id)).toContain(receipt.goodsReceiptId);
    expect((await api<Array<{ id: string }>>('GET', `/stock-receipts?locationId=${roomId}&q=ROOM-${run}`)).body).toEqual([]);
    const counts = await api<Array<{ locationId: string }>>('GET', `/stock-counts?locationId=${roomId}&inside=true`);
    expect(counts.body.map((c) => c.locationId)).toContain(rackId);
    expect((await api<unknown[]>('GET', `/stock-counts?locationId=${roomId}`)).body).toEqual([]);
  });
});
