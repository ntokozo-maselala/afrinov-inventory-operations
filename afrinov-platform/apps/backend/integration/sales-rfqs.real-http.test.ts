// Real-HTTP + real-database tests for Sales requests for quotation: raising and
// sending one with typed lines, recording quotes and a PDF, numbering apart from
// Procurement's, and above all who may see the prices.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ADMIN_EMAIL,
  client,
  login,
  requireAdminPassword,
  runId,
  startServer,
  type TestServer,
} from './helpers.js';

interface SalesRfq {
  id: string;
  number: string;
  status: string;
  closed: boolean;
  description: string | null;
  lines: Array<{ id: string; lineNo: number; description: string; unitOfMeasure: string; quantity: string }>;
  suppliers: Array<{
    supplierId: string; declined: boolean; quotedAt: string | null;
    totals: { subtotal: string; vat: string; net: string; unpricedLines: number } | null;
    quoteFile: { fileName: string } | null;
  }>;
}
interface ApiErrorBody { error: { code: string; message: string } }

describe('Sales requests for quotation over real HTTP', () => {
  const run = runId();
  const projectNumber = `AFRI-${parseInt(run, 16)}`;
  const otherProject = `AFRI-${parseInt(run, 16) + 1}`;
  let server: TestServer;
  let admin: ReturnType<typeof client>;
  let supplierA: string;
  let supplierB: string;

  /** A signed-in client holding one role, made once per run. */
  const signedIn = new Map<string, ReturnType<typeof client>>();
  async function as(role: 'SALES' | 'PROCUREMENT' | 'STORE_CONTROLLER' | 'DIRECTOR') {
    const known = signedIn.get(role);
    if (known) return known;
    const email = `it-sales-${role.toLowerCase()}-${run}@example.test`;
    const password = `It-${run}-sales`;
    expect((await admin('POST', '/users', { email, name: `${role} ${run}`, password, roleNames: [role] })).status).toBe(201);
    const made = client(server.port, await login(server.port, email, password));
    signedIn.set(role, made);
    return made;
  }

  const lines = [
    { description: '200NB pipes x 3m', unitOfMeasure: 'PC', quantity: 24 },
    { description: 'Mild steel plate 10mm', unitOfMeasure: 'kg', quantity: 12.5 },
  ];

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    admin = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    for (const [number, name] of [[projectNumber, `Pipe spools ${run}`], [otherProject, `Other job ${run}`]]) {
      expect((await admin('POST', '/projects', { projectNumber: number, name })).status).toBe(201);
    }
    const supplier = async (name: string) => {
      const res = await admin<{ id: string }>('POST', '/suppliers', { name: `${name} ${run}` });
      expect(res.status).toBe(201);
      return res.body.id;
    };
    supplierA = await supplier('Local Steel');
    supplierB = await supplier('Engineering Fasteners');
  });

  afterAll(async () => { await server?.close(); });

  it('raises a draft with typed lines, a listed unit and the next number for its project', async () => {
    const sales = await as('SALES');
    const res = await sales<SalesRfq>('POST', '/sales-rfqs', { projectNumber, lines, supplierIds: [supplierA, supplierB] });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(`AFRI-02A-${parseInt(run, 16)}-02-01`);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.description).toBe(`Pipe spools ${run}`);
    // PC is a spelling of the listed unit "each".
    expect(res.body.lines.map((l) => [l.lineNo, l.description, l.unitOfMeasure])).toEqual([[1, '200NB pipes x 3m', 'each'], [2, 'Mild steel plate 10mm', 'kg']]);
    const second = await sales<SalesRfq>('POST', '/sales-rfqs', { projectNumber, lines });
    expect(second.body.number).toBe(`AFRI-02A-${parseInt(run, 16)}-02-02`);
  });

  it('refuses a line with part of a counted unit, a unit not on the list, or no project', async () => {
    const part = await admin<ApiErrorBody>('POST', '/sales-rfqs', { projectNumber, lines: [{ description: 'Bend', unitOfMeasure: 'each', quantity: 1.5 }] });
    expect(part.status).toBe(400);
    expect(part.body.error.message).toMatch(/whole numbers/);
    const unit = await admin<ApiErrorBody>('POST', '/sales-rfqs', { projectNumber, lines: [{ description: 'Bend', unitOfMeasure: 'furlong', quantity: 1 }] });
    expect(unit.status).toBe(400);
    const none = await admin<ApiErrorBody>('POST', '/sales-rfqs', { projectNumber: 'NO-SUCH-PROJECT', lines });
    expect(none.status).toBe(400);
  });

  it('numbers apart from Procurement, so both can hold the sheet\'s first number', async () => {
    const material = await admin<{ id: string }>('POST', '/materials', { sku: `IT-SRFQ-${run}`, name: 'Plate', category: 'PROJECT_MATERIAL', unitOfMeasure: 'kg', projectNumber: otherProject });
    expect(material.status).toBe(200);
    const procurement = await admin<{ number: string }>('POST', '/rfqs', { projectNumber: otherProject, lines: [{ materialId: material.body.id, quantity: 1 }] });
    const sales = await admin<SalesRfq>('POST', '/sales-rfqs', { projectNumber: otherProject, lines });
    expect(procurement.body.number).toBe(sales.body.number);
  });

  it('takes a draft through sending, quotes, a decline and a PDF, with totals excluding and including VAT', async () => {
    const created = await admin<SalesRfq>('POST', '/sales-rfqs', { projectNumber, lines, supplierIds: [supplierA, supplierB] });
    const id = created.body.id;
    const [pipe, plate] = created.body.lines;

    const early = await admin<ApiErrorBody>('PUT', `/sales-rfqs/${id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: pipe!.id, unitPrice: 100 }] });
    expect(early.status).toBe(409);

    expect((await admin<SalesRfq>('POST', `/sales-rfqs/${id}/send`, {})).body.status).toBe('SENT');
    const fixed = await admin<ApiErrorBody>('PATCH', `/sales-rfqs/${id}`, { lines });
    expect(fixed.status).toBe(409);

    const quoted = await admin<SalesRfq>('PUT', `/sales-rfqs/${id}/suppliers/${supplierA}/quote`, {
      quoteReference: 'Q-1',
      prices: [{ rfqLineId: pipe!.id, unitPrice: 100 }, { rfqLineId: plate!.id, unitPrice: 20 }],
    });
    expect(quoted.status).toBe(200);
    const a = quoted.body.suppliers.find((s) => s.supplierId === supplierA)!;
    // 24 x 100 + 12.5 x 20 = 2650.
    expect(a.totals).toMatchObject({ subtotal: '2650.00', unpricedLines: 0 });

    const declined = await admin<SalesRfq>('POST', `/sales-rfqs/${id}/suppliers/${supplierB}/decline`, { notes: 'No stock' });
    expect(declined.body.suppliers.find((s) => s.supplierId === supplierB)).toMatchObject({ declined: true, quotedAt: null, totals: null });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/sales-rfqs/${id}/suppliers/${supplierA}/quote-file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'returned%20sheet.pdf', Authorization: `Bearer ${await login(server.port, ADMIN_EMAIL, requireAdminPassword())}` },
      body: Buffer.from('%PDF-1.4 sheet'),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as SalesRfq).suppliers.find((s) => s.supplierId === supplierA)!.quoteFile).toMatchObject({ fileName: 'returned sheet.pdf' });

    const history = await admin<Array<{ action: string; entityType: string }>>('GET', `/sales-rfqs/${id}/history`);
    expect(history.body.map((e) => e.action)).toEqual(expect.arrayContaining(['CREATE', 'RFQ_SEND', 'RFQ_QUOTE', 'RFQ_DECLINED', 'RFQ_QUOTE_FILE']));

    const cancelled = await admin<SalesRfq>('POST', `/sales-rfqs/${id}/cancel`, { reason: 'Client went elsewhere' });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await admin<ApiErrorBody>('POST', `/sales-rfqs/${id}/cancel`, { reason: 'Again' })).status).toBe(409);
  });

  it('keeps Sales prices from buyers and the store, in the RFQ and in the audit log', async () => {
    const created = await admin<SalesRfq>('POST', '/sales-rfqs', { projectNumber, lines, supplierIds: [supplierA] });
    const id = created.body.id;
    await admin('POST', `/sales-rfqs/${id}/send`, {});
    await admin('PUT', `/sales-rfqs/${id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: created.body.lines[0]!.id, unitPrice: 987.65 }] });

    for (const role of ['PROCUREMENT', 'STORE_CONTROLLER'] as const) {
      const other = await as(role);
      expect((await other('GET', '/sales-rfqs')).status, `${role} list`).toBe(403);
      expect((await other('GET', `/sales-rfqs/${id}`)).status, `${role} read`).toBe(403);
      expect((await other('GET', `/sales-rfqs/${id}/history`)).status, `${role} history`).toBe(403);
      expect((await other('POST', '/sales-rfqs', { projectNumber, lines })).status, `${role} raise`).toBe(403);
    }

    const director = await as('DIRECTOR');
    expect((await director<SalesRfq>('GET', `/sales-rfqs/${id}`)).status).toBe(200);
    expect((await director('POST', '/sales-rfqs', { projectNumber, lines })).status).toBe(403);
  });

  describe('linking a Procurement line to its Sales line', () => {
    interface LinkedLine { id: string; materialId: string; salesRfqLine: { id: string; lineNo: number; description: string; rfq: { number: string; status: string } } | null }
    interface Rfq { id: string; projectNumber: string; lines: LinkedLine[] }
    const linkPath = (rfq: Rfq, line: LinkedLine) => `/rfqs/${rfq.id}/lines/${line.id}/sales-line`;
    let materialA: string;
    let materialB: string;

    const item = async (sku: string) => {
      const res = await admin<{ id: string }>('POST', '/materials', { sku: `${sku}-${run}`, name: sku, category: 'PROJECT_MATERIAL', unitOfMeasure: 'kg', projectNumber });
      expect(res.status).toBe(200);
      return res.body.id;
    };
    const sentSales = async (project = projectNumber, withPrice = false) => {
      const created = await admin<SalesRfq>('POST', '/sales-rfqs', { projectNumber: project, lines, supplierIds: [supplierA] });
      await admin('POST', `/sales-rfqs/${created.body.id}/send`, {});
      if (withPrice) await admin('PUT', `/sales-rfqs/${created.body.id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: created.body.lines[0]!.id, unitPrice: 987.65 }] });
      return created.body;
    };
    const raise = async (supplierIds: string[] = []) => {
      const res = await admin<Rfq>('POST', '/rfqs', { projectNumber, lines: [{ materialId: materialA, quantity: 24 }, { materialId: materialB, quantity: 1 }], supplierIds });
      expect(res.status).toBe(201);
      return res.body;
    };

    beforeAll(async () => {
      materialA = await item('IT-LINK-A');
      materialB = await item('IT-LINK-B');
    });

    it('lets a buyer link and unlink a line, seeing what was asked for and never a price or supplier', async () => {
      const sales = await sentSales(projectNumber, true);
      const rfq = await raise();
      const buyer = await as('PROCUREMENT');

      const offered = await buyer<Array<{ id: string }>>('GET', `/rfqs/${rfq.id}/sales-lines`);
      expect(offered.status).toBe(200);
      expect(offered.body.map((l) => l.id)).toContain(sales.lines[0]!.id);
      expect(JSON.stringify(offered.body)).not.toMatch(/987\.65|unitPrice|supplier/i);

      const linked = await buyer<Rfq>('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: sales.lines[0]!.id });
      expect(linked.status).toBe(200);
      expect(linked.body.lines[0]!.salesRfqLine).toMatchObject({ lineNo: 1, description: '200NB pipes x 3m', rfq: { number: sales.number } });
      expect(JSON.stringify(linked.body)).not.toMatch(/987\.65/);

      const history = await buyer<Array<{ action: string; after: Record<string, unknown> }>>('GET', `/rfqs/${rfq.id}/history`);
      expect(history.body[0]).toMatchObject({ action: 'RFQ_SALES_LINK', after: { lineNo: 1, salesRfqNumber: sales.number, salesLineNo: 1 } });

      // Linking it again changes nothing, so adds nothing to its Activity.
      await buyer('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: sales.lines[0]!.id });
      expect((await buyer<unknown[]>('GET', `/rfqs/${rfq.id}/history`)).body).toHaveLength(history.body.length);

      const unlinked = await buyer<Rfq>('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: null });
      expect(unlinked.body.lines[0]!.salesRfqLine).toBeNull();
    });

    it('lets several lines share a Sales line', async () => {
      const sales = await sentSales();
      const rfq = await raise();
      await admin('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: sales.lines[0]!.id });
      const both = await admin<Rfq>('PUT', linkPath(rfq, rfq.lines[1]!), { salesRfqLineId: sales.lines[0]!.id });
      expect(both.body.lines.map((l) => l.salesRfqLine?.id)).toEqual([sales.lines[0]!.id, sales.lines[0]!.id]);
    });

    it("refuses a draft's lines, another project's, a made-up one, and any change once cancelled", async () => {
      const rfq = await raise();
      const line = rfq.lines[0]!;
      const draft = await admin<SalesRfq>('POST', '/sales-rfqs', { projectNumber, lines });
      expect((await admin('PUT', linkPath(rfq, line), { salesRfqLineId: draft.body.lines[0]!.id })).status).toBe(400);
      const elsewhere = await sentSales(otherProject);
      expect((await admin('PUT', linkPath(rfq, line), { salesRfqLineId: elsewhere.lines[0]!.id })).status).toBe(400);
      expect((await admin('PUT', linkPath(rfq, line), { salesRfqLineId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
      expect((await admin('PUT', linkPath(rfq, line), { salesRfqLineId: 'nope' })).status).toBe(400);
      expect((await admin('PUT', `/rfqs/${rfq.id}/lines/00000000-0000-4000-8000-000000000000/sales-line`, { salesRfqLineId: null })).status).toBe(404);

      const offered = await admin<Array<{ id: string }>>('GET', `/rfqs/${rfq.id}/sales-lines`);
      expect(offered.body.map((l) => l.id)).not.toContain(draft.body.lines[0]!.id);
      expect(offered.body.map((l) => l.id)).not.toContain(elsewhere.lines[0]!.id);

      const sales = await sentSales();
      await admin('POST', `/rfqs/${rfq.id}/cancel`, { reason: 'Not needed' });
      expect((await admin('PUT', linkPath(rfq, line), { salesRfqLineId: sales.lines[0]!.id })).status).toBe(409);
    });

    it('keeps a link when Sales later cancels, marked cancelled, and offers it no longer', async () => {
      const sales = await sentSales();
      const rfq = await raise();
      await admin('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: sales.lines[0]!.id });
      await admin('POST', `/sales-rfqs/${sales.id}/cancel`, { reason: 'Lost the job' });
      const read = await admin<Rfq>('GET', `/rfqs/${rfq.id}`);
      expect(read.body.lines[0]!.salesRfqLine!.rfq.status).toBe('CANCELLED');
      const offered = await admin<Array<{ id: string }>>('GET', `/rfqs/${rfq.id}/sales-lines`);
      expect(offered.body.map((l) => l.id)).not.toContain(sales.lines[0]!.id);
    });

    it("carries links through a draft's edit by item, and clears them when it moves project", async () => {
      const sales = await sentSales();
      const rfq = await raise();
      await admin('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: sales.lines[0]!.id });

      const edited = await admin<Rfq>('PATCH', `/rfqs/${rfq.id}`, { lines: [{ materialId: materialB, quantity: 2 }, { materialId: materialA, quantity: 30 }] });
      expect(edited.status).toBe(200);
      expect(edited.body.lines.map((l) => [l.materialId, l.salesRfqLine?.id ?? null])).toEqual([[materialB, null], [materialA, sales.lines[0]!.id]]);

      const moved = await admin<Rfq>('PATCH', `/rfqs/${rfq.id}`, { projectNumber: otherProject });
      expect(moved.status).toBe(200);
      expect(moved.body.lines.every((l) => l.salesRfqLine === null)).toBe(true);
      const history = await admin<Array<{ after: Record<string, unknown> }>>('GET', `/rfqs/${rfq.id}/history`);
      expect(history.body[0]!.after).toMatchObject({ projectNumber: otherProject, salesLinks: 0 });
    });

    it('can still be linked or corrected once awarded', async () => {
      const sales = await sentSales();
      const rfq = await raise([supplierA]);
      await admin('POST', `/rfqs/${rfq.id}/send`, {});
      await admin('PUT', `/rfqs/${rfq.id}/suppliers/${supplierA}/quote`, { prices: rfq.lines.map((l) => ({ rfqLineId: l.id, unitPrice: 10 })) });
      expect((await admin('POST', `/rfqs/${rfq.id}/award`, { supplierId: supplierA })).status).toBe(200);
      const late = await admin<Rfq>('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: sales.lines[0]!.id });
      expect(late.status).toBe(200);
      expect(late.body.lines[0]!.salesRfqLine?.id).toBe(sales.lines[0]!.id);
    });

    it('offers and takes links only from those who raise RFQs, while those who may open one see the link', async () => {
      const sales = await sentSales();
      const rfq = await raise();
      await admin('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: sales.lines[0]!.id });
      const director = await as('DIRECTOR');
      expect((await director('GET', `/rfqs/${rfq.id}/sales-lines`)).status).toBe(403);
      expect((await director('PUT', linkPath(rfq, rfq.lines[0]!), { salesRfqLineId: null })).status).toBe(403);
      expect((await director<Rfq>('GET', `/rfqs/${rfq.id}`)).body.lines[0]!.salesRfqLine?.id).toBe(sales.lines[0]!.id);
      const salesPerson = await as('SALES');
      expect((await salesPerson('GET', `/rfqs/${rfq.id}/sales-lines`)).status).toBe(403);
    });
  });

  describe('the Procurement savings report', () => {
    interface Report {
      total: { sales: string; procurement: string; order: string; discount: string; salesVsProcurement: string; procurementVsOrder: string; salesVsOrder: string; lines: number; linked: number };
      rows: Array<{ rfqNumber: string; sales: { lowest: string | null } | null; procurement: { lowest: string | null }; order: { lineTotal: string | null; discount: string | null } | null; salesVsProcurement: string | null; procurementVsOrder: string | null; salesVsOrder: string | null; notes: string[] }>;
    }
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
    const job = `AFRI-${parseInt(run, 16) + 2}`;
    const query = `from=${day}&to=${day}&projectNumber=${job}`;

    it('compares what Sales and buyers were quoted with the order, from RFQ to award', async () => {
      expect((await admin('POST', '/projects', { projectNumber: job, name: `Savings ${run}` })).status).toBe(201);
      const salesRfq = await admin<SalesRfq>('POST', '/sales-rfqs', { projectNumber: job, lines: [lines[0]], supplierIds: [supplierA, supplierB] });
      await admin('POST', `/sales-rfqs/${salesRfq.body.id}/send`, {});
      const salesLine = salesRfq.body.lines[0]!.id;
      await admin('PUT', `/sales-rfqs/${salesRfq.body.id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: salesLine, unitPrice: 100 }] });
      await admin('PUT', `/sales-rfqs/${salesRfq.body.id}/suppliers/${supplierB}/quote`, { prices: [{ rfqLineId: salesLine, unitPrice: 90 }] });

      const pipe = await admin<{ id: string }>('POST', '/materials', { sku: `IT-SAVE-${run}`, name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'each', projectNumber: job });
      const rfq = await admin<{ id: string; lines: Array<{ id: string }> }>('POST', '/rfqs', { projectNumber: job, lines: [{ materialId: pipe.body.id, quantity: 24 }], supplierIds: [supplierA, supplierB] });
      const line = rfq.body.lines[0]!.id;
      await admin('POST', `/rfqs/${rfq.body.id}/send`, {});
      await admin('PUT', `/rfqs/${rfq.body.id}/suppliers/${supplierA}/quote`, { prices: [{ rfqLineId: line, unitPrice: 95 }] });
      await admin('PUT', `/rfqs/${rfq.body.id}/suppliers/${supplierB}/quote`, { prices: [{ rfqLineId: line, unitPrice: 88 }] });

      const before = await admin<Report>('GET', `/reports/procurement-savings?${query}`);
      expect(before.status).toBe(200);
      expect(before.body.rows[0]).toMatchObject({ sales: null, order: null, salesVsProcurement: null, notes: ['Not linked to a Sales line', 'Not awarded yet, so there is no order to compare'] });

      await admin('PUT', `/rfqs/${rfq.body.id}/lines/${line}/sales-line`, { salesRfqLineId: salesLine });
      await admin('POST', `/rfqs/${rfq.body.id}/award`, { supplierId: supplierB });

      const report = await admin<Report>('GET', `/reports/procurement-savings?${query}`);
      expect(report.body.rows).toHaveLength(1);
      expect(report.body.rows[0]).toMatchObject({
        sales: { lowest: '2160.00' }, procurement: { lowest: '2112.00' }, order: { lineTotal: '2112.00' },
        salesVsProcurement: '48.00', procurementVsOrder: '0.00', salesVsOrder: '48.00', notes: [],
      });
      expect(report.body.total).toMatchObject({ sales: '2160.00', procurement: '2112.00', order: '2112.00', salesVsProcurement: '48.00', salesVsOrder: '48.00', lines: 1, linked: 1 });
    });

    it('filters by project and period, refusing a bad period', async () => {
      const elsewhere = await admin<Report>('GET', `/reports/procurement-savings?from=2020-01-01&to=2020-01-31&projectNumber=${job}`);
      expect(elsewhere.body.rows).toEqual([]);
      expect((await admin<Report>('GET', `/reports/procurement-savings?from=${day}&to=${day}&projectNumber=NO-SUCH`)).body.rows).toEqual([]);
      expect((await admin('GET', `/reports/procurement-savings?from=${day}&to=2020-01-01`)).status).toBe(400);
    });

    it('downloads as Excel', async () => {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/reports/procurement-savings/export?${query}`, { headers: { Authorization: `Bearer ${await login(server.port, ADMIN_EMAIL, requireAdminPassword())}` } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('spreadsheetml');
      expect(res.headers.get('content-disposition')).toContain(`afrinov-procurement-savings-${job}`);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    });

    it('is for those who may see Sales prices, not buyers or the store', async () => {
      for (const role of ['PROCUREMENT', 'STORE_CONTROLLER'] as const) {
        const other = await as(role);
        expect((await other('GET', `/reports/procurement-savings?${query}`)).status, `${role} report`).toBe(403);
        expect((await other('GET', `/reports/procurement-savings/export?${query}`)).status, `${role} download`).toBe(403);
      }
      for (const role of ['SALES', 'DIRECTOR'] as const) {
        expect((await (await as(role))('GET', `/reports/procurement-savings?${query}`)).status, role).toBe(200);
      }
    });
  });

  it('leaves Sales RFQ entries out of the raw audit log for someone who may not see them', async () => {
    const store = await as('STORE_CONTROLLER');
    const seen = await store<Array<{ entityType: string }>>('GET', '/audit?entityType=SalesRfq');
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual([]);
    const admins = await admin<Array<{ entityType: string }>>('GET', '/audit?entityType=SalesRfq');
    expect(admins.body.length).toBeGreaterThan(0);
  });
});
