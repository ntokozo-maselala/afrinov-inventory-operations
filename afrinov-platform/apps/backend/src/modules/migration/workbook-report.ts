// The dry-run report: what the import would load, and every problem found,
// grouped so the storeman and buyer can work through them. Markdown, so it
// reads in any editor and on GitHub-style viewers.
import { unitHint, type MappedImport } from './mapping.js';
import type { MasterDataPlan } from './master-data.js';
import { CATEGORY_LABEL, PROBLEM_TEXT, type Analysis, type Problem, type ProblemCode } from './workbook-analysis.js';

const rand = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '\\|');

export function problemCounts(problems: Problem[]): Array<{ code: ProblemCode; count: number }> {
  const counts = new Map<ProblemCode, number>();
  for (const p of problems) counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
  const all = (Object.keys(PROBLEM_TEXT) as ProblemCode[]).filter((c) => counts.has(c));
  // Blocking problems first, each group in catalogue order.
  return [...all.filter((c) => PROBLEM_TEXT[c].severity === 'error'), ...all.filter((c) => PROBLEM_TEXT[c].severity !== 'error')]
    .map((code) => ({ code, count: counts.get(code)! }));
}

export interface ReportMapping {
  file: string;
  /** True when this run wrote the mapping file with suggestions. */
  created: boolean;
  result: MappedImport | null;
}

/**
 * `problems` is everything to report: the workbook's own (less those the
 * mapping settles) and the mapping's.
 */
export interface ReportMasterData {
  file: string;
  created: boolean;
  plan: MasterDataPlan | null;
}

export function renderReport(
  analysis: Analysis,
  meta: { file: string; generatedAt: Date; problems?: Problem[]; mapping?: ReportMapping; masterData?: ReportMasterData },
): string {
  const { items, categories, locations } = analysis;
  const problems = meta.problems ?? analysis.problems;
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

  if (meta.mapping) {
    const m = meta.mapping;
    out.push('## Mapping file', '');
    if (m.created) {
      out.push(`Created \`${m.file}\` with suggested SKUs, units and locations. The storeman and buyer review it (see its "Read me" sheet), then run the dry run again.`, '');
    } else if (m.result) {
      const r = m.result;
      out.push(`Read \`${m.file}\`. With it, the import would create:`, '');
      out.push(`- **${r.materials.length} items**, with ${r.materials.reduce((a, x) => a + x.balances.length, 0)} opening balances`);
      out.push(`- **${r.locations.length} locations**: ${r.locations.map((l) => `${cell(l.name)} (${l.type.toLowerCase().replace(/_/g, ' ')})`).join(', ')}`);
      const units = new Map<string, number>();
      for (const x of r.materials) units.set(x.unitOfMeasure, (units.get(x.unitOfMeasure) ?? 0) + 1);
      out.push(`- Units: ${[...units].sort((a, b) => b[1] - a[1]).map(([u, n]) => `${cell(u)} ${n}`).join(', ')}`);
      const toCheck = r.materials.filter((x) => x.unitOfMeasure.toLowerCase() === 'each' && unitHint(x.name)).length;
      if (toCheck > 0) out.push(`- ${toCheck} items counted as "each" have a word in their name that suggests another unit (the last column of the Items sheet).`);
      out.push('');
    }
  }

  if (meta.masterData) {
    const m = meta.masterData;
    out.push('## Projects, recipients and suppliers', '');
    if (m.created) {
      out.push(`Created \`${m.file}\` from the workbook's "Project No." and "Employees" sheets, with an empty Suppliers sheet for the buyer. Review it (see its "Read me" sheet), then run the dry run again.`, '');
    } else if (m.plan) {
      const p = m.plan;
      out.push(`Read \`${m.file}\`. The import would add these, leaving any that already exist as they are:`, '');
      out.push(`- **${p.projects.length} projects**: ${p.projects.map((x) => cell(x.name ? `${x.projectNumber} (${x.name})` : x.projectNumber)).join(', ') || 'none'}`);
      const byType = new Map<string, number>();
      for (const r of p.recipients) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
      out.push(`- **${p.recipients.length} recipients**${byType.size ? `: ${[...byType].map(([t, n]) => `${n} ${t.toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')}` : ''}`);
      out.push(`- **${p.suppliers.length} suppliers**${p.suppliers.length === 0 ? ' (the buyer has not listed any yet)' : ''}`, '');
    }
  }

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
