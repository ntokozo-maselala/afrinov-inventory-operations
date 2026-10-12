// Download the Movements list, with its filters, as Excel. Live: the backend's
// GET /inventory-transactions/export. Frontend-only mode builds the same sheet
// here from the mock history.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { MovementRow } from './types';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LIMIT = 10_000;

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: 'Receipt', ISSUE: 'Issue', TRANSFER_OUT: 'Transfer out', TRANSFER_IN: 'Transfer in', ADJUSTMENT: 'Adjustment', RETURN: 'Return',
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
