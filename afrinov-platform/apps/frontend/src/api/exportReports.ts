// Excel downloads for the grouped Movements reports (received stock, issued
// stock, stock counts), built in the browser from the same API the page shows, so live and
// frontend-only mode give the same file. One row per line, with the delivery or
// issue or count it belongs to repeated, so the sheet can be sorted and filtered.
// The PDF copies keep each delivery, issue slip or count together instead.
import { api } from './client';
import { triggerDownload } from './exportReport';
import type { CountRecord, IssueSlip, ReceiptRecord } from './types';
import { downloadPdf, type PdfAbout } from '../lib/pdf';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';

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
    ['Counted', 'Location', 'Counted by', 'Items counted', 'Differences', 'Note', 'Code', 'Item', 'System', 'Counted qty', 'Difference', 'Unit', 'Item note'],
    counts.flatMap((c) => {
      const head = [new Date(c.at), c.locationName, c.countedByName, c.counted, c.adjusted, c.note ?? ''];
      // A full sheet where one was kept; older counts give their differences only.
      if (c.lines.length > 0) {
        return c.lines.map((l) => [...head, l.sku, l.name, Number(l.expected), Number(l.counted), Math.round((Number(l.counted) - Number(l.expected)) * 10000) / 10000, l.unitOfMeasure, l.note ?? '']);
      }
      return c.differences.length === 0
        ? [[...head, '', 'No differences', null, null, null, '']]
        : c.differences.map((d) => [...head, d.sku, d.name, null, null, Number(d.quantity), d.unitOfMeasure]);
    }),
    'No counts were posted on these dates.',
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Received stock as a PDF: each delivery with its supplier, delivery note and lines. */
export async function downloadReceivedStockPdf(query: string, about: PdfAbout): Promise<void> {
  const receipts = await fetchAll<ReceiptRecord>(`/stock-receipts?${query}`);
  await downloadPdf({
    ...about,
    lines: [...about.lines, `${plural(receipts.length, 'delivery', 'deliveries')}, ${plural(receipts.reduce((n, r) => n + r.lines.length, 0), 'line')}`],
    sections: receipts.length === 0
      ? [{ columns: [], rows: [], empty: 'No stock was received on these dates.' }]
      : receipts.map((r) => ({
        heading: `${formatDate(r.receivedAt)}  ·  ${r.supplierName}  ·  ${r.deliveryRef ?? 'No delivery note'}`,
        note: `Receipt ${r.number}, received by ${r.receivedByName}`,
        columns: [{ header: 'Code' }, { header: 'Item', wrap: true }, { header: 'Into location', wrap: true }, { header: 'Quantity', align: 'right' as const }, { header: 'Unit' }],
        rows: r.lines.map((l) => [l.sku, l.name, l.locationName, formatNumber(Number(l.quantity)), l.unitOfMeasure]),
      })),
  }, `afrinov-received-stock-${fileRange(query)}.pdf`);
}

/** Issued stock as a PDF: each issue slip with who it went to, the project and its lines. */
export async function downloadIssuedStockPdf(query: string, about: PdfAbout): Promise<void> {
  const slips = await fetchAll<IssueSlip>(`/inventory-issues?${query}`);
  await downloadPdf({
    ...about,
    lines: [...about.lines, `${plural(slips.length, 'issue')}, ${plural(slips.reduce((n, s) => n + s.lines.length, 0), 'line')}`],
    sections: slips.length === 0
      ? [{ columns: [], rows: [], empty: 'No stock was issued on these dates.' }]
      : slips.map((s) => ({
        heading: `${formatDateTime(s.issuedAt)}  ·  Issued to ${s.recipientName ?? 'not recorded'}${s.projectNumber ? `  ·  Project ${s.projectNumber}` : ''}`,
        note: `Issued by ${s.issuedByName}`,
        columns: [
          { header: 'Code' }, { header: 'Item', wrap: true }, { header: 'From location', wrap: true },
          { header: 'Issued', align: 'right' as const }, { header: 'Returned', align: 'right' as const },
          { header: 'Unit' }, { header: 'Reversed' },
        ],
        rows: s.lines.map((l) => [
          l.materialSku, l.materialName, l.locationName, formatNumber(Math.abs(Number(l.quantity))),
          Number(l.returnedQuantity ?? 0) ? formatNumber(Number(l.returnedQuantity)) : '-', l.unitOfMeasure ?? '', l.reversedById ? 'Yes' : '',
        ]),
      })),
  }, `afrinov-issued-stock-${fileRange(query)}.pdf`);
}

/** Stock counts as a PDF: each count with its sheet (or, for older counts, its differences) and notes. */
export async function downloadStockCountsPdf(query: string, about: PdfAbout): Promise<void> {
  const counts = await fetchAll<CountRecord>(`/stock-counts?${query}`);
  const columns = [
    { header: 'Code' }, { header: 'Item', wrap: true }, { header: 'System', align: 'right' as const },
    { header: 'Counted', align: 'right' as const }, { header: 'Difference', align: 'right' as const },
    { header: 'Unit' }, { header: 'Note', wrap: true },
  ];
  await downloadPdf({
    ...about,
    lines: [...about.lines, plural(counts.length, 'count')],
    sections: counts.length === 0
      ? [{ columns: [], rows: [], empty: 'No counts were posted on these dates.' }]
      : counts.map((c) => ({
        heading: `${formatDateTime(c.at)}  ·  ${c.locationName}  ·  ${plural(c.counted, 'item')} counted, ${plural(c.adjusted, 'difference')}`,
        note: [`Counted by ${c.countedByName}`, c.note, c.lines.length === 0 && c.differences.length > 0 ? 'Posted before full sheets were kept: differences only.' : null].filter(Boolean).join('. '),
        columns,
        rows: c.lines.length > 0
          ? c.lines.map((l) => {
            const diff = Math.round((Number(l.counted) - Number(l.expected)) * 10000) / 10000;
            return [l.sku, l.name, formatNumber(Number(l.expected)), formatNumber(Number(l.counted)), diff === 0 ? '-' : `${diff > 0 ? '+' : ''}${formatNumber(diff)}`, l.unitOfMeasure, l.note ?? ''];
          })
          : c.differences.map((d) => [d.sku, d.name, '', '', `${Number(d.quantity) > 0 ? '+' : ''}${formatNumber(Number(d.quantity))}`, d.unitOfMeasure, '']),
        empty: 'No differences.',
      })),
  }, `afrinov-stock-counts-${fileRange(query)}.pdf`);
}
