// Real-HTTP + real-database tests for receiving stock at the counter
// (POST /stock-receipts): it works with procurement switched off, books every
// line or none, shows the supplier and invoice on the movement, and can be
// reversed.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Receipt { goodsReceiptId: string; number: string; transactionIds: string[] }
interface HistoryRow { id: string; type: string; receiptNumber: string | null; supplierName: string | null; deliveryRef: string | null }

describe('receiving stock over real HTTP (procurement off)', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let supplierId: string;
  let discId: string;
  let glovesId: string;
  let rackId: string;
  let firstReceipt: Receipt;

  async function stockOf(materialId: string): Promise<string> {
    const { ledger, balance } = await ledgerAndBalance(materialId, rackId);
    expect(balance).toBe(ledger);
    return ledger;
  }

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: false });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));

    const supplier = await api<{ id: string }>('POST', '/suppliers', { name: `IT Supplier ${run}` });
    expect(supplier.status).toBe(201);
    supplierId = supplier.body.id;
    for (const [sku, set] of [[`IT-DISC-${run}`, (id: string) => { discId = id; }], [`IT-GLOVE-${run}`, (id: string) => { glovesId = id; }]] as const) {
      const m = await api<{ id: string }>('POST', '/materials', { sku, name: `Item ${sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each' });
      expect(m.status).toBe(200);
      set(m.body.id);
    }
    const rack = await api<{ id: string }>('POST', '/locations', { name: `IT receive rack ${run}`, type: 'RACK' });
    expect(rack.status).toBe(201);
    rackId = rack.body.id;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('receives several items in one entry while procurement routes are off', async () => {
    expect((await api('GET', '/goods-receipts')).status).toBe(404);

    const res = await api<Receipt>('POST', '/stock-receipts', {
      supplierId,
      deliveryRef: `INV-${run}`,
      receivedAt: new Date().toISOString().slice(0, 10),
      lines: [
        { materialId: discId, locationId: rackId, quantity: 20 },
        { materialId: glovesId, locationId: rackId, quantity: 6 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.number).toMatch(/^GR-\d{4}-\d{4}$/);
    expect(res.body.transactionIds).toHaveLength(2);
    firstReceipt = res.body;

    expect(await stockOf(discId)).toBe('20');
    expect(await stockOf(glovesId)).toBe('6');
    const gr = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: res.body.goodsReceiptId } });
    expect(gr).toMatchObject({ status: 'POSTED', purchaseOrderId: null, deliveryRef: `INV-${run}` });
  });

  it('shows the supplier and invoice number on the movement', async () => {
    const history = await api<HistoryRow[]>('GET', `/inventory-transactions?materialId=${discId}`);
    const row = history.body.find((t) => t.id === firstReceipt.transactionIds[0])!;
    expect(row).toMatchObject({
      type: 'RECEIPT',
      receiptNumber: firstReceipt.number,
      supplierName: `IT Supplier ${run}`,
      deliveryRef: `INV-${run}`,
    });
  });

  it('records nothing when any line is refused', async () => {
    const res = await api('POST', '/stock-receipts', {
      supplierId,
      deliveryRef: `INV-BAD-${run}`,
      lines: [
        { materialId: discId, locationId: rackId, quantity: 5 },
        { materialId: discId, locationId: '00000000-0000-0000-0000-000000000000', quantity: 5 },
      ],
    });
    expect(res.status).toBe(404);
    // Scoped to this receipt: other test files may record receipts at the same time.
    expect(await prisma.goodsReceipt.count({ where: { deliveryRef: `INV-BAD-${run}` } })).toBe(0);
    expect(await stockOf(discId)).toBe('20');

    const noInvoice = await api('POST', '/stock-receipts', { supplierId, deliveryRef: ' ', lines: [{ materialId: discId, locationId: rackId, quantity: 1 }] });
    expect(noInvoice.status).toBe(400);
  });

  it('can reverse a counter receipt booked by mistake', async () => {
    const reversed = await api<{ reversalIds: string[] }>('POST', `/inventory-transactions/${firstReceipt.transactionIds[1]}/reversal`, {
      reason: 'Gloves were for another branch',
    });
    expect(reversed.status).toBe(201);
    expect(await stockOf(glovesId)).toBe('0');
  });
});
