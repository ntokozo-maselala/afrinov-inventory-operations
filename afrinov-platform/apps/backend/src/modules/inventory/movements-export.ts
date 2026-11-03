// The Movements list as an Excel file: one row per movement, newest first,
// for the date range and filters the user chose. Quantities stay numbers so
// they can be summed per item in Excel; a tool loan due date change, and a
// used up or broken mark or its withdrawal, move no stock, so their quantity
// is left blank.
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
  USED_UP: 'Used up',
  BROKEN: 'Broken',
  OUTCOME_WITHDRAWN: 'Withdrawn',
};

const n = (q: string | null | undefined) => Number(q ?? 0);
/** Quantities are kept to four decimal places; rounding there drops floating-point dust (1.1 − 1 − 0.1). */
const round4 = (x: number) => Math.round(x * 1e4) / 1e4 || 0; // never -0
/** A figure as the downloads write it, in the browser too: plain digits, at most four decimals. */
const figureText = (x: number) => String(round4(x));
const stillOutOf = (m: Pick<MovementRow, 'quantity' | 'returnedQuantity' | 'usedUpQuantity' | 'brokenQuantity'>) =>
  round4(-n(m.quantity) - n(m.returnedQuantity) - n(m.usedUpQuantity) - n(m.brokenQuantity));

/**
 * The Used up, Broken and Still out columns (Qodo, PR #144): what each row
 * itself recorded, so a column adds up in Excel. A counter visit (a return, or
 * a mark of its own) gives its used up and broken, a withdrawal the same as a
 * negative; an issue of an item that tracks use, or that was marked, gives how
 * much is still out now. Blank on everything else.
 */
export function figureColumns(m: Pick<MovementRow, 'type' | 'quantity' | 'reversesId' | 'reversedById' | 'returnedQuantity' | 'usedUpQuantity' | 'brokenQuantity' | 'trackUse'>): {
  usedUp: number | null; broken: number | null; stillOut: number | null;
} {
  const blank = { usedUp: null, broken: null, stillOut: null };
  if (m.reversesId) return blank;
  const sign = m.type === 'OUTCOME_WITHDRAWN' ? -1 : 1;
  const figure = (q: string | null | undefined) => (n(q) > 0 ? sign * n(q) : null);
  if (m.type === 'RETURN' || m.type === 'USED_UP' || m.type === 'BROKEN' || m.type === 'OUTCOME_WITHDRAWN') {
    return { usedUp: figure(m.usedUpQuantity), broken: figure(m.brokenQuantity), stillOut: null };
  }
  if (m.type === 'ISSUE' && !m.reversedById && m.quantity !== null && (m.trackUse || n(m.usedUpQuantity) + n(m.brokenQuantity) > 0)) {
    return { ...blank, stillOut: stillOutOf(m) };
  }
  return blank;
}

/**
 * The reason column (ADR-026): on an issue of an item that tracks use, how
 * much is still out; on a return, what came back in that visit; on a mark or
 * its withdrawal, how many; else the reason code. The browser's download
 * (frontend lib/movementReason.ts movementReason) writes exactly the same
 * text; both are tested against movement-reason.cases.json.
 */
export function reasonText(m: Pick<MovementRow, 'type' | 'quantity' | 'reasonCode' | 'reversesId' | 'returnedQuantity' | 'usedUpQuantity' | 'brokenQuantity' | 'trackUse'>): string {
  const parts: string[] = [];
  if (m.type === 'ISSUE' && !m.reversesId && m.quantity !== null && (m.trackUse || n(m.usedUpQuantity) + n(m.brokenQuantity) > 0)) {
    parts.push(`still out ${figureText(stillOutOf(m))}`);
  }
  if ((m.type === 'RETURN' && !m.reversesId) || m.type === 'USED_UP' || m.type === 'BROKEN' || m.type === 'OUTCOME_WITHDRAWN') {
    const figures = [
      m.type === 'RETURN' && `back ${figureText(n(m.quantity))}`,
      n(m.usedUpQuantity) > 0 && `used up ${figureText(n(m.usedUpQuantity))}`,
      n(m.brokenQuantity) > 0 && `broken ${figureText(n(m.brokenQuantity))}`,
    ].filter(Boolean).join(', ');
    parts.push(m.type === 'OUTCOME_WITHDRAWN' ? `withdrawn: ${figures}` : figures);
  }
  if (m.reasonCode) parts.push(m.reasonCode.replace(/_/g, ' ').toLowerCase());
  return parts.join(' · ');
}

const QTY = '#,##0.####';

export function movementsFilename(from: string | undefined, to: string | undefined, now: Date): string {
  const range = from || to ? `${from ?? 'start'}-to-${to ?? now.toISOString().slice(0, 10)}` : now.toISOString().slice(0, 10);
  return `afrinov-movements-${range}.xlsx`;
}

/** What the reference column says: the receipt's supplier and delivery note, or the kind of record. */
function reference(m: MovementRow): string {
  if (m.receiptNumber) return [m.receiptNumber, m.supplierName, m.deliveryRef].filter(Boolean).join(' · ');
  if (m.referenceType === 'StockCount') return 'Stock count';
  if (m.returnOf) return `${m.type === 'RETURN' ? 'Return' : 'Mark'} on the issue of ${m.returnOf.postedAt.slice(0, 10)} from ${m.returnOf.locationName}`;
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
    { key: 'usedUp', width: 10 },
    { key: 'broken', width: 10 },
    { key: 'stillOut', width: 10 },
  ];

  ws.getCell('A1').value = 'Stock movements';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `${meta.scope} · ${rows.length} movement${rows.length === 1 ? '' : 's'} · exported ${meta.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const header = ws.getRow(4);
  const person = (meta.report && PERSON_HEADER[meta.report]) ?? 'Issued to';
  header.values = ['When', 'Type', 'Code', 'Item', 'Location', 'Quantity', 'Unit', person, 'Project', 'Due back', 'Reason', 'Note', 'Reference', 'By', 'Used up', 'Broken', 'Still out'];
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
      reason: reasonText(m),
      note: noteText(m),
      reference: reference(m),
      by: m.actorName,
      ...figureColumns(m),
    });
  }
  ws.getColumn('when').numFmt = 'yyyy-mm-dd hh:mm';
  for (const key of ['quantity', 'usedUp', 'broken', 'stillOut']) ws.getColumn(key).numFmt = QTY;
  if (rows.length === 0) ws.addRow({ when: 'No movements match these filters.' });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
