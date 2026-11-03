// Checks that the numbers agree in the database DATABASE_URL points at:
// balances against the ledger, and every issue's returned, used up, broken
// and still out (src/modules/inventory/issued-stock-check.ts). Read-only.
// Exits 1 when something does not add up.
//
//   npm run check:issued-stock --workspace=@afrinov/backend
import { prisma } from '../src/shared/db.js';
import { checkIssuedStock } from '../src/modules/inventory/issued-stock-check.js';

async function main(): Promise<void> {
  const { balances, issues, problems } = await checkIssuedStock(prisma);
  console.log(`Checked ${balances} stock balance${balances === 1 ? '' : 's'} and ${issues} issue${issues === 1 ? '' : 's'}.`);
  if (problems.length === 0) {
    console.log('Everything adds up.');
    return;
  }
  console.log(`${problems.length} thing${problems.length === 1 ? ' does' : 's do'} not add up:`);
  for (const p of problems) console.log(`- ${p}`);
  process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
