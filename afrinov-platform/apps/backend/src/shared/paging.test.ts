import { describe, expect, it } from 'vitest';
import { pageLimit } from './paging.js';
import { ApiError } from './errors.js';

describe('pageLimit', () => {
  it('leaves the list its default when no limit is given', () => {
    expect(pageLimit(undefined, 200)).toBeUndefined();
    expect(pageLimit('', 200)).toBeUndefined();
  });

  it('takes a whole number from 1 up to the cap', () => {
    expect(pageLimit('1', 200)).toBe(1);
    expect(pageLimit('50', 200)).toBe(50);
    expect(pageLimit('200', 200)).toBe(200);
  });

  it('caps a larger number at the maximum, as "at most N" always has', () => {
    expect(pageLimit('1000', 200)).toBe(200);
    expect(pageLimit('100000', 1000)).toBe(1000);
  });

  it.each(['abc', '0', '-1', '1.5', 'NaN', 'Infinity', '1e999'])('refuses %s with a 400 rather than reaching the database', (raw) => {
    let err: unknown;
    try { pageLimit(raw, 200); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(400);
    expect((err as ApiError).code).toBe('VALIDATION_ERROR');
  });
});
