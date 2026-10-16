// Download the Movements list, with its filters, as Excel. Live: the backend's
// GET /inventory-transactions/export. Frontend-only mode builds the same sheet
// here from the mock history. The PDF copy is built here in both modes.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { MovementRow } from './types';
import { downloadPdf, type PdfAbout, type PdfColumn } from '../lib/pdf';
import { formatDateTime, formatNumber } from '../lib/format';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LIMIT = 10_000;

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: 'Receipt', ISSUE: 'Issue', TRANSFER_OUT: 'Transfer out', TRANSFER_IN: 'Transfer in', ADJUSTMENT: 'Adjustment', RETURN: 'Return', LOAN: 'Tool out', LOAN_RETURN: 'Tool back',
};

export async function downloadMovements(query: string): Promise<void> {
  const params = new URLSearchParams(query);
  const from = params.get('from');
  const to = params.get('to');
  const fallback = `afrinov-movements-${from || to ? `${from ?? 'start'}-to-${to ?? 'today'}` : new Date().toISOString().slice(0, 10)}.xlsx`;
  if (FRONTEND_ONLY) {
    triggerDownload(new Blob([await buildInBrowser(query)], { type: XLSX }), fallback);
    return;
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1/inventory-transactions/export?${query}`, {
      headers: { Accept: XLSX, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('Download failed: the file was empty.');
  triggerDownload(blob, filenameFromDisposition(res.headers.get('content-disposition'), fallback));
}

async function buildInBrowser(query: string): Promise<ArrayBuffer> {
  const rows: MovementRow[] = [];
  for (let before = ''; rows.length < LIMIT;) {
    const page = await api.get<MovementRow[]>(`/inventory-transactions?${query}&limit=1000${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    rows.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1]!.cursor;
  }
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Movements');
  ws.getCell('A1').value = 'Stock movements';
  ws.getCell('A2').value = `${rows.length} movement${rows.length === 1 ? '' : 's'}`;
  ws.getRow(4).values = ['When', 'Type', 'Code', 'Item', 'Location', 'Quantity', 'Unit', 'Issued to', 'Project', 'Reason', 'Note', 'Reference', 'By'];
  ws.getRow(4).font = { bold: true };
  for (const m of rows) {
    const type = TYPE_LABEL[m.type] ?? m.type;
    ws.addRow([
      new Date(m.postedAt),
      m.reversesId ? `${type} (reversal)` : m.reversedById ? `${type} (reversed)` : type,
      m.materialSku, m.materialName, m.locationName, Number(m.quantity), m.unitOfMeasure ?? '',
      m.recipientName ?? '', m.projectNumber ?? '', m.reasonCode ? m.reasonCode.replace(/_/g, ' ').toLowerCase() : '', m.reasonNote ?? '',
      m.receiptNumber ? [m.receiptNumber, m.supplierName, m.deliveryRef].filter(Boolean).join(' · ') : m.referenceType === 'StockCount' ? 'Stock count' : m.referenceType ?? '',
      m.actorName,
    ]);
  }
  if (rows.length === 0) ws.addRow(['No movements match these filters.']);
  return wb.xlsx.writeBuffer();
}

/** The most movements one PDF holds; beyond it the page asks for a shorter range. */
const PDF_LIMIT = 5_000;

const reason = (m: MovementRow) => (m.reasonCode ? m.reasonCode.replace(/_/g, ' ').toLowerCase() : '');
const typeLabel = (m: MovementRow) => {
  const type = TYPE_LABEL[m.type] ?? m.type;
  return m.reversesId ? `${type} (reversal)` : m.reversedById ? `${type} (reversed)` : type;
};

/** Each ledger report's columns, as the page shows them. */
const condition = (m: MovementRow) => (m.type !== 'LOAN_RETURN' ? '' : m.reasonCode === 'DAMAGE' ? 'Damaged' : m.reasonCode === 'LOSS' ? 'Lost' : 'Good');

const LEDGER: Record<'all' | 'transfers' | 'writeoffs' | 'loans', Array<PdfColumn & { cell: (m: MovementRow) => string }>> = {
  all: [
    { header: 'When', cell: (m) => formatDateTime(m.postedAt) },
    { header: 'Type', cell: typeLabel },
    { header: 'Code', cell: (m) => m.materialSku },
    { header: 'Item', wrap: true, cell: (m) => m.materialName },
    { header: 'Location', wrap: true, cell: (m) => m.locationName },
    { header: 'Quantity', align: 'right', cell: (m) => formatNumber(Number(m.quantity)) },
    { header: 'Unit', cell: (m) => m.unitOfMeasure ?? '' },
    { header: 'Reason', wrap: true, cell: (m) => [reason(m), m.reasonNote].filter(Boolean).join(': ') },
    { header: 'Issued to', wrap: true, cell: (m) => m.recipientName ?? '' },
    { header: 'Project', cell: (m) => m.projectNumber ?? '' },
    { header: 'By', cell: (m) => m.actorName },
  ],
  transfers: [
    { header: 'When', cell: (m) => formatDateTime(m.postedAt) },
    { header: 'Code', cell: (m) => m.materialSku },
    { header: 'Item', wrap: true, cell: (m) => m.materialName },
    { header: 'From', wrap: true, cell: (m) => m.locationName },
    { header: 'To', wrap: true, cell: (m) => m.otherLocationName ?? '' },
    { header: 'Quantity', align: 'right', cell: (m) => formatNumber(Math.abs(Number(m.quantity))) },
    { header: 'Unit', cell: (m) => m.unitOfMeasure ?? '' },
    { header: 'By', cell: (m) => m.actorName },
  ],
  writeoffs: [
    { header: 'When', cell: (m) => formatDateTime(m.postedAt) },
    { header: 'Code', cell: (m) => m.materialSku },
    { header: 'Item', wrap: true, cell: (m) => m.materialName },
    { header: 'Location', wrap: true, cell: (m) => m.locationName },
    { header: 'Quantity', align: 'right', cell: (m) => formatNumber(Number(m.quantity)) },
    { header: 'Unit', cell: (m) => m.unitOfMeasure ?? '' },
    { header: 'Reason', wrap: true, cell: reason },
    { header: 'Note', wrap: true, cell: (m) => m.reasonNote ?? '' },
    { header: 'By', cell: (m) => m.actorName },
  ],
  loans: [
    { header: 'When', cell: (m) => formatDateTime(m.postedAt) },
    { header: 'Movement', cell: typeLabel },
    { header: 'Code', cell: (m) => m.materialSku },
    { header: 'Tool', wrap: true, cell: (m) => m.materialName },
    { header: 'Quantity', align: 'right', cell: (m) => formatNumber(Math.abs(Number(m.quantity))) },
    { header: 'Person', wrap: true, cell: (m) => m.recipientName ?? '' },
    { header: 'Project', cell: (m) => m.projectNumber ?? '' },
    { header: 'Location', wrap: true, cell: (m) => m.locationName },
    { header: 'Condition', cell: condition },
    { header: 'Note', wrap: true, cell: (m) => m.reasonNote ?? '' },
    { header: 'By', cell: (m) => m.actorName },
  ],
};

/**
 * A ledger report (all movements, transfers, or write-offs and adjustments) as
 * a PDF, with the page's columns, for the same day or range and filters.
 */
export async function downloadMovementsPdf(query: string, kind: 'all' | 'transfers' | 'writeoffs' | 'loans', about: PdfAbout): Promise<void> {
  const path = `/inventory-transactions?${query}${kind === 'all' ? '' : `&report=${kind}`}`;
  const rows: MovementRow[] = [];
  for (let before = ''; ;) {
    const page = await api.get<MovementRow[]>(`${path}&limit=1000${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    rows.push(...page);
    if (page.length < 1000) break;
    if (rows.length >= PDF_LIMIT) throw new Error(`More than ${PDF_LIMIT} movements match. Choose a shorter date range.`);
    before = page[page.length - 1]!.cursor;
  }
  const columns = LEDGER[kind];
  const params = new URLSearchParams(query);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? from;
  await downloadPdf({
    ...about,
    lines: [...about.lines, `${rows.length} movement${rows.length === 1 ? '' : 's'}`],
    sections: [{ columns, rows: rows.map((m) => columns.map((c) => c.cell(m))), empty: 'No movements match these filters.' }],
  }, `afrinov-${kind === 'all' ? 'movements' : kind}-${to && to !== from ? `${from}-to-${to}` : from}.pdf`);
}
