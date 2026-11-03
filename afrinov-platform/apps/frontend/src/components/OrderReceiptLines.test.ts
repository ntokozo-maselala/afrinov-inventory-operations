import { describe, it, expect } from 'vitest';
import { receiptLinesFromOrder, checkReceiptLines } from './OrderReceiptLines';

const order = (orderedQty: string, receivedQty: string) => ({
  id: 'po-1', number: 'AFRI-0001', supplierId: 's-1',
  lines: [{ id: 'l-1', materialId: 'm-1', orderedQty, receivedQty, material: { sku: 'CBL-1', name: 'Cable', unitOfMeasure: 'm' } }],
});

describe('the lines of a delivery against an order', () => {
  // The server keeps 4 decimal places and refuses finer ones, so what is still
  // owed after a part delivery must be filled in as the clerk would type it.
  it('fill in what is still owed to 4 decimal places', () => {
    const [line] = receiptLinesFromOrder(order('10', '9.7'));
    expect(line).toMatchObject({ quantity: '0.3', outstanding: 0.3 });
    expect(checkReceiptLines([{ ...line!, locationId: 'loc-1' }], true)).toMatchObject({ lines: [{ quantity: '0.3' }] });
  });

  it('leave out a line received in full', () => {
    expect(receiptLinesFromOrder(order('5', '5'))).toEqual([]);
  });
});
