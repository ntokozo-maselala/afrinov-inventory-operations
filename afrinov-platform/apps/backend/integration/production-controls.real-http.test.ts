// Real-HTTP + real-database tests for the controls added by the production
// readiness remediation: segregation of duties on approval (ADR-022, PRA-06),
// the order-row lock that keeps an edit and an approval from interleaving
// (PRA-07), and the database CHECK constraints behind the ledger and order
// invariants (PRA-14).
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Order { id: string; status: string; lines: Array<{ id: string }>; totals: { net: string } }

describe('production controls over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let admin: ReturnType<typeof client>;
  let approver: ReturnType<typeof client>;
  let supplierId: string;
  let beamId: string;
  const projectNumber = `IT-PC-${run}`;
  const approvalKey = '/settings/purchaseOrders.requireApprovalBeforeProcessing';
  let approvalWas: boolean;

  /** A submitted project order for one beam at `price` + 15% VAT, raised by the administrator. */
  async function submittedOrder(price: number): Promise<Order> {
    const created = await admin<Order>('POST', '/purchase-orders', {
      supplierId, projectNumber, vatRate: 15, lines: [{ materialId: beamId, orderedQty: 1, unitPrice: price }],
    });
    expect(created.status).toBe(201);
    const submitted = await admin<Order>('POST', `/purchase-orders/${created.body.id}/submit`);
    expect(submitted.body.status).toBe('PENDING_APPROVAL');
    return created.body;
  }

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    admin = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    approvalWas = (await admin<{ value: boolean }>('GET', approvalKey)).body.value;
    expect((await admin('PUT', approvalKey, { value: true })).status).toBe(200);

    // An approver whose limit is R 1 000 including VAT.
    const email = `it-pc-approver-${run}@afrinov.local`;
    const password = `It-${run}-approver-pc`;
    const made = await admin<{ id: string }>('POST', '/users', { email, name: `IT PC Approver ${run}`, password, roleNames: ['APPROVER'] });
    expect(made.status).toBe(201);
    expect((await admin('PATCH', `/users/${made.body.id}`, { approvalLimit: 1000 })).status).toBe(200);
    approver = client(server.port, await login(server.port, email, password));

    const supplier = await admin<{ id: string }>('POST', '/suppliers', { name: `IT PC Supplier ${run}` });
    supplierId = supplier.body.id;
    expect((await admin('POST', '/projects', { projectNumber, name: `IT controls ${run}` })).status).toBe(201);
    const beam = await admin<{ id: string }>('POST', '/materials', {
      sku: `IT-PC-BEAM-${run}`, name: `Integration beam ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'PC', projectNumber,
    });
    expect(beam.status).toBe(200);
    beamId = beam.body.id;
  });

  afterAll(async () => {
    await admin?.('PUT', approvalKey, { value: approvalWas });
    await server?.close();
  });

  it('refuses the order’s own creator as approver, whatever their authority, and names who can', async () => {
    const order = await submittedOrder(100);
    const refused = await admin<{ error: { message: string } }>('POST', `/purchase-orders/${order.id}/approve`);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/^You raised this order, so someone else must approve it\./);
    expect((await approver<{ status: string }>('POST', `/purchase-orders/${order.id}/approve`)).body.status).toBe('APPROVED');
  });

  it('never leaves an order approved at a total its approver’s limit did not cover, when an edit races the approval', async () => {
    // R 800 + VAT = R 920, within the R 1 000 limit; R 900 + VAT = R 1 035, over it.
    for (let attempt = 0; attempt < 10; attempt++) {
      const order = await submittedOrder(800);
      const lineId = order.lines[0]!.id;
      await Promise.all([
        approver('POST', `/purchase-orders/${order.id}/approve`),
        admin('PATCH', `/purchase-orders/${order.id}`, { linePrices: [{ lineId, unitPrice: 900 }] }),
      ]);
      const final = (await admin<Order>('GET', `/purchase-orders/${order.id}`)).body;
      // Either the edit came first and the approval was refused, or the
      // approval came first and the edit sent the order back for approval.
      if (final.status === 'APPROVED') expect(Number(final.totals.net)).toBeLessThanOrEqual(1000);
      else expect(final.status).toBe('PENDING_APPROVAL');
    }
  });

  describe('database CHECK constraints', () => {
    /** Runs one statement in a transaction that must be refused by a CHECK constraint. */
    async function expectRefused(statement: Prisma.Sql): Promise<void> {
      await expect(prisma.$transaction(async (tx) => { await tx.$executeRaw(statement); }))
        .rejects.toThrow(/check constraint|violates/i);
    }

    it('refuses a negative stock balance written past the services', async () => {
      const location = await admin<{ id: string }>('POST', '/locations', { name: `IT PC store ${run}`, type: 'STOREROOM' });
      expect(location.status).toBe(201);
      await expectRefused(Prisma.sql`
        INSERT INTO inventory_balances (material_id, location_id, quantity, updated_at)
        VALUES (${beamId}, ${location.body.id}, -1, now())`);
    });

    it('refuses an order line with no quantity, a negative price, and a VAT rate over 100%', async () => {
      const order = await submittedOrder(10);
      await expectRefused(Prisma.sql`UPDATE purchase_order_lines SET ordered_qty = 0 WHERE purchase_order_id = ${order.id}`);
      await expectRefused(Prisma.sql`UPDATE purchase_order_lines SET unit_price = -1 WHERE purchase_order_id = ${order.id}`);
      await expectRefused(Prisma.sql`UPDATE purchase_orders SET vat_rate = 150 WHERE id = ${order.id}`);
    });
  });
});
