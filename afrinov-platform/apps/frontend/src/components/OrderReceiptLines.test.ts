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

// Qodo, PR #153: an order with 0.5 each still owed could never be finished.
describe('checkReceiptLines and counted items', () => {
  const counted = () => 'COUNTED' as const;
  const line = { materialId: 'm-1', locationId: 'loc-1', purchaseOrderLineId: 'pl-1', outstanding: 2.5, label: 'WSH-1 — Washer', unit: 'each' };
  it('takes the part-unit still owed, with any whole ones, but no other part of one', () => {
    expect(checkReceiptLines([{ ...line, quantity: '2,5' }], true, counted)).toMatchObject({ lines: [{ quantity: '2,5' }] });
    expect(checkReceiptLines([{ ...line, quantity: '1,5' }], true, counted)).toMatchObject({ lines: [{ quantity: '1,5' }] });
    expect(checkReceiptLines([{ ...line, quantity: '2' }], true, counted)).toMatchObject({ lines: [{ quantity: '2' }] });
    expect(checkReceiptLines([{ ...line, quantity: '1,25' }], true, counted)).toEqual({ problem: 'WSH-1 — Washer: Counted in whole each: enter 1, 2, 3 …' });
    // A whole amount owed takes no part-unit (Qodo, PR #153).
    expect(checkReceiptLines([{ ...line, outstanding: 3, quantity: '2,5' }], true, counted)).toEqual({ problem: 'WSH-1 — Washer: Counted in whole each: enter 1, 2, 3 …' });
  });
});

// System audit A8: a delivery may go over the order by the allowance, with a reason.
describe('over-delivery', () => {
  it('lets a line go over what is owed within the allowance, only with a reason, and sends the reason', async () => {
    const { receiptLinesBody } = await import('./OrderReceiptLines');
    const [line] = receiptLinesFromOrder(order('100', '0'), 0.05);
    expect(line).toMatchObject({ outstanding: 100, upTo: 105 });
    const over = { ...line!, locationId: 'loc-1', quantity: '105' };
    expect(checkReceiptLines([over], true)).toEqual({ problem: 'CBL-1 — Cable: more came than is outstanding. Say why the extra is kept.' });
    expect(checkReceiptLines([{ ...over, quantity: '106' }], true)).toEqual({ problem: 'CBL-1 — Cable: up to 105 m can be received: 100 outstanding and the over-delivery allowed.' });
    const ok = checkReceiptLines([{ ...over, overReason: ' Sold by the drum ' }], true);
    expect('lines' in ok && receiptLinesBody(ok.lines)).toEqual([{ materialId: 'm-1', locationId: 'loc-1', quantity: 105, purchaseOrderLineId: 'l-1', overDeliveryReason: 'Sold by the drum' }]);
  });

  it('allows nothing over the order when the allowance is 0', () => {
    const [line] = receiptLinesFromOrder(order('100', '40'));
    expect(checkReceiptLines([{ ...line!, locationId: 'loc-1', quantity: '61' }], true)).toEqual({ problem: 'CBL-1 — Cable: only 60 m is still outstanding.' });
  });
});
