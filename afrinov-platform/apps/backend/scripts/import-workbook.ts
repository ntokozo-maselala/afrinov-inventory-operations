// The workbook import. By default a dry run: reads the stock workbook, checks
// it against the mapping file and writes a report of what would be loaded and
// every problem found, without touching the database.
//
//   npm run import:workbook -- --file "../../../AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm"
//
// The first run writes import-reports/mapping.xlsx with suggested SKUs, units
// and locations for the storeman to review; later runs read it back. It never
// overwrites an existing mapping file. Reports and the mapping file stay out
// of git (import-reports/ is ignored): they hold business data.
//
// With --apply it loads the items, locations and opening balances, once,
// into the database in DATABASE_URL (read from .env). It needs no blocking
// problems, the database's name typed back, the opening date and the user:
//
//   npm run import:workbook -- --file <workbook> --apply --database afrinov --date 2026-11-02 --actor storeman@afrinov.local
//
// With --reconcile it compares the database with the workbook afterwards, per
// category and per item, and writes a reconciliation report. Read-only.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readWorkbookFile } from '../src/modules/migration/workbook-reader.js';
import { analyseWorkbook, PROBLEM_TEXT, RESOLVED_BY_MAPPING, type Problem } from '../src/modules/migration/workbook-analysis.js';
import { applyMapping, readMappingFile, suggestMapping, writeMappingFile, type MappedImport } from '../src/modules/migration/mapping.js';
import { applyMasterData, readMasterDataFile, suggestMasterData, writeMasterDataFile, type MasterDataPlan } from '../src/modules/migration/master-data.js';
import { problemCounts, renderReport } from '../src/modules/migration/workbook-report.js';

const exists = (path: string) => access(path).then(() => true, () => false);

function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

async function apply(file: string, result: MappedImport, masterData: MasterDataPlan, values: { database?: string; date?: string; actor?: string }) {
  const dbName = databaseName(process.env.DATABASE_URL);
  if (!dbName) throw new Error('DATABASE_URL is not set (put it in apps/backend/.env).');
  if (values.database !== dbName) {
    throw new Error(`--apply writes to the database "${dbName}". Add --database ${dbName} to confirm that is the right one.`);
  }
  if (!values.date || !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) throw new Error('--date is required with --apply: the date the balances are true on, as YYYY-MM-DD.');
  if (!values.actor) throw new Error('--actor is required with --apply: the email of the user doing the import.');

  // Loaded only now, so a dry run never needs a database.
  const { prisma } = await import('../src/shared/db.js');
  const { OpeningBalanceService } = await import('../src/modules/migration/opening-balance.service.js');
  try {
    const actor = await prisma.user.findUnique({ where: { email: values.actor.toLowerCase() } });
    if (!actor) throw new Error(`No user with the email ${values.actor}.`);
    console.log(`Importing into "${dbName}", dated ${values.date}, as ${actor.email}…`);
    const done = await OpeningBalanceService.import({
      plan: result, masterData, openingDate: new Date(`${values.date}T00:00:00Z`), actorId: actor.id, sourceFile: basename(file),
    });
    console.log(`Done. Import ${done.importId}:`);
    console.log(`  ${done.materialsCreated} items created`);
    console.log(`  ${done.locationsCreated} locations created, ${done.locationsReused} already there`);
    console.log(`  ${done.balancesPosted} opening balances posted, ${done.zeroBalances} items with nothing on hand`);
    for (const [label, c] of [['projects', done.projects], ['recipients', done.recipients], ['suppliers', done.suppliers]] as const) {
      console.log(`  ${c.created} ${label} created, ${c.existing} already there`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function reconcileWith(file: string, outDir: string, result: MappedImport) {
  const dbName = databaseName(process.env.DATABASE_URL);
  if (!dbName) throw new Error('DATABASE_URL is not set (put it in apps/backend/.env).');
  const { prisma } = await import('../src/shared/db.js');
  const { loadSnapshot, reconcile, renderReconciliation } = await import('../src/modules/migration/reconciliation.js');
  try {
    console.log(`Comparing with the database "${dbName}"…`);
    const snapshot = await loadSnapshot(result.materials.map((m) => m.sku));
    const r = reconcile(result, snapshot.items, snapshot.importedOn);
    const generatedAt = new Date();
    const path = join(outDir, `reconciliation-${generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`);
    await writeFile(path, renderReconciliation(r, { file: basename(file), database: dbName, generatedAt }), 'utf8');
    for (const c of r.categories) {
      if (c.items.workbook === 0 && c.items.platform === 0) continue;
      console.log(`  ${c.category.padEnd(28)} items ${c.items.platform}/${c.items.workbook}  R ${c.value.platform.toFixed(2)} of R ${c.value.workbook.toFixed(2)}`);
    }
    console.log(r.importedOn ? `Opening balances dated ${r.importedOn}.` : 'No opening balances have been imported into this database.');
    console.log(r.differences.length === 0 ? 'Reconciled: every item, unit and rand matches.' : `${r.differences.length} differences; see the report.`);
    console.log(`Reconciliation report: ${path}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      out: { type: 'string', default: 'import-reports' },
      mapping: { type: 'string' },
      apply: { type: 'boolean', default: false },
      reconcile: { type: 'boolean', default: false },
      database: { type: 'string' },
      date: { type: 'string' },
      actor: { type: 'string' },
    },
  });
  if (!values.file) {
    console.error('Usage: npm run import:workbook -- --file <workbook.xlsm> [--mapping <mapping.xlsx>] [--out <folder>]');
    console.error('       add --apply --database <name> --date <YYYY-MM-DD> --actor <email> to import');
    console.error('       add --reconcile to compare the database with the workbook after the import');
    process.exit(2);
  }

  const file = resolve(values.file);
  const outDir = values.out!;
  const mappingPath = values.mapping ?? join(outDir, 'mapping.xlsx');
  const masterPath = join(outDir, 'master-data.xlsx');
  await mkdir(outDir, { recursive: true });

  console.log(`Reading ${basename(file)}…`);
  const workbook = await readWorkbookFile(file);
  const analysis = analyseWorkbook(workbook);

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

  let masterCreated = false;
  let masterPlan: MasterDataPlan | null = null;
  if (await exists(masterPath)) {
    console.log(`Reading ${masterPath}…`);
    const read = await readMasterDataFile(masterPath);
    const checked = applyMasterData(workbook.lists, read.data);
    masterPlan = checked.plan;
    problems = [...problems, ...read.problems, ...checked.problems];
  } else {
    await writeMasterDataFile(masterPath, suggestMasterData(workbook.lists ?? { projects: [], employees: [], missingSheets: [] }));
    masterCreated = true;
  }

  const generatedAt = new Date();
  const reportPath = join(outDir, `workbook-dry-run-${generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`);
  await writeFile(reportPath, renderReport(analysis, {
    file: basename(file), generatedAt, problems,
    mapping: { file: basename(mappingPath), created, result },
    masterData: { file: basename(masterPath), created: masterCreated, plan: masterPlan },
  }), 'utf8');

  for (const c of analysis.categories) {
    console.log(`  ${c.category.padEnd(28)} ${String(c.rows).padStart(5)} items  R ${c.value.toFixed(2).padStart(12)}  (workbook rows R ${c.workbookRowsTotal?.toFixed(2) ?? '?'})`);
  }
  if (result) console.log(`With the mapping: ${result.materials.length} items and ${result.locations.length} locations to create.`);
  if (masterPlan) console.log(`From master-data.xlsx: ${masterPlan.projects.length} projects, ${masterPlan.recipients.length} recipients, ${masterPlan.suppliers.length} suppliers.`);
  console.log('Problems:');
  for (const { code, count } of problemCounts(problems)) {
    console.log(`  ${PROBLEM_TEXT[code].severity === 'error' ? 'BLOCKING' : 'review  '} ${String(count).padStart(4)}  ${PROBLEM_TEXT[code].title}`);
  }
  console.log(`Report: ${reportPath}`);
  if (created) console.log(`Mapping file created: ${mappingPath}. Review it, save it, and run this again.`);
  if (masterCreated) console.log(`Projects, recipients and suppliers file created: ${masterPath}. Review it, save it, and run this again.`);
  const blocking = problems.filter((p) => PROBLEM_TEXT[p.code].severity === 'error').length;
  console.log(blocking === 0
    ? 'No blocking problems.'
    : `${blocking} blocking problem${blocking === 1 ? '' : 's'}: fix these before the real import.`);

  if (values.reconcile) {
    if (!result) throw new Error('Reconciling needs the mapping file used for the import.');
    if (blocking > 0) console.log('Note: the dry run has blocking problems, so the plan compared against may not be the one imported.');
    await reconcileWith(file, outDir, result);
    return;
  }
  if (!values.apply) {
    console.log('Dry run only: nothing was written to the database.');
    return;
  }
  if (!result || !masterPlan) throw new Error('The import needs reviewed mapping and master-data files; one was only just created.');
  if (blocking > 0) throw new Error('Not imported: fix the blocking problems first. Nothing was written to the database.');
  await apply(file, result, masterPlan, values);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
