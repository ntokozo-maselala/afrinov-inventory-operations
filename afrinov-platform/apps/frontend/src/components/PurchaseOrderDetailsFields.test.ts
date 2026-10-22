import { describe, it, expect } from 'vitest';
import { checkDetails, detailsBody, draftFromOrder, supplierDetails } from './PurchaseOrderDetailsFields';

const supplier = {
  contactName: 'Nicole', contactPhone: '011 452 8413', contactEmail: 'orders@example.com', address: '23 Grader Road\nSpartan',
};
const details = {
  supplierContactName: 'Nicole', supplierContactPhone: '011 452 8413', supplierContactEmail: 'orders@example.com', supplierAddress: '23 Grader Road\nSpartan',
};
const blanks = { supplierContactName: '', supplierContactPhone: '', supplierContactEmail: '', supplierAddress: '' };

describe('supplierDetails', () => {
  it('prefills all four order fields from the supplier without changing the supplier', () => {
    expect(supplierDetails(Object.freeze({ ...supplier }))).toEqual(details);
  });

  it.each([undefined, {}, { contactName: null, contactPhone: null, contactEmail: null, address: null }])('uses blank inputs for missing supplier details (%j)', (value) => {
    expect(supplierDetails(value)).toEqual(blanks);
  });
});

describe('draftFromOrder supplier details', () => {
  it('preserves the order values, including multiline addresses', () => {
    expect(draftFromOrder(details)).toMatchObject(details);
  });

  it.each([{}, { supplierContactName: null, supplierContactPhone: null, supplierContactEmail: null, supplierAddress: null }])('turns absent or cleared order details into blank inputs (%j)', (order) => {
    expect(draftFromOrder(order)).toMatchObject(blanks);
  });
});

describe.each(['create', 'edit'] as const)('detailsBody supplier details on %s', (mode) => {
  it('sends trimmed supplier details while keeping address lines and unrelated fields', () => {
    const draft = draftFromOrder({
      supplierContactName: '  Sean  ', supplierContactPhone: '  060 970 5820  ',
      supplierContactEmail: '  sean@example.com  ', supplierAddress: '  Branch 2\nRoodekop  ',
      deliveryAddress: '10 Lime Street', projectNumber: 'M-1325',
    });
    expect(detailsBody(Object.freeze(draft), mode)).toMatchObject({
      supplierContactName: 'Sean', supplierContactPhone: '060 970 5820', supplierContactEmail: 'sean@example.com', supplierAddress: 'Branch 2\nRoodekop',
      deliveryAddress: '10 Lime Street', projectNumber: 'M-1325',
    });
  });

  it.each(['', ' \t\n '])('sends blank supplier details as explicit nulls (%j)', (value) => {
    const draft = draftFromOrder({ supplierContactName: value, supplierContactPhone: value, supplierContactEmail: value, supplierAddress: value });
    expect(detailsBody(draft, mode)).toMatchObject({
      supplierContactName: null, supplierContactPhone: null, supplierContactEmail: null, supplierAddress: null,
    });
  });

  it('keeps the supplier address when the order is collected', () => {
    const body = detailsBody(draftFromOrder({ ...details, deliveryMethod: 'COLLECTION', deliveryAddress: '10 Lime Street' }), mode);
    expect(body.supplierAddress).toBe(details.supplierAddress);
    expect(body.deliveryAddress).toBe(mode === 'create' ? undefined : null);
  });
});

describe('checkDetails supplier email', () => {
  it.each(['', '   ', 'orders@example.com', '  orders+branch@example.co.za  '])('accepts an optional or valid email (%j)', (email) => {
    expect(checkDetails(draftFromOrder({ supplierContactEmail: email }))).toBeNull();
  });

  it.each(['missing-at', 'orders@', '@example.com', 'orders@example', 'orders @example.com', 'orders@@example.com'])('rejects invalid email %j with an actionable message', (email) => {
    expect(checkDetails(draftFromOrder({ supplierContactEmail: email })))
      .toBe(`The supplier email "${email}" is not an email address.`);
  });
});
