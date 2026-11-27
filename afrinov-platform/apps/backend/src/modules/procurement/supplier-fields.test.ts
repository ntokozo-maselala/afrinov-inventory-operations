import { describe, expect, it } from 'vitest';
import { cleanWebsite } from './supplier-fields.js';

describe('cleanWebsite', () => {
  it('drops the separators the vendor list leaves at either end', () => {
    expect(cleanWebsite('www.hydac.co.za | ')).toBe('www.hydac.co.za');
    expect(cleanWebsite(' ;, www.a.co.za,;|')).toBe('www.a.co.za');
    expect(cleanWebsite('|www.a.co.za')).toBe('www.a.co.za');
  });

  it('keeps separators inside the text', () => {
    expect(cleanWebsite('a.co.za | b.co.za')).toBe('a.co.za | b.co.za');
    expect(cleanWebsite('a,b;c')).toBe('a,b;c');
  });

  it('is null for nothing, or nothing but separators', () => {
    expect(cleanWebsite(undefined)).toBeNull();
    expect(cleanWebsite(null)).toBeNull();
    expect(cleanWebsite('')).toBeNull();
    expect(cleanWebsite(' | ,; ')).toBeNull();
  });

  it('gives what the old regex gave on every mix of separators and text', () => {
    const old = (s: string) => {
      const t = s.replace(/\s+/g, ' ').trim();
      if (t === '') return null;
      const stripped = t.replace(/^[|,;\s]+|[|,;\s]+$/g, '');
      return stripped === '' ? null : stripped;
    };
    const parts = ['|', ',', ';', ' ', '\t', 'a', 'b.c', ''];
    for (const x of parts) for (const y of parts) for (const z of parts) for (const w of parts) {
      const s = x + y + z + w;
      expect(cleanWebsite(s), JSON.stringify(s)).toBe(old(s));
    }
  });

  // CodeQL js/polynomial-redos: `[|,;\s]+$` retried from each position of a
  // long separator run took time growing with the square of its length.
  it('takes linear time on a long run of separators that does not end the text', () => {
    const hostile = `a${'|'.repeat(200_000)}a`;
    const started = performance.now();
    expect(cleanWebsite(hostile)).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
