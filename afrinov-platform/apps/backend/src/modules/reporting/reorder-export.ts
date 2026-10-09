// The re-order list as an Excel file for the buyer: every URGENT and WARNING
// item, grouped by category, with the quantity to order (Required Stock less
// on hand), the unit price, the value of the order and the supplier it last
// came from. Numbers stay numbers, so the buyer can sort and sum in Excel.
import ExcelJS from 'exceljs';
import type { StockStatusRow } from './reporting.service.js';
import type { StatusBands } from '../../shared/inventory/stock-status.js';

const CATEGORY_LABEL: Record<string, string> = {
  CONSUMABLES: 'Consumables',
  FASTENERS_SLUGS_INSULATION: 'Fasteners, Slugs & Insulation',
  TOOLING_PPE_ELECTRICAL: 'Tooling, PPE & Electrical',
  PROJECT_MATERIAL: 'Project Material',
  TOOLS: 'Tools',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABEL);

const STATUS_FILL: Record<string, string> = { URGENT: 'FFF8D7DA', WARNING: 'FFFFF3CD' };
const QTY = '#,##0.####';
const MONEY = '#,##0.00';

export interface ReorderMeta { generatedAt: Date; bands: StatusBands; currency: string }

export function reorderFilename(generatedAt: Date): string {
  return `afrinov-reorder-list-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
}

export async function buildReorderXlsx(rows: StockStatusRow[], meta: ReorderMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Afrinov IMS';
  wb.created = meta.generatedAt;
  const ws = wb.addWorksheet('Re-order list', { views: [{ state: 'frozen', ySplit: 4 }] });

  ws.columns = [
    { key: 'sku', width: 16 },
    { key: 'name', width: 42 },
    { key: 'unit', width: 8 },
    { key: 'status', width: 10 },
    { key: 'onHand', width: 10 },
    { key: 'required', width: 10 },
    { key: 'percent', width: 10 },
    { key: 'reorder', width: 12 },
    { key: 'price', width: 14 },
    { key: 'value', width: 16 },
    { key: 'supplier', width: 28 },
    { key: 'lastDelivered', width: 13 },
    { key: 'where', width: 30 },
  ];

  ws.getCell('A1').value = 'Re-order list';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFE3001B' } };
  ws.getCell('A2').value = `Generated ${meta.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC. `
    + `Items below ${meta.bands.warningBelowPercent}% of their Required Stock (urgent below ${meta.bands.urgentBelowPercent}%). `
    + `Re-order quantity = Required Stock − on hand. Prices excl. VAT, ${meta.currency}.`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };

  const header = ws.getRow(4);
  header.values = ['Code', 'Item', 'Unit', 'Status', 'On hand', 'Required', '% of required', 'Re-order qty',
    `Unit price (${meta.currency})`, `Re-order value (${meta.currency})`, 'Last supplier', 'Last delivered', 'Where it is kept'];
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 13 } };

  const byCategory = new Map<string, StockStatusRow[]>();
  for (const r of rows) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const categories = [...byCategory.keys()].sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99));

  let grandTotal = 0;
  let unpriced = 0;
  for (const category of categories) {
    const group = byCategory.get(category)!;
    const title = ws.addRow([`${CATEGORY_LABEL[category] ?? category} (${group.length})`]);
    title.font = { bold: true, size: 12 };

    let subtotal = 0;
    for (const r of group) {
      const reorder = Number(r.reorderQuantity);
      const price = r.unitCost === null ? null : Number(r.unitCost);
      const value = price === null ? null : Math.round(reorder * price * 100) / 100;
      if (value === null) unpriced++;
      else subtotal += value;
      const row = ws.addRow({
        sku: r.sku,
        name: r.name,
        unit: r.unitOfMeasure,
        status: r.status === 'URGENT' ? 'Urgent' : 'Warning',
        onHand: Number(r.onHand),
        required: Number(r.requiredStock),
        percent: r.percentOfRequired === null ? null : r.percentOfRequired / 100,
        reorder,
        price,
        value,
        supplier: r.lastSupplier?.name ?? '',
        lastDelivered: r.lastSupplier ? new Date(r.lastSupplier.receivedAt) : null,
        where: r.locations.map((l) => `${l.locationName} (${Number(l.quantity)})`).join(', ') || 'None on hand',
      });
      for (const key of ['onHand', 'required', 'reorder']) row.getCell(key).numFmt = QTY;
      row.getCell('percent').numFmt = '0.0%';
      row.getCell('price').numFmt = MONEY;
      row.getCell('value').numFmt = MONEY;
      row.getCell('lastDelivered').numFmt = 'yyyy-mm-dd';
      row.getCell('reorder').font = { bold: true };
      const fill = STATUS_FILL[r.status];
      if (fill) row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }
    const sub = ws.addRow({ name: `Subtotal ${CATEGORY_LABEL[category] ?? category}`, value: Math.round(subtotal * 100) / 100 });
    sub.font = { bold: true };
    sub.getCell('value').numFmt = MONEY;
    ws.addRow([]);
    grandTotal += subtotal;
  }

  if (rows.length === 0) {
    ws.addRow(['Nothing needs re-ordering: every item with a Required Stock is at or above the warning level.']);
  } else {
    const total = ws.addRow({ name: `Total re-order value (${rows.length} items)`, value: Math.round(grandTotal * 100) / 100 });
    total.font = { bold: true, size: 12 };
    total.getCell('value').numFmt = MONEY;
    if (unpriced > 0) ws.addRow({ name: `${unpriced} item${unpriced === 1 ? ' has' : 's have'} no unit price and ${unpriced === 1 ? 'is' : 'are'} not in the total.` });
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
