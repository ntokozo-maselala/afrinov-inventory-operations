// Checks the units of measure in the database DATABASE_URL points at, before
// or after the units migration (20260101000047_units_of_measure): how each
// spelling items use maps onto the list, which match nothing and would be kept
// for review, and where a counted item already holds part of a unit. Read-only.
//
// Exits 1 when something needs fixing before (or soon after) release:
//   - a unit not on the list;
//   - part of a unit on hand (count it to a whole number on Count stock);
//   - a part-unit Required Stock (the item can't be saved until it is whole);
//   - an open RFQ asking for part of one (a sent RFQ can't be changed or
//     awarded: cancel it and raise it again).
// Also lists, without failing, part-units still owed on an open order and
// still out on an issue or a tool loan: those can only be closed off as the
// exact remainder, so whoever receives or takes them back should know.
//
//   npm run check:units --workspace=@afrinov/backend
import { prisma } from '../src/shared/db.js';
import { COUNTED_AT_RELEASE, UNIT_ALIASES, unitCode } from '../src/shared/units.js';

const LISTED = new Set(Object.values(UNIT_ALIASES));
const counted = (unit: string) => COUNTED_AT_RELEASE.has(unitCode(unit));

type Row = { sku: string; unit: string; quantity: string; at: string };

function section(title: string, rows: Row[], blocking: boolean): boolean {
  if (rows.length === 0) return false;
  console.log(`\n${title} (${rows.length})${blocking ? '' : ', for information'}:`);
  for (const r of rows.slice(0, 50)) console.log(`- ${r.sku} ${r.at}: ${r.quantity} ${unitCode(r.unit)}`);
  if (rows.length > 50) console.log(`- … and ${rows.length - 50} more`);
  return blocking;
}

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
      console.log(`- "${unit}" (${n}) → ${code}, ${counted(code) ? 'counted' : 'measured'}`);
    }
  }
  if (unlisted.length > 0) {
    console.log(`${unlisted.length} unit${unlisted.length === 1 ? ' is' : 's are'} not on the list. Add the spelling to UNIT_ALIASES and the migration, or change the items' unit after release.`);
  }

  const onHand = (await prisma.$queryRaw<Row[]>`
    SELECT m.sku, m.unit_of_measure AS unit, b.quantity::text AS quantity, 'at ' || l.name AS at
    FROM inventory_balances b JOIN materials m ON m.id = b.material_id JOIN locations l ON l.id = b.location_id
    WHERE b.quantity <> trunc(b.quantity) ORDER BY m.sku, l.name`).filter((r) => counted(r.unit));

  const required = (await prisma.$queryRaw<Row[]>`
    SELECT sku, unit_of_measure AS unit, required_stock::text AS quantity, 'required stock' AS at
    FROM materials WHERE required_stock <> trunc(required_stock) ORDER BY sku`).filter((r) => counted(r.unit));

  const rfqs = (await prisma.$queryRaw<Row[]>`
    SELECT m.sku, m.unit_of_measure AS unit, rl.quantity::text AS quantity, 'on ' || r.number || ' (' || r.status || ')' AS at
    FROM rfq_lines rl JOIN rfqs r ON r.id = rl.rfq_id JOIN materials m ON m.id = rl.material_id
    WHERE r.status IN ('DRAFT', 'SENT') AND rl.quantity <> trunc(rl.quantity) ORDER BY r.number, m.sku`).filter((r) => counted(r.unit));

  const owed = (await prisma.$queryRaw<Row[]>`
    SELECT m.sku, m.unit_of_measure AS unit, (pl.ordered_qty - pl.received_qty)::text AS quantity, 'still owed on ' || po.number AS at
    FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id JOIN materials m ON m.id = pl.material_id
    WHERE po.status NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED') AND pl.ordered_qty > pl.received_qty
      AND (pl.ordered_qty - pl.received_qty) <> trunc(pl.ordered_qty - pl.received_qty)
    ORDER BY po.number, m.sku`).filter((r) => counted(r.unit));

  // Issued or lent in part-units and not reversed: what is left of them may be part of one.
  const out = (await prisma.$queryRaw<Row[]>`
    SELECT m.sku, m.unit_of_measure AS unit, (-t.quantity)::text AS quantity,
      lower(t.type::text) || ' of ' || to_char(t.posted_at, 'YYYY-MM-DD') AS at
    FROM inventory_transactions t JOIN materials m ON m.id = t.material_id
    WHERE t.type IN ('ISSUE', 'LOAN') AND t.reverses_id IS NULL AND t.quantity <> trunc(t.quantity)
      AND NOT EXISTS (SELECT 1 FROM inventory_transactions r WHERE r.reverses_id = t.id)
    ORDER BY t.posted_at`).filter((r) => counted(r.unit));

  const blocking = [
    section('Counted items holding part of a unit on hand: count them on Count stock', onHand, true),
    section('Counted items with a part-unit Required Stock: make it whole', required, true),
    section('Open RFQs asking for part of a counted item: change a draft; cancel and raise a sent one again', rfqs, true),
  ].some(Boolean);
  section('Part-units still owed on open orders: receive exactly that to finish them', owed, false);
  section('Issues and tool loans made in part-units: take back exactly what is left to close them', out, false);

  if (unlisted.length === 0 && !blocking) {
    console.log('\nEvery unit maps onto the list, and nothing will be blocked by the whole-unit rule.');
    return;
  }
  process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
