// The PDF copy of a report: built, then read back as text. jsPDF writes its
// pages uncompressed, so what is printed can be found in the file (with its
// brackets escaped).
import { describe, it, expect } from 'vitest';
import { buildPdf, parsePath, pdfText } from './pdf';

const text = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(buf);
const cells = (pdf: string) => [...pdf.matchAll(/^([\d.]+) [\d.]+ ([\d.]+) -?[\d.]+ re$/gm)].map((m) => [Number(m[1]), Number(m[2])] as const);
/** Where the table's cells start on the left, in points (an A4 landscape page is 842 wide). */
const leftEdge = (pdf: string) => Math.min(...cells(pdf).map(([x]) => x));
/** Where the table's cells end on the right, in points. */
const rightEdge = (pdf: string) => Math.max(...cells(pdf).map(([x, w]) => x + w));

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
    for (const s of ['Re-order list', 'All categories', 'Consumables \\(1\\)', 'Grinding disc', 'Subtotal Consumables', '1 item has no unit price', 'Page 1 of 1']) {
      expect(out).toContain(s);
    }
  });

  it('draws the Afrinov logo in its red and green, in place of the name in text', async () => {
    const out = text(await buildPdf({ title: 'Re-order list', lines: [], sections: [] }));
    expect(out).not.toContain('AFRINOV IMS');
    expect(out).toContain('0.9 0.2 0.16 rg'); // #E6332A
    expect(out).toContain('0.18 0.76 0.07 rg'); // #2FC112
  });

  it('reads the logo paths: moves, lines, curves and closes', () => {
    expect(parsePath('M 1 2 L 3 4 C 5 6 7 8 9 10 z M 0 0 1 1')).toEqual([
      { op: 'm', c: [1, 2] }, { op: 'l', c: [3, 4] }, { op: 'c', c: [5, 6, 7, 8, 9, 10] }, { op: 'h', c: [] },
      { op: 'm', c: [0, 0] }, { op: 'l', c: [1, 1] },
    ]);
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

  it('prints a note under a section heading', async () => {
    const out = text(await buildPdf({ title: 'Counts', lines: [], sections: [{ heading: 'Main Storeroom', note: 'Shelf 3 recounted', columns: [{ header: 'Code' }], rows: [['A']] }] }));
    expect(out).toContain('Shelf 3 recounted');
  });

  it('starts a section on a new page when asked', async () => {
    const one = { columns: [{ header: 'Code' }], rows: [['A']] };
    const out = text(await buildPdf({ title: 'Sheets', lines: [], sections: [one, { ...one, newPage: true }] }));
    expect(out).toContain('Page 2 of 2');
  });

  it('makes a short table only as wide as its content, and a wide one span the page with only its text wrapping', async () => {
    const short = text(await buildPdf({ title: 'Short', lines: [], sections: [{ columns: [{ header: 'Category' }, { header: 'Value', align: 'right' }], rows: [['Tools', 'R 7 700,00']] }] }));
    expect(rightEdge(short)).toBeLessThan(200);
    const long = 'A very long item name that keeps going '.repeat(8);
    const wide = text(await buildPdf({ title: 'Wide', lines: [], sections: [{ columns: [{ header: 'Code' }, { header: 'Item', wrap: true }], rows: [['TOOL-TORQUE-1/2', long]] }] }));
    // The page less its 20 mm side margins ends at about 785.
    expect(rightEdge(wide)).toBeGreaterThan(780);
    expect(leftEdge(wide)).toBeCloseTo(56.7, 0);
    expect(wide).toContain('(TOOL-TORQUE-1/2)');
  });

  // An item list as the reports print them: six columns, two of them text.
  const itemColumns = [
    { header: 'Code' }, { header: 'Item', wrap: true }, { header: 'Unit' },
    { header: 'Used', align: 'right' as const }, { header: 'Value', align: 'right' as const }, { header: 'Last supplier', wrap: true },
  ];

  it('spans the page with an item list of six columns or more, even when its content is short', async () => {
    const out = text(await buildPdf({ title: 'Items', lines: [], sections: [{ columns: itemColumns, rows: [['DISC', 'Disc', 'each', '4', 'R 10,00', 'Hydroscand']] }] }));
    expect(leftEdge(out)).toBeCloseTo(56.7, 0);
    expect(rightEdge(out)).toBeGreaterThan(780);
    expect(rightEdge(out)).toBeLessThan(787);
    // The spare width goes to the text columns: Item and Last supplier come out much wider than Code.
    const [code, item] = cells(out).slice(0, 2).map(([, w]) => w);
    expect(item!).toBeGreaterThan(3 * code!);
  });

  it('keeps a summary of five columns or fewer as wide as its content', async () => {
    const columns = [{ header: 'Category' }, { header: 'Urgent', align: 'right' as const }, { header: 'Warning', align: 'right' as const }, { header: 'Items', align: 'right' as const }, { header: 'Value', align: 'right' as const }];
    const out = text(await buildPdf({ title: 'Summary', lines: [], sections: [{ columns, rows: [['Tools', '2', '0', '2', 'R 7 700,00']] }] }));
    expect(rightEdge(out)).toBeLessThan(400);
  });

  it('lines up the columns of tables that have the same columns, as one per category', async () => {
    const out = text(await buildPdf({
      title: 'Stock used', lines: [], sections: [
        { heading: 'Consumables', columns: itemColumns, rows: [['GRIND-DISC-125', 'Grinding Disc 125 x 6mm', 'each', '40', 'R 1 280,00', '']] },
        { heading: 'Fasteners', columns: itemColumns, rows: [['M16X40-88-HEX', 'M16 x 40 8.8 BLACK HEX SET SCREW', 'each', '70', 'R 315,00', '']] },
      ],
    }));
    // Every cell of both tables starts at one of the same six column edges.
    const edges = new Set(cells(out).map(([x]) => x.toFixed(1)));
    expect(edges.size).toBe(itemColumns.length);
  });

  it('swaps characters the PDF fonts cannot print', () => {
    expect(pdfText('R 1 234 − 5 → 6')).toBe('R 1 234 - 5 -> 6');
  });
});
