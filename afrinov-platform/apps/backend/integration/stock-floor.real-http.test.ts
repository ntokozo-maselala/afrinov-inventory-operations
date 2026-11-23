// The stock floor in the database (BR-009, ADR-047): no stored balance is ever
// below zero, even if a path skips its own check. Covers the constraint, how
// its refusal reaches the person, that a balance of exactly zero and a whole
// transfer still pass, the migration's preflight, and the rollback script.
//
// Run with: npm run test:integration
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, overlapping, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';
import { classifyDatabaseRefusal, toErrorEnvelope } from '../src/shared/errors.js';
import { recomputeBalance, storesStock } from '../src/shared/inventory/balances.js';
import { STOCK_FLOOR_CONSTRAINT } from '../src/shared/inventory/stock-floor.js';
import { checkIssuedStock } from '../src/modules/inventory/issued-stock-check.js';

const MIGRATION = '20260101000073_stock_floor';
const migrationSql = () => readFileSync(resolve(process.cwd(), `prisma/migrations/${MIGRATION}/migration.sql`), 'utf8');
const rollbackSql = () => readFileSync(resolve(process.cwd(), `prisma/rollbacks/${MIGRATION}.sql`), 'utf8');

/** Thrown to end a transaction that only looks: everything in it is rolled back. */
class LookedOnly extends Error {}

async function constraintCount(db: Pick<typeof prisma, '$queryRaw'> = prisma): Promise<number> {
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_constraint WHERE conname = ${STOCK_FLOOR_CONSTRAINT}`;
  return rows[0]!.n;
}

describe('stock floor in the database (ADR-047)', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let shelf: string;
  let bench: string;

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const material = await api<{ id: string }>('POST', '/materials', {
      sku: `FLOOR-${run}`, name: `Floor test ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: 0,
    });
    expect(material.status).toBe(200);
    materialId = material.body.id;
    shelf = (await api<{ id: string }>('POST', '/locations', { name: `Floor shelf ${run}`, type: 'STOREROOM' })).body.id;
    bench = (await api<{ id: string }>('POST', '/locations', { name: `Floor bench ${run}`, type: 'STOREROOM' })).body.id;
    const opening = await api('POST', '/inventory-adjustments', {
      materialId, locationId: shelf, quantity: 5, reasonCode: 'FOUND', reasonNote: 'Stock floor test opening balance',
    });
    expect(opening.status).toBe(201);
  });

  afterAll(async () => { await server?.close(); });

  it('is in place on a freshly migrated database', async () => {
    expect(await constraintCount()).toBe(1);
  });

  it('refuses a negative balance written straight to the database', async () => {
    const write = prisma.$executeRaw`
      UPDATE inventory_balances SET quantity = -1
      WHERE material_id = ${materialId} AND location_id = ${shelf} AND held_for_project = ''`;
    const err = await write.then(() => null, (e: unknown) => e);
    expect(classifyDatabaseRefusal(err)?.event).toBe('stock-floor-refused');
    expect(await ledgerAndBalance(materialId, shelf)).toEqual({ ledger: '5', balance: '5' });
  });

  it('refuses a movement whose path skipped its balance check, as not enough stock, leaving no trace', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const linesBefore = await prisma.inventoryTransaction.count({ where: { materialId } });
    // A defective path: writes the line and recomputes without lock or check.
    const defective = prisma.$transaction(async (tx) => {
      await tx.inventoryTransaction.create({
        data: { materialId, locationId: shelf, type: 'ADJUSTMENT', quantity: -6, reasonCode: 'DAMAGE', reasonNote: 'defect', actorId: admin.id },
      });
      await recomputeBalance(storesStock(materialId, shelf), tx);
    });
    const err = await defective.then(() => null, (e: unknown) => e);

    const envelope = toErrorEnvelope(err, 'req-floor');
    expect(envelope.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(JSON.stringify(envelope)).not.toMatch(/inventory_balances|Failing row/);
    expect(await prisma.inventoryTransaction.count({ where: { materialId } })).toBe(linesBefore);
    expect(await ledgerAndBalance(materialId, shelf)).toEqual({ ledger: '5', balance: '5' });
  });

  it('refuses a defective path even when two copies of it truly overlap: the recompute takes the balance lock', async () => {
    // Found 2026-11-23 by removing the transfer's lock: both copies read 10 and
    // wrote −6, each recompute summed only what it could see (4), and the
    // balance was left at 4 over a ledger of −2. Locking inside the recompute
    // makes the second sum wait for the first to commit, so it sees −2 and the
    // floor refuses it.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const m = (await api<{ id: string }>('POST', '/materials', {
      sku: `FLOOR2-${run}`, name: `Floor race ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: 0,
    })).body.id;
    expect((await api('POST', '/inventory-adjustments', { materialId: m, locationId: shelf, quantity: 10, reasonCode: 'FOUND', reasonNote: 'Floor race opening' })).status).toBe(201);
    const defective = () => prisma.$transaction(async (tx) => {
      const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { materialId_locationId_heldForProject: { materialId: m, locationId: shelf, heldForProject: '' } } });
      if (balance.quantity.lt(6)) throw new Error('checked: not enough');
      await tx.inventoryTransaction.create({
        data: { materialId: m, locationId: shelf, type: 'ADJUSTMENT', quantity: -6, reasonCode: 'DAMAGE', reasonNote: 'defective path', actorId: admin.id },
      });
      await recomputeBalance(storesStock(m, shelf), tx);
      return 'posted';
    }, { timeout: 20_000 });
    const outcomes = await Promise.allSettled(await overlapping([
      () => defective().then((v) => ({ ok: v }), (e: unknown) => ({ err: e })),
      () => defective().then((v) => ({ ok: v }), (e: unknown) => ({ err: e })),
    ]));
    const results = outcomes.map((o) => (o.status === 'fulfilled' ? o.value : { err: o.reason }));
    expect(results.filter((r) => 'ok' in r)).toHaveLength(1);
    const refused = results.find((r) => 'err' in r) as { err: unknown };
    expect(classifyDatabaseRefusal(refused.err)?.event).toBe('stock-floor-refused');
    expect(await ledgerAndBalance(m, shelf)).toEqual({ ledger: '4', balance: '4' });
  });

  it('lets a balance reach exactly zero, and checks a transfer on where it ends, not halfway', async () => {
    // A transfer writes −5 then +5 before it recomputes: only the end is checked.
    const moved = await api('POST', '/inventory-transfers', { materialId, fromLocationId: shelf, toLocationId: bench, quantity: 5 });
    expect(moved.status).toBe(201);
    expect(await ledgerAndBalance(materialId, shelf)).toEqual({ ledger: '0', balance: '0' });
    expect(await ledgerAndBalance(materialId, bench)).toEqual({ ledger: '5', balance: '5' });
  });

  it('still answers an ordinary overdraw with the service\'s own message, before the database is reached', async () => {
    const res = await api<{ error: { code: string; message: string } }>('POST', '/inventory-transfers', {
      materialId, fromLocationId: shelf, toLocationId: bench, quantity: 1,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(res.body.error.message).toMatch(/only 0/);
  });

  it('migration preflight refuses a database that already holds a negative balance, naming the way out', async () => {
    const attempt = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(rollbackSql());
      await tx.$executeRaw`
        UPDATE inventory_balances SET quantity = -2
        WHERE material_id = ${materialId} AND location_id = ${bench} AND held_for_project = ''`;
      await tx.$executeRawUnsafe(migrationSql());
      throw new LookedOnly();
    });
    const err = await attempt.then(() => null, (e: unknown) => e);
    expect(err).not.toBeInstanceOf(LookedOnly);
    expect(String((err as Error).message)).toMatch(/1 balance\(s\) below zero.*check:issued-stock/s);
    expect(await constraintCount()).toBe(1);
    expect(await ledgerAndBalance(materialId, bench)).toEqual({ ledger: '5', balance: '5' });
  });

  it('check:issued-stock reports the floor missing after a rollback, so a forgotten rollback is found', async () => {
    expect((await checkIssuedStock(prisma)).problems.filter((p) => p.includes(STOCK_FLOOR_CONSTRAINT))).toEqual([]);
    const attempt = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(rollbackSql());
      const { problems } = await checkIssuedStock(tx);
      expect(problems.filter((p) => p.includes(STOCK_FLOOR_CONSTRAINT))).toHaveLength(1);
      throw new LookedOnly();
    });
    await expect(attempt).rejects.toBeInstanceOf(LookedOnly);
  });

  it('rollback script removes the constraint, and the migration puts it back (inside a transaction that is undone)', async () => {
    const attempt = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(rollbackSql());
      expect(await constraintCount(tx)).toBe(0);
      // Running the rollback twice is harmless.
      await tx.$executeRawUnsafe(rollbackSql());
      await tx.$executeRawUnsafe(migrationSql());
      expect(await constraintCount(tx)).toBe(1);
      await tx.$executeRawUnsafe(rollbackSql());
      throw new LookedOnly();
    });
    await expect(attempt).rejects.toBeInstanceOf(LookedOnly);
    expect(await constraintCount()).toBe(1);
  });
});
