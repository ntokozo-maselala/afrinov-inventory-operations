// Real-HTTP + real-database tests for requests for quotation (RFQ roadmap,
// Phase 1): raising and editing drafts, their numbers in the Manhours and
// Material workbook's style, the project rules they share with orders, and
// their Activity.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ADMIN_EMAIL,
  client,
  login,
  prisma,
  requireAdminPassword,
  runId,
  startServer,
  type TestServer,
} from './helpers.js';

interface Rfq {
  id: string;
  number: string;
  status: string;
  projectNumber: string | null;
  description: string | null;
  lines: Array<{ lineNo: number; materialId: string; quantity: string; material?: { sku: string } }>;
  suppliers: Array<{ supplierId: string; vatRate?: number; totals?: unknown; supplier?: { name: string } }>;
}
interface HistoryEntry { action: string; actorName: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
interface ApiErrorBody { error: { code: string; message: string } }

describe('requests for quotation over real HTTP', () => {
  const run = runId();
  const projectNumber = `AFRI-${run}`;
  const otherProject = `AFRI-${run}X`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let storesItem: string;
  let projectItem: string;
  let supplierA: string;
  let supplierB: string;
  let inactiveSupplier: string;

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));

    for (const [number, name] of [[projectNumber, `Door rails ${run}`], [otherProject, `Other job ${run}`]]) {
      expect((await api('POST', '/projects', { projectNumber: number, name })).status).toBe(201);
    }
    const stores = await api<{ id: string }>('POST', '/materials', { sku: `IT-RFQ-S-${run}`, name: 'Side wheel', category: 'CONSUMABLES', unitOfMeasure: 'PC' });
    expect(stores.status).toBe(200);
    storesItem = stores.body.id;
    const own = await api<{ id: string }>('POST', '/materials', { sku: `IT-RFQ-P-${run}`, name: 'Door C-channel frame 180x70', category: 'PROJECT_MATERIAL', unitOfMeasure: 'LOTS', projectNumber });
    expect(own.status).toBe(200);
    projectItem = own.body.id;

    const supplier = async (name: string) => {
      const res = await api<{ id: string }>('POST', '/suppliers', { name });
      expect(res.status).toBe(201);
      return res.body.id;
    };
    supplierA = await supplier(`IT RFQ Steel ${run}`);
    supplierB = await supplier(`IT RFQ Fabrication ${run}`);
    inactiveSupplier = await supplier(`IT RFQ Closed ${run}`);
    expect((await api('PATCH', `/suppliers/${inactiveSupplier}`, { active: false })).status).toBe(200);
  });

  afterAll(async () => {
    await server?.close();
  });

  const raise = (body: Record<string, unknown>) => api<Rfq & ApiErrorBody>('POST', '/rfqs', body);

  it("raises a draft for a project, numbered as the workbook's documents, with the project's name as description", async () => {
    const res = await raise({
      projectNumber,
      lines: [{ materialId: projectItem, quantity: 109.318 }, { materialId: storesItem, quantity: 4 }],
      supplierIds: [supplierA, supplierB, supplierA],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ number: `AFRI-02A-${run}-02-01`, status: 'DRAFT', projectNumber, description: `Door rails ${run}` });

    const rfq = await api<Rfq>('GET', `/rfqs/${res.body.id}`);
    expect(rfq.status).toBe(200);
    expect(rfq.body.lines.map((l) => [l.lineNo, l.material?.sku, Number(l.quantity)])).toEqual([
      [1, `IT-RFQ-P-${run}`, 109.318],
      [2, `IT-RFQ-S-${run}`, 4],
    ]);
    // Each supplier once, in the order asked, with no quote yet.
    expect(rfq.body.suppliers.map((s) => s.supplierId)).toEqual([supplierA, supplierB]);
    expect(rfq.body.suppliers.every((s) => s.totals === null && typeof s.vatRate === 'number')).toBe(true);

    const second = await raise({ projectNumber, lines: [{ materialId: storesItem, quantity: 1 }] });
    expect(second.body.number).toBe(`AFRI-02A-${run}-02-02`);
  });

  it('numbers an RFQ for Stores RFQ-0001 onwards, and never twice when raised at once', async () => {
    const stores = await raise({ lines: [{ materialId: storesItem, quantity: 2 }] });
    expect(stores.status).toBe(201);
    expect(stores.body.number).toMatch(/^RFQ-\d{4,}$/);
    expect(stores.body.description).toBeNull();

    const together = await Promise.all([1, 2, 3, 4].map(() => raise({ projectNumber: otherProject, lines: [{ materialId: storesItem, quantity: 1 }] })));
    expect(together.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(together.map((r) => r.body.number).sort()).toEqual([1, 2, 3, 4].map((n) => `AFRI-02A-${run}X-02-0${n}`));
  });

  it("refuses another project's material, an inactive supplier and an unknown project", async () => {
    const forStores = await raise({ lines: [{ materialId: projectItem, quantity: 1 }] });
    expect(forStores.status).toBe(400);
    expect(forStores.body.error.message).toMatch(/material for project/);

    const forOther = await raise({ projectNumber: otherProject, lines: [{ materialId: projectItem, quantity: 1 }] });
    expect(forOther.status).toBe(400);

    const closed = await raise({ lines: [{ materialId: storesItem, quantity: 1 }], supplierIds: [inactiveSupplier] });
    expect(closed.status).toBe(400);
    expect(closed.body.error.message).toMatch(/inactive/);

    expect((await raise({ projectNumber: `NOPE-${run}`, lines: [{ materialId: storesItem, quantity: 1 }] })).status).toBe(400);
  });

  it('edits a draft, renumbers it on a new project, and logs only what changed', async () => {
    const created = await raise({ lines: [{ materialId: storesItem, quantity: 3 }], supplierIds: [supplierA] });
    const id = created.body.id;

    const edited = await api<Rfq>('PATCH', `/rfqs/${id}`, {
      projectNumber,
      notes: 'Quote in rand, delivered to site',
      lines: [{ materialId: projectItem, quantity: 7 }, { materialId: storesItem, quantity: 3 }],
      supplierIds: [supplierB],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.number).toMatch(new RegExp(`^AFRI-02A-${run}-02-\\d{2}$`));
    expect(edited.body.lines).toHaveLength(2);
    expect(edited.body.suppliers.map((s) => s.supplierId)).toEqual([supplierB]);

    // The same save again changes nothing and logs nothing.
    expect((await api('PATCH', `/rfqs/${id}`, { notes: 'Quote in rand, delivered to site' })).status).toBe(200);

    const history = await api<HistoryEntry[]>('GET', `/rfqs/${id}/history`);
    expect(history.body.map((e) => e.action)).toEqual(['UPDATE', 'CREATE']);
    expect(history.body[0]!.actorName).toBeTruthy();
    expect(history.body[0]!.after).toMatchObject({ projectNumber, number: edited.body.number, supplierIds: [supplierB] });
    expect(history.body[0]!.before).toMatchObject({ projectNumber: null, number: created.body.number, supplierIds: [supplierA] });

    const listed = await api<Rfq[]>('GET', `/rfqs?projectNumber=${projectNumber}`);
    expect(listed.body.map((r) => r.id)).toContain(id);
    expect(listed.body.every((r) => r.projectNumber === projectNumber)).toBe(true);
  });

  it('refuses to edit an RFQ once it is no longer a draft', async () => {
    const created = await raise({ lines: [{ materialId: storesItem, quantity: 1 }] });
    // Sending comes in Phase 2; until then the status is set directly.
    await prisma.rfq.update({ where: { id: created.body.id }, data: { status: 'SENT' } });
    const res = await api<ApiErrorBody>('PATCH', `/rfqs/${created.body.id}`, { notes: 'Too late' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('answers 404 for an RFQ that does not exist', async () => {
    expect((await api('GET', '/rfqs/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api('GET', '/rfqs/00000000-0000-4000-8000-000000000000/history')).status).toBe(404);
  });
});
