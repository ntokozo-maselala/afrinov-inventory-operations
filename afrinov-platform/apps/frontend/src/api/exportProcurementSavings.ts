// Download the Procurement savings report as Excel. Live: the backend's
// GET /reports/procurement-savings/export. Frontend-only mode builds the same
// sheet here from the mock report.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { SavingsPrice, SavingsReport } from './reportTypes';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The PDF is made by the server only, so frontend-only mode offers Excel alone. */
export const SAVINGS_PDF_AVAILABLE = !FRONTEND_ONLY;

export async function downloadProcurementSavings(query: string, format: 'xlsx' | 'pdf' = 'xlsx'): Promise<void> {
  const params = new URLSearchParams(query);
  const project = params.get('projectNumber');
  const fallback = `afrinov-procurement-savings${project ? `-${project.replace(/[^A-Za-z0-9-]+/g, '-')}` : ''}-${params.get('from') ?? ''}-to-${params.get('to') ?? ''}.${format}`;
  if (FRONTEND_ONLY) {
    if (format === 'pdf') throw new Error('The PDF is not available in demo mode. Download Excel instead.');
    triggerDownload(new Blob([await buildInBrowser(query)], { type: XLSX }), fallback);
    return;
  }
  const token = getToken();
  const type = format === 'pdf' ? 'application/pdf' : XLSX;
  let res: Response;
  try {
    res = await fetch(`/api/v1/reports/procurement-savings/export?${query}${format === 'pdf' ? '&format=pdf' : ''}`, {
      headers: { Accept: type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  const r = await api.get<SavingsReport>(`/reports/procurement-savings?${query}`);
  const { default: ExcelJS } = await import('exceljs');
  const list = (prices: SavingsPrice[] | undefined) => (prices ?? []).map((p) => `${p.supplier}: ${p.currency} ${Number(p.lineTotal).toFixed(2)}`).join('\n');
  const n = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Procurement savings');
  ws.getCell('A1').value = `Procurement savings, ${r.from} to ${r.to}`;
  ws.getCell('A2').value = `Line totals excl. VAT, ${r.currency}. Quotes are compared at their lowest; the order is before line discounts.`;
  ws.getRow(5).values = [
    'Project', 'Procurement RFQ', 'Material', 'Unit', 'Qty', 'Procurement prices', 'Procurement lowest',
    'Order', 'Order price', 'Line discount', 'Procurement vs order', 'Notes',
  ];
  ws.getRow(5).font = { bold: true };
  for (const row of r.rows) {
    ws.addRow([
      row.projectNumber ?? '', row.rfqNumber, `${row.sku} ${row.material}`, row.unitOfMeasure, Number(row.quantity),
      list(row.procurement.prices), n(row.procurement.lowest),
      row.order?.number ?? '', n(row.order?.lineTotal), n(row.order?.discount), n(row.procurementVsOrder), row.notes.join('\n'),
    ]);
  }
  if (r.rows.length === 0) ws.addRow(['No Procurement RFQ was sent for this selection in this period.']);
  else {
    const t = r.total;
    ws.addRow([null, null, `Total (${t.lines} line${t.lines === 1 ? '' : 's'})`, null, null, null, Number(t.procurement), null, Number(t.order), Number(t.discount), Number(t.procurementVsOrder)]).font = { bold: true };
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
