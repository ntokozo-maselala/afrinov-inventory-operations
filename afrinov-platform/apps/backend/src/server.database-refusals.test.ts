// The central error handler and the database's own refusals (ADR-047).
//
// When the stock floor constraint refuses a balance, a code path skipped its
// own check: the person reads "not enough stock" (422) and the log gets an
// error-level event that names the stock floor, so it is followed up as a
// defect. A deadlock or write conflict rolled the transaction back: the person
// reads "try again" (409) and the log keeps it at error level, as before.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { STOCK_FLOOR_CONSTRAINT } from './shared/inventory/stock-floor.js';

vi.mock('./shared/db.js', () => ({ get prisma() { return {}; } }));

const driverFault = (code: string, cause: Record<string, unknown>) => Object.assign(
  new Error('Invalid invocation: cannot reach db.internal:5432 as user afrinov'),
  { name: 'PrismaClientKnownRequestError', code, meta: { driverAdapterError: { name: 'DriverAdapterError', cause } } },
);
const stockFloorBreach = () => driverFault('P2039', {
  originalCode: '23514', kind: 'postgres',
  originalMessage: `new row for relation "inventory_balances" violates check constraint "${STOCK_FLOOR_CONSTRAINT}"`,
});
const deadlockTakingLock = () => driverFault('P2010', { originalCode: '40P01', originalMessage: 'deadlock detected', kind: 'TransactionWriteConflict' });

describe('database refusals reach the person as domain errors (ADR-047)', () => {
  let app: FastifyInstance;
  let toThrow: () => unknown;

  beforeAll(async () => {
    app = await buildServer({ skipConfigValidation: true });
    app.get('/__test/refusal', async () => { throw toThrow(); });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await app.close(); });

  it('answers the stock floor with 422 INSUFFICIENT_BALANCE and logs it as a defect', async () => {
    const logged = vi.spyOn(app.log, 'error').mockImplementation(() => undefined);
    toThrow = stockFloorBreach;
    const res = await app.inject({ method: 'GET', url: '/__test/refusal' });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: { code: string; message: string; requestId: string } }>();
    expect(body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(body.error.requestId).toBeTruthy();
    expect(res.body).not.toMatch(/inventory_balances|db.internal|5432/);
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: 'stock-floor-refused' }), expect.stringMatching(/stock floor/i));
  });

  it('answers a deadlock with 409 CONFLICT and keeps it at error level', async () => {
    const logged = vi.spyOn(app.log, 'error').mockImplementation(() => undefined);
    toThrow = deadlockTakingLock;
    const res = await app.inject({ method: 'GET', url: '/__test/refusal' });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CONFLICT');
    expect(res.body).not.toMatch(/deadlock detected|db.internal/);
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: 'transaction-conflict' }), expect.any(String));
  });

  it('still answers an unrecognised raw-query failure as a 500', async () => {
    vi.spyOn(app.log, 'error').mockImplementation(() => undefined);
    toThrow = () => driverFault('P2010', { originalCode: '42601', kind: 'postgres' });
    const res = await app.inject({ method: 'GET', url: '/__test/refusal' });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
  });
});
