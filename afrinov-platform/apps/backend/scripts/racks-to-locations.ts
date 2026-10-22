// Racks to locations (racks and locations roadmap, Phase 3.1). By default a
// dry run: compares every Rack record with the locations, writes a report of
// what it would do, and changes nothing.
//
//   npm run racks:to-locations
//
// For each rack it finds the matching location (by code, then by name when
// that is unambiguous) and copies the rack's room onto it as the location's
// "Located in". The Rack extras (project, capacity, "Full" status, notes) are
// dropped, as decided; the report lists them. A rack it cannot place is left
// for a person to settle by its code:
//
//   npm run racks:to-locations -- --create F-7 --discard CHK-8849
//
// With --apply it does it all in one transaction, holding the same lock as
// location edits, in the database in DATABASE_URL (read from .env). It needs
// the database's name typed back and the user doing it. BACK UP THE DATABASE
// FIRST (pg_dump): applying removes the Rack records it has handled, after
// writing each one's full record to the audit log.
//
//   npm run racks:to-locations -- --apply --database afrinov --actor admin@afrinov.local
//
// Safe to run again: handled racks are gone, so a second run finds only the
// ones still needing a decision. The report goes to import-reports/, which
// stays out of git.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Prisma } from '@prisma/client';
import { planRackCopy, removedRacks, renderRackReport, type RackPlan } from '../src/modules/migration/rack-copy.js';
import { applyRackPlan } from '../src/modules/migration/rack-copy-apply.js';

type Db = Prisma.TransactionClient;

function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

const list = (v: string[] | undefined) => (v ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);

async function readAndPlan(db: Db, decisions: { create: string[]; discard: string[] }): Promise<RackPlan> {
  const [racks, locations] = await Promise.all([
    db.rack.findMany({
      select: { id: true, code: true, name: true, description: true, locationId: true, projectNumber: true, capacity: true, status: true, notes: true },
      orderBy: { code: 'asc' },
    }),
    db.location.findMany({ select: { id: true, name: true, code: true, type: true, active: true, parentId: true } }),
  ]);
  return planRackCopy(racks, locations, decisions);
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'import-reports' },
      create: { type: 'string', multiple: true },
      discard: { type: 'string', multiple: true },
      apply: { type: 'boolean', default: false },
      database: { type: 'string' },
      actor: { type: 'string' },
    },
  });
  const dbName = databaseName(process.env.DATABASE_URL);
  if (!dbName) throw new Error('DATABASE_URL is not set: there are no Rack records to read.');
  const decisions = { create: list(values.create), discard: list(values.discard) };
  const outDir = values.out!;
  await mkdir(outDir, { recursive: true });

  const { prisma } = await import('../src/shared/db.js');
  try {
    let actorId: string | null = null;
    if (values.apply) {
      if (values.database !== dbName) {
        throw new Error(`--apply writes to the database "${dbName}". Add --database ${dbName} to confirm that is the right one, after backing it up.`);
      }
      if (!values.actor) throw new Error('--actor is required with --apply: the email of the user doing it.');
      const actor = await prisma.user.findUnique({ where: { email: values.actor.toLowerCase() } });
      if (!actor) throw new Error(`No user with the email ${values.actor}.`);
      actorId = actor.id;
    }

    // Applied under the location-tree lock, planned again from what the
    // transaction sees, so it acts on exactly what it checked.
    const plan = await prisma.$transaction(async (tx) => {
      if (actorId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:location-tree'))`;
      const p = await readAndPlan(tx, decisions);
      if (actorId && p.errors.length === 0) await applyRackPlan(tx, p, actorId);
      return p;
    }, { timeout: 60_000 });

    const applied = !!actorId && plan.errors.length === 0;
    const generatedAt = new Date();
    const reportPath = join(outDir, `racks-to-locations-${generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`);
    await writeFile(reportPath, renderRackReport(plan, { database: dbName, generatedAt, applied }), 'utf8');

    const counts = new Map<string, number>();
    for (const i of plan.items) counts.set(i.outcome.kind, (counts.get(i.outcome.kind) ?? 0) + 1);
    console.log(`${plan.items.length} racks in "${dbName}": ${[...counts].map(([k, n]) => `${n} ${k}`).join(', ') || 'none left'}.`);
    for (const e of plan.errors) console.log(`  cannot apply: ${e}`);
    console.log(`Report: ${reportPath}`);
    if (plan.errors.length) {
      console.log('Nothing was changed: fix the --create / --discard codes above first.');
      process.exitCode = 1;
    } else if (!applied) {
      console.log('Dry run only: nothing was written to the database.');
    } else {
      console.log(`Done: ${removedRacks(plan).length} racks handled and removed; ${plan.items.length - removedRacks(plan).length} left for a decision.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
