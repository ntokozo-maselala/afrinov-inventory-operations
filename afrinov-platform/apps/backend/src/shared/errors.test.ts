import { describe, it, expect } from 'vitest';
import { ApiError, Errors, classifyDatabaseRefusal, classifyPrismaError, toErrorEnvelope, withRequestId } from './errors.js';
import { STOCK_FLOOR_CONSTRAINT } from './inventory/stock-floor.js';

// The shapes Prisma 7 with the pg driver adapter really throws, as captured
// against PostgreSQL 16 on 2026-11-23 (ADR-047): the P-code alone is not
// enough, the driver's cause says what the database refused.
const driverFault = (code: string, cause: Record<string, unknown>) => ({
  code,
  message: 'Invalid `tx.inventoryBalance.upsert()` invocation: cannot reach db.internal:5432 as user afrinov',
  meta: { modelName: 'InventoryBalance', driverAdapterError: { name: 'DriverAdapterError', cause } },
});
const checkViolation = (constraint: string) => driverFault('P2039', {
  originalCode: '23514', kind: 'postgres', code: '23514', severity: 'ERROR',
  originalMessage: `new row for relation "inventory_balances" violates check constraint "${constraint}"`,
  detail: 'Failing row contains (b3a4…, 0d4f…, -1.0000, 2026-11-23 08:34:34.506, ).',
});
const deadlock = { originalCode: '40P01', originalMessage: 'deadlock detected', kind: 'TransactionWriteConflict' };
const serializationFailure = { originalCode: '40001', originalMessage: 'could not serialize access', kind: 'TransactionWriteConflict' };

describe('shared/errors', () => {
  describe('Errors factory', () => {
    it('unauthenticated has status 401', () => {
      const e = Errors.unauthenticated();
      expect(e).toBeInstanceOf(ApiError);
      expect(e.statusCode).toBe(401);
      expect(e.code).toBe('UNAUTHENTICATED');
    });

    it('unauthenticated accepts custom message', () => {
      const e = Errors.unauthenticated('Token expired');
      expect(e.message).toBe('Token expired');
    });

    it('forbidden has status 403', () => {
      const e = Errors.forbidden();
      expect(e.statusCode).toBe(403);
      expect(e.code).toBe('FORBIDDEN');
    });

    it('forbidden accepts custom message', () => {
      const e = Errors.forbidden('User inactive');
      expect(e.message).toBe('User inactive');
    });

    it('notFound has status 404 and interpolates resource name', () => {
      const e = Errors.notFound('Material');
      expect(e.statusCode).toBe(404);
      expect(e.code).toBe('NOT_FOUND');
      expect(e.message).toBe('Material not found');
    });

    it('conflict has status 409 with details', () => {
      const e = Errors.conflict('Duplicate SKU', { sku: 'A-1' });
      expect(e.statusCode).toBe(409);
      expect(e.code).toBe('CONFLICT');
      expect(e.details).toEqual({ sku: 'A-1' });
    });

    it('validation has status 400 with details', () => {
      const e = Errors.validation('Bad input', { field: 'quantity' });
      expect(e.statusCode).toBe(400);
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.details).toEqual({ field: 'quantity' });
    });

    it('insufficientBalance has status 422', () => {
      const e = Errors.insufficientBalance('Cannot issue', { materialId: 'm-1' });
      expect(e.statusCode).toBe(422);
      expect(e.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('invalidState has status 409', () => {
      const e = Errors.invalidState('Already posted');
      expect(e.statusCode).toBe(409);
      expect(e.code).toBe('INVALID_STATE');
    });

    it('is a subclass of Error', () => {
      const e = Errors.notFound('Test');
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('ApiError');
    });

    it('serviceUnavailable has status 503 and a safe message', () => {
      const e = Errors.serviceUnavailable();
      expect(e.statusCode).toBe(503);
      expect(e.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('badRequest has status 400', () => {
      const e = Errors.badRequest();
      expect(e.statusCode).toBe(400);
      expect(e.code).toBe('BAD_REQUEST');
    });

    it('rateLimited has status 429, not 500', () => {
      const e = Errors.rateLimited();
      expect(e.statusCode).toBe(429);
      expect(e.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('classifyPrismaError', () => {
    it('treats an unreachable database as 503, never as a client error', () => {
      for (const code of ['P1001', 'P1002', 'P1017', 'P1008']) {
        const e = classifyPrismaError({ code });
        expect(e?.statusCode).toBe(503);
        expect(e?.code).toBe('SERVICE_UNAVAILABLE');
      }
    });

    it('maps a unique-constraint violation to a conflict', () => {
      const e = classifyPrismaError({ code: 'P2002' });
      expect(e?.statusCode).toBe(409);
      expect(e?.code).toBe('CONFLICT');
    });

    it('maps a missing-row operation to not-found', () => {
      const e = classifyPrismaError({ code: 'P2025' });
      expect(e?.statusCode).toBe(404);
      expect(e?.code).toBe('NOT_FOUND');
    });

    it('never leaks the raw driver message', () => {
      const e = classifyPrismaError({
        code: 'P1001',
        message: 'Can\'t reach database server at `db.internal:5432`: ECONNREFUSED',
      });
      expect(e?.message).not.toMatch(/ECONNREFUSED|5432|db\.internal/);
    });

    it('returns null for a non-Prisma error', () => {
      expect(classifyPrismaError(new Error('boom'))).toBeNull();
      expect(classifyPrismaError({ code: 'NOT_A_CODE' })).toBeNull();
      expect(classifyPrismaError(null)).toBeNull();
    });

    it('returns null for an unmapped Prisma code so it is logged as a defect', () => {
      // Transaction and raw-query failures (P2010, P2028, P2034) are not
      // classified operational faults: returning null lets the central handler
      // log them at error severity rather than as a database warning.
      for (const code of ['P2010', 'P2028', 'P2034', 'P2099']) {
        expect(classifyPrismaError({ code })).toBeNull();
      }
    });
  });

  describe('classifyDatabaseRefusal (ADR-047)', () => {
    it('answers the stock floor refusing a balance as not enough stock, never a 500', () => {
      const refusal = classifyDatabaseRefusal(checkViolation(STOCK_FLOOR_CONSTRAINT));
      expect(refusal?.event).toBe('stock-floor-refused');
      expect(refusal?.error.statusCode).toBe(422);
      expect(refusal?.error.code).toBe('INSUFFICIENT_BALANCE');
      expect(refusal?.error.message).toMatch(/below zero/);
    });

    it('leaves another check constraint unclassified, so it is still logged as a defect', () => {
      expect(classifyDatabaseRefusal(checkViolation('tool_repairs_quantity_check'))).toBeNull();
      expect(classifyDatabaseRefusal(driverFault('P2039', { originalCode: '23514' }))).toBeNull();
    });

    it('answers a deadlock in a model query as a conflict to try again', () => {
      const refusal = classifyDatabaseRefusal(driverFault('P2034', deadlock));
      expect(refusal?.event).toBe('transaction-conflict');
      expect(refusal?.error.statusCode).toBe(409);
      expect(refusal?.error.code).toBe('CONFLICT');
      expect(refusal?.error.message).toMatch(/nothing was saved/i);
    });

    it('answers a deadlock while taking the balance lock (a raw query) the same way', () => {
      // pg_advisory_xact_lock runs through $executeRaw, so its deadlock is P2010, not P2034.
      expect(classifyDatabaseRefusal(driverFault('P2010', deadlock))?.error.statusCode).toBe(409);
      expect(classifyDatabaseRefusal(driverFault('P2010', serializationFailure))?.error.statusCode).toBe(409);
    });

    it('leaves any other raw-query failure unclassified', () => {
      expect(classifyDatabaseRefusal(driverFault('P2010', { originalCode: '42601', kind: 'postgres' }))).toBeNull();
      expect(classifyDatabaseRefusal({ code: 'P2010' })).toBeNull();
    });

    it('ignores anything that is not a Prisma error', () => {
      expect(classifyDatabaseRefusal(new Error('deadlock detected'))).toBeNull();
      expect(classifyDatabaseRefusal({ code: '40P01' })).toBeNull();
      expect(classifyDatabaseRefusal(null)).toBeNull();
    });

    it('never leaks the driver message, the failing row or the connection string', () => {
      for (const fault of [checkViolation(STOCK_FLOOR_CONSTRAINT), driverFault('P2034', deadlock)]) {
        const text = JSON.stringify(classifyDatabaseRefusal(fault)?.error.message);
        expect(text).not.toMatch(/inventory_balances|Failing row|db.internal|5432|deadlock detected/);
      }
    });

    it('keeps P2034 out of classifyPrismaError, whose unmapped codes are defects', () => {
      expect(classifyPrismaError(driverFault('P2034', deadlock))).toBeNull();
      expect(classifyPrismaError(checkViolation(STOCK_FLOOR_CONSTRAINT))).toBeNull();
    });
  });

  describe('withRequestId', () => {
    it('adds the id to an error envelope that lacks one', () => {
      const body = JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload' } });
      const out = JSON.parse(withRequestId(body, 'req-9'));
      expect(out.error.requestId).toBe('req-9');
      expect(out.error.code).toBe('VALIDATION_ERROR');
      expect(out.error.message).toBe('Invalid payload');
    });

    it('leaves an envelope that already carries an id untouched', () => {
      const body = JSON.stringify({ error: { code: 'FORBIDDEN', message: 'no', requestId: 'req-own' } });
      expect(withRequestId(body, 'req-9')).toBe(body);
    });

    it('leaves a non-envelope or non-JSON body untouched', () => {
      expect(withRequestId('<html>502</html>', 'req-9')).toBe('<html>502</html>');
      expect(withRequestId(JSON.stringify({ ok: true }), 'req-9')).toBe(JSON.stringify({ ok: true }));
    });
  });

  describe('toErrorEnvelope', () => {
    it('passes an ApiError through with its code and message', () => {
      const env = toErrorEnvelope(Errors.conflict('Duplicate SKU', { sku: 'A-1' }), 'req-7');
      expect(env.error).toEqual({ code: 'CONFLICT', message: 'Duplicate SKU', details: { sku: 'A-1' }, requestId: 'req-7' });
    });

    it('omits details when there are none', () => {
      const env = toErrorEnvelope(Errors.notFound('Material'), 'req-1');
      expect(env.error).not.toHaveProperty('details');
    });

    it('classifies a database fault instead of returning a bare 500', () => {
      const env = toErrorEnvelope({ code: 'P1001', message: 'secret connection string' }, 'req-2');
      expect(env.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(env.error.message).not.toContain('secret');
      expect(env.error.requestId).toBe('req-2');
    });

    it('answers a database refusal with its domain code, not a bare 500 (ADR-047)', () => {
      const env = toErrorEnvelope(checkViolation(STOCK_FLOOR_CONSTRAINT), 'req-4');
      expect(env.error.code).toBe('INSUFFICIENT_BALANCE');
      expect(env.error.requestId).toBe('req-4');
      expect(toErrorEnvelope(driverFault('P2010', deadlock)).error.code).toBe('CONFLICT');
    });

    it('answers an unrecognised throw with a generic internal error', () => {
      const env = toErrorEnvelope(new TypeError('x.y is not a function'), 'req-3');
      expect(env.error.code).toBe('INTERNAL_ERROR');
      expect(env.error.message).toBe('Internal server error');
      expect(JSON.stringify(env)).not.toContain('is not a function');
    });
  });
});
