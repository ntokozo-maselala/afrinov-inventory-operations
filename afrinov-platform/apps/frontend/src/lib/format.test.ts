import { describe, expect, it } from 'vitest';
import { formatNumber, formatInt, formatDateTime, formatDate } from '../lib/format';

const NBSP = '\u00a0';

describe('format.ts — pure number & date formatting', () => {
  describe('formatNumber', () => {
    it('formats integers with no decimals', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(1)).toBe('1');
      expect(formatNumber(42)).toBe('42');
      expect(formatNumber(1000)).toBe(`1${NBSP}000`);
      expect(formatNumber(1234567)).toBe(`1${NBSP}234${NBSP}567`);
    });

    it('formats decimals up to 4 places (en-ZA uses comma)', () => {
      expect(formatNumber(1.5)).toBe('1,5');
      expect(formatNumber(1.25)).toBe('1,25');
      expect(formatNumber(1.1234)).toBe('1,1234');
      expect(formatNumber(1.12345)).toBe('1,1235');
    });

    it('formats negative numbers', () => {
      expect(formatNumber(-1)).toBe('-1');
      expect(formatNumber(-1.5)).toBe('-1,5');
    });

    it('handles NaN and Infinity gracefully', () => {
      expect(formatNumber(NaN)).toBe('—');
      expect(formatNumber(Infinity)).toBe('—');
      expect(formatNumber(-Infinity)).toBe('—');
    });

    it('fixed option forces 2 decimal places minimum, up to 4 max', () => {
      expect(formatNumber(1, { fixed: true })).toBe('1,00');
      expect(formatNumber(1.5, { fixed: true })).toBe('1,50');
      expect(formatNumber(1.123, { fixed: true })).toBe('1,123');
    });

    it('fixed option respects 4 decimal places max', () => {
      expect(formatNumber(1.12345, { fixed: true })).toBe('1,1235');
    });
  });

  describe('formatInt', () => {
    it('rounds to nearest integer', () => {
      expect(formatInt(1)).toBe('1');
      expect(formatInt(1.4)).toBe('1');
      expect(formatInt(1.5)).toBe('2');
      expect(formatInt(1.6)).toBe('2');
    });

    it('formats with thousands separator (NBSP)', () => {
      expect(formatInt(1000)).toBe(`1${NBSP}000`);
      expect(formatInt(1234567)).toBe(`1${NBSP}234${NBSP}567`);
    });

    it('handles negative numbers', () => {
      expect(formatInt(-1)).toBe('-1');
      expect(formatInt(-1000)).toBe(`-1${NBSP}000`);
    });

    it('handles NaN and Infinity', () => {
      expect(formatInt(NaN)).toBe('—');
      expect(formatInt(Infinity)).toBe('—');
    });
  });

  describe('formatDateTime', () => {
    it('formats valid ISO string to local date-time (en-ZA format)', () => {
      const result = formatDateTime('2026-09-16T10:30:00.000Z');
      expect(result).toMatch(/\d{2} \w{3,4} \d{4}, \d{2}:\d{2}/);
    });

    it('returns original string on invalid input', () => {
      expect(formatDateTime('not-a-date')).toBe('not-a-date');
      expect(formatDateTime('')).toBe('');
    });
  });

  describe('formatDate', () => {
    it('formats valid ISO string to local date (en-ZA format)', () => {
      const result = formatDate('2026-09-16T10:30:00.000Z');
      expect(result).toMatch(/\d{2} \w{3,4} \d{4}/);
    });

    it('returns original string on invalid input', () => {
      expect(formatDate('not-a-date')).toBe('not-a-date');
      expect(formatDate('')).toBe('');
    });
  });
});