// The dry-run report: what the import would load, and every problem found,
// grouped so the storeman and buyer can work through them. Markdown, so it
// reads in any editor and on GitHub-style viewers.
import { CATEGORY_LABEL, PROBLEM_TEXT, type Analysis, type Problem, type ProblemCode } from './workbook-analysis.js';

const rand = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '\\|');

export function problemCounts(problems: Problem[]): Array<{ code: ProblemCode; count: number }> {
  const counts = new Map<ProblemCode, number>();
  for (const p of problems) counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
  return (Object.keys(PROBLEM_TEXT) as ProblemCode[]).filter((c) => counts.has(c)).map((code) => ({ code, count: counts.get(code)! }));
}

export function renderReport(analysis: Analysis, meta: { file: string; generatedAt: Date }): string {
  const { items, problems, categories, locations } = analysis;
  const errors = problems.filter((p) => PROBLEM_TEXT[p.code].severity === 'error').length;
  const out: string[] = [];

  out.push('# Workbook import: dry run', '');
  out.push(`Workbook: \`${meta.file}\`  `);
  out.push(`Run at: ${meta.generatedAt.toISOString()}  `);
  out.push('Nothing was written to the database.', '');
  out.push(errors === 0
    ? `**${problems.length} problems to review, none blocking.**`
    : `**${errors} blocking problems** and ${problems.length - errors} to review. The import will not run until the blocking ones are fixed.`, '');

  out.push('## What would be loaded', '');
  out.push('| Category | Items | Units on hand | Value excl. VAT | Workbook, row by row | Difference | Workbook headline total |');
  out.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  const money = (n: number | null) => (n === null ? 'not found' : rand(n));
  for (const c of categories) {
    const diff = c.workbookRowsTotal === null ? '' : rand(Math.round((c.value - c.workbookRowsTotal) * 100) / 100);
    out.push(`| ${CATEGORY_LABEL[c.category]} | ${c.rows} | ${c.quantity} | ${rand(c.value)} | ${money(c.workbookRowsTotal)} | ${diff} | ${money(c.workbookTotal)} |`);
  }
  const total = categories.reduce((a, c) => ({ rows: a.rows + c.rows, value: a.value + c.value }), { rows: 0, value: 0 });
  out.push(`| **All** | **${total.rows}** | | **${rand(total.value)}** | | | |`, '');
  out.push('- **Value** is units on hand times the unit price. Negative stock counts as 0, and where an item has two prices the one on its own row is used, so small differences from the workbook are expected; each is listed under Problems.');
  out.push("- **Workbook, row by row** adds up the Summary sheet's Stock Value column over every item row.");
  out.push("- **Workbook headline total** is the figure at the top of each Summary sheet. Where it is lower, its SUM range stops before the last item row, so it leaves items out: a fault in the workbook, not in the import.");
  out.push(`- ${analysis.unusedRows} unused rows (a Product ID filled in ahead of time, with no item and no stock) were skipped.`);
  out.push(`- ${locations.length} distinct locations after ignoring case, spaces and punctuation.`, '');

  out.push('## Problems', '');
  if (problems.length === 0) out.push('None.', '');
  else {
    out.push('| Problem | Kind | Count | What happens |', '| --- | --- | ---: | --- |');
    for (const { code, count } of problemCounts(problems)) {
      const t = PROBLEM_TEXT[code];
      out.push(`| ${t.title} | ${t.severity === 'error' ? '**blocking**' : 'review'} | ${count} | ${t.resolution} |`);
    }
    out.push('');
  }

  for (const { code } of problemCounts(problems)) {
    const t = PROBLEM_TEXT[code];
    const list = problems.filter((p) => p.code === code);
    out.push(`### ${t.title} (${list.length})`, '', t.resolution, '');
    out.push('| Sheet | Row | Product ID | Item | Detail |', '| --- | ---: | --- | --- | --- |');
    for (const p of list) out.push(`| ${cell(p.sheet)} | ${p.row ?? ''} | ${cell(p.productId)} | ${cell(p.name)} | ${cell(p.detail)} |`);
    out.push('');
  }

  out.push('## Locations as written', '');
  out.push('| Spellings (rows) |', '| --- |');
  for (const l of locations) out.push(`| ${l.spellings.map((s) => `${cell(s.text)} (${s.rows})`).join(' · ')} |`);
  out.push('');

  if (items.length === 0) out.push('_No items found._');
  return out.join('\n');
}
