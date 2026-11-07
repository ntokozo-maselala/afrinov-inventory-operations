import { describe, it, expect } from 'vitest';
import { addWorkingDays, parseClosedDays, parseDay, workingDaysBetween } from './working-days.js';

const d = (s: string) => parseDay(s)!;
const none = new Set<string>();

describe('working days', () => {
  it('counts the days after the start up to and including the end, as the workbook did', () => {
    expect(workingDaysBetween(d('2026-01-12'), d('2026-01-12'), none)).toBe(0); // Monday to Monday
    expect(workingDaysBetween(d('2026-01-12'), d('2026-01-16'), none)).toBe(4); // Monday to Friday
  });

  it('leaves out weekends', () => {
    expect(workingDaysBetween(d('2026-01-16'), d('2026-01-19'), none)).toBe(1); // Friday to Monday
    expect(workingDaysBetween(d('2026-01-09'), d('2026-01-23'), none)).toBe(10); // two weeks
  });

  it('leaves out closed days, across a month end', () => {
    const closed = new Set(['2025-12-25', '2025-12-26', '2026-01-01']);
    // Wednesday 24 Dec to Friday 2 Jan: 29, 30, 31 Dec and 2 Jan.
    expect(workingDaysBetween(d('2025-12-24'), d('2026-01-02'), closed)).toBe(4);
  });

  it('is negative when the end is before the start, to say how early something is', () => {
    expect(workingDaysBetween(d('2026-01-16'), d('2026-01-12'), none)).toBe(-4);
  });

  it('adds and takes away working days, skipping weekends and closed days', () => {
    expect(addWorkingDays(d('2026-01-16'), 1, none)).toEqual(d('2026-01-19'));
    expect(addWorkingDays(d('2026-01-19'), -1, none)).toEqual(d('2026-01-16'));
    expect(addWorkingDays(d('2025-12-24'), 1, new Set(['2025-12-25', '2025-12-26']))).toEqual(d('2025-12-29'));
    expect(addWorkingDays(d('2026-01-17'), 0, none)).toEqual(d('2026-01-17')); // a Saturday stays put
  });

  it('round-trips: adding n working days spans n working days', () => {
    const closed = new Set(['2026-03-20']);
    const start = d('2026-03-02');
    for (const n of [0, 1, 5, 13, 30]) {
      expect(workingDaysBetween(start, addWorkingDays(start, n, closed), closed)).toBe(n);
    }
  });
});

describe('the closed days setting', () => {
  it('reads one date per line, with an optional note, and skips blank lines', () => {
    const { days, problems } = parseClosedDays('2026-12-25 Christmas Day\n\n  2026-12-26  Day of Goodwill\r\n2027-01-01');
    expect([...days]).toEqual(['2026-12-25', '2026-12-26', '2027-01-01']);
    expect(problems).toEqual([]);
  });

  it('names each line that does not start with a real date', () => {
    expect(parseClosedDays('Christmas\n2026-02-30\n2026-12-25').problems).toEqual([
      'Line 1 must start with a date as YYYY-MM-DD.',
      'Line 2 must start with a date as YYYY-MM-DD.',
    ]);
  });
});
