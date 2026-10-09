import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { downloadMonthEnd } from './exportMonthEnd';
import type { MonthEndReport } from './reportTypes';

const mocks = vi.hoisted(() => ({ frontendOnly: false, get: vi.fn(), token: vi.fn(), download: vi.fn(), fetch: vi.fn() }));
vi.mock('./client', () => ({
  get FRONTEND_ONLY() { return mocks.frontendOnly; }, api: { get: mocks.get }, getToken: mocks.token,
}));
vi.mock('./exportReport', async (importOriginal) => ({
  ...await importOriginal<typeof import('./exportReport')>(), triggerDownload: mocks.download,
}));

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const report: MonthEndReport = {
  month: '2026-09', from: '2026-09-01', to: '2026-09-30', generatedAt: '2026-10-09T00:00:00Z', currency: 'USD',
  bands: { urgentBelowPercent: 20, warningBelowPercent: 40 },
  categories: [{
    category: 'PROJECT_MATERIAL', items: [
      { sku: 'PRJ-1', name: 'Pipe', location: 'Rack A', requiredStock: 10, currentStock: 12, unitCost: 2,
        value: 24, percentOfRequired: 1.2, reorderQuantity: -2, status: 'OK' },
      { sku: 'PRJ-2', name: 'Unpriced pipe', location: '', requiredStock: 0, currentStock: 0, unitCost: null,
        value: null, percentOfRequired: null, reorderQuantity: null, status: 'NOT_SET' },
    ], value: 24, urgent: 0, warning: 0, itemsInStock: 1,
    used: [{ sku: 'PRJ-1', name: 'Pipe', location: 'Rack A', used: 3, value: 6 }], usedValue: 6,
  }, { category: 'TOOLS', items: [], value: 0, urgent: 0, warning: 0, itemsInStock: 0, used: [], usedValue: 0 }],
  total: { items: 2, itemsInStock: 1, value: 24, urgent: 0, warning: 0, usedValue: 6 },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.frontendOnly = false;
  mocks.token.mockReturnValue('test-token');
  mocks.get.mockResolvedValue(report);
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('downloadMonthEnd from the server', () => {
  it('requests Excel with authentication and downloads the returned bytes under the server filename', async () => {
    mocks.fetch.mockResolvedValue(new Response('workbook bytes', { headers: {
      'content-type': XLSX, 'content-disposition': 'attachment; filename="month-end.xlsx"',
    } }));
    await downloadMonthEnd('2026-09');
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/reports/month-end/export?month=2026-09', {
      headers: { Accept: XLSX, Authorization: 'Bearer test-token' },
    });
    expect(mocks.download).toHaveBeenCalledOnce();
    const [blob, filename] = mocks.download.mock.calls[0]!;
    expect(filename).toBe('month-end.xlsx');
    expect(blob.type).toBe(XLSX);
    expect(await blob.text()).toBe('workbook bytes');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('omits authorization when signed out and falls back to the month filename', async () => {
    mocks.token.mockReturnValue(null);
    mocks.fetch.mockResolvedValue(new Response('xlsx'));
    await downloadMonthEnd('2026-09');
    expect(mocks.fetch).toHaveBeenCalledWith(expect.any(String), { headers: { Accept: XLSX } });
    expect(mocks.download).toHaveBeenCalledWith(expect.anything(), 'afrinov-month-end-2026-09.xlsx');
  });

  it('encodes the supplied month as a single query value', async () => {
    mocks.fetch.mockResolvedValue(new Response('xlsx'));
    await downloadMonthEnd('2026-09&format=pdf');
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/reports/month-end/export?month=2026-09%26format%3Dpdf', expect.anything());
  });

  it.each([
    [new Response(JSON.stringify({ error: { message: 'Reports permission required' } }), { status: 403 }), 'Reports permission required'],
    [new Response('<html>Unavailable</html>', { status: 502 }), 'Request failed (502)'],
    [new Response(''), 'Download failed: the file was empty.'],
  ])('does not download an invalid response (%s)', async (response, message) => {
    mocks.fetch.mockResolvedValue(response);
    await expect(downloadMonthEnd('2026-09')).rejects.toThrow(message);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('reports network failures without downloading', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(downloadMonthEnd('2026-09')).rejects.toThrow('Unable to reach the server. Check your connection and try again.');
    expect(mocks.download).not.toHaveBeenCalled();
  });
});

async function readWorkbook(blob: Blob) {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

describe('downloadMonthEnd in frontend-only mode', () => {
  beforeEach(() => { mocks.frontendOnly = true; });

  it('builds a readable workbook with overview, summary, usage and empty-category sheets', async () => {
    await downloadMonthEnd('2026-09');
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/reports/month-end?month=2026-09');
    expect(mocks.fetch).not.toHaveBeenCalled();
    const [blob, filename] = mocks.download.mock.calls[0]!;
    expect(filename).toBe('afrinov-month-end-2026-09.xlsx');
    expect(blob.type).toBe(XLSX);
    const wb = await readWorkbook(blob);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Overview', 'Project Stock Summary', 'Project Used', 'Tools Summary', 'Tools Used']);
    const overview = wb.getWorksheet('Overview')!;
    expect(overview.getCell('D4').value).toBe('Stock value (USD)');
    expect(overview.getRow(5).values).toEqual([undefined, 'Project Material', 2, 1, 24, 0, 0, 6]);
    expect(overview.getRow(7).values).toEqual([undefined, 'Total', 2, 1, 24, 0, 0, 6]);
    const summary = wb.getWorksheet('Project Stock Summary')!;
    expect(summary.getCell('B2').value).toBe(24);
    expect(summary.getCell('B3').value).toBe('PROJECT INVENTORY — as at 2026-09-30');
    expect(summary.getRow(5).values).toEqual([undefined, 1, 'PRJ-1', 'Pipe', 'Rack A', 10, 12, 24, 1.2, 2, -2, 'OK']);
    expect(summary.getCell('G6').value).toBeNull();
    expect(summary.getCell('H6').value).toBeNull();
    expect(summary.getCell('J6').value).toBeNull();
    expect(summary.getCell('K6').value).toBe('NOT SET');
    expect(wb.getWorksheet('Project Used')!.getRow(6).values).toEqual([undefined, 'PRJ-1', 'Pipe', 'Rack A', 3, 6]);
    expect(wb.getWorksheet('Tools Used')!.getCell('B6').value).toBe('Nothing was used in this month.');
  });

  it('propagates report failures without starting a download', async () => {
    const error = new Error('That month has not started yet');
    mocks.get.mockRejectedValue(error);
    await expect(downloadMonthEnd('2999-01')).rejects.toBe(error);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
