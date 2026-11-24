// The daily stock reconciliation against a real database (ADR-047): it records
// a run a day, finds a balance that has drifted from its ledger, never runs
// twice at once, is read by Admins only, and its rollback script works.
//
// Run with: npm run test:integration
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';
import { StockReconciliationService, type ReconciliationHealth } from '../src/modules/inventory/stock-reconciliation.js';

const ROLLBACK = resolve(process.cwd(), 'prisma/rollbacks/20260101000074_stock_reconciliation_runs.sql');
const MIGRATION = resolve(process.cwd(), 'prisma/migrations/20260101000074_stock_reconciliation_runs/migration.sql');
class LookedOnly extends Error {}

describe('daily stock reconciliation (ADR-047)', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  // Each test runs a day after the one before, so every run is due.
  let day = new Date('2027-01-01T02:00:00.000Z');
  const nextDay = () => (day = new Date(day.getTime() + 24 * 3_600_000));

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    await prisma.stockReconciliationRun.deleteMany({});
  });
  afterAll(async () => {
    await prisma.stockReconciliationRun.deleteMany({});
    await server?.close();
  });

  it('says no check has run yet', async () => {
    const res = await api<ReconciliationHealth>('GET', '/stock-reconciliation/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'NONE', lastRun: null });
  });

  it('runs, finds that everything adds up, and records it', async () => {
    const outcome = await StockReconciliationService.runIfDue(nextDay());
    expect(outcome.kind).toBe('ran');
    const recorded = outcome.kind === 'ran' ? outcome.run : null;
    // A clean shared database: if this fails, a suite has left figures that don't add up.
    expect({ status: recorded?.status, problems: recorded?.problems }).toEqual({ status: 'OK', problems: [] });
    expect(recorded!.balances).toBeGreaterThan(0);
    expect(await prisma.stockReconciliationRun.count()).toBe(1);
  });

  it('runs once a day: a second tick the same day does nothing', async () => {
    const sameDay = new Date(day.getTime() + 60 * 60 * 1000);
    expect(await StockReconciliationService.runIfDue(sameDay)).toEqual({ kind: 'skipped', reason: 'not-due' });
    expect(await prisma.stockReconciliationRun.count()).toBe(1);
  });

  it('tries a failed check again at the next tick: a failure compared nothing, so it is not the day\'s check', async () => {
    const failedAt = nextDay();
    const failed = await prisma.stockReconciliationRun.create({
      // finishedAt is the clock's, as runIfDue records it; startedAt is the test's day.
      data: { status: 'FAILED', startedAt: failedAt, finishedAt: new Date(), balances: 0, issues: 0, problemCount: 0, detail: 'Test: the check could not finish' },
    });
    try {
      expect((await api<ReconciliationHealth>('GET', '/stock-reconciliation/status')).body.state).toBe('FAILED');
      const anHourLater = new Date(failedAt.getTime() + 60 * 60 * 1000);
      const outcome = await StockReconciliationService.runIfDue(anHourLater);
      expect(outcome.kind === 'ran' && outcome.run.status).toBe('OK');
      expect((await api<ReconciliationHealth>('GET', '/stock-reconciliation/status')).body.state).toBe('OK');
      // The clean check is now the day's: the tick after it waits.
      expect(await StockReconciliationService.runIfDue(new Date(anHourLater.getTime() + 60 * 60 * 1000))).toEqual({ kind: 'skipped', reason: 'not-due' });
    } finally {
      await prisma.stockReconciliationRun.delete({ where: { id: failed.id } });
    }
  });

  it('finds a balance that has drifted from its ledger, and Admins see it', async () => {
    const material = await api<{ id: string }>('POST', '/materials', {
      sku: `RECON-${run}`, name: `Reconciliation ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: 0,
    });
    const shelf = await api<{ id: string }>('POST', '/locations', { name: `Recon shelf ${run}`, type: 'STOREROOM' });
    expect((await api('POST', '/inventory-adjustments', {
      materialId: material.body.id, locationId: shelf.body.id, quantity: 5, reasonCode: 'FOUND', reasonNote: 'Reconciliation test',
    })).status).toBe(201);
    // A path that writes a line and never recomputes: the balance stays at 5 over a ledger of 8.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const stray = await prisma.inventoryTransaction.create({
      data: { materialId: material.body.id, locationId: shelf.body.id, type: 'ADJUSTMENT', quantity: 3, reasonCode: 'FOUND', reasonNote: 'no recompute', actorId: admin.id },
    });
    try {
      const outcome = await StockReconciliationService.runIfDue(nextDay());
      expect(outcome.kind === 'ran' && outcome.run.status).toBe('DRIFT');

      const res = await api<ReconciliationHealth>('GET', '/stock-reconciliation/status');
      expect(res.body.state).toBe('DRIFT');
      expect(res.body.lastRun!.problemCount).toBe(1);
      expect(res.body.lastRun!.problems).toEqual([`RECON-${run} at Recon shelf ${run}: stored balance 5, the ledger adds up to 8`]);
    } finally {
      // Leave the shared database adding up for the suites after this one.
      await prisma.inventoryTransaction.delete({ where: { id: stray.id } });
    }
    // Drift clears only when a later check finds the figures add up again.
    expect((await StockReconciliationService.runIfDue(nextDay())).kind).toBe('ran');
    expect((await api<ReconciliationHealth>('GET', '/stock-reconciliation/status')).body.state).toBe('OK');
  });

  it('never runs twice at once: two ticks together record one run', async () => {
    const before = await prisma.stockReconciliationRun.count();
    const at = nextDay();
    const outcomes = await Promise.all([StockReconciliationService.runIfDue(at), StockReconciliationService.runIfDue(at)]);
    expect(outcomes.filter((o) => o.kind === 'ran')).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'skipped')).toHaveLength(1);
    expect(await prisma.stockReconciliationRun.count()).toBe(before + 1);
  });

  it('is for those who keep the system running: refused without manage:settings, and signed out', async () => {
    const email = `it-recon-viewer-${run}@example.com`;
    const password = `viewer-${run}-pass`;
    expect((await api('POST', '/users', { email, name: `IT recon viewer ${run}`, password, roleNames: ['VIEWER'], mustChangePassword: false })).status).toBe(201);
    const viewer = client(server.port, await login(server.port, email, password));
    expect((await viewer('GET', '/stock-reconciliation/status')).status).toBe(403);
    expect((await client(server.port)('GET', '/stock-reconciliation/status')).status).toBe(401);
  });

  it('rollback script drops the table and the migration puts it back (inside a transaction that is undone)', async () => {
    const tableCount = async (db: Pick<typeof prisma, '$queryRaw'>) =>
      (await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'stock_reconciliation_runs'`)[0]!.n;
    const attempt = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(readFileSync(ROLLBACK, 'utf8'));
      expect(await tableCount(tx)).toBe(0);
      await tx.$executeRawUnsafe(readFileSync(ROLLBACK, 'utf8'));
      for (const statement of readFileSync(MIGRATION, 'utf8').split(/;\s*$/m).map((s) => s.trim()).filter((s) => s.replace(/--.*$/gm, '').trim())) {
        await tx.$executeRawUnsafe(statement);
      }
      expect(await tableCount(tx)).toBe(1);
      throw new LookedOnly();
    });
    await expect(attempt).rejects.toBeInstanceOf(LookedOnly);
    expect(await tableCount(prisma)).toBe(1);
  });
});
