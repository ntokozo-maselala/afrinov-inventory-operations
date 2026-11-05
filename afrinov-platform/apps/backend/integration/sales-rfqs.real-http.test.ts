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

  it('leaves Sales RFQ entries out of the raw audit log for someone who may not see them', async () => {
    const store = await as('STORE_CONTROLLER');
    const seen = await store<Array<{ entityType: string }>>('GET', '/audit?entityType=SalesRfq');
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual([]);
    const admins = await admin<Array<{ entityType: string }>>('GET', '/audit?entityType=SalesRfq');
    expect(admins.body.length).toBeGreaterThan(0);
  });
});
