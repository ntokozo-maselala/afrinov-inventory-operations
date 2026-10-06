import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildInventoryExportPath, getPdfBlob } from './exportReport';
import type { ReportResult } from '../mock/mockReport';

const report = {
  kpis: { rangeLabel: 'This month', generatedAt: '2026-09-16T10:00:00.000Z' },
  generatedAt: '2026-09-16T10:00:00.000Z',
} as ReportResult;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildInventoryExportPath', () => {
  it('preserves the visible report query and leaves the API prefix to the client', () => {
    const path = buildInventoryExportPath(
      'pdf',
      'range=CUSTOM&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-15T00%3A00%3A00.000Z&category=CONSUMABLES&category=TOOLS&locationId=loc-1&stockStatus=LOW_STOCK&page=2&pageSize=200',
    );

    expect(path.startsWith('/api/v1')).toBe(false);
    expect(path.startsWith('/reports/inventory/export?')).toBe(true);

    const params = new URLSearchParams(path.split('?')[1]);
    expect(params.get('format')).toBe('pdf');
    expect(params.get('range')).toBe('CUSTOM');
    expect(params.get('from')).toBe('2026-09-01T00:00:00.000Z');
    expect(params.get('to')).toBe('2026-09-15T00:00:00.000Z');
    expect(params.getAll('category')).toEqual(['CONSUMABLES', 'TOOLS']);
    expect(params.get('locationId')).toBe('loc-1');
    expect(params.get('stockStatus')).toBe('LOW_STOCK');
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('200');
  });

  it('sets the requested file format on an otherwise unfiltered report', () => {
    expect(buildInventoryExportPath('xlsx')).toBe('/reports/inventory/export?format=xlsx');
  });

  it('requests a verified PDF binary using the active filters exactly once', async () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'test-token') });
    const fetchMock = vi.fn(async () => new Response('%PDF-1.7', {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="filtered-report.pdf"',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getPdfBlob(report, 'range=MONTH&locationId=loc-1&stockStatus=LOW_STOCK&page=2&pageSize=200');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/reports/inventory/export?range=MONTH&locationId=loc-1&stockStatus=LOW_STOCK&page=2&pageSize=200&format=pdf',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/pdf',
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(result.filename).toBe('filtered-report.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
