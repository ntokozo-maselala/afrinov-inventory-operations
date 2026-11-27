import { describe, expect, it } from 'vitest';
import { mdCell } from './markdown.js';

/** The cells of one Markdown table row, as a GFM reader splits it. */
const cellsOf = (row: string): string[] => {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === '\\' && i + 1 < row.length) { cur += row[++i]; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells;
};

describe('mdCell', () => {
  it('leaves ordinary text alone', () => {
    expect(mdCell('Bolt M12 x 40')).toBe('Bolt M12 x 40');
    expect(mdCell(null)).toBe('');
    expect(mdCell(undefined)).toBe('');
  });

  it('escapes a pipe so it stays inside the cell', () => {
    expect(mdCell('A | B')).toBe('A \\| B');
  });

  // CodeQL js/incomplete-sanitization: with only `|` escaped, a value ending
  // in a backslash turned the next escaped pipe back into a column break.
  it.each(['C:\\stock\\', 'ends with \\', 'a\\|b', '\\\\|', 'x\\'])('keeps %j as one cell, read back as written', (value) => {
    const row = `${mdCell(value)}|next`;
    expect(cellsOf(row)).toEqual([value, 'next']);
  });
});
