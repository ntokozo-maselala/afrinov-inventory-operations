import { describe, it, expect } from 'vitest';
import { ApiError, Errors, classifyPrismaError, toErrorEnvelope, withRequestId } from './errors.js';

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

    it('answers an unrecognised throw with a generic internal error', () => {
      const env = toErrorEnvelope(new TypeError('x.y is not a function'), 'req-3');
      expect(env.error.code).toBe('INTERNAL_ERROR');
      expect(env.error.message).toBe('Internal server error');
      expect(JSON.stringify(env)).not.toContain('is not a function');
    });
  });
});
