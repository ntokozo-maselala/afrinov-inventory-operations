import { describe, expect, it } from 'vitest';
import { InventoryTransactionType, LocationType, MaterialCategory } from '@prisma/client';
import { enumFilter } from './query-filters.js';
import { ApiError } from './errors.js';

describe('enumFilter', () => {
  it('is no filter when none is given, an empty value included', () => {
    expect(enumFilter(undefined, MaterialCategory, 'category')).toBeUndefined();
    expect(enumFilter('', MaterialCategory, 'category')).toBeUndefined();
  });

  it('passes every value the enum has', () => {
    for (const v of Object.values(MaterialCategory)) expect(enumFilter(v, MaterialCategory, 'category')).toBe(v);
    for (const v of Object.values(LocationType)) expect(enumFilter(v, LocationType, 'type')).toBe(v);
    for (const v of Object.values(InventoryTransactionType)) expect(enumFilter(v, InventoryTransactionType, 'type')).toBe(v);
    expect(enumFilter('B', ['A', 'B'] as const, 'x')).toBe('B');
  });

  // These reached Prisma and came back as a 500 logged as an unhandled defect.
  it.each(['abc', 'tools', 'TOOLS ', '-1', "'; select 1;--", '%00', 'x'.repeat(5000)])(
    'refuses %s with a 400 naming the filter, before the database sees it',
    (raw) => {
      let err: unknown;
      try { enumFilter(raw, MaterialCategory, 'category'); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(400);
      expect((err as ApiError).code).toBe('VALIDATION_ERROR');
      expect((err as ApiError).message).toMatch(/^category must be one of /);
      expect((err as ApiError).details).toEqual({ category: raw });
    },
  );
});
