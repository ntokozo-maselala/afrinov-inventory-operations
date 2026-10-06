import { describe, it, expect } from 'vitest';
import { ApiError, Errors } from './errors.js';

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
  });
});
