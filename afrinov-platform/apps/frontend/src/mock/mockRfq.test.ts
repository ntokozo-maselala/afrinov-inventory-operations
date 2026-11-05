// The mock API raises and edits requests for quotation as the server does
// (rfq.service.ts), so frontend-only mode shows the same numbers and Activity.
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockApi, resetMockState } from './mockApi';

const api = createMockApi();

// RFQs are for one project and its material (Stores ordering roadmap): the
// seed's two plates and angles become AFRI-1325's, and AFRI-1402 gets a pipe.
let otherItem: string;
beforeEach(async () => {
  resetMockState();
  for (const id of ['mat-9', 'mat-10']) await api.patch(`/materials/${id}`, { projectNumber: 'AFRI-1325' });
  otherItem = (await api.post<{ id: string }>('/materials', { sku: 'AFRI-1402-PIPE', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', projectNumber: 'AFRI-1402' })).id;
});

interface Rfq {
  id: string; number: string; status: string; projectNumber: string | null; description: string | null;
  lines: Array<{ lineNo: number; materialId: string; quantity: string; material?: { sku: string } }>;
  suppliers: Array<{ supplierId: string; vatRate: number; totals: unknown; supplier?: { name: string } }>;
}
const raise = (body: Record<string, unknown>) => api.post<Rfq>('/rfqs', body);

describe('mock: requests for quotation', () => {
  it("numbers a project's RFQs as the workbook's documents", async () => {
    const first = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 4 }], supplierIds: ['sup-1', 'sup-2', 'sup-1'] });
    expect(first).toMatchObject({ number: 'AFRI-02A-1325-02-01', status: 'DRAFT', description: 'Hydroscand line build Q4' });
    expect(first.lines).toMatchObject([{ lineNo: 1, materialId: 'mat-9', quantity: '4' }]);
    expect(first.suppliers.map((s) => s.supplierId)).toEqual(['sup-1', 'sup-2']);
    expect(first.suppliers[0]).toMatchObject({ vatRate: 15, totals: null, supplier: { name: 'Hydroscand' } });

    expect((await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-10', quantity: 1 }] })).number).toBe('AFRI-02A-1325-02-02');
  });

  it('refuses no project, a Stores item, an unknown supplier and no lines', async () => {
    await expect(raise({ lines: [{ materialId: 'mat-9', quantity: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('is for one project') });
    await expect(raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-1', quantity: 1 }] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('is a Stores item') });
    await expect(raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-nope'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(raise({ projectNumber: 'AFRI-1325', lines: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('edits a draft, renumbers it on a new project, and keeps the change on its Activity', async () => {
    const draft = await raise({ projectNumber: 'AFRI-1402', lines: [{ materialId: otherItem, quantity: 3 }], supplierIds: ['sup-1'] });
    const edited = await api.patch<Rfq>(`/rfqs/${draft.id}`, { projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 3 }], supplierIds: ['sup-3'] });
    expect(edited.number).toBe('AFRI-02A-1325-02-01');
    expect(edited.suppliers.map((s) => s.supplierId)).toEqual(['sup-3']);
    // An unchanged save logs nothing.
    await api.patch(`/rfqs/${draft.id}`, { supplierIds: ['sup-3'] });

    const history = await api.get<Array<{ action: string; actorName: string | null; after: Record<string, unknown> | null }>>(`/rfqs/${draft.id}/history`);
    expect(history.map((e) => e.action)).toEqual(['UPDATE', 'CREATE']);
    expect(history[0]).toMatchObject({ actorName: 'You (admin)', after: { projectNumber: 'AFRI-1325', number: 'AFRI-02A-1325-02-01', supplierIds: ['sup-3'] } });

    const listed = await api.get<Rfq[]>('/rfqs?projectNumber=AFRI-1325');
    expect(listed.map((r) => r.id)).toEqual([draft.id]);
  });

  it('refuses what the server refuses: finer than 4 decimal places, overlong text, too many lines', async () => {
    const line = { materialId: 'mat-9', quantity: 1 };
    await expect(raise({ projectNumber: 'AFRI-1325', lines: [{ ...line, quantity: 0.00001 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(raise({ projectNumber: 'AFRI-1325', lines: [line], description: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(raise({ projectNumber: 'AFRI-1325', lines: Array.from({ length: 201 }, () => line) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await raise({ projectNumber: 'AFRI-1325', lines: [{ ...line, quantity: 254.466 }], description: 'x'.repeat(500) })).lines[0]!.quantity).toBe('254.466');
  });

  it('starts the Activity with everything the draft was raised with', async () => {
    const created = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 2 }], notes: 'Mill certificates required', penaltiesApply: true });
    const [entry] = await api.get<Array<{ after: Record<string, unknown> }>>(`/rfqs/${created.id}/history`);
    expect(entry!.after).toMatchObject({ projectNumber: 'AFRI-1325', description: 'Hydroscand line build Q4', notes: 'Mill certificates required', penaltiesApply: true });
  });

  it("moves a description that was the project's name with the project", async () => {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }] });
    expect((await api.patch<Rfq>(`/rfqs/${draft.id}`, { projectNumber: 'AFRI-1402', lines: [{ materialId: otherItem, quantity: 1 }] })).description).toBe('Boiler refurb – Site A');
    // It stays on a project.
    await expect(api.patch(`/rfqs/${draft.id}`, { projectNumber: null })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('sends a draft with a supplier, closing four days after today, and then moves only its closing date and adds suppliers', async () => {
    const lonely = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }] });
    await expect(api.post(`/rfqs/${lonely.id}/send`, {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-1'] });
    const sent = await api.post<Rfq & { issuedAt: string; closingDate: string; closed: boolean }>(`/rfqs/${draft.id}/send`, {});
    const issued = sent.issuedAt.slice(0, 10);
    const four = new Date(`${issued}T00:00:00Z`);
    four.setUTCDate(four.getUTCDate() + 4);
    expect(sent).toMatchObject({ status: 'SENT', closed: false });
    expect(sent.closingDate.slice(0, 10)).toBe(four.toISOString().slice(0, 10));
    await expect(api.post(`/rfqs/${draft.id}/send`, {})).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await expect(api.patch(`/rfqs/${draft.id}`, { notes: 'Too late' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(api.patch(`/rfqs/${draft.id}`, { supplierIds: ['sup-2'] })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const moved = await api.patch<Rfq & { closingDate: string }>(`/rfqs/${draft.id}`, { closingDate: '2099-01-31', supplierIds: ['sup-1', 'sup-2'] });
    expect(moved.closingDate.slice(0, 10)).toBe('2099-01-31');
    expect(moved.suppliers.map((s) => s.supplierId)).toEqual(['sup-1', 'sup-2']);

    const history = await api.get<Array<{ action: string }>>(`/rfqs/${draft.id}/history`);
    expect(history.map((e) => e.action)).toEqual(['UPDATE', 'RFQ_SEND', 'CREATE']);
  });

  it('adds a supplier to a sent RFQ although one already asked has since been deactivated', async () => {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-1'] });
    await api.post(`/rfqs/${draft.id}/send`, {});
    await api.patch('/suppliers/sup-1', { active: false });
    const added = await api.patch<Rfq>(`/rfqs/${draft.id}`, { supplierIds: ['sup-1', 'sup-2'] });
    expect(added.suppliers.map((s) => s.supplierId)).toEqual(['sup-1', 'sup-2']);
    await api.patch('/suppliers/sup-3', { active: false });
    await expect(api.patch(`/rfqs/${draft.id}`, { supplierIds: ['sup-1', 'sup-2', 'sup-3'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a day that does not exist, and names who sent it, as the server does', async () => {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-1'] });
    await expect(api.post(`/rfqs/${draft.id}/send`, { closingDate: '2099-02-30' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await api.get<Rfq & { sentBy: unknown }>(`/rfqs/${draft.id}`)).sentBy).toBeNull();
    const sent = await api.post<Rfq & { sentBy: { name: string } }>(`/rfqs/${draft.id}/send`, {});
    expect(sent.sentBy).toMatchObject({ name: 'You (admin)' });
    await expect(api.patch(`/rfqs/${draft.id}`, { closingDate: '2099-13-01' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a closing date on a draft, as the server does', async () => {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }] });
    await expect(api.patch(`/rfqs/${draft.id}`, { closingDate: '2099-01-31' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('cancels a draft or a sent RFQ with a reason, and nothing after that', async () => {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-1'] });
    await api.post(`/rfqs/${draft.id}/send`, {});
    await expect(api.post(`/rfqs/${draft.id}/cancel`, { reason: ' ' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await api.post<Rfq & { cancellationReason: string }>(`/rfqs/${draft.id}/cancel`, { reason: 'Client postponed' })).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Client postponed' });
    await expect(api.post(`/rfqs/${draft.id}/cancel`, { reason: 'Again' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('answers NOT_FOUND for an unknown RFQ rather than falling through to the order routes', async () => {
    await expect(api.get('/rfqs/rfq-nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// As the server (Phase 4): quotes, declines and the supplier's own PDF, only while it is sent.
describe('mock: quotes', () => {
  type Quoted = Omit<Rfq, 'lines' | 'suppliers'> & { lines: Array<{ id: string }>; suppliers: Array<{ supplierId: string; declined: boolean; totals: { net: string; unpricedLines: number } | null; quoteFile: { fileName: string; size: number } | null }> };
  async function sent(): Promise<Quoted> {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 4 }, { materialId: 'mat-10', quantity: 2 }], supplierIds: ['sup-1', 'sup-2'] });
    return api.post<Quoted>(`/rfqs/${draft.id}/send`, {});
  }

  it('records a quote with its totals, and refuses one on a draft or with no price', async () => {
    const rfq = await sent();
    const quoted = await api.put<Quoted>(`/rfqs/${rfq.id}/suppliers/sup-1/quote`, { quoteReference: 'Q-1', prices: [{ rfqLineId: rfq.lines[0]!.id, unitPrice: 160 }] });
    // 4 x 160 = 640, plus 15% VAT; the second line not offered.
    expect(quoted.suppliers.find((s) => s.supplierId === 'sup-1')!.totals).toMatchObject({ net: '736.00', unpricedLines: 1 });
    await expect(api.put(`/rfqs/${rfq.id}/suppliers/sup-1/quote`, { prices: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const draft = await api.post<Quoted>('/rfqs', { projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-1'] });
    await expect(api.put(`/rfqs/${draft.id}/suppliers/sup-1/quote`, { prices: [{ rfqLineId: draft.lines[0]!.id, unitPrice: 1 }] })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('records a decline, setting a quote aside', async () => {
    const rfq = await sent();
    await api.put(`/rfqs/${rfq.id}/suppliers/sup-2/quote`, { prices: [{ rfqLineId: rfq.lines[0]!.id, unitPrice: 99 }] });
    const declined = await api.post<Quoted>(`/rfqs/${rfq.id}/suppliers/sup-2/decline`, { notes: 'No stock' });
    expect(declined.suppliers.find((s) => s.supplierId === 'sup-2')).toMatchObject({ declined: true, totals: null });
    const history = await api.get<Array<{ action: string }>>(`/rfqs/${rfq.id}/history`);
    expect(history.slice(0, 2).map((e) => e.action)).toEqual(['RFQ_DECLINED', 'RFQ_QUOTE']);
  });

  it('refuses what the server refuses: overlong text, over 200 prices, a price too fine to keep, a quote expired before it came', async () => {
    const rfq = await sent();
    const line = rfq.lines[0]!.id;
    const put = (body: Record<string, unknown>) => api.put(`/rfqs/${rfq.id}/suppliers/sup-1/quote`, { prices: [{ rfqLineId: line, unitPrice: 1 }], ...body });
    await expect(put({ quoteReference: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(put({ prices: Array.from({ length: 201 }, () => ({ rfqLineId: line, unitPrice: 1 })) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(put({ prices: [{ rfqLineId: line, unitPrice: 0.000000001 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(put({ validUntil: '2020-01-01' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.post(`/rfqs/${rfq.id}/suppliers/sup-1/decline`, { notes: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('keeps a quotation under a .pdf name whatever it was called', async () => {
    const { mockPutQuoteFile } = await import('./mockApi');
    const rfq = await sent();
    const saved = await mockPutQuoteFile(rfq.id, 'sup-1', 'quote.html', new TextEncoder().encode('%PDF-<script>')) as Quoted;
    expect(saved.suppliers.find((s) => s.supplierId === 'sup-1')!.quoteFile?.fileName).toBe('quote.pdf');
  });

  it("keeps the supplier's PDF, gives it back, refuses one that isn't a PDF, and takes it off", async () => {
    const { mockPutQuoteFile, mockGetQuoteFile } = await import('./mockApi');
    const rfq = await sent();
    const pdf = new TextEncoder().encode('%PDF-1.4 quote');
    await expect(mockPutQuoteFile(rfq.id, 'sup-1', 'quote.txt', new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const saved = await mockPutQuoteFile(rfq.id, 'sup-1', 'EMV quote.pdf', pdf) as Quoted;
    expect(saved.suppliers.find((s) => s.supplierId === 'sup-1')!.quoteFile).toEqual(expect.objectContaining({ fileName: 'EMV quote.pdf', size: pdf.length }));
    // The detail carries the name and size, never the contents.
    expect(JSON.stringify(await api.get(`/rfqs/${rfq.id}`))).not.toContain('"data"');
    expect(mockGetQuoteFile(rfq.id, 'sup-1').data).toEqual(pdf);
    await api.del(`/rfqs/${rfq.id}/suppliers/sup-1/quote-file`);
    expect(() => mockGetQuoteFile(rfq.id, 'sup-1')).toThrow();
  });
});

// As the server (Phase 5): the award raises a draft order at the quoted prices, linked both ways.
describe('mock: award', () => {
  type Awarded = Omit<Rfq, 'lines' | 'status'> & { status: string; lines: Array<{ id: string }>; purchaseOrder: { id: string; number: string; supplierId: string } | null };
  async function quoted(): Promise<Awarded> {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 4 }, { materialId: 'mat-10', quantity: 2 }], supplierIds: ['sup-1', 'sup-2'] });
    const rfq = await api.post<Awarded>(`/rfqs/${draft.id}/send`, {});
    const [l1, l2] = rfq.lines;
    await api.put(`/rfqs/${rfq.id}/suppliers/sup-1/quote`, { quoteReference: 'H-1', prices: [{ rfqLineId: l1!.id, unitPrice: 150 }, { rfqLineId: l2!.id, unitPrice: 20 }] });
    await api.put(`/rfqs/${rfq.id}/suppliers/sup-2/quote`, { prices: [{ rfqLineId: l1!.id, unitPrice: 160 }, { rfqLineId: l2!.id, unitPrice: 20 }] });
    return rfq;
  }

  it('raises a draft order for the clear choice at its prices, named on both sides', async () => {
    const rfq = await quoted();
    const awarded = await api.post<Awarded>(`/rfqs/${rfq.id}/award`, { supplierId: 'sup-1' });
    expect(awarded).toMatchObject({ status: 'AWARDED', purchaseOrder: { supplierId: 'sup-1' } });
    const order = await api.get<{ status: string; notes: string; rfq: { number: string }; lines: Array<{ unitPrice: string }> }>(`/purchase-orders/${awarded.purchaseOrder!.id}`);
    expect(order).toMatchObject({ status: 'DRAFT', rfq: { number: rfq.number }, notes: `As per your quotation H-1 for ${rfq.number}.` });
    expect(order.lines.map((l) => Number(l.unitPrice))).toEqual([150, 20]);
    const orderHistory = await api.get<Array<{ after: Record<string, unknown> }>>(`/purchase-orders/${awarded.purchaseOrder!.id}/history`);
    expect(orderHistory.at(-1)!.after).toMatchObject({ rfqNumber: rfq.number });
    await expect(api.post(`/rfqs/${rfq.id}/award`, { supplierId: 'sup-1' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('asks why for a dearer quote, and refuses a supplier who has not quoted', async () => {
    const rfq = await quoted();
    await expect(api.post(`/rfqs/${rfq.id}/award`, { supplierId: 'sup-2' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { concerns: [expect.stringContaining('quoted less')] } });
    expect((await api.post<Awarded>(`/rfqs/${rfq.id}/award`, { supplierId: 'sup-2', reason: 'Faster delivery' })).status).toBe('AWARDED');

    const other = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-3'] });
    await api.post(`/rfqs/${other.id}/send`, {});
    await expect(api.post(`/rfqs/${other.id}/award`, { supplierId: 'sup-3' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('mock: quote currency', () => {
  it('works out VAT at the currency a quote was given in, not the one the supplier moved to', async () => {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-1'] });
    const rfq = await api.post<Rfq & { lines: Array<{ id: string }> }>(`/rfqs/${draft.id}/send`, {});
    await api.put(`/rfqs/${rfq.id}/suppliers/sup-1/quote`, { prices: [{ rfqLineId: rfq.lines[0]!.id, unitPrice: 100 }] });
    await api.patch('/suppliers/sup-1', { currency: 'EUR' });
    const after = await api.get<{ suppliers: Array<{ supplierId: string; totals: { vat: string } | null }> }>(`/rfqs/${rfq.id}`);
    // Quoted in rand, so still with 15% VAT.
    expect(after.suppliers.find((s) => s.supplierId === 'sup-1')!.totals!.vat).toBe('15.00');
  });
});

describe('mock: award currency', () => {
  it("won't award a quote given in another currency than the supplier trades in now", async () => {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }], supplierIds: ['sup-1'] });
    const rfq = await api.post<Rfq & { lines: Array<{ id: string }> }>(`/rfqs/${draft.id}/send`, {});
    await api.put(`/rfqs/${rfq.id}/suppliers/sup-1/quote`, { prices: [{ rfqLineId: rfq.lines[0]!.id, unitPrice: 10 }] });
    await api.patch('/suppliers/sup-1', { currency: 'EUR' });
    await expect(api.post(`/rfqs/${rfq.id}/award`, { supplierId: 'sup-1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('quoted in ZAR but now trades in EUR') });
  });
});

// The savings report, as procurement-savings.service.ts.
describe('mock: Procurement savings report', () => {
  type Row = { sales: { lowest: string | null; cancelled: boolean } | null; procurement: { lowest: string | null }; order: { lineTotal: string | null; discount: string | null } | null; salesVsProcurement: string | null; procurementVsOrder: string | null; salesVsOrder: string | null; notes: string[] };
  type Report = { rows: Row[]; total: Record<string, string | number> };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
  const report = (query = `from=${today}&to=${today}`) => api.get<Report>(`/reports/procurement-savings?${query}`);

  const sentSales = async (quantity = 24) => {
    const s = await api.post<{ id: string; lines: Array<{ id: string }> }>('/sales-rfqs', { projectNumber: 'AFRI-1325', lines: [{ description: 'Plate', unitOfMeasure: 'kg', quantity }], supplierIds: ['sup-1', 'sup-2'] });
    await api.post(`/sales-rfqs/${s.id}/send`, {});
    const line = s.lines[0]!.id;
    await api.put(`/sales-rfqs/${s.id}/suppliers/sup-1/quote`, { prices: [{ rfqLineId: line, unitPrice: 100 }] });
    await api.put(`/sales-rfqs/${s.id}/suppliers/sup-2/quote`, { prices: [{ rfqLineId: line, unitPrice: 90 }] });
    return { id: s.id, line };
  };
  const quotedRfq = async (quantity = 24, materialId = 'mat-9') => {
    const r = await api.post<{ id: string; lines: Array<{ id: string }> }>('/rfqs', { projectNumber: 'AFRI-1325', lines: [{ materialId, quantity }], supplierIds: ['sup-1', 'sup-2'] });
    await api.post(`/rfqs/${r.id}/send`, {});
    const line = r.lines[0]!.id;
    await api.put(`/rfqs/${r.id}/suppliers/sup-1/quote`, { prices: [{ rfqLineId: line, unitPrice: 95 }] });
    await api.put(`/rfqs/${r.id}/suppliers/sup-2/quote`, { prices: [{ rfqLineId: line, unitPrice: 88 }] });
    return { id: r.id, line };
  };
  const unitOf = async (materialId: string) => (await api.get<{ unitOfMeasure: string }>(`/materials/${materialId}`)).unitOfMeasure;

  beforeEach(async () => {
    // The Sales lines are in kg, so the items they are compared with need to be too.
    for (const id of ['mat-9', 'mat-10']) await api.patch(`/materials/${id}`, { unitOfMeasure: 'kg' });
  });

  it('compares the lowest on each side with the order, once linked and awarded', async () => {
    expect(await unitOf('mat-9')).toBe('kg');
    const sales = await sentSales();
    const r = await quotedRfq();
    expect((await report()).rows[0]).toMatchObject({ sales: null, salesVsProcurement: null, notes: ['Not linked to a Sales line', 'Not awarded yet, so there is no order to compare'] });
    await api.put(`/rfqs/${r.id}/lines/${r.line}/sales-line`, { salesRfqLineId: sales.line });
    await api.post(`/rfqs/${r.id}/award`, { supplierId: 'sup-2' });
    const { rows, total } = await report();
    expect(rows[0]).toMatchObject({
      sales: { lowest: '2160.00' }, procurement: { lowest: '2112.00' }, order: { lineTotal: '2112.00' },
      salesVsProcurement: '48.00', procurementVsOrder: '0.00', salesVsOrder: '48.00', notes: [],
    });
    expect(total).toMatchObject({ sales: '2160.00', procurement: '2112.00', order: '2112.00', salesVsOrder: '48.00', lines: 1, linked: 1 });
  });

  it('leaves out a quantity that differs and a cancelled Sales RFQ, saying why', async () => {
    const sales = await sentSales();
    const r = await quotedRfq(20);
    await api.put(`/rfqs/${r.id}/lines/${r.line}/sales-line`, { salesRfqLineId: sales.line });
    const differs = await report();
    expect(differs.rows[0]!.salesVsProcurement).toBeNull();
    expect(differs.rows[0]!.notes[0]).toMatch(/Sales asked for 24 kg.*come to 20 kg/);
    expect(differs.total).toMatchObject({ sales: '0.00' });
    await api.post(`/sales-rfqs/${sales.id}/cancel`, { reason: 'Lost the job' });
    const gone = await report();
    expect(gone.rows[0]!.sales).toMatchObject({ cancelled: true });
    expect(gone.rows[0]!.notes[0]).toMatch(/was cancelled/);
  });

  it('adds up lines sharing a Sales line, comparing them once', async () => {
    const sales = await sentSales();
    const a = await quotedRfq(20);
    const b = await quotedRfq(4, 'mat-10');
    for (const r of [a, b]) await api.put(`/rfqs/${r.id}/lines/${r.line}/sales-line`, { salesRfqLineId: sales.line });
    const { rows, total } = await report();
    // Sales 2160 against 20 x 88 + 4 x 88.
    expect(rows.map((x) => x.salesVsProcurement)).toEqual(['48.00', null]);
    expect(rows[1]!.notes[0]).toMatch(/on the first of them/);
    expect(total).toMatchObject({ sales: '2160.00', procurement: '2112.00', salesVsProcurement: '48.00', linked: 2 });
  });

  it('filters by project and period, leaves out drafts, and refuses a backward period', async () => {
    await quotedRfq();
    await api.post('/rfqs', { projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 1 }] });
    expect((await report()).rows).toHaveLength(1);
    expect((await report(`from=${today}&to=${today}&projectNumber=AFRI-1402`)).rows).toEqual([]);
    expect((await report('from=2020-01-01&to=2020-01-31')).rows).toEqual([]);
    await expect(report('from=2020-02-01&to=2020-01-01')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// A buyer matching lines to what Sales asked for, as rfq.service.ts.
describe('mock: linking a line to its Sales line', () => {
  type Linked = { id: string; materialId: string; salesRfqLine: { id: string; description: string; rfq: { number: string; status: string } } | null };
  type LinkRfq = { id: string; lines: Linked[] };
  const asked = [{ description: '200NB pipes x 3m', unitOfMeasure: 'each', quantity: 24 }];
  const sentSales = async (projectNumber = 'AFRI-1325') => {
    const s = await api.post<{ id: string; lines: Array<{ id: string }> }>('/sales-rfqs', { projectNumber, lines: asked, supplierIds: ['sup-1'] });
    await api.post(`/sales-rfqs/${s.id}/send`, {});
    return s;
  };
  const buy = () => api.post<LinkRfq>('/rfqs', { projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 24 }, { materialId: 'mat-10', quantity: 1 }] });
  const link = (r: LinkRfq, i: number, salesRfqLineId: string | null) => api.put<LinkRfq>(`/rfqs/${r.id}/lines/${r.lines[i]!.id}/sales-line`, { salesRfqLineId });

  it('offers only sent lines of the same project, without prices or suppliers', async () => {
    const sales = await sentSales();
    const elsewhere = await sentSales('AFRI-1402');
    const draft = await api.post<{ lines: Array<{ id: string }> }>('/sales-rfqs', { projectNumber: 'AFRI-1325', lines: asked });
    const r = await buy();
    const offered = await api.get<Array<{ id: string }>>(`/rfqs/${r.id}/sales-lines`);
    expect(offered.map((l) => l.id)).toEqual([sales.lines[0]!.id]);
    expect(JSON.stringify(offered)).not.toMatch(/price|supplier/i);
    await expect(link(r, 0, elsewhere.lines[0]!.id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(link(r, 0, draft.lines[0]!.id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('links, shares, unlinks and records each, and stops once cancelled', async () => {
    const sales = await sentSales();
    const r = await buy();
    const id = sales.lines[0]!.id;
    expect((await link(r, 0, id)).lines[0]!.salesRfqLine).toMatchObject({ description: '200NB pipes x 3m', rfq: { status: 'SENT' } });
    expect((await link(r, 1, id)).lines.map((l) => l.salesRfqLine?.id)).toEqual([id, id]);
    expect((await link(r, 1, null)).lines[1]!.salesRfqLine).toBeNull();
    const history = await api.get<Array<{ action: string }>>(`/rfqs/${r.id}/history`);
    expect(history.filter((e) => e.action === 'RFQ_SALES_LINK')).toHaveLength(3);
    await api.post(`/rfqs/${r.id}/cancel`, { reason: 'Not needed' });
    await expect(link(r, 0, null)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it("follows the item through a draft's edit, and clears when it moves project", async () => {
    const sales = await sentSales();
    const r = await buy();
    await link(r, 0, sales.lines[0]!.id);
    const edited = await api.patch<LinkRfq>(`/rfqs/${r.id}`, { lines: [{ materialId: 'mat-10', quantity: 2 }, { materialId: 'mat-9', quantity: 30 }] });
    expect(edited.lines.map((l) => [l.materialId, l.salesRfqLine?.id ?? null])).toEqual([['mat-10', null], ['mat-9', sales.lines[0]!.id]]);
    const moved = await api.patch<LinkRfq>(`/rfqs/${r.id}`, { projectNumber: 'AFRI-1402', lines: [{ materialId: otherItem, quantity: 1 }] });
    expect(moved.lines.every((l) => l.salesRfqLine === null)).toBe(true);
  });
});

// Sales RFQs: typed lines, numbered apart from Procurement's, and nothing to award.
describe('mock: Sales requests for quotation', () => {
  type SalesRfq = { id: string; number: string; status: string; lines: Array<{ id: string; description: string }>; suppliers: Array<{ supplierId: string; declined: boolean; totals: { subtotal: string } | null; quoteFile?: unknown }> };
  const lines = [{ description: '200NB pipes x 3m', unitOfMeasure: 'each', quantity: 24 }];
  const raiseSales = (body: Record<string, unknown> = {}) => api.post<SalesRfq>('/sales-rfqs', { projectNumber: 'AFRI-1325', lines, supplierIds: ['sup-1', 'sup-2'], ...body });

  it('numbers apart from Procurement, and keeps the typed lines', async () => {
    await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', quantity: 4 }] });
    const first = await raiseSales();
    expect(first).toMatchObject({ number: 'AFRI-02A-1325-02-01', status: 'DRAFT' });
    expect(first.lines).toMatchObject([{ lineNo: 1, description: '200NB pipes x 3m', unitOfMeasure: 'each', quantity: '24' }]);
    expect((await raiseSales()).number).toBe('AFRI-02A-1325-02-02');
  });

  it('sends, records a quote and a decline, and cancels', async () => {
    const draft = await raiseSales();
    const base = `/sales-rfqs/${draft.id}`;
    await expect(api.put(`${base}/suppliers/sup-1/quote`, { prices: [{ rfqLineId: draft.lines[0]!.id, unitPrice: 100 }] })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await api.post<SalesRfq>(`${base}/send`, {})).status).toBe('SENT');
    const quoted = await api.put<SalesRfq>(`${base}/suppliers/sup-1/quote`, { prices: [{ rfqLineId: draft.lines[0]!.id, unitPrice: 100 }] });
    expect(quoted.suppliers[0]!.totals).toMatchObject({ subtotal: '2400.00' });
    const declined = await api.post<SalesRfq>(`${base}/suppliers/sup-2/decline`, { notes: 'No stock' });
    expect(declined.suppliers[1]).toMatchObject({ declined: true, totals: null });
    expect((await api.post<SalesRfq>(`${base}/cancel`, { reason: 'Client went elsewhere' })).status).toBe('CANCELLED');
    await expect(api.get(`${base}/history`)).resolves.toHaveLength(5);
  });

  it('refuses a unit not on the list and part of a counted unit, as the server does (Qodo, PR #158)', async () => {
    await expect(raiseSales({ lines: [{ description: 'Bend', unitOfMeasure: 'furlong', quantity: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('not a unit on the list') });
    await expect(raiseSales({ lines: [{ description: 'Bend', unitOfMeasure: 'each', quantity: 1.5 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('whole numbers') });
    const measured = await raiseSales({ lines: [{ description: 'Plate', unitOfMeasure: 'KG', quantity: 12.5 }] });
    expect(measured.lines).toMatchObject([{ unitOfMeasure: 'kg', quantity: '12.5' }]);
  });

  it('checks the suppliers and the closing date again when sending, as the server does (Qodo, PR #158)', async () => {
    const draft = await raiseSales({ supplierIds: ['sup-3'] });
    const base = `/sales-rfqs/${draft.id}`;
    await expect(api.post(`${base}/send`, { closingDate: '2020-01-01' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining("can't be before") });
    await expect(api.post(`${base}/send`, { closingDate: '2099-02-30' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await api.patch('/suppliers/sup-3', { active: false });
    await expect(api.post(`${base}/send`, {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('is inactive') });
    await api.patch('/suppliers/sup-3', { active: true });
    expect((await api.post<SalesRfq>(`${base}/send`, {})).status).toBe('SENT');
    await expect(api.patch(base, { closingDate: '2020-01-01' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a send once the project has closed, as the server does (Qodo, PR #158)', async () => {
    const draft = await raiseSales();
    await api.patch('/projects/AFRI-1325', { status: 'COMPLETED' });
    await expect(api.post(`/sales-rfqs/${draft.id}/send`, {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('completed') });
  });

  it("takes prices only for this RFQ's lines, kept to what the server holds (Qodo, PR #158)", async () => {
    const other = await raiseSales();
    const draft = await raiseSales();
    const base = `/sales-rfqs/${draft.id}`;
    await api.post(`${base}/send`, {});
    const line = draft.lines[0]!.id;
    const quote = (body: Record<string, unknown>) => api.put<SalesRfq>(`${base}/suppliers/sup-1/quote`, body);
    await expect(quote({ prices: [{ rfqLineId: other.lines[0]!.id, unitPrice: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('is not on') });
    await expect(quote({ prices: [{ rfqLineId: line, unitPrice: -1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(quote({ prices: [{ rfqLineId: line, unitPrice: 1.00001 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(quote({ quotedAt: '2099-01-01', prices: [{ rfqLineId: line, unitPrice: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(quote({ validUntil: '2020-01-01', prices: [{ rfqLineId: line, unitPrice: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const twice = await quote({ prices: [{ rfqLineId: line, unitPrice: 1 }, { rfqLineId: line, unitPrice: 2 }] });
    expect(twice.suppliers[0]!.totals).toMatchObject({ subtotal: '48.00' });
  });

  it('refuses a line with no description, and an RFQ it does not have', async () => {
    await expect(raiseSales({ lines: [{ description: ' ', unitOfMeasure: 'each', quantity: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.get('/sales-rfqs/nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
