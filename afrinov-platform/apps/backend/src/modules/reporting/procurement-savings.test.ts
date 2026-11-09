// The savings report's figures: lowest on each side, line totals, what is left
// out and why, and lines sharing a Sales line counted once.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { MAX_SAVINGS_LINES, ProcurementSavingsService, buildSavingsReport, type SavingsRfq } from './procurement-savings.service.js';
import { buildSavingsXlsx, savingsFilename } from './procurement-savings-export.js';
import { buildSavingsPdf } from './procurement-savings-pdf.js';

const { count, findMany } = vi.hoisted(() => ({ count: vi.fn(), findMany: vi.fn() }));
vi.mock('../../shared/db.js', () => ({ prisma: { rfqLine: { count }, rfq: { findMany } } }));

const D = (v: number) => new Prisma.Decimal(v);
const quote = (supplier: string, unitPrice: number, over: Record<string, unknown> = {}) => ({
  unitPrice: D(unitPrice),
  rfqSupplier: { supplierId: supplier, currency: 'ZAR', declined: false, quotedAt: new Date('2026-11-01'), supplier: { name: supplier, currency: 'ZAR' }, ...over },
});
const salesLine = (over: Record<string, unknown> = {}) => ({
  id: 'sl-1', lineNo: 1, description: '200NB pipes x 3m', unitOfMeasure: 'each', quantity: D(24),
  rfq: { number: 'AFRI-02A-1404-02-01', status: 'SENT' }, prices: [quote('Local Steel', 100), quote('Fasteners', 90)], ...over,
});
const line = (over: Record<string, unknown> = {}) => ({
  id: 'l-1', lineNo: 1, materialId: 'm-1', quantity: D(24), salesRfqLineId: 'sl-1', salesRfqLine: salesLine(),
  material: { sku: 'PIPE', name: 'Pipe', unitOfMeasure: 'each' }, prices: [quote('EMV', 95), quote('Macsteel', 88)], ...over,
});
const orderLine = (over: Record<string, unknown> = {}) => ({ id: 'o-1', materialId: 'm-1', orderedQty: D(24), unitPrice: D(88), discountPercent: D(0), ...over });
const order = (lines: unknown[] = [orderLine()], over: Record<string, unknown> = {}) => ({ number: 'PO-1', status: 'APPROVED', currency: 'ZAR', supplierId: 'Macsteel', supplier: { name: 'Macsteel' }, lines, ...over });
const rfq = (lines: unknown[], over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'AFRI-02A-1404-02-02', status: 'AWARDED', projectNumber: 'AFRI-1404', project: { name: 'Pipe spools' }, purchaseOrder: order(), lines, ...over,
}) as unknown as SavingsRfq;
const range = { from: '2026-11-01', to: '2026-11-30' };
const build = (rfqs: SavingsRfq[], others: SavingsRfq[] = []) => buildSavingsReport(rfqs, others, range);

describe('Procurement savings report', () => {
  it('lists every price by supplier, and compares line totals at the lowest on each side', () => {
    const r = build([rfq([line()])]);
    const row = r.rows[0]!;
    expect(row.sales!.prices).toEqual([
      { supplier: 'Fasteners', currency: 'ZAR', unitPrice: '90', lineTotal: '2160.00' },
      { supplier: 'Local Steel', currency: 'ZAR', unitPrice: '100', lineTotal: '2400.00' },
    ]);
    expect(row.sales!.lowest).toBe('2160.00');
    expect(row.procurement.lowest).toBe('2112.00');
    expect(row.order).toMatchObject({ number: 'PO-1', supplier: 'Macsteel', lineTotal: '2112.00' });
    expect(row).toMatchObject({ salesVsProcurement: '48.00', procurementVsOrder: '0.00', salesVsOrder: '48.00', notes: [] });
    expect(r.total).toMatchObject({ sales: '2160.00', procurement: '2112.00', order: '2112.00', salesVsProcurement: '48.00', procurementVsOrder: '0.00', salesVsOrder: '48.00', lines: 1, linked: 1 });
  });

  it('shows a negative difference when the order did not go to the cheapest', () => {
    const r = build([rfq([line()], { purchaseOrder: order([orderLine({ unitPrice: D(95) })], { supplier: { name: 'EMV' } }) })]);
    expect(r.rows[0]).toMatchObject({ procurementVsOrder: '-168.00', salesVsOrder: '-120.00' });
    expect(r.total.procurementVsOrder).toBe('-168.00');
  });

  it('takes the order before its line discount, and shows the discount on its own', () => {
    const r = build([rfq([line()], { purchaseOrder: order([orderLine({ discountPercent: D(10) })]) })]);
    expect(r.rows[0]!.order).toMatchObject({ lineTotal: '2112.00', discountPercent: '10', discount: '211.20' });
    expect(r.rows[0]!.procurementVsOrder).toBe('0.00');
    expect(r.total.discount).toBe('211.20');
  });

  it('leaves out declined quotes and those not yet recorded', () => {
    const r = build([rfq([line({ prices: [quote('EMV', 95), quote('Cheap', 1, { declined: true }), quote('Late', 2, { quotedAt: null })] })])]);
    expect(r.rows[0]!.procurement.prices.map((p) => p.supplier)).toEqual(['EMV']);
    expect(r.rows[0]!.procurement.lowest).toBe('2280.00');
  });

  it('keeps an unlinked line, with its Procurement and order figures but no Sales comparison', () => {
    const r = build([rfq([line({ salesRfqLineId: null, salesRfqLine: null })])]);
    expect(r.rows[0]).toMatchObject({ sales: null, salesVsProcurement: null, salesVsOrder: null, procurementVsOrder: '0.00' });
    expect(r.rows[0]!.notes).toEqual(['Not linked to a Sales line']);
    expect(r.total).toMatchObject({ sales: '0.00', procurement: '2112.00', linked: 0, lines: 1 });
  });

  it('notes a quantity or unit that differs from Sales, leaving it blank and out of the totals', () => {
    const other = build([rfq([line({ quantity: D(20) })], { purchaseOrder: null, status: 'SENT' })]);
    expect(other.rows[0]).toMatchObject({ salesVsProcurement: null, salesVsOrder: null });
    expect(other.rows[0]!.notes[0]).toMatch(/Sales asked for 24 each.*come to 20 each/);
    expect(other.total).toMatchObject({ sales: '0.00', salesVsProcurement: '0.00' });

    const unit = build([rfq([line({ material: { sku: 'PIPE', name: 'Pipe', unitOfMeasure: 'm' } })])]);
    expect(unit.rows[0]!.salesVsProcurement).toBeNull();
    expect(unit.rows[0]!.notes[0]).toMatch(/a different unit/);
  });

  it('leaves a cancelled Sales RFQ out of the comparison, keeping the link in view', () => {
    const r = build([rfq([line({ salesRfqLine: salesLine({ rfq: { number: 'S-1', status: 'CANCELLED' } }) })])]);
    expect(r.rows[0]!.sales).toMatchObject({ cancelled: true, lowest: '2160.00' });
    expect(r.rows[0]).toMatchObject({ salesVsProcurement: null, salesVsOrder: null, procurementVsOrder: '0.00' });
    expect(r.rows[0]!.notes[0]).toMatch(/S-1 was cancelled/);
    expect(r.total).toMatchObject({ sales: '0.00', linked: 1 });
  });

  it('compares only rand: other currencies are listed but not the lowest, or noted when they are all there is', () => {
    const mixed = build([rfq([line({ prices: [quote('Hydac', 1, { currency: 'EUR' }), quote('EMV', 95)] })])]);
    expect(mixed.rows[0]!.procurement.prices.map((p) => p.currency)).toEqual(['ZAR', 'EUR']);
    expect(mixed.rows[0]!.procurement.lowest).toBe('2280.00');

    const foreign = build([rfq([line({ prices: [quote('Hydac', 1, { currency: 'EUR' })] })], { purchaseOrder: order([orderLine()], { currency: 'EUR' }) })]);
    expect(foreign.rows[0]).toMatchObject({ salesVsProcurement: null, procurementVsOrder: null, salesVsOrder: null });
    expect(foreign.rows[0]!.notes).toEqual(expect.arrayContaining([expect.stringMatching(/Procurement quotes are not in rand/), expect.stringMatching(/PO-1 is in EUR/)]));
    expect(foreign.total).toMatchObject({ procurement: '0.00', order: '0.00', discount: '0.00' });
  });

  it('adds up lines sharing a Sales line, comparing them once, on the first', () => {
    const a = line({ quantity: D(20), prices: [quote('EMV', 80)] });
    const b = line({ id: 'l-2', lineNo: 2, materialId: 'm-2', quantity: D(4), prices: [quote('EMV', 100)] });
    const r = build([rfq([a, b], { purchaseOrder: order([orderLine({ orderedQty: D(20), unitPrice: D(80) }), orderLine({ id: 'o-2', materialId: 'm-2', orderedQty: D(4), unitPrice: D(100) })]) })]);
    // Sales 2160 against 1600 + 400.
    expect(r.rows[0]).toMatchObject({ salesVsProcurement: '160.00', salesVsOrder: '160.00' });
    expect(r.rows[1]).toMatchObject({ salesVsProcurement: null, salesVsOrder: null });
    expect(r.rows[1]!.notes[0]).toMatch(/on the first of them/);
    // What Sales was set against, on the row that shows the comparison only.
    expect(r.rows[0]!.comparedWith).toEqual({ lines: 2, quantity: '24', unitOfMeasure: r.rows[0]!.sales!.unitOfMeasure, procurement: '2000.00', order: '2000.00' });
    expect(r.rows[1]!.comparedWith).toBeNull();
    expect(r.total).toMatchObject({ sales: '2160.00', procurement: '2000.00', salesVsProcurement: '160.00', salesVsOrder: '160.00', linked: 2 });
  });

  it('does not say lines sharing a Sales line are compared together when they are not', () => {
    const a = line({ quantity: D(20), prices: [quote('EMV', 80)] });
    const b = line({ id: 'l-2', lineNo: 2, materialId: 'm-2', quantity: D(10), prices: [quote('EMV', 100)] });
    const r = build([rfq([a, b])]);
    for (const row of r.rows) {
      expect(row.salesVsProcurement).toBeNull();
      expect(row.notes).toContain('Shares its Sales line with 1 other line');
      expect(row.notes.join(' ')).not.toMatch(/compared together/);
      expect(row.comparedWith).toBeNull();
    }
  });

  it('counts a line sharing the Sales line on an RFQ outside the selection', () => {
    const a = line({ quantity: D(20), prices: [quote('EMV', 80)] });
    const elsewhere = rfq([line({ id: 'l-9', quantity: D(4), prices: [quote('EMV', 100)] })], { id: 'r-9', status: 'SENT', purchaseOrder: null });
    const r = build([rfq([a], { status: 'SENT', purchaseOrder: null })], [elsewhere]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ salesVsProcurement: '160.00' });
    // Its other line has no order yet, so Sales against the order waits for it.
    expect(r.rows[0]!.salesVsOrder).toBeNull();
  });

  it('notes an order that was cancelled, a line taken off it, and a quantity changed on it', () => {
    const gone = build([rfq([line()], { purchaseOrder: order([orderLine()], { status: 'CANCELLED' }) })]);
    expect(gone.rows[0]).toMatchObject({ order: null, procurementVsOrder: null });
    expect(gone.rows[0]!.notes).toEqual(['Order PO-1 was cancelled']);
    const off = build([rfq([line()], { purchaseOrder: order([]) })]);
    expect(off.rows[0]!.notes).toEqual(['Not on order PO-1']);
    const changed = build([rfq([line()], { purchaseOrder: order([orderLine({ orderedQty: D(30) })]) })]);
    expect(changed.rows[0]).toMatchObject({ procurementVsOrder: null, salesVsOrder: null });
    expect(changed.rows[0]!.notes[0]).toMatch(/PO-1 is for 30, the RFQ for 24/);
  });

  it('pairs the same item twice on an order by its quantity', () => {
    const a = line({ salesRfqLineId: null, salesRfqLine: null, quantity: D(2), prices: [quote('EMV', 10)] });
    const b = line({ id: 'l-2', lineNo: 2, salesRfqLineId: null, salesRfqLine: null, quantity: D(5), prices: [quote('EMV', 10)] });
    const r = build([rfq([a, b], { purchaseOrder: order([orderLine({ id: 'o-1', orderedQty: D(5), unitPrice: D(10) }), orderLine({ id: 'o-2', orderedQty: D(2), unitPrice: D(10) })]) })]);
    expect(r.rows.map((x) => x.order?.quantity)).toEqual(['2', '5']);
    expect(r.rows.map((x) => x.procurementVsOrder)).toEqual(['0.00', '0.00']);
  });

  it('pairs the same item at the same quantity by the price quoted for each line (Qodo, PR #159)', () => {
    const a = line({ salesRfqLineId: null, salesRfqLine: null, prices: [quote('Macsteel', 10)] });
    const b = line({ id: 'l-2', lineNo: 2, salesRfqLineId: null, salesRfqLine: null, prices: [quote('Macsteel', 20)] });
    // The order's lines come back in no particular order.
    const r = build([rfq([a, b], { purchaseOrder: order([orderLine({ id: 'o-1', unitPrice: D(20) }), orderLine({ id: 'o-2', unitPrice: D(10) })]) })]);
    expect(r.rows.map((x) => x.order?.unitPrice)).toEqual(['10', '20']);
    expect(r.rows.map((x) => x.procurementVsOrder)).toEqual(['0.00', '0.00']);
  });

  it('says why the order columns are blank on an RFQ not yet awarded (Qodo, PR #159)', () => {
    const r = build([rfq([line()], { status: 'SENT', purchaseOrder: null })]);
    expect(r.rows[0]).toMatchObject({ salesVsProcurement: '48.00', procurementVsOrder: null, salesVsOrder: null });
    expect(r.rows[0]!.notes).toEqual(['Not awarded yet, so there is no order to compare']);
  });

  it('adds up discounts over the same lines as the order total (Qodo, PR #159)', () => {
    const r = build([rfq([line()], { purchaseOrder: order([orderLine({ orderedQty: D(30), discountPercent: D(10) })]) })]);
    expect(r.rows[0]!.order).toMatchObject({ discount: '264.00' });
    expect(r.total).toMatchObject({ order: '0.00', discount: '0.00' });
  });

  describe('how much it loads (Qodo, PR #159)', () => {
    beforeEach(() => {
      count.mockReset();
      findMany.mockReset().mockResolvedValue([]);
    });

    it('refuses a selection over the limit, without loading it', async () => {
      count.mockResolvedValue(MAX_SAVINGS_LINES + 1);
      await expect(ProcurementSavingsService.report({ from: '2026-01-01', to: '2026-12-31' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('shorter period') });
      expect(findMany).not.toHaveBeenCalled();
    });

    it('loads one at the limit', async () => {
      count.mockResolvedValue(MAX_SAVINGS_LINES);
      await expect(ProcurementSavingsService.report({ from: '2026-01-01', to: '2026-12-31' })).resolves.toMatchObject({ rows: [] });
      expect(findMany).toHaveBeenCalledTimes(1);
    });
  });

  it('downloads as a sheet with every price, the notes and a total row', async () => {
    const r = build([rfq([line(), line({ id: 'l-2', lineNo: 2, materialId: 'm-2', salesRfqLineId: null, salesRfqLine: null })])]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildSavingsXlsx(r, { scope: 'All projects' }) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Procurement savings')!;
    expect(String(ws.getCell('A1').value)).toContain('2026-11-01 to 2026-11-30');
    const first = ws.getRow(6);
    expect(String(first.getCell(7).value)).toBe('Fasteners: ZAR 2160.00\nLocal Steel: ZAR 2400.00');
    expect(first.getCell(14).value).toBe(48);
    expect(String(ws.getRow(7).getCell(17).value)).toContain('Not linked');
    const total = ws.getRow(8);
    expect(String(total.getCell(4).value)).toContain('Total (2 lines, 1 linked)');
    expect(total.getCell(14).value).toBe(48);
    expect(savingsFilename(r, 'AFRI-1404')).toBe('afrinov-procurement-savings-AFRI-1404-2026-11-01-to-2026-11-30.xlsx');
  });

  it('downloads as an A4 landscape PDF, running onto more pages as it needs', async () => {
    const one = await buildSavingsPdf(build([rfq([line()])]), { scope: 'All projects' });
    expect(one.subarray(0, 4).toString()).toBe('%PDF');
    expect(one.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
    const pages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
    expect(pages(one)).toBe(1);
    const many = Array.from({ length: 40 }, (_, i) => line({ id: `l-${i}`, lineNo: i + 1, materialId: `m-${i}`, salesRfqLineId: null, salesRfqLine: null }));
    expect(pages(await buildSavingsPdf(build([rfq(many)]), { scope: 'Project AFRI-1404' }))).toBeGreaterThan(1);
    expect(savingsFilename({ from: '2026-11-01', to: '2026-11-09' }, undefined, 'pdf')).toBe('afrinov-procurement-savings-2026-11-01-to-2026-11-09.pdf');
  });

  it('makes a PDF that says so when nothing was sent', async () => {
    expect((await buildSavingsPdf(build([]), { scope: 'All projects' })).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('says so in the sheet when nothing was sent', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildSavingsXlsx(build([]), { scope: 'All projects' }) as unknown as ArrayBuffer);
    expect(String(wb.getWorksheet('Procurement savings')!.getRow(6).getCell(1).value)).toMatch(/No Procurement RFQ/);
  });
});
