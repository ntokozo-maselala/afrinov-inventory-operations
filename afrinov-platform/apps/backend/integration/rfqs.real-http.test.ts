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
import { addDays, todayInSouthAfrica } from '../src/modules/procurement/rfq.service.js';

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
  // One project numbered as Afrinov's are, one not: each has its own sequence.
  const digits = String(parseInt(run, 16));
  const projectNumber = `AFRI-${digits}`;
  const otherProject = `IT-${run}`;
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
    expect(res.body).toMatchObject({ number: `AFRI-02A-${digits}-02-01`, status: 'DRAFT', projectNumber, description: `Door rails ${run}` });
    // The save answers with the RFQ as GET /rfqs/:id shows it.
    expect(res.body.lines[0]!.material?.sku).toBe(`IT-RFQ-P-${run}`);
    expect(res.body.suppliers[0]!.supplier?.name).toBe(`IT RFQ Steel ${run}`);

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
    expect(second.body.number).toBe(`AFRI-02A-${digits}-02-02`);
  });

  it('numbers an RFQ for Stores RFQ-0001 onwards, and never twice when raised at once', async () => {
    const stores = await raise({ lines: [{ materialId: storesItem, quantity: 2 }] });
    expect(stores.status).toBe(201);
    expect(stores.body.number).toMatch(/^RFQ-\d{4,}$/);
    expect(stores.body.description).toBeNull();

    const together = await Promise.all([1, 2, 3, 4].map(() => raise({ projectNumber: otherProject, lines: [{ materialId: storesItem, quantity: 1 }] })));
    expect(together.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(together.map((r) => r.body.number).sort()).toEqual([1, 2, 3, 4].map((n) => `RFQ-IT-${run}-0${n}`));
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

    // Quantities are kept to 4 decimal places: a finer one would be saved as 0.
    expect((await raise({ lines: [{ materialId: storesItem, quantity: 0.00001 }] })).status).toBe(400);
  });

  it('refuses an archived project', async () => {
    const archived = `IT-ARC-${run}`;
    expect((await api('POST', '/projects', { projectNumber: archived, name: `Archived ${run}` })).status).toBe(201);
    expect((await api('DELETE', `/projects/${archived}`)).status).toBe(200);
    const res = await raise({ projectNumber: archived, lines: [{ materialId: storesItem, quantity: 1 }] });
    expect(res.status).toBe(400);
  });

  it('starts the Activity with everything the draft was raised with', async () => {
    const created = await raise({ lines: [{ materialId: storesItem, quantity: 2.5 }], description: 'Round bars', notes: 'Mill certificates required', penaltiesApply: true, supplierIds: [supplierA] });
    const history = await api<HistoryEntry[]>('GET', `/rfqs/${created.body.id}/history`);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]!.after).toMatchObject({
      number: created.body.number, status: 'DRAFT', projectNumber: null, description: 'Round bars',
      notes: 'Mill certificates required', penaltiesApply: true, lines: [{ materialId: storesItem, quantity: '2.5' }], supplierIds: [supplierA],
    });
  });

  it("moves a description that was the project's name with the project, and keeps one the buyer wrote", async () => {
    const named = await raise({ projectNumber, lines: [{ materialId: storesItem, quantity: 1 }] });
    expect(named.body.description).toBe(`Door rails ${run}`);
    const moved = await api<Rfq>('PATCH', `/rfqs/${named.body.id}`, { projectNumber: otherProject });
    expect(moved.body.description).toBe(`Other job ${run}`);
    const off = await api<Rfq>('PATCH', `/rfqs/${named.body.id}`, { projectNumber: null });
    expect(off.body.description).toBeNull();

    const written = await raise({ projectNumber, description: 'Round bars for the door rails', lines: [{ materialId: storesItem, quantity: 1 }] });
    const kept = await api<Rfq>('PATCH', `/rfqs/${written.body.id}`, { projectNumber: otherProject });
    expect(kept.body.description).toBe('Round bars for the door rails');
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
    expect(edited.body.number).toMatch(new RegExp(`^AFRI-02A-${digits}-02-\\d{2}$`));
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

  describe('sending (Phase 2)', () => {
    type Sent = Rfq & { issuedAt: string | null; closingDate: string | null; closed: boolean; sentBy?: { name: string } | null } & ApiErrorBody;
    const send = (id: string, body: Record<string, unknown> = {}) => api<Sent>('POST', `/rfqs/${id}/send`, body);
    const day = (iso: string | null) => iso?.slice(0, 10);

    it('needs a supplier to ask before it goes out', async () => {
      const created = await raise({ lines: [{ materialId: storesItem, quantity: 1 }] });
      const res = await send(created.body.id);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/at least one supplier/);
    });

    it('issues it today and closes it four days later, as the RFQ sheet does', async () => {
      const created = await raise({ lines: [{ materialId: storesItem, quantity: 1 }], supplierIds: [supplierA] });
      const res = await send(created.body.id);
      expect(res.status).toBe(200);
      const today = todayInSouthAfrica();
      expect(res.body).toMatchObject({ status: 'SENT', closed: false, sentBy: { name: expect.any(String) } });
      expect(day(res.body.issuedAt)).toBe(today);
      expect(day(res.body.closingDate)).toBe(addDays(today, 4));

      // Sent once only.
      expect((await send(created.body.id)).status).toBe(409);
      const history = await api<HistoryEntry[]>('GET', `/rfqs/${created.body.id}/history`);
      expect(history.body[0]).toMatchObject({ action: 'RFQ_SEND', before: { status: 'DRAFT' }, after: { status: 'SENT', closingDate: addDays(today, 4), supplierIds: [supplierA] } });
    });

    it('takes the closing date given, but not one before today', async () => {
      const created = await raise({ lines: [{ materialId: storesItem, quantity: 1 }], supplierIds: [supplierA] });
      expect((await send(created.body.id, { closingDate: addDays(todayInSouthAfrica(), -1) })).status).toBe(400);
      const res = await send(created.body.id, { closingDate: addDays(todayInSouthAfrica(), 10) });
      expect(day(res.body.closingDate)).toBe(addDays(todayInSouthAfrica(), 10));
    });

    it('checks its suppliers again as it goes out', async () => {
      const created = await raise({ lines: [{ materialId: storesItem, quantity: 1 }], supplierIds: [supplierA] });
      const late = await api<{ id: string }>('POST', '/suppliers', { name: `IT RFQ Late ${run}` });
      expect((await api('PATCH', `/rfqs/${created.body.id}`, { supplierIds: [supplierA, late.body.id] })).status).toBe(200);
      expect((await api('PATCH', `/suppliers/${late.body.id}`, { active: false })).status).toBe(200);
      const res = await send(created.body.id);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/inactive/);
    });

    it('once sent, moves only its closing date and adds suppliers, taking none off', async () => {
      const created = await raise({ lines: [{ materialId: storesItem, quantity: 1 }], supplierIds: [supplierA] });
      await send(created.body.id);
      const id = created.body.id;

      const notes = await api<ApiErrorBody>('PATCH', `/rfqs/${id}`, { notes: 'Too late' });
      expect(notes.status).toBe(409);
      expect(notes.body.error.message).toMatch(/only its closing date and the suppliers/);
      expect((await api('PATCH', `/rfqs/${id}`, { supplierIds: [supplierB] })).status).toBe(409);

      const later = addDays(todayInSouthAfrica(), 7);
      const moved = await api<Sent>('PATCH', `/rfqs/${id}`, { closingDate: later, supplierIds: [supplierA, supplierB] });
      expect(moved.status).toBe(200);
      expect(day(moved.body.closingDate)).toBe(later);
      expect(moved.body.suppliers.map((s) => s.supplierId)).toEqual([supplierA, supplierB]);
      expect((await api('PATCH', `/rfqs/${id}`, { closingDate: addDays(todayInSouthAfrica(), -1) })).status).toBe(400);
    });

    it('shows a sent RFQ past its closing date as closed', async () => {
      const created = await raise({ lines: [{ materialId: storesItem, quantity: 1 }], supplierIds: [supplierA] });
      await send(created.body.id);
      // As if it went out last week.
      await prisma.rfq.update({ where: { id: created.body.id }, data: { issuedAt: new Date('2026-01-05'), closingDate: new Date('2026-01-09') } });
      expect((await api<Sent>('GET', `/rfqs/${created.body.id}`)).body.closed).toBe(true);
      const listed = await api<Sent[]>('GET', '/rfqs?status=SENT');
      expect(listed.body.find((r) => r.id === created.body.id)?.closed).toBe(true);
    });

    it('cancels a draft or a sent RFQ with a reason, and nothing after that', async () => {
      const created = await raise({ lines: [{ materialId: storesItem, quantity: 1 }], supplierIds: [supplierA] });
      await send(created.body.id);
      expect((await api('POST', `/rfqs/${created.body.id}/cancel`, { reason: ' ' })).status).toBe(400);
      const res = await api<Sent & { cancellationReason: string }>('POST', `/rfqs/${created.body.id}/cancel`, { reason: 'Client postponed the job' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Client postponed the job' });
      expect((await api('POST', `/rfqs/${created.body.id}/cancel`, { reason: 'Again' })).status).toBe(409);
      expect((await api('PATCH', `/rfqs/${created.body.id}`, { closingDate: addDays(todayInSouthAfrica(), 9) })).status).toBe(409);

      const draft = await raise({ lines: [{ materialId: storesItem, quantity: 1 }] });
      expect((await api<Sent>('POST', `/rfqs/${draft.body.id}/cancel`, { reason: 'Raised twice' })).body.status).toBe('CANCELLED');
    });
  });

  it('answers 404 for an RFQ that does not exist', async () => {
    expect((await api('GET', '/rfqs/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api('GET', '/rfqs/00000000-0000-4000-8000-000000000000/history')).status).toBe(404);
  });
});
