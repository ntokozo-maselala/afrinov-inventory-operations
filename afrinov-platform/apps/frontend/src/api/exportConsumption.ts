// Download the stock-used (consumption) report as Excel. Live: the backend's
// GET /reports/consumption/export. Frontend-only mode builds the same two
// sheets here from the mock report. The PDF copy is built here in both modes.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { ConsumptionReport } from './reportTypes';
import { CATEGORIES, categoryLabel } from '../lib/categories';
import { downloadPdf, type PdfTable } from '../lib/pdf';
import { formatDate, formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';

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

/**
 * Stock used as a PDF, for the same selection as the page: the totals by
 * category, by project and by who it was issued to, then each item used.
 * `filters` says in words what the selection is, e.g. "Project: P-104 · Mall".
 */
export async function downloadConsumptionPdf(query: string, filters: string[]): Promise<void> {
  const r = await api.get<ConsumptionReport>(`/reports/consumption?${query}`);
  const params = new URLSearchParams(query);
  const money = (n: number) => formatCurrency(n, r.currency);
  const period = `${formatDate(r.from)} to ${formatDate(r.to)}`;
  const order = CATEGORIES.map((c) => c.value);
  const categories = [...new Set(r.items.map((i) => i.category))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const nothing = 'Nothing was issued for this selection in this period.';

  const sections: PdfTable[] = [{
    heading: 'By category',
    columns: [{ header: 'Category', wrap: true }, { header: 'Items', align: 'right' }, { header: `Value (${r.currency})`, align: 'right' }],
    rows: r.byCategory.map((c) => [categoryLabel(c.category), formatNumber(c.items), money(c.value)]),
    totals: [['Total', formatNumber(r.total.items), money(r.total.value)]],
    empty: nothing,
  }];
  if (!params.get('projectNumber')) {
    sections.push({
      heading: 'By project',
      columns: [{ header: 'Project' }, { header: 'Name', wrap: true }, { header: 'Items', align: 'right' }, { header: `Value (${r.currency})`, align: 'right' }],
      rows: r.byProject.map((p) => [p.projectNumber ?? 'No project', p.projectName ?? '', formatNumber(p.items), money(p.value)]),
      totals: [['Total', '', formatNumber(r.total.items), money(r.total.value)]],
      empty: nothing,
    });
  }
  sections.push({
    heading: 'By who it was issued to',
    columns: [{ header: 'Issued to', wrap: true }, { header: 'Type' }, { header: 'Issues', align: 'right' }, { header: 'Items', align: 'right' }, { header: `Value (${r.currency})`, align: 'right' }],
    rows: r.byRecipient.map((x) => [x.name ?? 'Not recorded', x.type ? x.type.charAt(0) + x.type.slice(1).toLowerCase() : '', formatNumber(x.issues), formatNumber(x.items), money(x.value)]),
    totals: [['Total', '', '', formatNumber(r.total.items), money(r.total.value)]],
    empty: nothing,
  });
  for (const category of categories) {
    const group = r.items.filter((i) => i.category === category);
    sections.push({
      heading: `${categoryLabel(category)}: by item (${group.length})`,
      columns: [
        { header: 'Code' }, { header: 'Item', wrap: true }, { header: 'Unit' },
        { header: 'Issued', align: 'right' }, { header: 'Returned', align: 'right' }, { header: 'Used', align: 'right' },
        { header: 'Unit price', align: 'right' }, { header: 'Value', align: 'right' },
      ],
      rows: group.map((i) => [
        i.sku, i.name, i.unitOfMeasure, formatNumber(i.issued), i.returned ? formatNumber(i.returned) : '-', formatNumber(i.used),
        i.unitCost === null ? '-' : money(i.unitCost), i.value === null ? '-' : money(i.value),
      ]),
      totals: [['', `Subtotal ${categoryLabel(category)}`, '', '', '', '', '', money(r.byCategory.find((c) => c.category === category)?.value ?? 0)]],
    });
  }
  if (r.lines) {
    sections.push({
      heading: `Issued to ${r.byRecipient[0]?.name ?? 'the recipient'}, issue by issue`,
      columns: [
        { header: 'Date' }, { header: 'Issue/Return' }, { header: 'Code' }, { header: 'Item', wrap: true },
        { header: 'Quantity', align: 'right' }, { header: 'Unit' }, { header: 'Project' }, { header: 'Issued by' },
      ],
      rows: r.lines.map((l) => [formatDate(l.postedAt), l.type === 'ISSUE' ? 'Issue' : 'Return', l.sku, l.name, formatNumber(l.quantity), l.unitOfMeasure, l.projectNumber ?? '', l.issuedBy]),
    });
  }

  const project = params.get('projectNumber');
  await downloadPdf({
    title: `Stock used, ${period}`,
    lines: [
      ...(filters.length ? [filters.join('  ·  ')] : ['All projects, everyone, all categories']),
      'Used = issued - returned; reversed issues and returns are left out. Value = used x unit price now, excl. VAT.',
    ],
    sections,
    notes: r.total.unpriced > 0 ? [`${r.total.unpriced} item${r.total.unpriced === 1 ? ' has' : 's have'} no unit price and ${r.total.unpriced === 1 ? 'is' : 'are'} not in the values.`] : [],
  }, `afrinov-consumption${project ? `-${project.replace(/[^A-Za-z0-9-]+/g, '-')}` : ''}-${r.from}-to-${r.to}.pdf`);
}
