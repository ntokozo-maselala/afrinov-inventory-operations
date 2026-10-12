// Download the re-order list (every URGENT and WARNING item) as Excel.
//
// Live: GET /reports/reorder-list/export, built by the backend's
// reorder-export.ts. Frontend-only mode has no server, so the same sheet is
// built here from the mock's stock status, with the same columns and order.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { StockStatusItem } from '../pages/StockStatus';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fallbackName = () => `afrinov-reorder-list-${new Date().toISOString().slice(0, 10)}.xlsx`;

export async function downloadReorderList(): Promise<void> {
  if (FRONTEND_ONLY) {
    triggerDownload(new Blob([await buildInBrowser()], { type: XLSX }), fallbackName());
    return;
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch('/api/v1/reports/reorder-list/export', {
      headers: { Accept: XLSX, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('Download failed: the file was empty.');
  triggerDownload(blob, filenameFromDisposition(res.headers.get('content-disposition'), fallbackName()));
}

const CATEGORY_LABEL: Record<string, string> = {
  CONSUMABLES: 'Consumables',
  FASTENERS_SLUGS_INSULATION: 'Fasteners, Slugs & Insulation',
  TOOLING_PPE_ELECTRICAL: 'Tooling, PPE & Electrical',
  PROJECT_MATERIAL: 'Project Material',
  TOOLS: 'Tools',
};

async function buildInBrowser(): Promise<ArrayBuffer> {
  const [rows, settings] = await Promise.all([
    api.get<StockStatusItem[]>('/reports/stock-status?status=URGENT,WARNING'),
    api.get<Array<{ key: string; value: unknown }>>('/settings'),
  ]);
  const setting = (key: string, fallback: unknown) => settings.find((s) => s.key === key)?.value ?? fallback;
  const urgent = setting('inventory.urgentBelowPercent', 20);
  const warning = setting('inventory.warningBelowPercent', 40);
  const currency = String(setting('general.defaultCurrency', 'ZAR'));

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Re-order list');
  ws.getCell('A1').value = 'Re-order list';
  ws.getCell('A2').value = `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC. `
    + `Items below ${warning}% of their Required Stock (urgent below ${urgent}%). `
    + `Re-order quantity = Required Stock − on hand. Prices excl. VAT, ${currency}.`;
  ws.getRow(4).values = ['Code', 'Item', 'Unit', 'Status', 'On hand', 'Required', '% of required', 'Re-order qty',
    `Unit price (${currency})`, `Re-order value (${currency})`, 'Last supplier', 'Last delivered', 'Where it is kept'];
  ws.getRow(4).font = { bold: true };

  const order = Object.keys(CATEGORY_LABEL);
  const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  let total = 0;
  for (const category of categories) {
    const group = rows.filter((r) => r.category === category);
    ws.addRow([`${CATEGORY_LABEL[category] ?? category} (${group.length})`]).font = { bold: true };
    let subtotal = 0;
    for (const r of group) {
      const reorder = Number(r.reorderQuantity);
      const price = r.unitCost === null ? null : Number(r.unitCost);
      const value = price === null ? null : Math.round(reorder * price * 100) / 100;
      if (value !== null) subtotal += value;
      ws.addRow([
        r.sku, r.name, r.unitOfMeasure, r.status === 'URGENT' ? 'Urgent' : 'Warning',
        Number(r.onHand), Number(r.requiredStock), r.percentOfRequired === null ? null : r.percentOfRequired / 100,
        reorder, price, value, r.lastSupplier?.name ?? '',
        r.lastSupplier ? new Date(r.lastSupplier.receivedAt) : null,
        r.locations.map((l) => `${l.locationName} (${Number(l.quantity)})`).join(', ') || 'None on hand',
      ]);
    }
    ws.addRow([null, `Subtotal ${CATEGORY_LABEL[category] ?? category}`, null, null, null, null, null, null, null, Math.round(subtotal * 100) / 100]).font = { bold: true };
    ws.addRow([]);
    total += subtotal;
  }
  if (rows.length === 0) ws.addRow(['Nothing needs re-ordering: every item with a Required Stock is at or above the warning level.']);
  else ws.addRow([null, `Total re-order value (${rows.length} items)`, null, null, null, null, null, null, null, Math.round(total * 100) / 100]).font = { bold: true };
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
