// Checks the units of measure in the database DATABASE_URL points at, before
// or after the units migration (20260101000043_units_of_measure): how each
// spelling items use maps onto the list, which match nothing and would be kept
// for review, and which counted items already hold part of a unit (fixed with
// a stock count). Read-only. Exits 1 when something needs a look.
//
//   npm run check:units --workspace=@afrinov/backend
import { prisma } from '../src/shared/db.js';
import { COUNTED_AT_RELEASE, UNIT_ALIASES, unitCode } from '../src/shared/units.js';

const LISTED = new Set(Object.values(UNIT_ALIASES));

async function main(): Promise<void> {
  const units = await prisma.$queryRaw<Array<{ unit: string; items: bigint }>>`
    SELECT unit_of_measure AS unit, COUNT(*) AS items FROM materials GROUP BY unit_of_measure ORDER BY unit_of_measure`;
  const unlisted: string[] = [];
  console.log('Units in use:');
  for (const { unit, items } of units) {
    const code = unitCode(unit);
    const n = `${items} item${items === 1n ? '' : 's'}`;
    if (!LISTED.has(code)) {
      unlisted.push(unit);
      console.log(`- "${unit}" (${n}): not on the list, kept as measured and marked for review`);
    } else {
      console.log(`- "${unit}" (${n}) → ${code}, ${COUNTED_AT_RELEASE.has(code) ? 'counted' : 'measured'}`);
    }
  }

  const fractions = (await prisma.$queryRaw<Array<{ sku: string; unit: string; location: string; quantity: string }>>`
    SELECT m.sku, m.unit_of_measure AS unit, l.name AS location, b.quantity::text AS quantity
    FROM inventory_balances b
    JOIN materials m ON m.id = b.material_id
    JOIN locations l ON l.id = b.location_id
    WHERE b.quantity <> trunc(b.quantity)
    ORDER BY m.sku, l.name`).filter((r) => COUNTED_AT_RELEASE.has(unitCode(r.unit)));

  if (unlisted.length === 0 && fractions.length === 0) {
    console.log('Every unit maps onto the list, and no counted item holds part of a unit.');
    return;
  }
  if (unlisted.length > 0) {
    console.log(`${unlisted.length} unit${unlisted.length === 1 ? ' is' : 's are'} not on the list. Add the spelling to UNIT_ALIASES and the migration, or change the items' unit after release.`);
  }
  if (fractions.length > 0) {
    console.log(`${fractions.length} balance${fractions.length === 1 ? '' : 's'} of a counted item hold part of a unit. Count them on Count stock to correct them:`);
    for (const f of fractions) console.log(`- ${f.sku} at ${f.location}: ${f.quantity} ${unitCode(f.unit)}`);
  }
  process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
