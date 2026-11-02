// The Movements list as an Excel file: one row per movement, newest first,
// for the date range and filters the user chose. Quantities stay numbers so
// they can be summed per item in Excel; a tool loan due date change moves no
// stock, so its quantity is left blank.
import ExcelJS from 'exceljs';
import { takesResponsible, type InventoryService } from './inventory.service.js';

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
  LOAN: 'Check out',
  LOAN_RETURN: 'Check in',
  DUE_DATE_CHANGE: 'Due date moved',
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

/** When a tool loan is due, as its row tells it: agreed at check-out, as it stood at check-in, or the change. */
export function dueText(m: Pick<MovementRow, 'type' | 'dueOn' | 'previousDueOn' | 'currentDueOn' | 'daysLate'>): string {
  if (!m.dueOn) return '';
  if (m.type === 'DUE_DATE_CHANGE') return m.previousDueOn ? `${m.previousDueOn} → ${m.dueOn}` : m.dueOn;
  if (m.type === 'LOAN') return m.currentDueOn && m.currentDueOn !== m.dueOn ? `${m.dueOn} (now ${m.currentDueOn})` : m.dueOn;
  if (m.type === 'LOAN_RETURN' && m.daysLate !== null) return m.daysLate > 0 ? `${m.dueOn} (${m.daysLate} day${m.daysLate === 1 ? '' : 's'} late)` : `${m.dueOn} (on time)`;
  return m.dueOn;
}

/** The note, with why tools were lent to someone with an overdue one. */
export function noteText(m: Pick<MovementRow, 'reasonNote' | 'overdueOverrideReason'>): string {
  return [m.reasonNote, m.overdueOverrideReason ? `Lent while overdue: ${m.overdueOverrideReason}` : null].filter(Boolean).join(' · ');
}

/** The person column, named for the report: who it was issued to, unless the report says otherwise. */
const PERSON_HEADER: Partial<Record<string, string>> = { writeoffs: 'Responsible', loans: 'Checked out to', returned: 'Returned by' };

export async function buildMovementsXlsx(rows: MovementRow[], meta: { scope: string; generatedAt: Date; report?: string }): Promise<Buffer> {
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
    { key: 'due', width: 24 },
    { key: 'reason', width: 15 },
    { key: 'note', width: 30 },
    { key: 'reference', width: 34 },
    { key: 'by', width: 20 },
  ];

  ws.getCell('A1').value = 'Stock movements';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `${meta.scope} · ${rows.length} movement${rows.length === 1 ? '' : 's'} · exported ${meta.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const header = ws.getRow(4);
  const person = (meta.report && PERSON_HEADER[meta.report]) ?? 'Issued to';
  header.values = ['When', 'Type', 'Code', 'Item', 'Location', 'Quantity', 'Unit', person, 'Project', 'Due back', 'Reason', 'Note', 'Reference', 'By'];
  header.font = { bold: true };

  for (const m of rows) {
    const type = TYPE_LABEL[m.type] ?? m.type;
    ws.addRow({
      when: new Date(m.postedAt),
      type: m.reversesId ? `${type} (reversal)` : m.reversedById ? `${type} (reversed)` : type,
      sku: m.materialSku,
      name: m.materialName,
      location: m.locationName,
      quantity: m.quantity === null ? null : Number(m.quantity),
      unit: m.unitOfMeasure,
      to: m.recipientName ?? (meta.report === 'writeoffs' && m.reasonCode && takesResponsible(m.reasonCode) ? 'Not known' : ''),
      project: m.projectNumber ?? '',
      due: dueText(m),
      reason: m.reasonCode ? m.reasonCode.replace(/_/g, ' ').toLowerCase() : '',
      note: noteText(m),
      reference: reference(m),
      by: m.actorName,
    });
  }
  ws.getColumn('when').numFmt = 'yyyy-mm-dd hh:mm';
  ws.getColumn('quantity').numFmt = QTY;
  if (rows.length === 0) ws.addRow({ when: 'No movements match these filters.' });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
