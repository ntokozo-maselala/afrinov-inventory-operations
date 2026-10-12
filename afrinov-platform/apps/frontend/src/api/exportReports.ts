// Excel downloads for the grouped Movements reports (received stock, issued
// stock, stock counts), built in the browser from the same API the page shows, so live and
// frontend-only mode give the same file. One row per line, with the delivery or
// issue or count it belongs to repeated, so the sheet can be sorted and filtered.
import { api } from './client';
import { triggerDownload } from './exportReport';
import type { CountRecord, IssueSlip, ReceiptRecord } from './types';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The most records one download fetches; the page asks for a shorter range beyond it. */
const LIMIT = 2_000;

async function fetchAll<T extends { cursor: string }>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let before = ''; ;) {
    const page = await api.get<T[]>(`${path}&limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    rows.push(...page);
    if (page.length < 200) return rows;
    if (rows.length >= LIMIT) throw new Error(`More than ${LIMIT} records match. Choose a shorter date range.`);
    before = page[page.length - 1]!.cursor;
  }
}

function fileRange(query: string): string {
  const p = new URLSearchParams(query);
  const from = p.get('from') ?? '';
  const to = p.get('to') ?? from;
  return to && to !== from ? `${from}-to-${to}` : from;
}

async function download(title: string, file: string, header: string[], rows: Array<Array<string | number | Date | null>>, empty: string) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getRow(3).values = header;
  ws.getRow(3).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  if (rows.length === 0) ws.addRow([empty]);
  ws.columns.forEach((c) => { c.width = 18; });
  triggerDownload(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX }), file);
}

export async function downloadReceivedStock(query: string): Promise<void> {
  const receipts = await fetchAll<ReceiptRecord>(`/stock-receipts?${query}`);
  await download(
    'Received stock',
    `afrinov-received-stock-${fileRange(query)}.xlsx`,
    ['Delivery date', 'Supplier', 'Delivery note / invoice no.', 'Receipt no.', 'Received by', 'Code', 'Item', 'Into location', 'Quantity', 'Unit'],
    receipts.flatMap((r) => r.lines.map((l) => [
      new Date(r.receivedAt), r.supplierName, r.deliveryRef ?? '', r.number, r.receivedByName, l.sku, l.name, l.locationName, Number(l.quantity), l.unitOfMeasure,
    ])),
    'No stock was received on these dates.',
  );
}

export async function downloadIssuedStock(query: string): Promise<void> {
  const slips = await fetchAll<IssueSlip>(`/inventory-issues?${query}`);
  await download(
    'Issued stock',
    `afrinov-issued-stock-${fileRange(query)}.xlsx`,
    ['Issued', 'Issued to', 'Project', 'Issued by', 'Code', 'Item', 'From location', 'Issued qty', 'Returned', 'Unit', 'Reversed'],
    slips.flatMap((s) => s.lines.map((l) => [
      new Date(s.issuedAt), s.recipientName ?? 'Not recorded', s.projectNumber ?? '', s.issuedByName, l.materialSku, l.materialName, l.locationName,
      Math.abs(Number(l.quantity)), Number(l.returnedQuantity ?? 0), l.unitOfMeasure ?? '', l.reversedById ? 'Yes' : '',
    ])),
    'No stock was issued on these dates.',
  );
}

export async function downloadStockCounts(query: string): Promise<void> {
  const counts = await fetchAll<CountRecord>(`/stock-counts?${query}`);
  await download(
    'Stock counts',
    `afrinov-stock-counts-${fileRange(query)}.xlsx`,
    ['Counted', 'Location', 'Counted by', 'Items counted', 'Differences', 'Note', 'Code', 'Item', 'System', 'Counted qty', 'Difference', 'Unit'],
    counts.flatMap((c) => {
      const head = [new Date(c.at), c.locationName, c.countedByName, c.counted, c.adjusted, c.note ?? ''];
      // A full sheet where one was kept; older counts give their differences only.
      if (c.lines.length > 0) {
        return c.lines.map((l) => [...head, l.sku, l.name, Number(l.expected), Number(l.counted), Math.round((Number(l.counted) - Number(l.expected)) * 10000) / 10000, l.unitOfMeasure]);
      }
      return c.differences.length === 0
        ? [[...head, '', 'No differences', null, null, null, '']]
        : c.differences.map((d) => [...head, d.sku, d.name, null, null, Number(d.quantity), d.unitOfMeasure]);
    }),
    'No counts were posted on these dates.',
  );
}
