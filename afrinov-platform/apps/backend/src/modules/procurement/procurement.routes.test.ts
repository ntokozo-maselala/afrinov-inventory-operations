import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/db.js', () => ({ prisma: {} }));

const { createPOSchema, updatePOSchema } = await import('./procurement.routes.js');
const createBody = {
  supplierId: '10000000-0000-4000-8000-000000000001',
  lines: [{ materialId: '20000000-0000-4000-8000-000000000001', orderedQty: 1 }],
};

describe.each([
  { name: 'createPOSchema', schema: createPOSchema, required: createBody },
  { name: 'updatePOSchema', schema: updatePOSchema, required: {} },
])('$name supplier details', ({ schema, required }) => {
  it('leaves omitted fields absent so the service can distinguish them from cleared fields', () => {
    const parsed = schema.parse(required);
    for (const key of ['supplierContactName', 'supplierContactPhone', 'supplierContactEmail', 'supplierAddress']) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it.each([null, ''])('accepts %j to clear all four supplier details', (value) => {
    const details = { supplierContactName: value, supplierContactPhone: value, supplierContactEmail: value, supplierAddress: value };
    expect(schema.parse({ ...required, ...details })).toMatchObject(details);
  });

  it('trims a valid supplier email before passing it to the service', () => {
    expect(schema.parse({ ...required, supplierContactEmail: '  orders+branch@example.co.za  ' }))
      .toMatchObject({ supplierContactEmail: 'orders+branch@example.co.za' });
  });

  it.each(['no-at-sign', 'orders@', '@example.com', 'two@@example.com', 'orders @example.com'])('rejects invalid email %j', (email) => {
    const parsed = schema.safeParse({ ...required, supplierContactEmail: email });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors).toHaveProperty('supplierContactEmail');
  });

  it.each([
    { key: 'supplierContactName', max: 200 },
    { key: 'supplierContactPhone', max: 50 },
    { key: 'supplierAddress', max: 500 },
  ])('accepts $key at its limit and rejects one character over', ({ key, max }) => {
    const value = 'x'.repeat(max);
    expect(schema.parse({ ...required, [key]: value })).toMatchObject({ [key]: value });
    const parsed = schema.safeParse({ ...required, [key]: `${value}x` });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors).toHaveProperty(key);
  });

  // The longest an email address can be: the rule supplier emails are imported with has no lower cap.
  it('accepts a 320 character email and rejects a 321 character email', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(251)}.com`;
    expect(email).toHaveLength(320);
    expect(schema.parse({ ...required, supplierContactEmail: email })).toMatchObject({ supplierContactEmail: email });
    expect(schema.safeParse({ ...required, supplierContactEmail: `${email}x` }).success).toBe(false);
  });

  it.each(['supplierContactName', 'supplierContactPhone', 'supplierContactEmail', 'supplierAddress'])('rejects a non-text %s', (key) => {
    expect(schema.safeParse({ ...required, [key]: 123 }).success).toBe(false);
  });
});

// Order lines keep quantities and prices to 4 decimal places (Decimal(18, 4)):
// a finer figure would be saved rounded, so the order would not say what was typed.
describe('order quantities and prices', () => {
  const line = (orderedQty: number, unitPrice?: number) => ({ ...createBody, lines: [{ ...createBody.lines[0], orderedQty, unitPrice }] });

  it('are kept to 4 decimal places', async () => {
    const { createGRSchema } = await import('./procurement.routes.js');
    expect(createPOSchema.safeParse(line(2.5, 0.305)).success).toBe(true);
    expect(createPOSchema.safeParse(line(0.00001)).success).toBe(false);
    expect(createPOSchema.safeParse(line(1, 0.30501)).success).toBe(false);
    expect(updatePOSchema.safeParse({ linePrices: [{ lineId: '30000000-0000-4000-8000-000000000001', unitPrice: 0.30501 }] }).success).toBe(false);
    const receipt = (quantity: number) => createGRSchema.safeParse({ supplierId: 's', lines: [{ materialId: createBody.lines[0]!.materialId, locationId: createBody.supplierId, quantity }] });
    expect(receipt(9.7).success).toBe(true);
    expect(receipt(0.30000000000000004).success).toBe(false);
  });
});
