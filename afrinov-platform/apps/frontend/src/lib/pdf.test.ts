// The PDF copy of a report: built, then read back as text. jsPDF writes its
// pages uncompressed, so what is printed can be found in the file (with its
// brackets escaped).
import { describe, it, expect } from 'vitest';
import { buildPdf, pdfText } from './pdf';

const text = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(buf);

describe('report PDF', () => {
  it('prints the title, what it covers, each table with its totals, and page numbers', async () => {
    const out = text(await buildPdf({
      title: 'Re-order list',
      lines: ['All categories'],
      sections: [{
        heading: 'Consumables (1)',
        columns: [{ header: 'Code' }, { header: 'Item' }, { header: 'Value', align: 'right' }],
        rows: [['CON-1', 'Grinding disc', 'R 890,00']],
        totals: [['', 'Subtotal Consumables', 'R 890,00']],
      }],
      notes: ['1 item has no unit price and is not in the totals.'],
    }, new Date('2026-10-13T08:00:00Z')));
    expect(out.startsWith('%PDF-')).toBe(true);
    for (const s of ['AFRINOV IMS', 'Re-order list', 'All categories', 'Consumables \\(1\\)', 'Grinding disc', 'Subtotal Consumables', '1 item has no unit price', 'Page 1 of 1']) {
      expect(out).toContain(s);
    }
  });

  it('says so in place of a table with no rows', async () => {
    const out = text(await buildPdf({
      title: 'Stock used',
      lines: [],
      sections: [{ heading: 'By project', columns: [{ header: 'Project' }], rows: [], empty: 'Nothing was issued.' }],
    }));
    expect(out).toContain('Nothing was issued.');
    expect(out).not.toContain('(Project)');
  });

  it('runs onto more pages, numbering each', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`SKU-${i}`, `Item ${i}`]);
    const out = text(await buildPdf({ title: 'Long', lines: [], sections: [{ columns: [{ header: 'Code' }, { header: 'Item' }], rows }] }));
    expect(out).toMatch(/Page 1 of [3-9]/);
  });

  it('swaps characters the PDF fonts cannot print', () => {
    expect(pdfText('R 1 234 − 5 → 6')).toBe('R 1 234 - 5 -> 6');
  });
});
