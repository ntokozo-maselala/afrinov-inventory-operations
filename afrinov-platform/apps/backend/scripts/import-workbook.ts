// Dry run of the workbook import: reads the stock workbook, checks it and
// writes a report of what would be loaded and every problem found. It never
// touches the database.
//
//   npm run import:workbook -- --file "../../../AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm"
//
// The report goes to import-reports/ (git-ignored: it holds business data).
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readWorkbookFile } from '../src/modules/migration/workbook-reader.js';
import { analyseWorkbook, PROBLEM_TEXT } from '../src/modules/migration/workbook-analysis.js';
import { problemCounts, renderReport } from '../src/modules/migration/workbook-report.js';

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      out: { type: 'string', default: 'import-reports' },
    },
  });
  if (!values.file) {
    console.error('Usage: npm run import:workbook -- --file <workbook.xlsm> [--out <folder>]');
    process.exit(2);
  }

  const file = resolve(values.file);
  console.log(`Reading ${basename(file)}…`);
  const analysis = analyseWorkbook(await readWorkbookFile(file));

  const generatedAt = new Date();
  await mkdir(values.out!, { recursive: true });
  const reportPath = join(values.out!, `workbook-dry-run-${generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`);
  await writeFile(reportPath, renderReport(analysis, { file: basename(file), generatedAt }), 'utf8');

  for (const c of analysis.categories) {
    console.log(`  ${c.category.padEnd(28)} ${String(c.rows).padStart(5)} items  R ${c.value.toFixed(2).padStart(12)}  (workbook rows R ${c.workbookRowsTotal?.toFixed(2) ?? '?'})`);
  }
  console.log('Problems:');
  for (const { code, count } of problemCounts(analysis.problems)) {
    console.log(`  ${PROBLEM_TEXT[code].severity === 'error' ? 'BLOCKING' : 'review  '} ${String(count).padStart(4)}  ${PROBLEM_TEXT[code].title}`);
  }
  console.log(`Report: ${reportPath}`);
  const blocking = analysis.problems.filter((p) => PROBLEM_TEXT[p.code].severity === 'error').length;
  console.log(blocking === 0
    ? 'No blocking problems.'
    : `${blocking} blocking problem${blocking === 1 ? '' : 's'}: fix these in the workbook before the real import.`);
  console.log('Dry run only: nothing was written to the database.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
