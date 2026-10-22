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

  it('accepts a 200 character email and rejects a 201 character email', () => {
    const domain = `${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(9)}.com`;
    const email = `${'a'.repeat(64)}@${domain}`;
    expect(email).toHaveLength(200);
    expect(schema.parse({ ...required, supplierContactEmail: email })).toMatchObject({ supplierContactEmail: email });
    expect(schema.safeParse({ ...required, supplierContactEmail: `${email}x` }).success).toBe(false);
  });

  it.each(['supplierContactName', 'supplierContactPhone', 'supplierContactEmail', 'supplierAddress'])('rejects a non-text %s', (key) => {
    expect(schema.safeParse({ ...required, [key]: 123 }).success).toBe(false);
  });
});
