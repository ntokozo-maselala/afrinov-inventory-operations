// South African days (system audit G2, ADR-041): UTC+2 all year.
import { describe, it, expect } from 'vitest';
import { dayRange, saDayOf, saDayStart, saMonth, saMonthRange, saToday, saYear } from './dates.js';

describe('South African days', () => {
  it('start at midnight in South Africa, 22:00 UTC the day before', () => {
    expect(saDayStart('2026-10-01').toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(saDayOf(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01');
    expect(saDayOf(new Date('2026-09-30T21:59:59Z'))).toBe('2026-09-30');
  });

  it('give the month and year as South Africa has them, at the turn', () => {
    const turn = new Date('2026-12-31T22:30:00Z'); // 00:30 on 1 January 2027 in South Africa
    expect([saToday(turn), saMonth(turn), saYear(turn)]).toEqual(['2027-01-01', '2027-01', 2027]);
    expect(saMonthRange('2026-02')).toEqual({
      start: new Date('2026-02-01T00:00:00+02:00'), end: new Date('2026-03-01T00:00:00+02:00'), first: '2026-02-01', last: '2026-02-28',
    });
  });

  it('filter whole South African days, the last one included', () => {
    expect(dayRange('2026-10-01', '2026-10-31')).toEqual({ gte: new Date('2026-10-01T00:00:00+02:00'), lt: new Date('2026-11-01T00:00:00+02:00') });
  });
});
