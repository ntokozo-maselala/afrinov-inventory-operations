// Where each kind of order lives (Stores and Procurement Separation Roadmap):
// a Stores order inside Store → Order stock, a project order inside Procurement.
import { describe, it, expect } from 'vitest';
import { kindOfPath, orderKindOf, orderPath } from './orderKind';

describe('orderKind', () => {
  it('tells the kind from the project', () => {
    expect(orderKindOf({ projectNumber: null })).toBe('stores');
    expect(orderKindOf({})).toBe('stores');
    expect(orderKindOf({ projectNumber: 'AFRI-1402' })).toBe('projects');
    // As the server: only null (no project) is a Stores order (Qodo, PR #120).
    expect(orderKindOf({ projectNumber: '' })).toBe('projects');
  });

  it("opens each order in its own section", () => {
    expect(orderPath({ id: 'po-1', projectNumber: null })).toBe('/stock/orders/po-1');
    expect(orderPath({ id: 'po-2', projectNumber: 'AFRI-1402' })).toBe('/purchase-orders/po-2');
  });

  it('tells which section an address is in', () => {
    expect(kindOfPath('/stock/orders/po-1')).toBe('stores');
    expect(kindOfPath('/stock/orders/po-1/edit')).toBe('stores');
    expect(kindOfPath('/purchase-orders/po-2')).toBe('projects');
    // The Order stock list itself is not an order's address.
    expect(kindOfPath('/stock/orders')).toBe('projects');
  });
});
