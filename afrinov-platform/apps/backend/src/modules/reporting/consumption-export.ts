// The consumption report as Excel, laid out like the workbook's Stock Report
// sheets ("Used Stock Inventory": item, quantity used, value excl. VAT), with
// the period, the project, and a sheet by project the workbook never had.
import ExcelJS from 'exceljs';
import type { ConsumptionReport } from './consumption.service.js';

const CATEGORY_LABEL: Record<string, string> = {
  CONSUMABLES: 'Consumables',
  FASTENERS_SLUGS_INSULATION: 'Fasteners, Slugs & Insulation',
  TOOLING_PPE_ELECTRICAL: 'Tooling, PPE & Electrical',
  PROJECT_MATERIAL: 'Project Material',
  TOOLS: 'Tools',
};
const ORDER = Object.keys(CATEGORY_LABEL);
const QTY = '#,##0.####';
const MONEY = '#,##0.00';

export function consumptionFilename(r: Pick<ConsumptionReport, 'from' | 'to'>, projectNumber?: string): string {
  const project = projectNumber ? `-${projectNumber.replace(/[^A-Za-z0-9-]+/g, '-')}` : '';
  return `afrinov-consumption${project}-${r.from}-to-${r.to}.xlsx`;
}

export async function buildConsumptionXlsx(r: ConsumptionReport, meta: { currency: string; scope: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Afrinov IMS';

  // ── By item ───────────────────────────────────────────────────────────
  const ws = wb.addWorksheet('By item', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [
    { key: 'sku', width: 16 }, { key: 'name', width: 44 }, { key: 'unit', width: 8 },
    { key: 'issued', width: 11 }, { key: 'returned', width: 11 }, { key: 'used', width: 11 },
    { key: 'price', width: 14 }, { key: 'value', width: 16 },
  ];
  ws.getCell('A1').value = `Stock used, ${r.from} to ${r.to}`;
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFE3001B' } };
  ws.getCell('A2').value = `${meta.scope}. Used = issued − returned; reversed issues and returns are left out. `
    + `Value = used × unit price now, excl. VAT, ${meta.currency}.`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };
  const header = ws.getRow(4);
  header.values = ['Code', 'Item', 'Unit', 'Issued', 'Returned', 'Used', `Unit price (${meta.currency})`, `Value (${meta.currency})`];
  header.font = { bold: true };
  header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });

  const categories = [...new Set(r.items.map((i) => i.category))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  for (const category of categories) {
    const group = r.items.filter((i) => i.category === category);
    ws.addRow([`${CATEGORY_LABEL[category] ?? category} (${group.length})`]).font = { bold: true, size: 12 };
    for (const i of group) {
      const row = ws.addRow({ sku: i.sku, name: i.name, unit: i.unitOfMeasure, issued: i.issued, returned: i.returned, used: i.used, price: i.unitCost, value: i.value });
      for (const k of ['issued', 'returned', 'used']) row.getCell(k).numFmt = QTY;
      row.getCell('price').numFmt = MONEY;
      row.getCell('value').numFmt = MONEY;
    }
    const sub = ws.addRow({ name: `Subtotal ${CATEGORY_LABEL[category] ?? category}`, value: r.byCategory.find((c) => c.category === category)?.value ?? 0 });
    sub.font = { bold: true };
    sub.getCell('value').numFmt = MONEY;
    ws.addRow([]);
  }
  if (r.items.length === 0) {
    ws.addRow(['Nothing was issued in this period.']);
  } else {
    const total = ws.addRow({ name: `Total stock used (${r.total.items} items)`, value: r.total.value });
    total.font = { bold: true, size: 12 };
    total.getCell('value').numFmt = MONEY;
    if (r.total.unpriced > 0) ws.addRow({ name: `${r.total.unpriced} item${r.total.unpriced === 1 ? ' has' : 's have'} no unit price and ${r.total.unpriced === 1 ? 'is' : 'are'} not in the total.` });
  }

  // ── By project ────────────────────────────────────────────────────────
  const wp = wb.addWorksheet('By project');
  wp.columns = [{ key: 'project', width: 18 }, { key: 'name', width: 40 }, { key: 'items', width: 10 }, { key: 'value', width: 16 }];
  wp.getCell('A1').value = `Stock used by project, ${r.from} to ${r.to}`;
  wp.getCell('A1').font = { bold: true, size: 14 };
  const ph = wp.getRow(3);
  ph.values = ['Project', 'Name', 'Items', `Value (${meta.currency})`];
  ph.font = { bold: true };
  for (const p of r.byProject) {
    const row = wp.addRow({ project: p.projectNumber ?? 'No project', name: p.projectName ?? '', items: p.items, value: p.value });
    row.getCell('value').numFmt = MONEY;
  }
  const pt = wp.addRow({ name: 'Total', value: r.total.value });
  pt.font = { bold: true };
  pt.getCell('value').numFmt = MONEY;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
