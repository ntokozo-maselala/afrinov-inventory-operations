// Real-HTTP + real-database tests for Sales requests for quotation: pricing each
// equipment line from labour at the listed rates and the quotes on the
// project's Procurement RFQs (the one Procurement recommends, or another), the markup, the Director's approval and the quotation reference, the
// labour rates the Workshop Manager keeps, and above all who may see the price.
// Also the Procurement savings report, which no longer has a Sales column.
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

interface Totals {
  labour: string; material: string; other: string; cost: string; markup: string | null; equipment: string | null; delivery: string;
  totalExVat: string | null; vatRate: string; vat: string | null; totalIncVat: string | null;
}
interface SalesRfq {
  id: string;
  number: string;
  quoteReference: string | null;
  status: string;
  equipment: string | null;
  description: string | null;
  clientName: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  signerEmail: string | null;
  issuedAt: string | null;
  returnReason: string | null;
  clientAddress: string | null;
  quoteNotes: string | null;
  equipmentLines: Array<{
    lineNo: number; equipment: string | null; details: string | null; quantity: number; markupPercent: string | null;
    labour: Array<{ lineNo: number; role: string; hours: string; hourlyRate: string; total: string }>;
    materials: Array<{ rfqId: string; supplierId: string; amount: string; recommended: boolean; recommendedSupplier: { id: string } | null; unusable: boolean }>;
    otherCosts: Array<{ lineNo: number; description: string; quantity: string; unitCost: string; total: string }>;
    totals: { quantity: number; markupPercent: string | null; labour: string; material: string; other: string; unitCost: string; unitMarkup: string | null; unitPrice: string | null; total: string | null };
  }>;
  totals: Totals;
}
/** The first line's labour and quotes, as the single equipment line had them. */
const first = (r: SalesRfq) => r.equipmentLines[0]!;
interface LabourRate { id: string; role: string; hourlyRate: string; active: boolean }
interface ApiErrorBody { error: { code: string; message: string } }

describe('Sales requests for quotation over real HTTP', () => {
  const run = runId();
  const projectNumber = `AFRI-${parseInt(run, 16)}`;
  const otherProject = `AFRI-${parseInt(run, 16) + 1}`;
  let server: TestServer;
  let admin: ReturnType<typeof client>;
  let supplierId: string;
  let otherSupplier: string;
  /** Sent: Local Steel quoted R9 000 (recommended), Fasteners R9 500. */
  let quotedRfq: string;
  /** Still a draft, so not out with suppliers. */
  let draftRfq: string;
  /** Sent and quoted, but another project's. */
  let otherRfq: string;
  let welder: LabourRate;
  let boilerMaker: LabourRate;

  /** A signed-in client holding one role, made once per run. */
  const signedIn = new Map<string, ReturnType<typeof client>>();
  async function as(role: 'SALES' | 'PROCUREMENT' | 'STORE_CONTROLLER' | 'DIRECTOR' | 'WORKSHOP_MANAGER' | 'PROCUREMENT_MANAGER') {
    const known = signedIn.get(role);
    if (known) return known;
    const email = `it-sales-${role.toLowerCase()}-${run}@example.test`;
    const password = `It-${run}-sales`;
    expect((await admin('POST', '/users', { email, name: `${role} ${run}`, password, roleNames: [role], mustChangePassword: false })).status).toBe(201);
    const made = client(server.port, await login(server.port, email, password));
    signedIn.set(role, made);
    return made;
  }

  /** A Procurement RFQ for 10 of an item, sent and quoted at these unit prices by Local Steel and Fasteners, unless left a draft. */
  async function procurementRfq(project: string, prices: [number, number] | null): Promise<string> {
    const material = await admin<{ id: string }>('POST', '/materials', {
      sku: `IT-SRFQ-${project}-${prices ? prices.join('-') : 'draft'}`, name: 'Plate', category: 'PROJECT_MATERIAL', unitOfMeasure: 'kg', projectNumber: project,
    });
    expect(material.status).toBe(200);
    const rfq = await admin<{ id: string; lines: Array<{ id: string }> }>('POST', '/rfqs', { projectNumber: project, lines: [{ materialId: material.body.id, quantity: 10 }], supplierIds: [supplierId, otherSupplier] });
    expect(rfq.status).toBe(201);
    if (!prices) return rfq.body.id;
    await admin('POST', `/rfqs/${rfq.body.id}/send`, {});
    const line = rfq.body.lines[0]!.id;
    await admin('PUT', `/rfqs/${rfq.body.id}/suppliers/${supplierId}/quote`, { prices: [{ rfqLineId: line, unitPrice: prices[0] }] });
    await admin('PUT', `/rfqs/${rfq.body.id}/suppliers/${otherSupplier}/quote`, { prices: [{ rfqLineId: line, unitPrice: prices[1] }] });
    return rfq.body.id;
  }

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    admin = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    for (const [number, name, clientName] of [[projectNumber, `Pump rebuild ${run}`, 'Northam Platinum'], [otherProject, `Other job ${run}`, 'Other client']]) {
      expect((await admin('POST', '/projects', { projectNumber: number, name, client: clientName })).status).toBe(201);
    }
    const supplier = await admin<{ id: string }>('POST', '/suppliers', { name: `Local Steel ${run}` });
    expect(supplier.status).toBe(201);
    supplierId = supplier.body.id;
    const fasteners = await admin<{ id: string }>('POST', '/suppliers', { name: `Fasteners ${run}` });
    otherSupplier = fasteners.body.id;
    quotedRfq = await procurementRfq(projectNumber, [900, 950]);
    expect((await (await as('PROCUREMENT'))('PUT', `/rfqs/${quotedRfq}/recommended-quote`, { supplierId })).status).toBe(200);
    draftRfq = await procurementRfq(projectNumber, null);
    otherRfq = await procurementRfq(otherProject, [50, 60]);
    const rates = await (await as('SALES'))<LabourRate[]>('GET', '/labour-rates?active=true');
    welder = rates.body.find((r) => r.role === 'Welder')!;
    boilerMaker = rates.body.find((r) => r.role === 'Boiler Maker')!;
  });

  afterAll(async () => { await server?.close(); });

  describe('labour rates', () => {
    it("lists the sheet's selling rates for Sales", async () => {
      const rates = await (await as('SALES'))<LabourRate[]>('GET', '/labour-rates');
      expect(rates.status).toBe(200);
      expect(rates.body.length).toBeGreaterThanOrEqual(34);
      expect(welder).toMatchObject({ hourlyRate: '400', active: true });
      expect(boilerMaker).toMatchObject({ hourlyRate: '300' });
    });

    it('is kept by the Workshop Manager: a role added, renamed, re-rated and made inactive, each logged', async () => {
      const workshop = await as('WORKSHOP_MANAGER');
      const role = `Pipe Fitter ${run}`;
      const added = await workshop<LabourRate>('POST', '/labour-rates', { role, hourlyRate: 350 });
      expect(added.status).toBe(201);
      const twice = await workshop<ApiErrorBody>('POST', '/labour-rates', { role: role.toUpperCase(), hourlyRate: 1 });
      expect(twice.status).toBe(409);
      const changed = await workshop<LabourRate>('PATCH', `/labour-rates/${added.body.id}`, { hourlyRate: 375.5, active: false });
      expect(changed.body).toMatchObject({ hourlyRate: '375.5', active: false });
      expect((await workshop<ApiErrorBody>('PATCH', `/labour-rates/${added.body.id}`, { hourlyRate: 0 })).status).toBe(400);
      const log = await admin<Array<{ action: string; after: Record<string, unknown> }>>('GET', `/audit?entityType=LabourRate&entityId=${added.body.id}`);
      expect(log.body.map((e) => e.action).sort()).toEqual(['CREATE', 'UPDATE']);
    });

    it('can be read but not changed by Sales, and is nobody else\'s business', async () => {
      expect((await (await as('SALES'))('POST', '/labour-rates', { role: `X ${run}`, hourlyRate: 1 })).status).toBe(403);
      expect((await (await as('PROCUREMENT'))('GET', '/labour-rates')).status).toBe(403);
      expect((await (await as('STORE_CONTROLLER'))('GET', '/labour-rates')).status).toBe(403);
    });
  });

  describe('costing', () => {
    /** One equipment line: the pump, its labour and the recommended quote. */
    const pump = (over: Record<string, unknown> = {}) => ({
      equipment: 'Main Piston Pump',
      labour: [{ labourRateId: welder.id, hours: 10 }, { labourRateId: boilerMaker.id, hours: 5.5 }],
      materials: [{ rfqId: quotedRfq, supplierId }],
      ...over,
    });
    const draft = (line: Record<string, unknown> = {}) => ({
      projectNumber,
      equipmentLines: [pump(line)],
      markupPercent: 40,
      deliveryPrice: 500,
    });

    it("offers the project's sent RFQs' quotes with their rand totals and the recommended one, and only to Sales", async () => {
      const sales = await as('SALES');
      type Option = { id: string; recommendedSupplierId: string | null; quotes: Array<{ supplierId: string; total: string; amount: string | null; recommended: boolean }> };
      const options = await sales<Option[]>('GET', `/sales-rfqs/quote-options?projectNumber=${projectNumber}`);
      expect(options.status).toBe(200);
      const rfq = options.body.find((o) => o.id === quotedRfq)!;
      expect(rfq.recommendedSupplierId).toBe(supplierId);
      expect(rfq.quotes.map((q) => [q.supplierId, q.amount, q.recommended])).toEqual([[supplierId, '9000.00', true], [otherSupplier, '9500.00', false]]);
      expect(options.body.map((o) => o.id)).not.toContain(draftRfq);
      expect(options.body.map((o) => o.id)).not.toContain(otherRfq);
      expect((await (await as('PROCUREMENT'))('GET', `/sales-rfqs/quote-options?projectNumber=${projectNumber}`)).status).toBe(403);
    });

    it('is recommended by a buyer without awarding, and the recommendation goes when that supplier declines', async () => {
      const buyer = await as('PROCUREMENT');
      const rfq = await procurementRfq(projectNumber, [10, 20]);
      const recommended = await buyer<{ status: string; recommendedSupplierId: string | null; purchaseOrder: unknown }>('PUT', `/rfqs/${rfq}/recommended-quote`, { supplierId: otherSupplier });
      expect(recommended.body).toMatchObject({ status: 'SENT', recommendedSupplierId: otherSupplier, purchaseOrder: null });
      expect((await (await as('SALES'))('PUT', `/rfqs/${rfq}/recommended-quote`, { supplierId })).status).toBe(403);
      expect((await buyer('PUT', `/rfqs/${draftRfq}/recommended-quote`, { supplierId })).status).toBe(409);
      await buyer('POST', `/rfqs/${rfq}/suppliers/${otherSupplier}/decline`, {});
      expect((await buyer<{ recommendedSupplierId: string | null }>('GET', `/rfqs/${rfq}`)).body.recommendedSupplierId).toBeNull();
      const unquoted = await buyer<ApiErrorBody>('PUT', `/rfqs/${rfq}/recommended-quote`, { supplierId: otherSupplier });
      expect(unquoted.status).toBe(400);
      const history = await buyer<Array<{ action: string }>>('GET', `/rfqs/${rfq}/history`);
      expect(history.body.map((e) => e.action)).toContain('RFQ_RECOMMEND');
    });

    it("prices labour and the recommended quote's material, with the markup on the whole and delivery after it", async () => {
      const sales = await as('SALES');
      const res = await sales<SalesRfq>('POST', '/sales-rfqs', draft());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'DRAFT', equipment: 'Main Piston Pump', description: `Pump rebuild ${run}`, quoteReference: null });
      expect(res.body.number).toMatch(new RegExp(`^AFRI-02A-${parseInt(run, 16)}-02-\\d{2}$`));
      // The client is the project's, the conditions the usual ones, the email the creator's.
      expect(res.body).toMatchObject({ clientName: 'Northam Platinum', deliveryTerms: 'DAP, Northam Platinum', paymentTerms: '30 days from invoice date.' });
      expect(res.body.signerEmail).toBe(`it-sales-sales-${run}@example.test`);
      expect(first(res.body).labour.map((l) => [l.lineNo, l.role, l.hours, l.hourlyRate, l.total])).toEqual([[1, 'Welder', '10', '400', '4000.00'], [2, 'Boiler Maker', '5.5', '300', '1650.00']]);
      expect(first(res.body)).toMatchObject({ lineNo: 1, equipment: 'Main Piston Pump', quantity: 1, totals: { unitPrice: '20510.00', total: '20510.00' } });
      expect(first(res.body).materials).toEqual([expect.objectContaining({ rfqId: quotedRfq, supplierId, amount: '9000.00', recommended: true, unusable: false })]);
      const t = res.body.totals;
      expect(t).toMatchObject({ labour: '5650.00', material: '9000.00', cost: '14650.00', markup: '5860.00', equipment: '20510.00', delivery: '500.00', totalExVat: '21010.00' });
      const vat = (21010 * Number(t.vatRate)) / 100;
      expect(Number(t.vat)).toBeCloseTo(vat, 2);
      expect(Number(t.totalIncVat)).toBeCloseTo(21010 + vat, 2);
    });

    it('shows a quote other than the recommended one as such', async () => {
      const res = await (await as('SALES'))<SalesRfq>('POST', '/sales-rfqs', draft({ materials: [{ rfqId: quotedRfq, supplierId: otherSupplier }] }));
      expect(first(res.body).materials[0]).toMatchObject({ supplierId: otherSupplier, amount: '9500.00', recommended: false, recommendedSupplier: { id: supplierId } });
    });

    it("refuses a quote that isn't on one of the project's sent RFQs, a supplier who hasn't quoted, a role no longer used, and bad hours or markup", async () => {
      const sales = await as('SALES');
      for (const rfqId of [draftRfq, otherRfq]) {
        const refused = await sales<ApiErrorBody>('POST', '/sales-rfqs', draft({ materials: [{ rfqId, supplierId }] }));
        expect(refused.status).toBe(400);
        expect(refused.body.error.message).toBe(`That isn't a request for quotation sent for ${projectNumber}`);
      }
      const nobody = await sales<ApiErrorBody>('POST', '/sales-rfqs', draft({ materials: [{ rfqId: quotedRfq, supplierId: 'no-such-supplier' }] }));
      expect(nobody.body.error.message).toMatch(/hasn't quoted/);
      const twice = await sales<ApiErrorBody>('POST', '/sales-rfqs', draft({ materials: [{ rfqId: quotedRfq, supplierId }, { rfqId: quotedRfq, supplierId: otherSupplier }] }));
      expect(twice.body.error.message).toMatch(/one quote on each/);
      const workshop = await as('WORKSHOP_MANAGER');
      const retired = await workshop<LabourRate>('POST', '/labour-rates', { role: `Retired role ${run}`, hourlyRate: 100 });
      await workshop('PATCH', `/labour-rates/${retired.body.id}`, { active: false });
      const inactive = await sales<ApiErrorBody>('POST', '/sales-rfqs', draft({ labour: [{ labourRateId: retired.body.id, hours: 1 }] }));
      expect(inactive.status).toBe(400);
      expect(inactive.body.error.message).toMatch(/no longer used/);
      expect((await sales('POST', '/sales-rfqs', draft({ labour: [{ labourRateId: welder.id, hours: 1.555 }] }))).status).toBe(400);
      expect((await sales('POST', '/sales-rfqs', { ...draft(), markupPercent: -1 })).status).toBe(400);
    });

    it('takes a draft through submission, a send-back, approval and its quotation reference', async () => {
      const sales = await as('SALES');
      const director = await as('DIRECTOR');
      const created = await sales<SalesRfq>('POST', '/sales-rfqs', { ...draft(), markupPercent: null });
      const id = created.body.id;

      const noMarkup = await sales<ApiErrorBody>('POST', `/sales-rfqs/${id}/submit`);
      expect(noMarkup.status).toBe(400);
      expect(noMarkup.body.error.message).toMatch(/the markup/);
      await sales('PATCH', `/sales-rfqs/${id}`, { markupPercent: 35 });

      const submitted = await sales<SalesRfq>('POST', `/sales-rfqs/${id}/submit`);
      expect(submitted.body.status).toBe('PENDING_APPROVAL');
      expect((await sales<ApiErrorBody>('PATCH', `/sales-rfqs/${id}`, { markupPercent: 50 })).status).toBe(409);
      expect((await sales('POST', `/sales-rfqs/${id}/approve`)).status).toBe(403);

      const back = await director<SalesRfq>('POST', `/sales-rfqs/${id}/send-back`, { reason: 'Markup too low for this client' });
      expect(back.body).toMatchObject({ status: 'DRAFT', returnReason: 'Markup too low for this client' });
      await sales('PATCH', `/sales-rfqs/${id}`, { markupPercent: 45 });
      const again = await sales<SalesRfq>('POST', `/sales-rfqs/${id}/submit`);
      expect(again.body).toMatchObject({ status: 'PENDING_APPROVAL', returnReason: null });

      const approved = await director<SalesRfq>('POST', `/sales-rfqs/${id}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.quoteReference).toMatch(new RegExp(`^AFRI-02A-${parseInt(run, 16)}-04-\\d+$`));
      expect(approved.body.issuedAt).toBeTruthy();
      expect(approved.body.totals.markup).toBe('6592.50');
      expect((await director('POST', `/sales-rfqs/${id}/approve`)).status).toBe(409);

      // An approved price stays put when the rates or the quote change afterwards.
      await (await as('WORKSHOP_MANAGER'))('PATCH', `/labour-rates/${welder.id}`, { hourlyRate: 410 });
      const line = (await admin<{ lines: Array<{ id: string }> }>('GET', `/rfqs/${quotedRfq}`)).body.lines[0]!.id;
      await admin('PUT', `/rfqs/${quotedRfq}/suppliers/${supplierId}/quote`, { prices: [{ rfqLineId: line, unitPrice: 1000 }] });
      const later = await sales<SalesRfq>('GET', `/sales-rfqs/${id}`);
      expect(first(later.body).labour[0]!.hourlyRate).toBe('400');
      expect(first(later.body).materials[0]!.amount).toBe('9000.00');
      expect(later.body.totals.equipment).toBe(approved.body.totals.equipment);
      await (await as('WORKSHOP_MANAGER'))('PATCH', `/labour-rates/${welder.id}`, { hourlyRate: 400 });
      await admin('PUT', `/rfqs/${quotedRfq}/suppliers/${supplierId}/quote`, { prices: [{ rfqLineId: line, unitPrice: 900 }] });

      const history = await sales<Array<{ action: string }>>('GET', `/sales-rfqs/${id}/history`);
      expect(history.body.map((e) => e.action)).toEqual(expect.arrayContaining(['CREATE', 'SALES_RFQ_SUBMIT', 'SALES_RFQ_RETURN', 'SALES_RFQ_APPROVE']));
    });

    it('prices more than one equipment line, each for one unit times its quantity, with other costs, as AFRI-02A-1094-04-1 quotes a door and its installation', async () => {
      const sales = await as('SALES');
      const res = await sales<SalesRfq>('POST', '/sales-rfqs', {
        projectNumber, markupPercent: 10, deliveryPrice: 0,
        clientAddress: '  Main Office \n\n Farm Zondereinde 384KQ  ',
        equipmentLines: [
          { equipment: 'Stainless Steel Ultra High Door & Rail', details: '3D Scan Existing Area\n  Safety Installation Pack ', quantity: 2, materials: [{ rfqId: quotedRfq, supplierId }] },
          {
            equipment: 'Installation', details: 'Accommodation & LOA\nInstallation Labour',
            labour: [{ labourRateId: welder.id, hours: 8 }],
            otherCosts: [{ description: ' Accommodation ', quantity: 2, unitCost: 1200 }, { description: 'LOA', quantity: 2.5, unitCost: 350.5 }],
          },
        ],
      });
      expect(res.status).toBe(201);
      // The address and details keep their lines.
      expect(res.body.clientAddress).toBe('Main Office\nFarm Zondereinde 384KQ');
      const [door, install] = res.body.equipmentLines;
      expect(door).toMatchObject({ lineNo: 1, details: '3D Scan Existing Area\nSafety Installation Pack', quantity: 2, totals: { unitCost: '9000.00', unitMarkup: '900.00', unitPrice: '9900.00', total: '19800.00' } });
      // 8 × 400 + 2 × 1 200 + 2.5 × 350.50 = 3 200 + 2 400 + 876.25.
      expect(install!.otherCosts.map((c) => [c.lineNo, c.description, c.total])).toEqual([[1, 'Accommodation', '2400.00'], [2, 'LOA', '876.25']]);
      expect(install!.totals).toMatchObject({ labour: '3200.00', other: '3276.25', unitCost: '6476.25', unitMarkup: '647.63', unitPrice: '7123.88', total: '7123.88' });
      expect(res.body.totals).toMatchObject({ labour: '3200.00', material: '18000.00', other: '3276.25', cost: '24476.25', markup: '2447.63', equipment: '26923.88', totalExVat: '26923.88' });
      expect(res.body.equipment).toBe('Stainless Steel Ultra High Door & Rail');

      // A quote counts on one line only.
      const twice = await sales<ApiErrorBody>('PATCH', `/sales-rfqs/${res.body.id}`, { equipmentLines: [pump(), pump({ equipment: 'Spare' })] });
      expect(twice.status).toBe(400);
      expect(twice.body.error.message).toMatch(/one quote on each/);
      // The quantity is a whole number, and an error names the line.
      expect((await sales('PATCH', `/sales-rfqs/${res.body.id}`, { equipmentLines: [pump({ quantity: 1.5 })] })).status).toBe(400);
      const bad = await sales<ApiErrorBody>('PATCH', `/sales-rfqs/${res.body.id}`, { equipmentLines: [pump(), { equipment: 'Hire', otherCosts: [{ description: ' ', quantity: 1, unitCost: 10 }] }] });
      expect(bad.body.error.message).toMatch(/^Equipment line 2: Other cost 1 needs a description/);
      expect((await sales<ApiErrorBody>('PATCH', `/sales-rfqs/${res.body.id}`, { equipmentLines: [] })).body.error.message).toMatch(/at least one equipment line/);

      // A line with nothing to price, or no name, holds up submitting, by line.
      await sales('PATCH', `/sales-rfqs/${res.body.id}`, { equipmentLines: [pump(), { details: 'Nothing yet' }] });
      const held = await sales<ApiErrorBody>('POST', `/sales-rfqs/${res.body.id}/submit`);
      expect(held.body.error.message).toMatch(/the equipment on line 2, labour, a quote or another cost on line 2/);

      // Saving the lines replaces them; the Activity says what they were.
      const saved = await sales<SalesRfq>('PATCH', `/sales-rfqs/${res.body.id}`, { equipmentLines: [pump({ quantity: 3 })] });
      expect(saved.body.equipmentLines).toHaveLength(1);
      // 14 650 + 10% = 16 115 a unit, times 3.
      expect(saved.body.totals.equipment).toBe('48345.00');
      const history = await sales<Array<{ action: string; after: { equipmentLines?: Array<{ quantity: number }> } }>>('GET', `/sales-rfqs/${res.body.id}/history`);
      expect(history.body[0]!.after.equipmentLines?.map((l) => l.quantity)).toEqual([3]);
      expect((await sales<SalesRfq>('POST', `/sales-rfqs/${res.body.id}/submit`)).body.status).toBe('PENDING_APPROVAL');
    });

    // AFRI-0413 Rev 2 prices the electrode flexibles at quantity 0, as the client
    // supplies them, and adds "All Flexibles to be free issued by client".
    it('prices a line at quantity 0 without charging it, and keeps the quotation\'s own notes, as AFRI-0413 Rev 2', async () => {
      const sales = await as('SALES');
      const res = await sales<SalesRfq>('POST', '/sales-rfqs', {
        projectNumber, markupPercent: 50, deliveryPrice: 0,
        quoteNotes: '  All Flexibles to be free issued by client \n\n Prices valid while stock lasts ',
        equipmentLines: [
          { equipment: 'Maintenance', otherCosts: [{ description: 'Oil testing', quantity: 1, unitCost: 1000 }] },
          { equipment: 'Electrode Flexibles per Furnace (Supplied to Client)', quantity: 0, otherCosts: [{ description: 'Flexibles', quantity: 1, unitCost: 100080.27 }] },
        ],
      });
      expect(res.status).toBe(201);
      // Kept line by line, trimmed, blank lines dropped.
      expect(res.body.quoteNotes).toBe('All Flexibles to be free issued by client\nPrices valid while stock lasts');
      const [, flexibles] = res.body.equipmentLines;
      // Its price shows; it charges nothing.
      expect(flexibles).toMatchObject({ quantity: 0, totals: { unitCost: '100080.27', unitMarkup: '50040.14', unitPrice: '150120.41', total: '0.00' } });
      expect(res.body.totals).toMatchObject({ cost: '1000.00', markup: '500.00', equipment: '1500.00', totalExVat: '1500.00' });

      // A negative quantity is still refused.
      expect((await sales('PATCH', `/sales-rfqs/${res.body.id}`, { equipmentLines: [{ equipment: 'X', quantity: -1 }] })).status).toBe(400);
      // A quotation that charges nothing isn't sent to the Director.
      await sales('PATCH', `/sales-rfqs/${res.body.id}`, {
        equipmentLines: [{ equipment: 'Electrode Flexibles', quantity: 0, otherCosts: [{ description: 'Flexibles', quantity: 1, unitCost: 10 }] }],
      });
      const nothing = await sales<ApiErrorBody>('POST', `/sales-rfqs/${res.body.id}/submit`);
      expect(nothing.status).toBe(400);
      expect(nothing.body.error.message).toMatch(/a quantity of 1 or more/);

      // Clearing the notes clears them, and the Activity keeps the change.
      const cleared = await sales<SalesRfq>('PATCH', `/sales-rfqs/${res.body.id}`, { quoteNotes: ' ' });
      expect(cleared.body.quoteNotes).toBeNull();
      const history = await sales<Array<{ after: { quoteNotes?: string | null } }>>('GET', `/sales-rfqs/${res.body.id}/history`);
      expect(history.body.some((h) => 'quoteNotes' in h.after && h.after.quoteNotes === null)).toBe(true);
    });

    // AFRI-0413's costing sheet marks each line up on its own: the maintenance
    // × 1.3 × 1.2 (56%), the spares × 1.35 × 1.2 (62%).
    it('marks each line up at its own markup, or the job\'s when it has none, as AFRI-0413 Rev 2', async () => {
      const sales = await as('SALES');
      const res = await sales<SalesRfq>('POST', '/sales-rfqs', {
        projectNumber, markupPercent: 56, deliveryPrice: 0, clientName: 'Samancor TC Smelters (Pty)',
        equipmentLines: [
          { equipment: 'Maintenance', otherCosts: [{ description: 'Labour and costs', quantity: 1, unitCost: 255600 }] },
          { equipment: 'Anticipated Spares', markupPercent: 62, otherCosts: [{ description: 'Spares allowance', quantity: 1, unitCost: 45000 }] },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.body.equipmentLines.map((l) => [l.markupPercent, l.totals.markupPercent, l.totals.total])).toEqual([[null, '56', '398736.00'], ['62', '62', '72900.00']]);
      expect(res.body.totals).toMatchObject({ cost: '300600.00', markup: '171036.00', totalExVat: '471636.00', vat: '70745.40', totalIncVat: '542381.40' });

      // A line's markup is checked like the job's, naming the line.
      const bad = await sales<ApiErrorBody>('PATCH', `/sales-rfqs/${res.body.id}`, { equipmentLines: [{ equipment: 'X', markupPercent: 12.345, otherCosts: [{ description: 'Y', quantity: 1, unitCost: 1 }] }] });
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toMatch(/^The equipment line: its markup has at most 2 decimal places/);

      // Without the job's markup, the line with none of its own holds up submitting.
      await sales('PATCH', `/sales-rfqs/${res.body.id}`, {
        markupPercent: null,
        equipmentLines: [
          { equipment: 'Maintenance', otherCosts: [{ description: 'Labour and costs', quantity: 1, unitCost: 255600 }] },
          { equipment: 'Anticipated Spares', markupPercent: 62, otherCosts: [{ description: 'Spares allowance', quantity: 1, unitCost: 45000 }] },
        ],
      });
      const held = await sales<ApiErrorBody>('POST', `/sales-rfqs/${res.body.id}/submit`);
      expect(held.status).toBe(400);
      expect(held.body.error.message).toMatch(/the markup \(the job's, or one on line 1\)/);

      // With its own markup on every line, no job markup is needed; the Activity keeps each line's.
      const own = await sales<SalesRfq>('PATCH', `/sales-rfqs/${res.body.id}`, {
        equipmentLines: [
          { equipment: 'Maintenance', markupPercent: 56, otherCosts: [{ description: 'Labour and costs', quantity: 1, unitCost: 255600 }] },
          { equipment: 'Anticipated Spares', markupPercent: 62, otherCosts: [{ description: 'Spares allowance', quantity: 1, unitCost: 45000 }] },
        ],
      });
      expect(own.body.totals.totalExVat).toBe('471636.00');
      const history = await sales<Array<{ after: { equipmentLines?: Array<{ markupPercent: string | null }> } }>>('GET', `/sales-rfqs/${res.body.id}/history`);
      expect(history.body[0]!.after.equipmentLines?.map((l) => l.markupPercent)).toEqual(['56', '62']);
      const submitted = await sales<SalesRfq>('POST', `/sales-rfqs/${res.body.id}/submit`);
      expect(submitted.body).toMatchObject({ status: 'PENDING_APPROVAL', totals: { totalExVat: '471636.00' } });
    });

    it('starts a new one with one empty equipment line, and moving it to another project takes its quotes off its lines', async () => {
      const sales = await as('SALES');
      const bare = await sales<SalesRfq>('POST', '/sales-rfqs', { projectNumber });
      expect(bare.body.equipmentLines).toEqual([expect.objectContaining({ lineNo: 1, equipment: null, quantity: 1, labour: [], materials: [], otherCosts: [] })]);
      const priced = await sales<SalesRfq>('POST', '/sales-rfqs', draft());
      const moved = await sales<SalesRfq>('PATCH', `/sales-rfqs/${priced.body.id}`, { projectNumber: otherProject });
      expect(first(moved.body)).toMatchObject({ equipment: 'Main Piston Pump', materials: [] });
      expect(first(moved.body).labour).toHaveLength(2);
    });

    it('numbers each approved quotation of a project in turn', async () => {
      const sales = await as('SALES');
      const director = await as('DIRECTOR');
      const refs: string[] = [];
      for (let i = 0; i < 2; i++) {
        const created = await sales<SalesRfq>('POST', '/sales-rfqs', draft());
        await sales('POST', `/sales-rfqs/${created.body.id}/submit`);
        refs.push((await director<SalesRfq>('POST', `/sales-rfqs/${created.body.id}/approve`)).body.quoteReference!);
      }
      const n = (ref: string) => Number(ref.split('-').pop());
      expect(n(refs[1]!)).toBe(n(refs[0]!) + 1);
    });

    it('lets nobody approve a Sales RFQ they raised or submitted', async () => {
      const own = await admin<SalesRfq>('POST', '/sales-rfqs', draft());
      await admin('POST', `/sales-rfqs/${own.body.id}/submit`);
      const refused = await admin<ApiErrorBody>('POST', `/sales-rfqs/${own.body.id}/approve`);
      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toMatch(/someone else approves it/);
    });

    it('can be cancelled at any point, with a reason', async () => {
      const sales = await as('SALES');
      const created = await sales<SalesRfq>('POST', '/sales-rfqs', draft());
      expect((await sales('POST', `/sales-rfqs/${created.body.id}/cancel`, {})).status).toBe(400);
      const cancelled = await sales<SalesRfq>('POST', `/sales-rfqs/${created.body.id}/cancel`, { reason: 'Client went elsewhere' });
      expect(cancelled.body.status).toBe('CANCELLED');
      expect((await sales('POST', `/sales-rfqs/${created.body.id}/cancel`, { reason: 'Again' })).status).toBe(409);
    });

    it('shows the price only to Sales, the managers who oversee margin, and admins', async () => {
      for (const role of ['PROCUREMENT', 'STORE_CONTROLLER', 'WORKSHOP_MANAGER'] as const) {
        expect((await (await as(role))('GET', '/sales-rfqs')).status, role).toBe(403);
      }
      for (const role of ['SALES', 'DIRECTOR', 'PROCUREMENT_MANAGER'] as const) {
        expect((await (await as(role))('GET', '/sales-rfqs?status=PENDING_APPROVAL')).status, role).toBe(200);
      }
    });
  });

  describe('the Procurement savings report', () => {
    interface Report {
      total: Record<string, unknown>;
      rows: Array<Record<string, unknown> & { procurement: { lowest: string | null }; order: { lineTotal: string | null } | null; procurementVsOrder: string | null; notes: string[] }>;
    }
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
    const job = `AFRI-${parseInt(run, 16) + 2}`;
    const query = `from=${day}&to=${day}&projectNumber=${job}`;

    it('compares what buyers were quoted with the order, with no Sales column', async () => {
      expect((await admin('POST', '/projects', { projectNumber: job, name: `Savings ${run}` })).status).toBe(201);
      const other = await admin<{ id: string }>('POST', '/suppliers', { name: `Savings Fasteners ${run}` });
      const pipe = await admin<{ id: string }>('POST', '/materials', { sku: `IT-SAVE-${run}`, name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'each', projectNumber: job });
      const rfq = await admin<{ id: string; lines: Array<{ id: string }> }>('POST', '/rfqs', { projectNumber: job, lines: [{ materialId: pipe.body.id, quantity: 24 }], supplierIds: [supplierId, other.body.id] });
      const line = rfq.body.lines[0]!.id;
      await admin('POST', `/rfqs/${rfq.body.id}/send`, {});
      await admin('PUT', `/rfqs/${rfq.body.id}/suppliers/${supplierId}/quote`, { prices: [{ rfqLineId: line, unitPrice: 95 }] });
      await admin('PUT', `/rfqs/${rfq.body.id}/suppliers/${other.body.id}/quote`, { prices: [{ rfqLineId: line, unitPrice: 88 }] });
      await admin('POST', `/rfqs/${rfq.body.id}/award`, { supplierId: other.body.id });

      const report = await admin<Report>('GET', `/reports/procurement-savings?${query}`);
      expect(report.status).toBe(200);
      expect(report.body.rows).toHaveLength(1);
      expect(report.body.rows[0]).toMatchObject({ procurement: { lowest: '2112.00' }, order: { lineTotal: '2112.00' }, procurementVsOrder: '0.00', notes: [] });
      expect(report.body.rows[0]).not.toHaveProperty('sales');
      expect(report.body.total).toEqual({ procurement: '2112.00', order: '2112.00', discount: '0.00', procurementVsOrder: '0.00', lines: 1 });
      // Buyers no longer link lines to Sales lines.
      expect((await admin('GET', `/rfqs/${rfq.body.id}/sales-lines`)).status).toBe(404);
    });

    it('filters by project and period, refusing a bad period', async () => {
      expect((await admin<Report>('GET', `/reports/procurement-savings?from=2020-01-01&to=2020-01-31&projectNumber=${job}`)).body.rows).toEqual([]);
      expect((await admin('GET', `/reports/procurement-savings?from=${day}&to=2020-01-01`)).status).toBe(400);
    });

    it('downloads as Excel and PDF', async () => {
      const token = await login(server.port, ADMIN_EMAIL, requireAdminPassword());
      for (const [format, type] of [['xlsx', 'spreadsheetml'], ['pdf', 'application/pdf']] as const) {
        const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/reports/procurement-savings/export?${query}&format=${format}`, { headers: { Authorization: `Bearer ${token}` } });
        expect(res.status, format).toBe(200);
        expect(res.headers.get('content-type')).toContain(type);
        expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
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
