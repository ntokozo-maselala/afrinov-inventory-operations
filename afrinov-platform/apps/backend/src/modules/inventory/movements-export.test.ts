import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildMovementsXlsx } from './movements-export.js';

type ExportRow = Parameters<typeof buildMovementsXlsx>[0][number];

const movement = (type: 'LOAN' | 'LOAN_RETURN') => ({
  id: type,
  postedAt: '2026-10-20T08:00:00.000Z',
  type,
  materialSku: 'TL-0001',
  materialName: 'Torque wrench',
  locationName: 'Main Store',
  quantity: type === 'LOAN' ? '-1' : '1',
  unitOfMeasure: 'each',
  recipientName: 'Sabelo',
  projectNumber: 'AFRI-1325',
  reasonCode: null,
  reasonNote: null,
  receiptNumber: null,
  supplierName: null,
  deliveryRef: null,
  referenceType: null,
  returnOf: null,
  actorName: 'Vusi',
  reversesId: null,
  reversedById: null,
}) as unknown as ExportRow;

describe('buildMovementsXlsx', () => {
  it('uses the check-out and check-in labels for tool movements', async () => {
    const bytes = await buildMovementsXlsx([movement('LOAN'), movement('LOAN_RETURN')], {
      scope: 'All movements',
      generatedAt: new Date('2026-10-21T12:00:00.000Z'),
    });
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);

    const sheet = workbook.getWorksheet('Movements');
    expect(sheet?.getCell('B5').value).toBe('Check out');
    expect(sheet?.getCell('B6').value).toBe('Check in');
  });
});
