// Dry run of the workbook import: reads the stock workbook, checks it against
// the mapping file and writes a report of what would be loaded and every
// problem found. It never touches the database.
//
//   npm run import:workbook -- --file "../../../AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm"
//
// The first run writes import-reports/mapping.xlsx with suggested SKUs, units
// and locations for the storeman to review; later runs read it back. It never
// overwrites an existing mapping file. Reports and the mapping file stay out
// of git (import-reports/ is ignored): they hold business data.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readWorkbookFile } from '../src/modules/migration/workbook-reader.js';
import { analyseWorkbook, PROBLEM_TEXT, RESOLVED_BY_MAPPING, type Problem } from '../src/modules/migration/workbook-analysis.js';
import { applyMapping, readMappingFile, suggestMapping, writeMappingFile, type MappedImport } from '../src/modules/migration/mapping.js';
import { problemCounts, renderReport } from '../src/modules/migration/workbook-report.js';

const exists = (path: string) => access(path).then(() => true, () => false);

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      out: { type: 'string', default: 'import-reports' },
      mapping: { type: 'string' },
    },
  });
  if (!values.file) {
    console.error('Usage: npm run import:workbook -- --file <workbook.xlsm> [--mapping <mapping.xlsx>] [--out <folder>]');
    process.exit(2);
  }

  const file = resolve(values.file);
  const outDir = values.out!;
  const mappingPath = values.mapping ?? join(outDir, 'mapping.xlsx');
  await mkdir(outDir, { recursive: true });

  console.log(`Reading ${basename(file)}…`);
  const analysis = analyseWorkbook(await readWorkbookFile(file));

  let problems: Problem[] = analysis.problems;
  let created = false;
  let result: MappedImport | null = null;
  if (await exists(mappingPath)) {
    console.log(`Reading mapping file ${mappingPath}…`);
    const read = await readMappingFile(mappingPath);
    result = applyMapping(analysis, read.mapping);
    problems = [...analysis.problems.filter((p) => !RESOLVED_BY_MAPPING.has(p.code)), ...read.problems, ...result.problems];
  } else {
    await writeMappingFile(mappingPath, suggestMapping(analysis), analysis);
    created = true;
  }

  const generatedAt = new Date();
  const reportPath = join(outDir, `workbook-dry-run-${generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`);
  await writeFile(reportPath, renderReport(analysis, {
    file: basename(file), generatedAt, problems, mapping: { file: basename(mappingPath), created, result },
  }), 'utf8');

  for (const c of analysis.categories) {
    console.log(`  ${c.category.padEnd(28)} ${String(c.rows).padStart(5)} items  R ${c.value.toFixed(2).padStart(12)}  (workbook rows R ${c.workbookRowsTotal?.toFixed(2) ?? '?'})`);
  }
  if (result) console.log(`With the mapping: ${result.materials.length} items and ${result.locations.length} locations to create.`);
  console.log('Problems:');
  for (const { code, count } of problemCounts(problems)) {
    console.log(`  ${PROBLEM_TEXT[code].severity === 'error' ? 'BLOCKING' : 'review  '} ${String(count).padStart(4)}  ${PROBLEM_TEXT[code].title}`);
  }
  console.log(`Report: ${reportPath}`);
  if (created) console.log(`Mapping file created: ${mappingPath}. Review it, save it, and run this again.`);
  const blocking = problems.filter((p) => PROBLEM_TEXT[p.code].severity === 'error').length;
  console.log(blocking === 0
    ? 'No blocking problems.'
    : `${blocking} blocking problem${blocking === 1 ? '' : 's'}: fix these before the real import.`);
  console.log('Dry run only: nothing was written to the database.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
