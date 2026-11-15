// Days are South African days, as the server counts them (system audit G2).
import { describe, it, expect } from 'vitest';
import { monthToDate, saDay } from './dates';

describe('South African days', () => {
  it('takes 00:30 on the 1st in South Africa as the new month, whatever the device is set to', () => {
    const now = new Date('2026-09-30T22:30:00Z'); // 00:30 on 1 October in South Africa
    expect(saDay(now)).toBe('2026-10-01');
    expect(monthToDate(now)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(saDay(new Date('2026-10-01T21:59:00Z'))).toBe('2026-10-01');
  });
});
