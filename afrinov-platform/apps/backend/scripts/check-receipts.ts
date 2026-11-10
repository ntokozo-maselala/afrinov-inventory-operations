// Checks proof of receipt (ADR-034) in the database DATABASE_URL points at:
// how slips were confirmed, which still wait and for how long, who posted
// them, which were disputed or changed after they were confirmed, and how
// many images are past their keep period. Read-only.
//
// Exits 1 when a rule is broken: a confirmation for a slip that doesn't
// exist, or a worker's or contractor's slip confirmed by someone else. That
// should never happen: it would be a bug, or a change made around the API.
// Slips still waiting are listed but are not a failure.
//
//   npm run check:receipts --workspace=@afrinov/backend
import { prisma } from '../src/shared/db.js';
import { checkReceipts } from '../src/modules/inventory/receipt-check.js';

const list = (ids: string[]) => ids.slice(0, 20).map((id) => `- ${id}`).join('\n') + (ids.length > 20 ? `\n- … and ${ids.length - 20} more` : '');

async function main(): Promise<void> {
  const r = await checkReceipts(prisma);
  const confirmed = r.confirmed.PIN + r.confirmed.SIGNATURE + r.confirmed.PAPER;
  const waiting = r.waiting.today + r.waiting.week + r.waiting.month + r.waiting.older;
  console.log(`Issue and tool loan slips: ${r.slips}`);
  console.log(`Confirmed: ${confirmed} (PIN ${r.confirmed.PIN}, signature ${r.confirmed.SIGNATURE}, signed paper slip ${r.confirmed.PAPER})`);
  console.log(`Not confirmed: ${waiting} (today ${r.waiting.today}, 1 to 6 days ${r.waiting.week}, 7 to 29 days ${r.waiting.month}, 30 days or more ${r.waiting.older})`);
  if (r.waitingByIssuer.length > 0) {
    console.log('\nNot confirmed, by who posted them:');
    for (const i of r.waitingByIssuer) console.log(`- ${i.name}: ${i.slips}`);
  }
  if (r.disputed.length > 0) console.log(`\nSaid to be wrong by the person collecting (${r.disputed.length}), to check and correct:\n${list(r.disputed)}`);
  if (r.changedAfter.length > 0) console.log(`\nChanged after they were confirmed (${r.changedAfter.length}):\n${list(r.changedAfter)}`);
  if (r.imagesDue > 0) console.log(`\nImages past inventory.receiptImageKeepMonths: ${r.imagesDue}. The server removes them hourly.`);

  if (r.orphaned.length > 0 || r.wrongSigner.length > 0) {
    if (r.orphaned.length > 0) console.log(`\nConfirmations for a slip that doesn't exist (${r.orphaned.length}):\n${list(r.orphaned)}`);
    if (r.wrongSigner.length > 0) console.log(`\nWorker or contractor slips confirmed by someone else (${r.wrongSigner.length}):\n${list(r.wrongSigner)}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nEvery confirmation keeps the rules.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
