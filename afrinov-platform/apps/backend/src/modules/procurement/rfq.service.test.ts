// RFQ numbers follow the Manhours and Material workbook's document numbers:
// AFRI-02A-<project>-02-<nn> for a project, RFQ-<nnnn> without one.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/db.js', () => ({ prisma: {} }));

const { nextRfqNumber, rfqNumberPrefix } = await import('./rfq.service.js');

describe('RFQ numbers', () => {
  it('takes the project number without its AFRI- for a project, as the workbook files are named', () => {
    expect(rfqNumberPrefix('AFRI-1325')).toBe('AFRI-02A-1325-02-');
    expect(rfqNumberPrefix('afri-1094')).toBe('AFRI-02A-1094-02-');
    expect(rfqNumberPrefix('P-77')).toBe('AFRI-02A-P-77-02-');
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
