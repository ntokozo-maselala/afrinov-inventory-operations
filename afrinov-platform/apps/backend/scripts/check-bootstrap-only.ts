// Fails when a database that should hold only the bootstrap (permissions,
// roles, the first admin, settings) also holds business data (PRA-01).
//
// CI runs it straight after a production-mode seed. Operators can run it once
// against a new production database before the opening-balance import:
//   npm run db:check-bootstrap --workspace=@afrinov/backend
// It only reads, and prints table names and counts, never row contents.
import { prisma } from '../src/shared/db.js';

async function main(): Promise<void> {
  const counts = {
    materials: await prisma.material.count(),
    suppliers: await prisma.supplier.count(),
    projects: await prisma.project.count(),
    recipients: await prisma.recipient.count(),
    locations: await prisma.location.count(),
    purchase_orders: await prisma.purchaseOrder.count(),
    goods_receipts: await prisma.goodsReceipt.count(),
    inventory_transactions: await prisma.inventoryTransaction.count(),
  };
  const present = Object.entries(counts).filter(([, n]) => n > 0);
  for (const [table, n] of Object.entries(counts)) console.log(`${table}: ${n}`);
  if (present.length > 0) {
    console.error(`Business data found in: ${present.map(([t]) => t).join(', ')}. This database is not bootstrap-only.`);
    process.exitCode = 1;
    return;
  }
  const admins = await prisma.user.count({ where: { roles: { some: { role: { name: 'ADMIN' } } } } });
  if (admins === 0) {
    console.error('No administrator exists: the bootstrap did not run.');
    process.exitCode = 1;
    return;
  }
  console.log('Bootstrap only: no business data, and an administrator exists.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
