// The stock status rule, against the stock workbook's URGENCY column.
import { describe, it, expect } from 'vitest';
import { classifyItem, needsAttention } from './stock-status.js';

describe('classifyItem', () => {
  it.each([
    // on hand, required, status, percent, re-order
    [0, 100, 'URGENT', 0, 100],
    [19.9, 100, 'URGENT', 19.9, 80.1],
    [20, 100, 'WARNING', 20, 80],
    [39.9, 100, 'WARNING', 39.9, 60.1],
    [40, 100, 'OK', 40, 60],
    [100, 100, 'OK', 100, 0],
    [167, 100, 'OK', 167, 0],
  ] as const)('%s of %s is %s', (onHand, required, status, percent, reorder) => {
    expect(classifyItem(onHand, required)).toEqual({ status, percentOfRequired: percent, reorderQuantity: reorder });
  });

  it('marks an item with no Required Stock as NOT_SET, where the workbook showed URGENT', () => {
    expect(classifyItem(6, 0)).toEqual({ status: 'NOT_SET', percentOfRequired: null, reorderQuantity: 0 });
    expect(classifyItem(0, 0).status).toBe('NOT_SET');
  });

  it('uses the bands it is given, and never lets WARNING sit below URGENT', () => {
    expect(classifyItem(15, 100, { urgentBelowPercent: 10, warningBelowPercent: 50 }).status).toBe('WARNING');
    expect(classifyItem(30, 100, { urgentBelowPercent: 40, warningBelowPercent: 20 }).status).toBe('URGENT');
    expect(classifyItem(45, 100, { urgentBelowPercent: 40, warningBelowPercent: 20 }).status).toBe('OK');
  });

  it('only URGENT and WARNING need attention', () => {
    expect(['URGENT', 'WARNING', 'OK', 'NOT_SET'].filter((s) => needsAttention(s as never))).toEqual(['URGENT', 'WARNING']);
  });
});
