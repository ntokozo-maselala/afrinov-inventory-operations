import { describe, it, expect } from 'vitest';
import { parseClosedDays, workingDaysBetween } from './workingDays';

describe('working days, as the server counts them', () => {
  it('counts the days after the start up to the end, leaving out weekends', () => {
    expect(workingDaysBetween('2026-01-12', '2026-01-12')).toBe(0);
    expect(workingDaysBetween('2026-01-12', '2026-01-16')).toBe(4);
    expect(workingDaysBetween('2026-01-16', '2026-01-19')).toBe(1);
    expect(workingDaysBetween('2026-01-16', '2026-01-12')).toBe(-4);
  });

  it('leaves out closed days', () => {
    expect(workingDaysBetween('2025-12-24', '2026-01-02', new Set(['2025-12-25', '2025-12-26', '2026-01-01']))).toBe(4);
  });

  it('gives nothing for a value that is not a date', () => {
    expect(workingDaysBetween('', '2026-01-12')).toBeNull();
  });

  it('reads the closed days setting: a date at the start of each line, notes and bad lines ignored', () => {
    expect([...parseClosedDays('2026-12-25 Christmas Day\n\nnot a date\n2026-02-30\n2026-12-26')]).toEqual(['2026-12-25', '2026-12-26']);
    expect(parseClosedDays(undefined).size).toBe(0);
  });
});
