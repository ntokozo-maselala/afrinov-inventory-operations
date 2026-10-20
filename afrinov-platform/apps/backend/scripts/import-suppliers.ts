// The vendor list import. By default a dry run: reads the vendor list in the
// AFRI-0000_x purchase order template ("Item Description" workbook), compares
// it with the suppliers already in the app and writes a report, without
// touching the database.
//
//   npm run import:suppliers -- --file "../../../afrinov-docs/docs/AFRI-0000_x R0 - Item Description.xlsm"
//
// With --apply it creates the new suppliers and fills empty fields on existing
// ones, in one transaction, in the database in DATABASE_URL (read from .env).
// It needs the database's name typed back and the user doing the import:
//
//   npm run import:suppliers -- --file <workbook> --apply --database afrinov --actor buyer@afrinov.local
//
// Nothing already typed in the app is overwritten, so it is safe to run again.
// The report goes to import-reports/, which stays out of git.
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Prisma } from '@prisma/client';
import { planVendorImport, readVendorListFile, renderVendorReport, VENDOR_PROBLEM_TEXT, type VendorPlan } from '../src/modules/migration/vendor-list.js';

function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

async function apply(plan: VendorPlan, values: { database?: string; actor?: string }) {
  const dbName = databaseName(process.env.DATABASE_URL);
  if (values.database !== dbName) {
    throw new Error(`--apply writes to the database "${dbName}". Add --database ${dbName} to confirm that is the right one.`);
  }
  if (!values.actor) throw new Error('--actor is required with --apply: the email of the user doing the import.');
  const { prisma } = await import('../src/shared/db.js');
  try {
    const actor = await prisma.user.findUnique({ where: { email: values.actor.toLowerCase() } });
    if (!actor) throw new Error(`No user with the email ${values.actor}.`);
    console.log(`Importing into "${dbName}" as ${actor.email}…`);
    await prisma.$transaction(async (tx) => {
      for (const c of plan.create) {
        const { name, vendorCode, address, contactName, contactPhone, contactEmail, currency, website, services, paymentTerms } = c;
        const created = await tx.supplier.create({
          data: { name, vendorCode, address, contactName, contactPhone, contactEmail, currency, website, services, paymentTerms },
        });
        await tx.auditLogEntry.create({
          data: { actorId: actor.id, action: 'CREATE', entityType: 'Supplier', entityId: created.id, after: created as unknown as Prisma.InputJsonValue },
        });
      }
      for (const f of plan.fill) {
        const before = await tx.supplier.findUniqueOrThrow({ where: { id: f.id } });
        const after = await tx.supplier.update({ where: { id: f.id }, data: f.fields });
        await tx.auditLogEntry.create({
          data: {
            actorId: actor.id, action: 'UPDATE', entityType: 'Supplier', entityId: f.id,
            before: before as unknown as Prisma.InputJsonValue, after: after as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }, { timeout: 60_000 });
    console.log(`Done: ${plan.create.length} suppliers created, ${plan.fill.length} updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      out: { type: 'string', default: 'import-reports' },
      apply: { type: 'boolean', default: false },
      database: { type: 'string' },
      actor: { type: 'string' },
    },
  });
  if (!values.file) {
    console.error('Usage: npm run import:suppliers -- --file <Item Description workbook.xlsm> [--out <folder>]');
    console.error('       add --apply --database <name> --actor <email> to import');
    process.exit(2);
  }
  const file = resolve(values.file);
  const outDir = values.out!;
  await mkdir(outDir, { recursive: true });

  console.log(`Reading ${basename(file)}…`);
  const list = await readVendorListFile(file);
  if (!list.sheet) throw new Error('No sheet with a "Vendor name" heading in its top row. Is this the Item Description workbook?');
  console.log(`  ${list.rows.length} rows on "${list.sheet}"`);

  // Compared with the database when there is one; otherwise as if it had no suppliers.
  let existing: Parameters<typeof planVendorImport>[1] = [];
  if (process.env.DATABASE_URL) {
    const { prisma } = await import('../src/shared/db.js');
    try {
      existing = await prisma.supplier.findMany({
        select: {
          id: true, name: true, vendorCode: true, address: true, contactName: true, contactPhone: true,
          contactEmail: true, currency: true, website: true, services: true, paymentTerms: true,
        },
      });
      console.log(`  ${existing.length} suppliers already in "${databaseName(process.env.DATABASE_URL)}"`);
    } finally {
      await prisma.$disconnect();
    }
  } else {
    console.log('  DATABASE_URL is not set: compared as if the app had no suppliers.');
  }

  const plan = planVendorImport(list, existing);
  const generatedAt = new Date();
  const reportPath = join(outDir, `vendor-list-${generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`);
  await writeFile(reportPath, renderVendorReport(plan, { file: basename(file), sheet: list.sheet, generatedAt }), 'utf8');

  console.log(`New: ${plan.create.length}. Existing, empty fields filled: ${plan.fill.length}. Existing, nothing to add: ${plan.unchanged.length}.`);
  const counts = new Map<string, number>();
  for (const p of plan.problems) counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
  for (const [code, count] of counts) {
    const text = VENDOR_PROBLEM_TEXT[code as keyof typeof VENDOR_PROBLEM_TEXT];
    console.log(`  ${text.skipped ? 'not loaded' : 'review    '} ${String(count).padStart(4)}  ${text.title}`);
  }
  console.log(`Report: ${reportPath}`);
  if (!values.apply) {
    console.log('Dry run only: nothing was written to the database.');
    return;
  }
  await apply(plan, values);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
