// The mock API raises and edits requests for quotation as the server does
// (rfq.service.ts), so frontend-only mode shows the same numbers and Activity.
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockApi, resetMockState } from './mockApi';

const api = createMockApi();

beforeEach(() => resetMockState());

interface Rfq {
  id: string; number: string; status: string; projectNumber: string | null; description: string | null;
  lines: Array<{ lineNo: number; materialId: string; quantity: string; material?: { sku: string } }>;
  suppliers: Array<{ supplierId: string; vatRate: number; totals: unknown; supplier?: { name: string } }>;
}
const raise = (body: Record<string, unknown>) => api.post<Rfq>('/rfqs', body);

describe('mock: requests for quotation', () => {
  it("numbers a project's RFQs as the workbook's documents, and the rest RFQ-0001 onwards", async () => {
    const first = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-1', quantity: 4 }], supplierIds: ['sup-1', 'sup-2', 'sup-1'] });
    expect(first).toMatchObject({ number: 'AFRI-02A-1325-02-01', status: 'DRAFT', description: 'Hydroscand line build Q4' });
    expect(first.lines).toMatchObject([{ lineNo: 1, materialId: 'mat-1', quantity: '4' }]);
    expect(first.suppliers.map((s) => s.supplierId)).toEqual(['sup-1', 'sup-2']);
    expect(first.suppliers[0]).toMatchObject({ vatRate: 15, totals: null, supplier: { name: 'Hydroscand' } });

    expect((await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-2', quantity: 1 }] })).number).toBe('AFRI-02A-1325-02-02');
    expect((await raise({ lines: [{ materialId: 'mat-2', quantity: 1 }] })).number).toBe('RFQ-0001');
  });

  it('refuses project material with no project, an unknown supplier and no lines', async () => {
    await expect(raise({ lines: [{ materialId: 'mat-9', quantity: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(raise({ lines: [{ materialId: 'mat-1', quantity: 1 }], supplierIds: ['sup-nope'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(raise({ lines: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('edits a draft, renumbers it on a new project, and keeps the change on its Activity', async () => {
    const draft = await raise({ lines: [{ materialId: 'mat-1', quantity: 3 }], supplierIds: ['sup-1'] });
    const edited = await api.patch<Rfq>(`/rfqs/${draft.id}`, { projectNumber: 'AFRI-1325', supplierIds: ['sup-3'] });
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
    const line = { materialId: 'mat-1', quantity: 1 };
    await expect(raise({ lines: [{ ...line, quantity: 0.00001 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(raise({ lines: [line], description: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(raise({ lines: Array.from({ length: 201 }, () => line) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await raise({ lines: [{ ...line, quantity: 254.466 }], description: 'x'.repeat(500) })).lines[0]!.quantity).toBe('254.466');
  });

  it('starts the Activity with everything the draft was raised with', async () => {
    const created = await raise({ lines: [{ materialId: 'mat-1', quantity: 2 }], notes: 'Mill certificates required', penaltiesApply: true });
    const [entry] = await api.get<Array<{ after: Record<string, unknown> }>>(`/rfqs/${created.id}/history`);
    expect(entry!.after).toMatchObject({ projectNumber: null, description: null, notes: 'Mill certificates required', penaltiesApply: true });
  });

  it("moves a description that was the project's name with the project", async () => {
    const draft = await raise({ projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-1', quantity: 1 }] });
    expect((await api.patch<Rfq>(`/rfqs/${draft.id}`, { projectNumber: 'AFRI-1402' })).description).toBe('Boiler refurb – Site A');
    expect((await api.patch<Rfq>(`/rfqs/${draft.id}`, { projectNumber: null })).description).toBeNull();
  });

  it('sends a draft with a supplier, closing four days after today, and then moves only its closing date and adds suppliers', async () => {
    const lonely = await raise({ lines: [{ materialId: 'mat-1', quantity: 1 }] });
    await expect(api.post(`/rfqs/${lonely.id}/send`, {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const draft = await raise({ lines: [{ materialId: 'mat-1', quantity: 1 }], supplierIds: ['sup-1'] });
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
    const draft = await raise({ lines: [{ materialId: 'mat-1', quantity: 1 }], supplierIds: ['sup-1'] });
    await api.post(`/rfqs/${draft.id}/send`, {});
    await api.patch('/suppliers/sup-1', { active: false });
    const added = await api.patch<Rfq>(`/rfqs/${draft.id}`, { supplierIds: ['sup-1', 'sup-2'] });
    expect(added.suppliers.map((s) => s.supplierId)).toEqual(['sup-1', 'sup-2']);
    await api.patch('/suppliers/sup-3', { active: false });
    await expect(api.patch(`/rfqs/${draft.id}`, { supplierIds: ['sup-1', 'sup-2', 'sup-3'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a day that does not exist, and names who sent it, as the server does', async () => {
    const draft = await raise({ lines: [{ materialId: 'mat-1', quantity: 1 }], supplierIds: ['sup-1'] });
    await expect(api.post(`/rfqs/${draft.id}/send`, { closingDate: '2099-02-30' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await api.get<Rfq & { sentBy: unknown }>(`/rfqs/${draft.id}`)).sentBy).toBeNull();
    const sent = await api.post<Rfq & { sentBy: { name: string } }>(`/rfqs/${draft.id}/send`, {});
    expect(sent.sentBy).toMatchObject({ name: 'You (admin)' });
    await expect(api.patch(`/rfqs/${draft.id}`, { closingDate: '2099-13-01' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a closing date on a draft, as the server does', async () => {
    const draft = await raise({ lines: [{ materialId: 'mat-1', quantity: 1 }] });
    await expect(api.patch(`/rfqs/${draft.id}`, { closingDate: '2099-01-31' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('cancels a draft or a sent RFQ with a reason, and nothing after that', async () => {
    const draft = await raise({ lines: [{ materialId: 'mat-1', quantity: 1 }], supplierIds: ['sup-1'] });
    await api.post(`/rfqs/${draft.id}/send`, {});
    await expect(api.post(`/rfqs/${draft.id}/cancel`, { reason: ' ' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await api.post<Rfq & { cancellationReason: string }>(`/rfqs/${draft.id}/cancel`, { reason: 'Client postponed' })).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Client postponed' });
    await expect(api.post(`/rfqs/${draft.id}/cancel`, { reason: 'Again' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('answers NOT_FOUND for an unknown RFQ rather than falling through to the order routes', async () => {
    await expect(api.get('/rfqs/rfq-nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
