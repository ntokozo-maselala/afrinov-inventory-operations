// Real-HTTP + real-database tests for the supplier record: the vendor fields
// from the AFRI-0000_x purchase order template, editing and deactivating.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Supplier {
  id: string; name: string; vendorCode: string | null; address: string | null; currency: string;
  paymentTerms: string | null; website: string | null; services: string | null; active: boolean;
}

describe('suppliers over real HTTP', () => {
  const run = runId();
  const code = `IT${run}`.slice(0, 20).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let supplierId: string;

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
  });

  afterAll(async () => {
    await server?.close();
  });

  it('creates a supplier with the template fields, tidied', async () => {
    const res = await api<Supplier>('POST', '/suppliers', {
      name: `IT Vendor ${run}`, vendorCode: code.toLowerCase(), address: '23 Grader Road, Spartan',
      paymentTerms: 'cod', website: 'www.example.co.za | ', services: 'Fasteners',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vendorCode: code, currency: 'ZAR', paymentTerms: 'C.O.D', website: 'www.example.co.za', active: true });
    supplierId = res.body.id;
  });

  it('refuses a second supplier with the same vendor code', async () => {
    const res = await api('POST', '/suppliers', { name: `IT Vendor B ${run}`, vendorCode: code });
    expect(res.status).toBe(409);
  });

  it('refuses a currency the app does not know', async () => {
    const res = await api('POST', '/suppliers', { name: `IT Vendor C ${run}`, currency: 'YEN' });
    expect(res.status).toBe(400);
  });

  it('gets one supplier by id, and 404s an unknown one', async () => {
    expect((await api<Supplier>('GET', `/suppliers/${supplierId}`)).body.name).toBe(`IT Vendor ${run}`);
    expect((await api('GET', '/suppliers/no-such-supplier')).status).toBe(404);
  });

  it('edits only the fields sent, clears with null, and logs the change', async () => {
    const res = await api<Supplier>('PATCH', `/suppliers/${supplierId}`, { currency: 'EUR', paymentTerms: '30 days nett', website: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ vendorCode: code, address: '23 Grader Road, Spartan', currency: 'EUR', paymentTerms: '30 DAYS NETT', website: null });
    const entry = await prisma.auditLogEntry.findFirst({ where: { entityType: 'Supplier', entityId: supplierId, action: 'UPDATE' } });
    expect(entry).not.toBeNull();
  });

  it('deactivates and reactivates', async () => {
    expect((await api<Supplier>('PATCH', `/suppliers/${supplierId}`, { active: false })).body.active).toBe(false);
    expect((await api<Supplier>('PATCH', `/suppliers/${supplierId}`, { active: true })).body.active).toBe(true);
  });

  it('can be searched by vendor code', async () => {
    const res = await api<Supplier[]>('GET', `/suppliers?q=${encodeURIComponent(code)}`);
    expect(res.body.map((s) => s.id)).toContain(supplierId);
  });
});
