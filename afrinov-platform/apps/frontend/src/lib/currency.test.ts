import { describe, expect, it } from 'vitest';
import { formatCurrency, formatPercent, formatCompact } from '../lib/currency';

describe('currency.ts — pure currency & percentage formatting', () => {
  describe('formatCurrency', () => {
    it('formats ZAR with R prefix and comma decimal', () => {
      expect(formatCurrency(0, 'ZAR')).toBe('R\u00a00,00');
      expect(formatCurrency(100, 'ZAR')).toBe('R\u00a0100,00');
      expect(formatCurrency(1234.56, 'ZAR')).toBe('R\u00a01\u00a0234,56');
      expect(formatCurrency(1234567.89, 'ZAR')).toBe('R\u00a01\u00a0234\u00a0567,89');
    });

    it('formats USD with US$ prefix (en-ZA locale)', () => {
      expect(formatCurrency(100, 'USD')).toBe('US$100,00');
      expect(formatCurrency(1234.56, 'USD')).toBe('US$1\u00a0234,56');
    });

    it('formats EUR with € prefix (en-ZA locale)', () => {
      expect(formatCurrency(100, 'EUR')).toBe('\u20ac100,00');
    });

    it('handles negative amounts', () => {
      expect(formatCurrency(-100, 'ZAR')).toBe('-R\u00a0100,00');
      expect(formatCurrency(-100, 'USD')).toBe('-US$100,00');
    });

    it('handles NaN and Infinity', () => {
      expect(formatCurrency(NaN, 'ZAR')).toBe('—');
      expect(formatCurrency(Infinity, 'ZAR')).toBe('—');
      expect(formatCurrency(-Infinity, 'ZAR')).toBe('—');
    });

    it('always shows 2 decimal places', () => {
      expect(formatCurrency(1, 'ZAR')).toBe('R\u00a01,00');
      expect(formatCurrency(1.5, 'ZAR')).toBe('R\u00a01,50');
    });

    it('caches formatters for same currency', () => {
      formatCurrency(100, 'ZAR');
      formatCurrency(200, 'ZAR');
      expect(formatCurrency(300, 'ZAR')).toBe('R\u00a0300,00');
    });
  });

  describe('formatPercent', () => {
    it('formats percentage with one decimal place', () => {
      expect(formatPercent(50, 100)).toBe('50.0%');
      expect(formatPercent(1, 3)).toBe('33.3%');
      expect(formatPercent(2, 3)).toBe('66.7%');
    });

    it('handles zero total', () => {
      expect(formatPercent(10, 0)).toBe('0.0%');
    });

    it('handles negative values', () => {
      expect(formatPercent(-10, 100)).toBe('-10.0%');
    });
  });

  describe('formatCompact', () => {
    it('formats millions with M suffix', () => {
      expect(formatCompact(1_000_000)).toBe('1.0M');
      expect(formatCompact(1_500_000)).toBe('1.5M');
      expect(formatCompact(12_345_678)).toBe('12.3M');
    });

    it('formats thousands with K suffix', () => {
      expect(formatCompact(1_000)).toBe('1.0K');
      expect(formatCompact(1_500)).toBe('1.5K');
      expect(formatCompact(99_999)).toBe('100.0K');
    });

    it('formats small numbers as plain integers', () => {
      expect(formatCompact(0)).toBe('0');
      expect(formatCompact(1)).toBe('1');
      expect(formatCompact(999)).toBe('999');
    });

    it('rounds negative numbers to integer (no compact suffix)', () => {
      expect(formatCompact(-1_000)).toBe('-1000');
      expect(formatCompact(-1_000_000)).toBe('-1000000');
    });
  });
});