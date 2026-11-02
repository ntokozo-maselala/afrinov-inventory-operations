import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildMovementsXlsx } from './movements-export.js';

type ExportRow = Parameters<typeof buildMovementsXlsx>[0][number];

const movement = (type: 'LOAN' | 'LOAN_RETURN' | 'DUE_DATE_CHANGE', extra: Record<string, unknown> = {}) => ({
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
  ...extra,
}) as unknown as ExportRow;

async function sheetOf(rows: ExportRow[]) {
  const bytes = await buildMovementsXlsx(rows, { scope: 'All movements', generatedAt: new Date('2026-10-21T12:00:00.000Z') });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return workbook.getWorksheet('Movements')!;
}

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

  it('lists a due date change with no quantity, the dates before and after, and why', async () => {
    const sheet = await sheetOf([
      movement('DUE_DATE_CHANGE', { quantity: null, dueOn: '2026-11-06', previousDueOn: '2026-10-30', reasonNote: 'Pour delayed' }),
      movement('LOAN', { dueOn: '2026-10-30', currentDueOn: '2026-11-06', overdueOverrideReason: 'Second crew' }),
      movement('LOAN_RETURN', { dueOn: '2026-10-16', daysLate: 14 }),
    ]);
    expect(sheet.getRow(4).getCell(10).value).toBe('Due back');
    expect([sheet.getCell('B5').value, sheet.getCell('F5').value, sheet.getCell('J5').value, sheet.getCell('L5').value])
      .toEqual(['Due date moved', null, '2026-10-30 → 2026-11-06', 'Pour delayed']);
    expect([sheet.getCell('J6').value, sheet.getCell('L6').value]).toEqual(['2026-10-30 (now 2026-11-06)', 'Lent while overdue: Second crew']);
    expect(sheet.getCell('J7').value).toBe('2026-10-16 (14 days late)');
  });
});
