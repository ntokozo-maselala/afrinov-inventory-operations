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
  let token: string;
  let storesItem: string;
  let projectItem: string;
  let projectItem2: string;
  let otherItem: string;
  let supplierA: string;
  let supplierB: string;
  let inactiveSupplier: string;

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    token = await login(server.port, ADMIN_EMAIL, requireAdminPassword());
    api = client(server.port, token);

    for (const [number, name] of [[projectNumber, `Door rails ${run}`], [otherProject, `Other job ${run}`]]) {
      expect((await api('POST', '/projects', { projectNumber: number, name })).status).toBe(201);
    }
    const stores = await api<{ id: string }>('POST', '/materials', { sku: `IT-RFQ-S-${run}`, name: 'Side wheel', category: 'CONSUMABLES', unitOfMeasure: 'PC' });
    expect(stores.status).toBe(200);
    storesItem = stores.body.id;
    const own = await api<{ id: string }>('POST', '/materials', { sku: `IT-RFQ-P-${run}`, name: 'Door C-channel frame 180x70', category: 'PROJECT_MATERIAL', unitOfMeasure: 'LOTS', projectNumber });
    expect(own.status).toBe(200);
    projectItem = own.body.id;
    const own2 = await api<{ id: string }>('POST', '/materials', { sku: `IT-RFQ-P2-${run}`, name: 'Door rail 40x40', category: 'PROJECT_MATERIAL', unitOfMeasure: 'M', projectNumber });
    expect(own2.status).toBe(200);
    projectItem2 = own2.body.id;
    const others = await api<{ id: string }>('POST', '/materials', { sku: `IT-RFQ-O-${run}`, name: 'Gate hinge', category: 'PROJECT_MATERIAL', unitOfMeasure: 'PC', projectNumber: otherProject });
    expect(others.status).toBe(200);
    otherItem = others.body.id;

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
      lines: [{ materialId: projectItem, quantity: 109.318 }, { materialId: projectItem2, quantity: 4 }],
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
      [2, `IT-RFQ-P2-${run}`, 4],
    ]);
    // Each supplier once, in the order asked, with no quote yet.
    expect(rfq.body.suppliers.map((s) => s.supplierId)).toEqual([supplierA, supplierB]);
    expect(rfq.body.suppliers.every((s) => s.totals === null && typeof s.vatRate === 'number')).toBe(true);

    const second = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }] });
    expect(second.body.number).toBe(`AFRI-02A-${digits}-02-02`);
  });

  it('is for a project and its material only (Stores ordering roadmap): Stores stock is ordered by the store', async () => {
    const noProject = await raise({ lines: [{ materialId: storesItem, quantity: 2 }] });
    expect(noProject.status).toBe(400);
    expect(noProject.body.error.message).toMatch(/is for one project/);
    const storesLine = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }, { materialId: storesItem, quantity: 2 }] });
    expect(storesLine.status).toBe(400);
    expect(storesLine.body.error.message).toMatch(/is a Stores item, so it isn't bought for project/);
  });

  it('never gives two RFQs raised at once the same number', async () => {
    const together = await Promise.all([1, 2, 3, 4].map(() => raise({ projectNumber: otherProject, lines: [{ materialId: otherItem, quantity: 1 }] })));
    expect(together.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(together.map((r) => r.body.number).sort()).toEqual([1, 2, 3, 4].map((n) => `RFQ-IT-${run}-0${n}`));
  });

  it("refuses another project's material, an inactive supplier and an unknown project", async () => {
    const forOther = await raise({ projectNumber: otherProject, lines: [{ materialId: projectItem, quantity: 1 }] });
    expect(forOther.status).toBe(400);
    expect(forOther.body.error.message).toMatch(/material for project/);

    const closed = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [inactiveSupplier] });
    expect(closed.status).toBe(400);
    expect(closed.body.error.message).toMatch(/inactive/);

    expect((await raise({ projectNumber: `NOPE-${run}`, lines: [{ materialId: projectItem, quantity: 1 }] })).status).toBe(400);

    // Quantities are kept to 4 decimal places: a finer one would be saved as 0.
    expect((await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 0.00001 }] })).status).toBe(400);
  });

  it('refuses an archived project', async () => {
    const archived = `IT-ARC-${run}`;
    expect((await api('POST', '/projects', { projectNumber: archived, name: `Archived ${run}` })).status).toBe(201);
    expect((await api('DELETE', `/projects/${archived}`)).status).toBe(200);
    const res = await raise({ projectNumber: archived, lines: [{ materialId: projectItem, quantity: 1 }] });
    expect(res.status).toBe(400);
  });

  it('starts the Activity with everything the draft was raised with', async () => {
    const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 2.5 }], description: 'Round bars', notes: 'Mill certificates required', penaltiesApply: true, supplierIds: [supplierA] });
    const history = await api<HistoryEntry[]>('GET', `/rfqs/${created.body.id}/history`);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]!.after).toMatchObject({
      number: created.body.number, status: 'DRAFT', projectNumber, description: 'Round bars',
      notes: 'Mill certificates required', penaltiesApply: true, lines: [{ materialId: projectItem, quantity: '2.5' }], supplierIds: [supplierA],
    });
  });

  it("moves a description that was the project's name with the project, and keeps one the buyer wrote", async () => {
    const named = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }] });
    expect(named.body.description).toBe(`Door rails ${run}`);
    const moved = await api<Rfq>('PATCH', `/rfqs/${named.body.id}`, { projectNumber: otherProject, lines: [{ materialId: otherItem, quantity: 1 }] });
    expect(moved.body.description).toBe(`Other job ${run}`);
    // Its material stays with its project.
    expect((await api('PATCH', `/rfqs/${named.body.id}`, { projectNumber })).status).toBe(400);
    // And it stays on a project.
    const off = await api<ApiErrorBody>('PATCH', `/rfqs/${named.body.id}`, { projectNumber: null });
    expect(off.status).toBe(400);
    expect(off.body.error.message).toMatch(/is for one project/);

    const written = await raise({ projectNumber, description: 'Round bars for the door rails', lines: [{ materialId: projectItem, quantity: 1 }] });
    const kept = await api<Rfq>('PATCH', `/rfqs/${written.body.id}`, { projectNumber: otherProject, lines: [{ materialId: otherItem, quantity: 1 }] });
    expect(kept.body.description).toBe('Round bars for the door rails');
  });

  it('edits a draft, renumbers it on a new project, and logs only what changed', async () => {
    const created = await raise({ projectNumber: otherProject, lines: [{ materialId: otherItem, quantity: 3 }], supplierIds: [supplierA] });
    const id = created.body.id;

    const edited = await api<Rfq>('PATCH', `/rfqs/${id}`, {
      projectNumber,
      notes: 'Quote in rand, delivered to site',
      lines: [{ materialId: projectItem, quantity: 7 }, { materialId: projectItem2, quantity: 3 }],
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
    expect(history.body[0]!.before).toMatchObject({ projectNumber: otherProject, number: created.body.number, supplierIds: [supplierA] });

    const listed = await api<Rfq[]>('GET', `/rfqs?projectNumber=${projectNumber}`);
    expect(listed.body.map((r) => r.id)).toContain(id);
    expect(listed.body.every((r) => r.projectNumber === projectNumber)).toBe(true);
  });

  describe('sending (Phase 2)', () => {
    type Sent = Rfq & { issuedAt: string | null; closingDate: string | null; closed: boolean; sentBy?: { name: string } | null } & ApiErrorBody;
    const send = (id: string, body: Record<string, unknown> = {}) => api<Sent>('POST', `/rfqs/${id}/send`, body);
    const day = (iso: string | null) => iso?.slice(0, 10);

    it('needs a supplier to ask before it goes out', async () => {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }] });
      const res = await send(created.body.id);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/at least one supplier/);
    });

    it('issues it today and closes it four days later, as the RFQ sheet does', async () => {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
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
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      expect((await send(created.body.id, { closingDate: addDays(todayInSouthAfrica(), -1) })).status).toBe(400);
      // A day that doesn't exist is refused, not saved as 2 March.
      const impossible = await send(created.body.id, { closingDate: '2099-02-30' });
      expect(impossible.status).toBe(400);
      expect(impossible.body.error.message).toMatch(/not a date/);
      const res = await send(created.body.id, { closingDate: addDays(todayInSouthAfrica(), 10) });
      expect(day(res.body.closingDate)).toBe(addDays(todayInSouthAfrica(), 10));
    });

    it('checks its suppliers again as it goes out', async () => {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      const late = await api<{ id: string }>('POST', '/suppliers', { name: `IT RFQ Late ${run}` });
      expect((await api('PATCH', `/rfqs/${created.body.id}`, { supplierIds: [supplierA, late.body.id] })).status).toBe(200);
      expect((await api('PATCH', `/suppliers/${late.body.id}`, { active: false })).status).toBe(200);
      const res = await send(created.body.id);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/inactive/);
    });

    it('once sent, moves only its closing date and adds suppliers, taking none off', async () => {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
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

    it('adds a supplier to a sent RFQ although one already asked has since been deactivated', async () => {
      const gone = await api<{ id: string }>('POST', '/suppliers', { name: `IT RFQ Gone ${run}` });
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [gone.body.id] });
      await send(created.body.id);
      expect((await api('PATCH', `/suppliers/${gone.body.id}`, { active: false })).status).toBe(200);

      const added = await api<Sent>('PATCH', `/rfqs/${created.body.id}`, { supplierIds: [gone.body.id, supplierA] });
      expect(added.status).toBe(200);
      expect(added.body.suppliers.map((s) => s.supplierId)).toEqual([gone.body.id, supplierA]);
      // A new one is still checked.
      const inactive = await api<ApiErrorBody>('PATCH', `/rfqs/${created.body.id}`, { supplierIds: [gone.body.id, supplierA, inactiveSupplier] });
      expect(inactive.status).toBe(400);
      expect(inactive.body.error.message).toMatch(/inactive/);
    });

    it('shows a sent RFQ past its closing date as closed', async () => {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      await send(created.body.id);
      // As if it went out last week.
      await prisma.rfq.update({ where: { id: created.body.id }, data: { issuedAt: new Date('2026-01-05'), closingDate: new Date('2026-01-09') } });
      expect((await api<Sent>('GET', `/rfqs/${created.body.id}`)).body.closed).toBe(true);
      const listed = await api<Sent[]>('GET', '/rfqs?status=SENT');
      expect(listed.body.find((r) => r.id === created.body.id)?.closed).toBe(true);
    });

    it('cancels a draft or a sent RFQ with a reason, and nothing after that', async () => {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      await send(created.body.id);
      expect((await api('POST', `/rfqs/${created.body.id}/cancel`, { reason: ' ' })).status).toBe(400);
      const res = await api<Sent & { cancellationReason: string }>('POST', `/rfqs/${created.body.id}/cancel`, { reason: 'Client postponed the job' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Client postponed the job' });
      expect((await api('POST', `/rfqs/${created.body.id}/cancel`, { reason: 'Again' })).status).toBe(409);
      expect((await api('PATCH', `/rfqs/${created.body.id}`, { closingDate: addDays(todayInSouthAfrica(), 9) })).status).toBe(409);

      const draft = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }] });
      expect((await api<Sent>('POST', `/rfqs/${draft.body.id}/cancel`, { reason: 'Raised twice' })).body.status).toBe('CANCELLED');
    });
  });

  describe('quotes (Phase 4)', () => {
    type Quoted = Omit<Rfq, 'lines' | 'suppliers'> & ApiErrorBody & {
      lines: Array<{ id: string; lineNo: number }>;
      suppliers: Array<{
        supplierId: string; quotedAt: string | null; declined: boolean; quoteReference: string | null; validUntil: string | null;
        leadTime: string | null; prices: Array<{ rfqLineId: string; unitPrice: string }>;
        totals: { subtotal: string; vat: string; net: string; unpricedLines: number } | null;
        quoteFile: { fileName: string; size: number } | null;
      }>;
    };
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

    /** A sent RFQ with two lines, asking both suppliers. */
    async function sentRfq(): Promise<Quoted> {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 4 }, { materialId: projectItem2, quantity: 2.5 }], supplierIds: [supplierA, supplierB] });
      return (await api<Quoted>('POST', `/rfqs/${created.body.id}/send`, {})).body;
    }
    const quote = (rfqId: string, supplierId: string, body: Record<string, unknown>) => api<Quoted>('PUT', `/rfqs/${rfqId}/suppliers/${supplierId}/quote`, body);
    const upload = (path: string, data: Buffer, type = 'application/pdf', name = 'EMV quote 1094.pdf') => fetch(`http://127.0.0.1:${server.port}/api/v1${path}`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': type, 'x-file-name': encodeURIComponent(name) }, body: new Uint8Array(data),
    });

    it("records a supplier's prices and works out their totals, leaving a line they don't offer unpriced", async () => {
      const rfq = await sentRfq();
      const [first, second] = rfq.lines;
      const res = await quote(rfq.id, supplierA, {
        quoteReference: 'Q-2291', validUntil: '2099-12-31', leadTime: '2 weeks', prices: [{ rfqLineId: first!.id, unitPrice: 160 }],
      });
      expect(res.status).toBe(200);
      const a = res.body.suppliers.find((s) => s.supplierId === supplierA)!;
      expect(a).toMatchObject({ quoteReference: 'Q-2291', leadTime: '2 weeks', declined: false });
      expect(a.quotedAt?.slice(0, 10)).toBe(todayInSouthAfrica());
      // 4 x 160 = 640, VAT 15% for a rand supplier; the second line has no price.
      expect(a.totals).toEqual({ subtotal: '640.00', vat: '96.00', net: '736.00', unpricedLines: 1 });
      expect(res.body.suppliers.find((s) => s.supplierId === supplierB)!.totals).toBeNull();

      // Corrected: both lines now priced.
      const corrected = await quote(rfq.id, supplierA, { prices: [{ rfqLineId: first!.id, unitPrice: 150 }, { rfqLineId: second!.id, unitPrice: 10.5 }] });
      expect(corrected.body.suppliers.find((s) => s.supplierId === supplierA)!.totals).toMatchObject({ subtotal: '626.25', unpricedLines: 0 });
      const history = await api<HistoryEntry[]>('GET', `/rfqs/${rfq.id}/history`);
      expect(history.body.slice(0, 2).map((e) => e.action)).toEqual(['RFQ_QUOTE_CORRECTED', 'RFQ_QUOTE']);
      // The correction keeps the whole quote it replaced.
      expect(history.body[0]!.before).toMatchObject({ quoteReference: 'Q-2291', leadTime: '2 weeks', validUntil: '2099-12-31', prices: [{ rfqLineId: first!.id, unitPrice: '160' }] });
    });

    it('refuses a quote with no price, a line from elsewhere, a day to come, or a price finer than 4 decimals', async () => {
      const rfq = await sentRfq();
      const line = rfq.lines[0]!.id;
      expect((await quote(rfq.id, supplierA, { prices: [] })).status).toBe(400);
      expect((await quote(rfq.id, supplierA, { prices: [{ rfqLineId: '00000000-0000-4000-8000-000000000000', unitPrice: 1 }] })).status).toBe(400);
      expect((await quote(rfq.id, supplierA, { quotedAt: addDays(todayInSouthAfrica(), 2), prices: [{ rfqLineId: line, unitPrice: 1 }] })).status).toBe(400);
      expect((await quote(rfq.id, supplierA, { validUntil: '2099-02-30', prices: [{ rfqLineId: line, unitPrice: 1 }] })).status).toBe(400);
      expect((await quote(rfq.id, supplierA, { prices: [{ rfqLineId: line, unitPrice: 1.23456 }] })).status).toBe(400);
      // A price too small to keep at 4 decimal places would be saved as 0.
      expect((await quote(rfq.id, supplierA, { prices: [{ rfqLineId: line, unitPrice: 0.000000001 }] })).status).toBe(400);
      // A quote can't run out before it came in.
      expect((await quote(rfq.id, supplierA, { validUntil: '2020-01-01', prices: [{ rfqLineId: line, unitPrice: 1 }] })).status).toBe(400);
      // A supplier who wasn't asked.
      expect((await quote(rfq.id, inactiveSupplier, { prices: [{ rfqLineId: line, unitPrice: 1 }] })).status).toBe(404);
    });

    it('takes quotes only while the RFQ is out with suppliers', async () => {
      const draft = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      const line = (await api<Quoted>('GET', `/rfqs/${draft.body.id}`)).body.lines[0]!.id;
      expect((await quote(draft.body.id, supplierA, { prices: [{ rfqLineId: line, unitPrice: 1 }] })).status).toBe(409);
      await api('POST', `/rfqs/${draft.body.id}/send`, {});
      await api('POST', `/rfqs/${draft.body.id}/cancel`, { reason: 'Not needed' });
      expect((await quote(draft.body.id, supplierA, { prices: [{ rfqLineId: line, unitPrice: 1 }] })).status).toBe(409);
    });

    it('records a decline, setting aside a quote recorded before, and a later quote replaces it', async () => {
      const rfq = await sentRfq();
      const line = rfq.lines[0]!.id;
      await quote(rfq.id, supplierB, { prices: [{ rfqLineId: line, unitPrice: 99 }] });
      const declined = await api<Quoted>('POST', `/rfqs/${rfq.id}/suppliers/${supplierB}/decline`, { notes: 'No stock of 304' });
      expect(declined.body.suppliers.find((s) => s.supplierId === supplierB)).toMatchObject({ declined: true, quotedAt: null, prices: [], totals: null });
      const declinedEntry = (await api<HistoryEntry[]>('GET', `/rfqs/${rfq.id}/history`)).body[0]!;
      expect(declinedEntry).toMatchObject({ action: 'RFQ_DECLINED', before: { declined: false, prices: [{ rfqLineId: line, unitPrice: '99' }] } });
      const requoted = await quote(rfq.id, supplierB, { prices: [{ rfqLineId: line, unitPrice: 98 }] });
      expect(requoted.body.suppliers.find((s) => s.supplierId === supplierB)).toMatchObject({ declined: false });
    });

    it("keeps the supplier's quotation PDF, gives it back as attached, and takes it off", async () => {
      const rfq = await sentRfq();
      const path = `/rfqs/${rfq.id}/suppliers/${supplierA}/quote-file`;
      expect((await upload(path, Buffer.from('not a pdf'))).status).toBe(400);
      expect((await upload(path, PDF, 'application/octet-stream')).status).toBe(415);

      const put = await upload(path, PDF);
      expect(put.status).toBe(200);
      const saved = (await put.json()) as Quoted;
      expect(saved.suppliers.find((s) => s.supplierId === supplierA)!.quoteFile).toMatchObject({ fileName: 'EMV quote 1094.pdf', size: PDF.length });
      // The detail carries the file's name and size, never its contents.
      expect(JSON.stringify(saved)).not.toContain('%PDF');

      const got = await fetch(`http://127.0.0.1:${server.port}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
      expect(got.status).toBe(200);
      expect(got.headers.get('content-type')).toBe('application/pdf');
      expect(got.headers.get('x-content-type-options')).toBe('nosniff');
      expect(got.headers.get('content-disposition')).toContain("filename*=UTF-8''EMV%20quote%201094.pdf");
      expect(Buffer.from(await got.arrayBuffer()).equals(PDF)).toBe(true);

      expect((await api('DELETE', path)).status).toBe(200);
      expect((await api('GET', path)).status).toBe(404);
      const history = await api<HistoryEntry[]>('GET', `/rfqs/${rfq.id}/history`);
      expect(history.body.slice(0, 2).map((e) => e.action)).toEqual(['RFQ_QUOTE_FILE_REMOVED', 'RFQ_QUOTE_FILE']);
    });

    it('keeps a quotation under a .pdf name whatever it was called, so it never opens as a web page', async () => {
      const rfq = await sentRfq();
      const path = `/rfqs/${rfq.id}/suppliers/${supplierA}/quote-file`;
      const disguised = Buffer.from('%PDF-<script>alert(1)</script>', 'latin1');
      const saved = (await (await upload(path, disguised, 'application/pdf', 'quote.html')).json()) as Quoted;
      expect(saved.suppliers.find((s) => s.supplierId === supplierA)!.quoteFile?.fileName).toBe('quote.pdf');
      const got = await fetch(`http://127.0.0.1:${server.port}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
      expect(got.headers.get('content-disposition')).toContain('filename="quote.pdf"');
    });

    it('refuses an upload from someone not signed in before reading it', async () => {
      const rfq = await sentRfq();
      const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/rfqs/${rfq.id}/suppliers/${supplierA}/quote-file`, {
        method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: new Uint8Array(PDF),
      });
      expect(res.status).toBe(401);
    });

    it('takes a quotation PDF larger than the 1 MB the rest of the API allows, up to 10 MB', async () => {
      const rfq = await sentRfq();
      const path = `/rfqs/${rfq.id}/suppliers/${supplierA}/quote-file`;
      const big = Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024, 0x20)]);
      expect((await upload(path, big)).status).toBe(200);
      // Over 10 MB is refused: with a 413, or by the server closing the
      // connection before the upload finishes. Either way nothing is kept.
      const tooBig = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024, 0x20)]);
      const refused = await upload(path, tooBig).then((r) => r.status, () => 'closed');
      expect([413, 'closed']).toContain(refused);
      const kept = (await api<Quoted>('GET', `/rfqs/${rfq.id}`)).body.suppliers.find((s) => s.supplierId === supplierA)!.quoteFile;
      expect(kept?.size).toBe(big.length);
    });
  });

  describe('award (Phase 5)', () => {
    type Awarded = Omit<Rfq, 'lines' | 'suppliers'> & ApiErrorBody & {
      lines: Array<{ id: string }>;
      suppliers: Array<{ supplierId: string }>;
      purchaseOrder: { id: string; number: string; status: string } | null;
      error: { code: string; message: string; details?: { concerns?: string[] } };
    };
    interface Order {
      id: string; number: string; status: string; supplierId: string; projectNumber: string | null; penaltiesApply: boolean; notes: string | null;
      rfq: { id: string; number: string } | null;
      lines: Array<{ materialId: string; orderedQty: string; unitPrice: string | null }>;
    }

    /** A sent RFQ for the project with two lines; A quotes 736 incl. VAT for line 1 only, B 690 for line 1 and 10 for line 2. */
    async function quoted(): Promise<Awarded> {
      const created = await raise({
        projectNumber, penaltiesApply: true, notes: 'Deliver to site',
        lines: [{ materialId: projectItem2, quantity: 4 }, { materialId: projectItem, quantity: 1 }], supplierIds: [supplierA, supplierB],
      });
      const sent = (await api<Awarded>('POST', `/rfqs/${created.body.id}/send`, {})).body;
      const [l1, l2] = sent.lines;
      await api('PUT', `/rfqs/${sent.id}/suppliers/${supplierA}/quote`, { quoteReference: 'A-1', prices: [{ rfqLineId: l1!.id, unitPrice: 160 }] });
      await api('PUT', `/rfqs/${sent.id}/suppliers/${supplierB}/quote`, { quoteReference: 'B-7', prices: [{ rfqLineId: l1!.id, unitPrice: 150 }, { rfqLineId: l2!.id, unitPrice: 0.0001 }] });
      return sent;
    }
    const award = (id: string, body: Record<string, unknown>) => api<Awarded>('POST', `/rfqs/${id}/award`, body);

    it('raises a draft order at the quoted prices for the clear choice, linked both ways', async () => {
      const rfq = await quoted();
      const res = await award(rfq.id, { supplierId: supplierB });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AWARDED');
      expect(res.body.purchaseOrder).toMatchObject({ status: 'DRAFT' });

      const order = (await api<Order>('GET', `/purchase-orders/${res.body.purchaseOrder!.id}`)).body;
      expect(order).toMatchObject({ status: 'DRAFT', supplierId: supplierB, projectNumber, penaltiesApply: true, rfq: { id: rfq.id, number: rfq.number } });
      expect(order.notes).toBe(`As per your quotation B-7 for ${rfq.number}.\nDeliver to site`);
      expect(order.lines.map((l) => [l.materialId, Number(l.orderedQty), Number(l.unitPrice)])).toEqual([[projectItem2, 4, 150], [projectItem, 1, 0.0001]]);

      const poHistory = await api<HistoryEntry[]>('GET', `/purchase-orders/${order.id}/history`);
      expect(poHistory.body.at(-1)).toMatchObject({ action: 'CREATE', after: { rfqId: rfq.id, rfqNumber: rfq.number } });
      const rfqHistory = await api<HistoryEntry[]>('GET', `/rfqs/${rfq.id}/history`);
      expect(rfqHistory.body[0]).toMatchObject({ action: 'RFQ_AWARD', after: { supplierId: supplierB, purchaseOrderNumber: order.number, concerns: [] } });

      // Awarded once only, and its quotes no longer change.
      expect((await award(rfq.id, { supplierId: supplierB })).status).toBe(409);
      expect((await api('POST', `/rfqs/${rfq.id}/suppliers/${supplierA}/decline`, {})).status).toBe(409);
    });

    it('asks why before awarding to a quote that left a line unpriced, and keeps the reason', async () => {
      const rfq = await quoted();
      const refused = await award(rfq.id, { supplierId: supplierA });
      expect(refused.status).toBe(400);
      expect(refused.body.error.details?.concerns).toEqual([expect.stringContaining("didn't price 1 line")]);

      const res = await award(rfq.id, { supplierId: supplierA, reason: 'B can only deliver in six weeks' });
      expect(res.status).toBe(200);
      const order = (await api<Order>('GET', `/purchase-orders/${res.body.purchaseOrder!.id}`)).body;
      // The line A didn't price goes on the order without a price, to be added before approval.
      expect(order.lines.map((l) => l.unitPrice === null ? null : Number(l.unitPrice))).toEqual([160, null]);
      const history = await api<HistoryEntry[]>('GET', `/rfqs/${rfq.id}/history`);
      expect(history.body[0]!.after).toMatchObject({ reason: 'B can only deliver in six weeks' });
    });

    it("won't award to a supplier who hasn't quoted, nor a draft", async () => {
      const rfq = await quoted();
      await api('POST', `/rfqs/${rfq.id}/suppliers/${supplierB}/decline`, { notes: 'Changed their mind' });
      expect((await award(rfq.id, { supplierId: supplierB })).status).toBe(400);
      const draft = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      expect((await award(draft.body.id, { supplierId: supplierA })).status).toBe(409);
    });

    it("won't award a quote given in another currency than the supplier trades in now", async () => {
      const rfq = await quoted();
      expect((await api('PATCH', `/suppliers/${supplierB}`, { currency: 'EUR' })).status).toBe(200);
      try {
        const res = await award(rfq.id, { supplierId: supplierB });
        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/quoted in ZAR but now trades in EUR/);
      } finally {
        await api('PATCH', `/suppliers/${supplierB}`, { currency: 'ZAR' });
      }
    });

    it('gives each quoted line its subtotal rounded as the order rounds it', async () => {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      const sent = (await api<Awarded>('POST', `/rfqs/${created.body.id}/send`, {})).body;
      const res = await api<{ suppliers: Array<{ supplierId: string; lineSubtotals: Array<{ rfqLineId: string; subtotal: string }> }> }>(
        'PUT', `/rfqs/${sent.id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: sent.lines[0]!.id, unitPrice: 1.005 }] },
      );
      // 1.005 x 1 rounds half up to 1.01, as the order will; a double would show 1.00.
      expect(res.body.suppliers.find((s) => s.supplierId === supplierA)!.lineSubtotals).toEqual([{ rfqLineId: sent.lines[0]!.id, subtotal: '1.01' }]);
    });

    it('awards an RFQ sent before Stores ordering, Stores items and all, but sends no such draft now', async () => {
      const created = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }, { materialId: projectItem2, quantity: 2 }], supplierIds: [supplierA] });
      const sent = (await api<Awarded>('POST', `/rfqs/${created.body.id}/send`, {})).body;
      // As one sent before the rule would be: its second line a Stores item.
      await prisma.rfqLine.update({ where: { id: sent.lines[1]!.id }, data: { materialId: storesItem } });
      await api('PUT', `/rfqs/${sent.id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: sent.lines[0]!.id, unitPrice: 5 }, { rfqLineId: sent.lines[1]!.id, unitPrice: 7 }] });
      const res = await award(sent.id, { supplierId: supplierA });
      expect(res.status).toBe(200);
      const order = (await api<Order>('GET', `/purchase-orders/${res.body.purchaseOrder!.id}`)).body;
      expect(order.lines.map((l) => l.materialId)).toEqual([projectItem, storesItem]);

      // A draft from before the rule, with no project, can't go out.
      const draft = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      await prisma.rfq.update({ where: { id: draft.body.id }, data: { projectNumber: null } });
      const refused = await api<ApiErrorBody>('POST', `/rfqs/${draft.body.id}/send`, {});
      expect(refused.status).toBe(400);
      expect(refused.body.error.message).toMatch(/is for one project/);

      // Nor is one already sent awarded: its order would be a Stores order,
      // the store's to change, not the buyer's (Qodo, PR #117).
      const old = await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] });
      const oldSent = (await api<Awarded>('POST', `/rfqs/${old.body.id}/send`, {})).body;
      await api('PUT', `/rfqs/${oldSent.id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: oldSent.lines[0]!.id, unitPrice: 5 }] });
      await prisma.rfq.update({ where: { id: oldSent.id }, data: { projectNumber: null } });
      const noProject = await award(oldSent.id, { supplierId: supplierA });
      expect(noProject.status).toBe(400);
      expect(noProject.body.error.message).toMatch(/has no project, so it can't be awarded/);
      expect(await prisma.purchaseOrder.count({ where: { rfq: { id: oldSent.id } } })).toBe(0);
    });

    it('raises one order when two buyers award at once', async () => {
      const rfq = await quoted();
      const both = await Promise.all([award(rfq.id, { supplierId: supplierB }), award(rfq.id, { supplierId: supplierB })]);
      expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
      const orders = await prisma.purchaseOrder.count({ where: { rfq: { id: rfq.id } } });
      expect(orders).toBe(1);
    });
  });

  describe('roll out (Phase 6)', () => {
    /** Signs in as a new user holding just this role. */
    async function as(role: string) {
      const email = `it-rfq-${role.toLowerCase()}-${run}@afrinov.local`;
      const password = `It-${run}-${role.toLowerCase()}`;
      expect((await api('POST', '/users', { email, name: `IT RFQ ${role} ${run}`, password, roleNames: [role] })).status).toBe(201);
      return client(server.port, await login(server.port, email, password));
    }

    it('takes a buyer from raising an RFQ to an order awaiting approval, with both sides of the story kept', async () => {
      // Approval on, so the order really waits for an approver, whatever the
      // test database was left with; put back however the test ends.
      const approvalKey = '/settings/purchaseOrders.requireApprovalBeforeProcessing';
      const approvalWas = (await api<{ value: boolean }>('GET', approvalKey)).body.value;
      expect((await api('PUT', approvalKey, { value: true })).status).toBe(200);
      try {
        const buyer = await as('PROCUREMENT');
        const raised = await buyer<Rfq & { lines: Array<{ id: string }> }>('POST', '/rfqs', {
          projectNumber, lines: [{ materialId: projectItem2, quantity: 4 }, { materialId: projectItem, quantity: 2 }], supplierIds: [supplierA, supplierB],
        });
        expect(raised.status).toBe(201);
        const id = raised.body.id;
        const [l1, l2] = raised.body.lines;
        expect((await buyer('POST', `/rfqs/${id}/send`, {})).status).toBe(200);
        expect((await buyer('PUT', `/rfqs/${id}/suppliers/${supplierA}/quote`, { quoteReference: 'A-9', prices: [{ rfqLineId: l1!.id, unitPrice: 150 }, { rfqLineId: l2!.id, unitPrice: 30 }] })).status).toBe(200);
        expect((await buyer('PUT', `/rfqs/${id}/suppliers/${supplierB}/quote`, { prices: [{ rfqLineId: l1!.id, unitPrice: 155 }, { rfqLineId: l2!.id, unitPrice: 30 }] })).status).toBe(200);
        const awarded = await buyer<{ status: string; purchaseOrder: { id: string; number: string } }>('POST', `/rfqs/${id}/award`, { supplierId: supplierA });
        expect(awarded.status).toBe(200);
        const orderId = awarded.body.purchaseOrder.id;

        // The order goes on through approval like any other.
        const submitted = await buyer<{ status: string }>('POST', `/purchase-orders/${orderId}/submit`);
        expect(submitted.status).toBe(200);
        expect(submitted.body.status).toBe('PENDING_APPROVAL');

        // Both stories, every entry under the buyer's name.
        const buyerName = `IT RFQ PROCUREMENT ${run}`;
        const rfqStory = (await buyer<HistoryEntry[]>('GET', `/rfqs/${id}/history`)).body.reverse();
        expect(rfqStory.map((e) => [e.action, e.actorName])).toEqual(
          ['CREATE', 'RFQ_SEND', 'RFQ_QUOTE', 'RFQ_QUOTE', 'RFQ_AWARD'].map((action) => [action, buyerName]),
        );
        const orderStory = (await buyer<HistoryEntry[]>('GET', `/purchase-orders/${orderId}/history`)).body.reverse();
        expect(orderStory.map((e) => [e.action, e.actorName])).toEqual([['CREATE', buyerName], ['PO_SUBMIT', buyerName]]);
        expect(orderStory[0]).toMatchObject({ after: { rfqId: id } });
      } finally {
        await api('PUT', approvalKey, { value: approvalWas });
      }
    });

    it.each(['APPROVER', 'STORE_CONTROLLER'])('lets a %s open RFQs and their quotations, and change nothing', async (role) => {
      const user = await as(role);
      const draft = (await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] })).body;
      const rfq = (await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }], supplierIds: [supplierA] })).body;
      await api('POST', `/rfqs/${rfq.id}/send`, {});
      expect((await user('GET', '/rfqs')).status).toBe(200);
      expect((await user('GET', `/rfqs/${rfq.id}`)).status).toBe(200);
      expect((await user('GET', `/rfqs/${rfq.id}/history`)).status).toBe(200);
      for (const [method, path, body] of [
        ['POST', '/rfqs', { projectNumber, lines: [{ materialId: projectItem, quantity: 1 }] }],
        ['PATCH', `/rfqs/${rfq.id}`, { closingDate: '2099-01-01' }],
        ['POST', `/rfqs/${draft.id}/send`, {}],
        ['PUT', `/rfqs/${rfq.id}/suppliers/${supplierA}/quote-file`, {}],
        ['DELETE', `/rfqs/${rfq.id}/suppliers/${supplierA}/quote-file`, undefined],
        ['PUT', `/rfqs/${rfq.id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: rfq.lines[0]!.materialId, unitPrice: 1 }] }],
        ['POST', `/rfqs/${rfq.id}/suppliers/${supplierA}/decline`, {}],
        ['POST', `/rfqs/${rfq.id}/award`, { supplierId: supplierA }],
        ['POST', `/rfqs/${rfq.id}/cancel`, { reason: 'Not mine to cancel' }],
      ] as const) {
        expect([method, path, (await user(method, path, body)).status]).toEqual([method, path, 403]);
      }
    });

    it.each(['TECHNICIAN', 'VIEWER'])('keeps RFQs from a %s altogether', async (role) => {
      const user = await as(role);
      const rfq = (await raise({ projectNumber, lines: [{ materialId: projectItem, quantity: 1 }] })).body;
      expect((await user('GET', '/rfqs')).status).toBe(403);
      expect((await user('GET', `/rfqs/${rfq.id}`)).status).toBe(403);
    });
  });

  it('answers 404 for an RFQ that does not exist', async () => {
    expect((await api('GET', '/rfqs/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api('GET', '/rfqs/00000000-0000-4000-8000-000000000000/history')).status).toBe(404);
  });
});
