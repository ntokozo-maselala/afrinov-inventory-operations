// The vendor list import from the AFRI-0000_x purchase order template.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { planVendorImport, readVendorList, renderVendorReport, type ExistingSupplier, type VendorList } from './vendor-list.js';

const HEADER = ['VENDOR NAME', 'VENDOR CODE', 'PHYSICAL ADDRESS', 'CONTACT PERSON', 'CONTACT NUMBER', 'CURRENCY', 'EMAIL ADDRESS', 'WEBSITE', 'SERVICES AND SUPPLIES', 'PAYMENT TERMS'];

function workbook(rows: Array<Array<string | null>>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Inputs').addRow(['Rev:', null, null, null, null, '00']);
  const ws = wb.addWorksheet('Suppliers (2)');
  ws.addRow(HEADER);
  for (const r of rows) ws.addRow(r);
  return wb;
}

const existing = (over: Partial<ExistingSupplier> & { id: string; name: string }): ExistingSupplier => ({
  vendorCode: null, address: null, contactName: null, contactPhone: null, contactEmail: null,
  currency: 'ZAR', website: null, services: null, paymentTerms: null, ...over,
});

describe('readVendorList', () => {
  it('finds the vendor sheet by its heading and tidies each field', () => {
    const list = readVendorList(workbook([
      ['Hydac ', 'v006', 'Hydac Technology, Edanvale', 'Lillian', '011 723 9080', 'ZAR', 'Lillian.Obi@hydac.com', 'www.hydac.co.za | ', 'Hydraulics & Filtrations', '30 Days Nett'],
      ['HS SRL', 'V162', null, null, null, 'EUROS', 'sales@hs.it', null, 'Hydraulic Power Units', 'COD'],
    ]));
    expect(list.sheet).toBe('Suppliers (2)');
    expect(list.rows[0]).toMatchObject({
      row: 2, name: 'Hydac', vendorCode: 'V006', website: 'www.hydac.co.za', paymentTerms: '30 DAYS NETT', currency: 'ZAR',
    });
    expect(list.rows[1]).toMatchObject({ currency: 'EUR', paymentTerms: 'C.O.D' });
  });

  it('keeps an invalid email out but remembers what was written', () => {
    const list = readVendorList(workbook([['Premier Workwear', 'V056', null, null, null, 'ZAR', 'lorriane2primierworkwear', null, null, null]]));
    expect(list.rows[0]).toMatchObject({ contactEmail: null, emailRaw: 'lorriane2primierworkwear' });
  });

  it('skips empty rows and reports no sheet when there is no vendor heading', () => {
    expect(readVendorList(workbook([[null, null], ['Afrox', 'V034']])).rows).toHaveLength(1);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Order').addRow(['PURCHASE ORDER No.']);
    expect(readVendorList(wb)).toEqual({ sheet: null, rows: [] });
  });
});

describe('planVendorImport', () => {
  const list = (rows: Array<Array<string | null>>): VendorList => readVendorList(workbook(rows));

  it('creates suppliers that are not in the app yet, ZAR when no currency is given', () => {
    const plan = planVendorImport(list([['Fast Flame', 'V003', '6 - 8 Alberdein Street, Roodekop', 'Sean', '011 866 1740', null, null, null, 'Laser Cut & Machining', 'C.O.D']]), []);
    expect(plan.create).toEqual([expect.objectContaining({ name: 'Fast Flame', vendorCode: 'V003', currency: 'ZAR', contactName: 'Sean' })]);
    expect(plan.problems).toEqual([]);
  });

  it('loads the most complete of two rows with the same name and reports the other', () => {
    const plan = planVendorImport(list([
      ['BMG', 'V025', null, null, null, 'ZAR', null, null, null, '30 DAYS NETT'],
      ['BMG', 'V048', '3 Droste Crescent', 'Thomas', '011 620 7421', 'ZAR', 'thomasw@bmgworld.net', 'www.bmgworld.net', 'Electrical Machine Supply', 'C.O.D'],
    ]), []);
    expect(plan.create.map((c) => c.vendorCode)).toEqual(['V048']);
    expect(plan.problems).toEqual([expect.objectContaining({ code: 'DUPLICATE_NAME', row: 2 })]);
  });

  it('fills only the empty fields of a supplier already in the app', () => {
    const plan = planVendorImport(
      list([['Hydroscand', 'V007', '12 Pipe Road', 'Someone else', null, 'ZAR', null, null, 'Hydraulic hoses', 'C.O.D']]),
      [existing({ id: 'seed-sup-hydroscand', name: 'HYDROSCAND', contactName: 'Thabo' })],
    );
    expect(plan.create).toEqual([]);
    expect(plan.fill).toEqual([{ row: 2, id: 'seed-sup-hydroscand', name: 'HYDROSCAND', fields: { vendorCode: 'V007', address: '12 Pipe Road', services: 'Hydraulic hoses', paymentTerms: 'C.O.D' } }]);
  });

  it('sets a foreign currency on an existing supplier still on the ZAR default', () => {
    const plan = planVendorImport(list([['HS SRL', null, null, null, null, 'EUR', null, null, null, null]]), [existing({ id: 's1', name: 'HS SRL' })]);
    expect(plan.fill[0]!.fields).toEqual({ currency: 'EUR' });
  });

  it('counts a supplier with nothing new as unchanged', () => {
    const plan = planVendorImport(list([['Afrox', 'V034']]), [existing({ id: 's1', name: 'Afrox', vendorCode: 'V034' })]);
    expect(plan.unchanged).toEqual([{ row: 2, name: 'Afrox' }]);
  });

  it("keeps the app's vendor code when the list has a different one", () => {
    const plan = planVendorImport(list([['Afrox', 'V035', 'Midrand']]), [existing({ id: 's1', name: 'Afrox', vendorCode: 'V034' })]);
    expect(plan.fill[0]!.fields).toEqual({ address: 'Midrand' });
    expect(plan.problems).toEqual([expect.objectContaining({ code: 'CODE_DIFFERS' })]);
  });

  it('does not load a row whose vendor code belongs to a different supplier', () => {
    const plan = planVendorImport(list([['Hydac Pty', 'V006']]), [existing({ id: 's1', name: 'Hydac', vendorCode: 'V006' })]);
    expect(plan.create).toEqual([]);
    expect(plan.problems).toEqual([expect.objectContaining({ code: 'CODE_BELONGS_TO_OTHER', detail: 'V006 is Hydac in the app' })]);
  });

  it('does not load two rows with the same vendor code', () => {
    const plan = planVendorImport(list([['Alpha', 'V100'], ['Beta', 'V100']]), []);
    expect(plan.create.map((c) => c.name)).toEqual(['Alpha']);
    expect(plan.problems).toEqual([expect.objectContaining({ code: 'CODE_BELONGS_TO_OTHER', row: 3 })]);
  });

  it('reports rows without a code, with a bad email or an unknown currency, and still loads them', () => {
    const plan = planVendorImport(list([['World Power Products', null, null, null, null, 'Yen', 'N', 'www.wpp.co.za', null, 'C.O.D']]), []);
    expect(plan.create).toEqual([expect.objectContaining({ name: 'World Power Products', vendorCode: null, currency: 'ZAR', contactEmail: null })]);
    expect(plan.problems.map((p) => p.code).sort()).toEqual(['BAD_EMAIL', 'NO_CODE', 'UNKNOWN_CURRENCY']);
  });
});

describe('renderVendorReport', () => {
  it('summarises what would be loaded and lists what to review', () => {
    const plan = planVendorImport(readVendorList(workbook([['Hydac', 'V006'], ['Hydac', 'V026', null, null, null, null, 'N']])), []);
    const md = renderVendorReport(plan, { file: 'AFRI-0000_x R0 - Item Description.xlsm', sheet: 'Suppliers (2)', generatedAt: new Date('2026-10-19T06:00:00Z') });
    expect(md).toContain('| New | 1 |');
    expect(md).toContain('| Not loaded | 1 |');
    expect(md).toContain('Name appears more than once');
    expect(md).toContain('| 2 | V006 | Hydac | ZAR |');
  });
});
