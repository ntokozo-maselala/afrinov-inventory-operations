// The Movements list as an Excel file: one row per movement, newest first,
// for the date range and filters the user chose. Quantities stay numbers so
// they can be summed per item in Excel.
import ExcelJS from 'exceljs';
import type { InventoryService } from './inventory.service.js';

type MovementRow = Awaited<ReturnType<typeof InventoryService.queryHistory>>[number];

/** The most rows one download holds; a wider range is refused with a message. */
export const MOVEMENTS_EXPORT_LIMIT = 10_000;

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: 'Receipt',
  ISSUE: 'Issue',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  ADJUSTMENT: 'Adjustment',
  RETURN: 'Return',
  LOAN: 'Tool out',
  LOAN_RETURN: 'Tool back',
};

const QTY = '#,##0.####';

export function movementsFilename(from: string | undefined, to: string | undefined, now: Date): string {
  const range = from || to ? `${from ?? 'start'}-to-${to ?? now.toISOString().slice(0, 10)}` : now.toISOString().slice(0, 10);
  return `afrinov-movements-${range}.xlsx`;
}

/** What the reference column says: the receipt's supplier and delivery note, or the kind of record. */
function reference(m: MovementRow): string {
  if (m.receiptNumber) return [m.receiptNumber, m.supplierName, m.deliveryRef].filter(Boolean).join(' · ');
  if (m.referenceType === 'StockCount') return 'Stock count';
  if (m.returnOf) return `Return of the issue of ${m.returnOf.postedAt.slice(0, 10)} from ${m.returnOf.locationName}`;
  return m.referenceType ?? '';
}

export async function buildMovementsXlsx(rows: MovementRow[], meta: { scope: string; generatedAt: Date }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Afrinov IMS';
  wb.created = meta.generatedAt;
  const ws = wb.addWorksheet('Movements', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [
    { key: 'when', width: 18 },
    { key: 'type', width: 13 },
    { key: 'sku', width: 18 },
    { key: 'name', width: 38 },
    { key: 'location', width: 18 },
    { key: 'quantity', width: 11 },
    { key: 'unit', width: 8 },
    { key: 'to', width: 20 },
    { key: 'project', width: 13 },
    { key: 'reason', width: 15 },
    { key: 'note', width: 30 },
    { key: 'reference', width: 34 },
    { key: 'by', width: 20 },
  ];

  ws.getCell('A1').value = 'Stock movements';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `${meta.scope} · ${rows.length} movement${rows.length === 1 ? '' : 's'} · exported ${meta.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const header = ws.getRow(4);
  header.values = ['When', 'Type', 'Code', 'Item', 'Location', 'Quantity', 'Unit', 'Issued to', 'Project', 'Reason', 'Note', 'Reference', 'By'];
  header.font = { bold: true };

  for (const m of rows) {
    const type = TYPE_LABEL[m.type] ?? m.type;
    ws.addRow({
      when: new Date(m.postedAt),
      type: m.reversesId ? `${type} (reversal)` : m.reversedById ? `${type} (reversed)` : type,
      sku: m.materialSku,
      name: m.materialName,
      location: m.locationName,
      quantity: Number(m.quantity),
      unit: m.unitOfMeasure,
      to: m.recipientName ?? '',
      project: m.projectNumber ?? '',
      reason: m.reasonCode ? m.reasonCode.replace(/_/g, ' ').toLowerCase() : '',
      note: m.reasonNote ?? '',
      reference: reference(m),
      by: m.actorName,
    });
  }
  ws.getColumn('when').numFmt = 'yyyy-mm-dd hh:mm';
  ws.getColumn('quantity').numFmt = QTY;
  if (rows.length === 0) ws.addRow({ when: 'No movements match these filters.' });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
