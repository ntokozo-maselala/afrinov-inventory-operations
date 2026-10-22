// The supplier email on a purchase order takes the rule a supplier's email is
// imported with, so an order never refuses the email its supplier holds.
import { describe, it, expect } from 'vitest';
import { createPOSchema, updatePOSchema } from './procurement.routes.js';
import { EMAIL_PATTERN } from './supplier-fields.js';

const valid = (supplierContactEmail: unknown) => updatePOSchema.safeParse({ supplierContactEmail }).success;

describe('the supplier email on a purchase order', () => {
  it('takes any email the supplier import takes', () => {
    for (const email of ['nicole@welding.co.za', 'a..b@x.co', "o'brien@x.com", 'sales@exclusive-air.co.za']) {
      expect(EMAIL_PATTERN.test(email)).toBe(true);
      expect(valid(email)).toBe(true);
    }
  });

  it('takes none: blank, spaces only or null', () => {
    expect(valid('')).toBe(true);
    // Spaces only clear it too, as for the other details.
    expect(updatePOSchema.parse({ supplierContactEmail: '   ' }).supplierContactEmail).toBe('');
    expect(valid(null)).toBe(true);
    expect(updatePOSchema.safeParse({}).success).toBe(true);
  });

  it('refuses what is not an email, or is longer than an email can be', () => {
    expect(valid('not-an-email')).toBe(false);
    expect(valid('greg.coertzen-flex.com')).toBe(false);
    expect(valid(`${'a'.repeat(310)}@example.com`)).toBe(false);
    expect(createPOSchema.shape.supplierContactEmail.safeParse('nicole@welding.co.za').success).toBe(true);
  });
});
