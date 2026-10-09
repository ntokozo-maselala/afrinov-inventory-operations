// Download the stock-used (consumption) report as Excel. Live: the backend's
// GET /reports/consumption/export. Frontend-only mode builds the same two
// sheets here from the mock report.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { ConsumptionReport } from './reportTypes';
import { CATEGORIES, categoryLabel } from '../lib/categories';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function downloadConsumption(query: string): Promise<void> {
  const params = new URLSearchParams(query);
  const fallback = `afrinov-consumption-${params.get('from') ?? ''}-to-${params.get('to') ?? ''}.xlsx`;
  if (FRONTEND_ONLY) {
    triggerDownload(new Blob([await buildInBrowser(query)], { type: XLSX }), fallback);
    return;
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1/reports/consumption/export?${query}`, {
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
  const r = await api.get<ConsumptionReport>(`/reports/consumption?${query}`);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('By item');
  ws.getCell('A1').value = `Stock used, ${r.from} to ${r.to}`;
  ws.getCell('A2').value = 'Used = issued − returned; reversed issues and returns are left out. Value = used × unit price now, excl. VAT.';
  ws.getRow(4).values = ['Code', 'Item', 'Unit', 'Issued', 'Returned', 'Used', 'Unit price', 'Value'];
  ws.getRow(4).font = { bold: true };
  const order = CATEGORIES.map((c) => c.value);
  const categories = [...new Set(r.items.map((i) => i.category))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  for (const category of categories) {
    const group = r.items.filter((i) => i.category === category);
    ws.addRow([`${categoryLabel(category)} (${group.length})`]).font = { bold: true };
    for (const i of group) ws.addRow([i.sku, i.name, i.unitOfMeasure, i.issued, i.returned, i.used, i.unitCost, i.value]);
    ws.addRow([null, `Subtotal ${categoryLabel(category)}`, null, null, null, null, null, r.byCategory.find((c) => c.category === category)?.value ?? 0]).font = { bold: true };
    ws.addRow([]);
  }
  if (r.items.length === 0) ws.addRow(['Nothing was issued in this period.']);
  else ws.addRow([null, `Total stock used (${r.total.items} items)`, null, null, null, null, null, r.total.value]).font = { bold: true };

  const wp = wb.addWorksheet('By project');
  wp.getCell('A1').value = `Stock used by project, ${r.from} to ${r.to}`;
  wp.getRow(3).values = ['Project', 'Name', 'Items', 'Value'];
  wp.getRow(3).font = { bold: true };
  for (const p of r.byProject) wp.addRow([p.projectNumber ?? 'No project', p.projectName ?? '', p.items, p.value]);
  wp.addRow([null, 'Total', null, r.total.value]).font = { bold: true };

  const wr = wb.addWorksheet('By recipient');
  wr.getCell('A1').value = `Stock issued by recipient, ${r.from} to ${r.to}`;
  wr.getRow(3).values = ['Issued to', 'Type', 'Issues', 'Items', 'Value'];
  wr.getRow(3).font = { bold: true };
  for (const x of r.byRecipient) wr.addRow([x.name ?? 'Not recorded', x.type ? x.type.charAt(0) + x.type.slice(1).toLowerCase() : '', x.issues, x.items, x.value]);
  wr.addRow(['Total', null, null, null, r.total.value]).font = { bold: true };

  if (r.lines) {
    const wl = wb.addWorksheet('Issues');
    wl.getCell('A1').value = `Issued to ${r.byRecipient[0]?.name ?? 'the recipient'}, ${r.from} to ${r.to}`;
    wl.getRow(3).values = ['Date', 'Issue/Return', 'Code', 'Item', 'Quantity', 'Unit', 'Project', 'Issued by'];
    wl.getRow(3).font = { bold: true };
    for (const l of r.lines) wl.addRow([new Date(l.postedAt), l.type === 'ISSUE' ? 'Issue' : 'Return', l.sku, l.name, l.quantity, l.unitOfMeasure, l.projectNumber ?? '', l.issuedBy]);
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
