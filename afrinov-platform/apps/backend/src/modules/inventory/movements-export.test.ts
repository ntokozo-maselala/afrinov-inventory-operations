import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildMovementsXlsx } from './movements-export.js';

type ExportRow = Parameters<typeof buildMovementsXlsx>[0][number];

const movement = (type: 'LOAN' | 'LOAN_RETURN' | 'DUE_DATE_CHANGE' | 'ISSUE' | 'RETURN' | 'USED_UP' | 'BROKEN' | 'OUTCOME_WITHDRAWN', extra: Record<string, unknown> = {}) => ({
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

  // Qodo, PR #144: the figures are columns of their own that add up.
  it('gives each row what it recorded in Used up, Broken and Still out, so the columns add up', async () => {
    const disc = { materialSku: 'DISC-125', trackUse: true };
    const sheet = await sheetOf([
      movement('OUTCOME_WITHDRAWN', { ...disc, quantity: null, brokenQuantity: '1' }),
      movement('USED_UP', { ...disc, quantity: null, usedUpQuantity: '2' }),
      movement('BROKEN', { ...disc, quantity: null, brokenQuantity: '1' }),
      movement('RETURN', { ...disc, quantity: '2', usedUpQuantity: '1', brokenQuantity: '0' }),
      // 6 issued; 2 back, 3 used up, 1 broken withdrawn: 1 still out.
      movement('ISSUE', { ...disc, quantity: '-6', returnedQuantity: '2', usedUpQuantity: '3', brokenQuantity: '0' }),
    ]);
    expect([15, 16, 17].map((c) => sheet.getRow(4).getCell(c).value)).toEqual(['Used up', 'Broken', 'Still out']);
    const figures = (r: number) => [15, 16, 17].map((c) => sheet.getRow(r).getCell(c).value ?? null);
    expect([5, 6, 7, 8, 9].map(figures)).toEqual([
      [null, -1, null], [2, null, null], [null, 1, null], [1, null, null], [null, null, 1],
    ]);
    // Used up adds up to the issue's 3; broken to 0, the one broken having been withdrawn.
    const total = (c: number) => [5, 6, 7, 8, 9].reduce((a, r) => a + Number(sheet.getRow(r).getCell(c).value ?? 0), 0);
    expect([total(15), total(16)]).toEqual([3, 0]);
    expect(sheet.getCell('K9').value).toBe('still out 1');
  });
});
