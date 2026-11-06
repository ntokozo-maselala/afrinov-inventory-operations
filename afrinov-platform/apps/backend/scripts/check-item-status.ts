// Checks items against their status records in the database DATABASE_URL points
// at (ADR-032), and lists inactive items still holding stock. Read-only.
//
// Exits 1 when an item's active flag disagrees with its newest status change.
// That should never happen: it would be a bug, or a change made around the API.
// An inactive item holding stock is listed but is not a failure: each one is
// reactivated, cleared and deactivated again.
//
//   npm run check:item-status --workspace=@afrinov/backend
import { prisma } from '../src/shared/db.js';
import { checkItemStatus } from '../src/modules/inventory/item-status-check.js';

async function main(): Promise<void> {
  const report = await checkItemStatus(prisma);
  console.log(`Items: ${report.items}`);
  console.log(`Status changes recorded: ${report.statusChanges}`);

  if (report.inactiveHoldingStock.length > 0) {
    console.log(`\nInactive items holding stock (${report.inactiveHoldingStock.length}), to reactivate, clear and deactivate again:`);
    for (const i of report.inactiveHoldingStock) console.log(`- ${i.sku}: ${i.quantity}`);
  }
  if (report.mismatched.length > 0) {
    console.log(`\nActive flag disagrees with the record (${report.mismatched.length}):`);
    for (const i of report.mismatched) {
      console.log(`- ${i.sku}: ${i.active ? 'active' : 'inactive'}, last recorded as ${i.recorded === null ? 'nothing' : i.recorded ? 'active' : 'inactive'}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('\nEvery item agrees with its status record.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
