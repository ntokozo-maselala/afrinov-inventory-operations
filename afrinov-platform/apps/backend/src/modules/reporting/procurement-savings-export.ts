// The Procurement savings report as Excel: one row for each RFQ line, each
// supplier's price in its cell, and a total row.
import ExcelJS from 'exceljs';
import type { SavingsPrice, SavingsReport } from './procurement-savings.service.js';

const QTY = '#,##0.####';
const MONEY = '#,##0.00;[Red]-#,##0.00';

const priceList = (prices: SavingsPrice[] | undefined) =>
  (prices ?? []).map((p) => `${p.supplier}: ${p.currency} ${Number(p.lineTotal).toFixed(2)}`).join('\n');
const amount = (value: string | null | undefined) => (value === null || value === undefined ? null : Number(value));

export function savingsFilename(r: Pick<SavingsReport, 'from' | 'to'>, projectNumber?: string, extension: 'xlsx' | 'pdf' = 'xlsx'): string {
  const project = projectNumber ? `-${projectNumber.replace(/[^A-Za-z0-9-]+/g, '-')}` : '';
  return `afrinov-procurement-savings${project}-${r.from}-to-${r.to}.${extension}`;
}

export async function buildSavingsXlsx(r: SavingsReport, meta: { scope: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Afrinov IMS';
  const ws = wb.addWorksheet('Procurement savings', { views: [{ state: 'frozen', ySplit: 5 }] });
  ws.columns = [
    { key: 'project', width: 14 }, { key: 'rfq', width: 22 }, { key: 'material', width: 36 }, { key: 'unit', width: 8 }, { key: 'qty', width: 10 },
    { key: 'procurementPrices', width: 34 }, { key: 'procurementLowest', width: 14 },
    { key: 'orderNo', width: 18 }, { key: 'order', width: 14 }, { key: 'discount', width: 12 },
    { key: 'procurementVsOrder', width: 14 }, { key: 'notes', width: 50 },
  ];
  ws.getCell('A1').value = `Procurement savings, ${r.from} to ${r.to}`;
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFE3001B' } };
  ws.getCell('A2').value = `${meta.scope}. Line totals excl. VAT, ${r.currency}. Quotes are compared at their lowest; the order is before line discounts.`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };
  ws.getCell('A3').value = 'A difference is positive where the order is lower. One that can\'t be compared is blank and out of the totals, with the reason under Notes.';
  ws.getCell('A3').font = { italic: true, color: { argb: 'FF555555' } };
  const header = ws.getRow(5);
  header.values = [
    'Project', 'Procurement RFQ', 'Material', 'Unit', 'Qty', 'Procurement prices', 'Procurement lowest',
    'Order', 'Order price', 'Line discount', 'Procurement vs order', 'Notes',
  ];
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: 'top' };
  header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });

  const moneyKeys = ['procurementLowest', 'order', 'discount', 'procurementVsOrder'];
  for (const row of r.rows) {
    const added = ws.addRow({
      project: row.projectNumber ?? '', rfq: row.rfqNumber,
      material: `${row.sku} ${row.material}`, unit: row.unitOfMeasure, qty: Number(row.quantity),
      procurementPrices: priceList(row.procurement.prices), procurementLowest: amount(row.procurement.lowest),
      orderNo: row.order?.number ?? '', order: amount(row.order?.lineTotal), discount: amount(row.order?.discount),
      procurementVsOrder: amount(row.procurementVsOrder),
      notes: row.notes.join('\n'),
    });
    added.alignment = { wrapText: true, vertical: 'top' };
    added.getCell('qty').numFmt = QTY;
    for (const k of moneyKeys) added.getCell(k).numFmt = MONEY;
  }
  if (r.rows.length === 0) {
    ws.addRow(['No Procurement RFQ was sent for this selection in this period.']);
  } else {
    const t = r.total;
    const total = ws.addRow({
      material: `Total (${t.lines} line${t.lines === 1 ? '' : 's'})`,
      procurementLowest: Number(t.procurement), order: Number(t.order), discount: Number(t.discount),
      procurementVsOrder: Number(t.procurementVsOrder),
    });
    total.font = { bold: true, size: 12 };
    for (const k of moneyKeys) total.getCell(k).numFmt = MONEY;
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
