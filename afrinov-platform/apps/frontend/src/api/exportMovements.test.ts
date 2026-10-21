import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MovementRow } from './types';

const { mockGet, mockDownloadPdf, mockTriggerDownload, mode } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockDownloadPdf: vi.fn(),
  mockTriggerDownload: vi.fn(),
  mode: { frontendOnly: false },
}));

vi.mock('./client', () => ({
  api: { get: mockGet },
  get FRONTEND_ONLY() { return mode.frontendOnly; },
  getToken: vi.fn(),
}));
vi.mock('./exportReport', () => ({
  errorMessage: vi.fn(),
  filenameFromDisposition: vi.fn(),
  triggerDownload: mockTriggerDownload,
}));
vi.mock('../lib/pdf', () => ({ downloadPdf: mockDownloadPdf }));

const { downloadMovements, downloadMovementsPdf } = await import('./exportMovements');

const movement = (type: 'LOAN' | 'LOAN_RETURN'): MovementRow => ({
  id: type,
  cursor: `2026-10-20T08:00:00.000Z_${type}`,
  postedAt: '2026-10-20T08:00:00.000Z',
  type,
  materialId: 'm-1',
  materialSku: 'TL-0001',
  materialName: 'Torque wrench',
  unitOfMeasure: 'each',
  locationId: 'loc-1',
  locationName: 'Main Store',
  quantity: type === 'LOAN' ? '-1' : '1',
  actorId: 'u-1',
  actorName: 'Vusi',
  recipientName: 'Sabelo',
  projectNumber: 'AFRI-1325',
});

describe('movement exports', () => {
  beforeEach(() => {
    mode.frontendOnly = false;
    mockGet.mockReset();
    mockDownloadPdf.mockReset();
    mockTriggerDownload.mockReset();
  });

  afterEach(() => {
    mode.frontendOnly = false;
  });

  it('labels tool check-outs and check-ins in the PDF ledger', async () => {
    mockGet.mockResolvedValueOnce([movement('LOAN'), movement('LOAN_RETURN')]).mockResolvedValueOnce([]);

    await downloadMovementsPdf('from=2026-10-20&to=2026-10-20', 'loans', { title: 'Tool movements', lines: [] });

    const report = mockDownloadPdf.mock.calls[0]![0] as { sections: Array<{ rows: string[][] }> };
    expect(report.sections[0]!.rows.map((row) => row[1])).toEqual(['Check out', 'Check in']);
  });

  it('labels tool check-outs and check-ins in the frontend-only spreadsheet', async () => {
    mode.frontendOnly = true;
    mockGet.mockResolvedValue([movement('LOAN'), movement('LOAN_RETURN')]);

    await downloadMovements('from=2026-10-20&to=2026-10-20');

    const blob = mockTriggerDownload.mock.calls[0]![0] as Blob;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.getWorksheet('Movements');
    expect(sheet?.getCell('B5').value).toBe('Check out');
    expect(sheet?.getCell('B6').value).toBe('Check in');
  });
});
