// Read-only check that the numbers agree in the database (ADR-002, ADR-026):
//
// - every stored balance is the sum of its ledger lines, and none is negative;
// - every issue: issued = returned + used up + broken + still out, with still
//   out never negative; a reversed issue has nothing returned or marked left;
// - used up and broken are marked only against an unreversed issue, a mark
//   booked with a return points at a return of that same issue, and a
//   withdrawal matches the mark it withdraws.
//
// Run against any database with `npm run check:issued-stock`. The integration
// tests run it after every operation.
import type { Prisma, PrismaClient } from '@prisma/client';

type Client = Pick<PrismaClient, '$queryRaw'> | Pick<Prisma.TransactionClient, '$queryRaw'>;

export interface IssuedStockCheck {
  balances: number;
  issues: number;
  /** One line per thing that does not add up; empty when everything does. */
  problems: string[];
}

const n = (x: unknown) => Number(x ?? 0);

export async function checkIssuedStock(db: Client): Promise<IssuedStockCheck> {
  const problems: string[] = [];

  // Stored balances against the ledger, both ways round. A balance is an item
  // at a location held for a project, or for none (Stores, '' in the balance row).
  const balances = await db.$queryRaw<Array<{ sku: string; location: string; held_for_project: string; balance: unknown; ledger: unknown }>>`
    SELECT m.sku, l.name AS location, held_for_project, COALESCE(b.quantity, 0) AS balance, COALESCE(t.total, 0) AS ledger
    FROM (
      SELECT material_id, location_id, COALESCE(held_for_project, '') AS held_for_project, SUM(quantity) AS total
      FROM inventory_transactions GROUP BY material_id, location_id, COALESCE(held_for_project, '')
    ) t
    FULL JOIN inventory_balances b USING (material_id, location_id, held_for_project)
    JOIN materials m ON m.id = material_id
    JOIN locations l ON l.id = location_id`;
  for (const b of balances) {
    const where = `${b.sku} at ${b.location}${b.held_for_project ? ` held for ${b.held_for_project}` : ''}`;
    if (n(b.balance) !== n(b.ledger)) problems.push(`${where}: stored balance ${n(b.balance)}, the ledger adds up to ${n(b.ledger)}`);
    if (n(b.balance) < 0) problems.push(`${where}: balance is negative (${n(b.balance)})`);
  }

  // Every issue: what came back (net of reversed returns) and what is marked (live marks only).
  const issues = await db.$queryRaw<Array<{
    id: string; sku: string; recipient: string | null; posted_at: Date; issued: unknown; returned: unknown; used_up: unknown; broken: unknown; reversed: boolean;
  }>>`
    SELECT i.id, m.sku, r.name AS recipient, i.posted_at, -i.quantity AS issued,
      COALESCE((SELECT SUM(x.quantity) FROM inventory_transactions x
        WHERE x.type = 'RETURN' AND x.reference_type = 'Return' AND x.reference_id = i.id), 0) AS returned,
      COALESCE((SELECT SUM(o.quantity) FROM consumable_outcomes o
        WHERE o.issue_transaction_id = i.id AND o.outcome = 'USED_UP' AND o.withdraws_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM consumable_outcomes w WHERE w.withdraws_id = o.id)), 0) AS used_up,
      COALESCE((SELECT SUM(o.quantity) FROM consumable_outcomes o
        WHERE o.issue_transaction_id = i.id AND o.outcome = 'BROKEN' AND o.withdraws_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM consumable_outcomes w WHERE w.withdraws_id = o.id)), 0) AS broken,
      EXISTS (SELECT 1 FROM inventory_transactions v WHERE v.reverses_id = i.id) AS reversed
    FROM inventory_transactions i
    JOIN materials m ON m.id = i.material_id
    LEFT JOIN recipients r ON r.id = i.recipient_id
    WHERE i.type = 'ISSUE' AND i.reverses_id IS NULL`;
  for (const i of issues) {
    const what = `${i.sku} issued to ${i.recipient ?? 'nobody'} on ${i.posted_at.toISOString().slice(0, 16).replace('T', ' ')}`;
    const issued = n(i.issued); const returned = n(i.returned); const usedUp = n(i.used_up); const broken = n(i.broken);
    const stillOut = issued - returned - usedUp - broken;
    if (i.reversed) {
      if (returned !== 0 || usedUp + broken !== 0) problems.push(`${what}: reversed, but ${returned} returned and ${usedUp + broken} used up or broken still count`);
    } else if (stillOut < 0) {
      problems.push(`${what}: ${issued} issued, ${returned} back, ${usedUp} used up, ${broken} broken leaves ${stillOut} still out`);
    }
    if (returned < 0) problems.push(`${what}: returns add up to ${returned}`);
  }

  // Marks only against an unreversed issue; booked with a return of that issue; withdrawals that match.
  const marks = await db.$queryRaw<Array<{ id: string; problem: string }>>`
    SELECT o.id, 'is marked against a ' || i.type || CASE WHEN i.reverses_id IS NOT NULL THEN ' reversal' ELSE '' END AS problem
    FROM consumable_outcomes o JOIN inventory_transactions i ON i.id = o.issue_transaction_id
    WHERE i.type <> 'ISSUE' OR i.reverses_id IS NOT NULL
    UNION ALL
    SELECT o.id, 'points at a return of another issue'
    FROM consumable_outcomes o JOIN inventory_transactions r ON r.id = o.return_transaction_id
    WHERE r.type <> 'RETURN' OR r.reference_id IS DISTINCT FROM o.issue_transaction_id
    UNION ALL
    SELECT w.id, 'withdraws a mark it does not match'
    FROM consumable_outcomes w JOIN consumable_outcomes o ON o.id = w.withdraws_id
    WHERE o.withdraws_id IS NOT NULL OR o.issue_transaction_id <> w.issue_transaction_id OR o.outcome <> w.outcome OR o.quantity <> w.quantity`;
  for (const m of marks) problems.push(`Used up or broken record ${m.id} ${m.problem}`);

  return { balances: balances.length, issues: issues.length, problems };
}
