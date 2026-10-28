// RFQ numbers follow the Manhours and Material workbook's document numbers:
// AFRI-02A-<project>-02-<nn> for a project, RFQ-<nnnn> without one.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/db.js', () => ({ prisma: {} }));

const { nextRfqNumber, rfqNumberPrefix, todayInSouthAfrica, addDays } = await import('./rfq.service.js');

describe('RFQ dates', () => {
  it("takes today in South Africa, two hours ahead of the server's UTC clock", () => {
    expect(todayInSouthAfrica(new Date('2026-10-28T21:59:00Z'))).toBe('2026-10-28');
    expect(todayInSouthAfrica(new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29');
  });

  it('counts days across month and year ends', () => {
    expect(addDays('2026-10-28', 4)).toBe('2026-11-01');
    expect(addDays('2026-12-30', 4)).toBe('2027-01-03');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('RFQ numbers', () => {
  it('takes the digits of an AFRI-<digits> project, as the workbook files are named', () => {
    expect(rfqNumberPrefix('AFRI-1325')).toBe('AFRI-02A-1325-02-');
    expect(rfqNumberPrefix('AFRI-1094')).toBe('AFRI-02A-1094-02-');
  });

  it('keeps any other project number whole, so two projects never share a sequence', () => {
    expect(rfqNumberPrefix('1325')).toBe('RFQ-1325-');
    expect(rfqNumberPrefix('afri-1325')).toBe('RFQ-afri-1325-');
    expect(rfqNumberPrefix('P-77')).toBe('RFQ-P-77-');
    expect(nextRfqNumber('1325', ['AFRI-02A-1325-02-04'])).toBe('RFQ-1325-01');
    expect(nextRfqNumber('AFRI-1325', ['RFQ-1325-04'])).toBe('AFRI-02A-1325-02-01');
    // Project 0001's RFQs are not RFQs without a project.
    expect(nextRfqNumber(null, ['RFQ-0001-07'])).toBe('RFQ-0001');
  });

  it('starts each project at 01 and goes one past the highest issued', () => {
    expect(nextRfqNumber('AFRI-1325', [])).toBe('AFRI-02A-1325-02-01');
    expect(nextRfqNumber('AFRI-1325', ['AFRI-02A-1325-02-01', 'AFRI-02A-1325-02-03'])).toBe('AFRI-02A-1325-02-04');
  });

  it("counts only the project's own numbers", () => {
    expect(nextRfqNumber('AFRI-1325', ['AFRI-02A-1402-02-07', 'RFQ-0009'])).toBe('AFRI-02A-1325-02-01');
    // A project whose number starts like another's is not counted with it.
    expect(nextRfqNumber('AFRI-13', ['AFRI-02A-1325-02-05'])).toBe('AFRI-02A-13-02-01');
  });

  it('numbers RFQs without a project RFQ-0001 onwards', () => {
    expect(nextRfqNumber(null, [])).toBe('RFQ-0001');
    expect(nextRfqNumber(undefined, ['RFQ-0001', 'RFQ-0012', 'RFQ-draft'])).toBe('RFQ-0013');
  });

  it('runs past 99 on a busy project rather than repeating a number', () => {
    expect(nextRfqNumber('AFRI-1325', ['AFRI-02A-1325-02-99'])).toBe('AFRI-02A-1325-02-100');
  });
});
