import { describe, it, expect } from 'vitest';
import { presentError, fieldErrorsFrom, isRetryable } from './errorPresentation';

describe('errorPresentation', () => {
  describe('category mapping', () => {
    it('maps a backend outage to calm, retryable copy', () => {
      const p = presentError({ code: 'SERVICE_UNAVAILABLE', message: 'whatever' });
      expect(p.title).toBe("We're having trouble connecting");
      expect(p.retryable).toBe(true);
      expect(p.tone).toBe('warning');
    });

    it('maps a lost connection to a connection message', () => {
      const p = presentError({ code: 'NETWORK_ERROR', message: 'x' });
      expect(p.title).toBe('Connection interrupted');
      expect(p.retryable).toBe(true);
    });

    it('maps a timeout distinctly from a lost connection', () => {
      const p = presentError({ code: 'TIMEOUT', message: 'x' });
      expect(p.title).toMatch(/longer than expected/i);
      expect(p.retryable).toBe(true);
    });

    it('maps a permission failure and does not offer a retry', () => {
      const p = presentError({ code: 'FORBIDDEN', message: 'Missing permission: view:reports' });
      expect(p.title).toBe("You don't have access to this action");
      expect(p.retryable).toBe(false);
      // The internal permission name is not repeated to the user.
      expect(p.message).not.toContain('view:reports');
    });

    it('maps an expired session without offering a retry', () => {
      const p = presentError({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      expect(p.title).toMatch(/session/i);
      expect(p.retryable).toBe(false);
    });

    it('maps a missing record to a not-found message', () => {
      const p = presentError({ code: 'NOT_FOUND', message: 'Material not found' });
      expect(p.title).toMatch(/couldn't find that record/i);
      expect(p.retryable).toBe(false);
    });

    it('maps rate limiting to a wait-and-retry message', () => {
      const p = presentError({ code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' });
      expect(p.title).toMatch(/too many requests/i);
      expect(p.retryable).toBe(true);
    });
  });

  describe('domain wording', () => {
    it('shows the server wording for a business-rule conflict', () => {
      const p = presentError({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Only 3 of SKU A-1 are available at D-1; you asked for 5.',
      });
      expect(p.message).toBe('Only 3 of SKU A-1 are available at D-1; you asked for 5.');
    });

    it('shows the server wording for a validation error', () => {
      const p = presentError({ code: 'VALIDATION_ERROR', message: 'Quantity must be greater than zero.' });
      expect(p.message).toBe('Quantity must be greater than zero.');
    });

    it('rejects a server "message" that is really a stack trace', () => {
      const p = presentError({
        code: 'VALIDATION_ERROR',
        message: 'TypeError: Cannot read properties of undefined\n    at validate (/app/src/a.ts:12:9)',
      });
      expect(p.message).not.toMatch(/TypeError|at validate/);
    });

    it('rejects a server message that leaks a filesystem path', () => {
      const p = presentError({ code: 'CONFLICT', message: 'Failed at /srv/app/prisma/schema.prisma line 4' });
      expect(p.message).not.toContain('/srv/app');
    });
  });

  describe('unknown and malformed input', () => {
    it('falls back to the generic message for an unknown code', () => {
      const p = presentError({ code: 'SOME_NEW_CODE', message: 'boom' });
      expect(p.title).toBe("Something didn't go as expected");
      expect(p.message).toMatch(/contact your system administrator/i);
    });

    it('never throws and never returns raw text for a non-error value', () => {
      for (const bad of [undefined, null, 'string', 42, {}, [], new Error('raw')]) {
        const p = presentError(bad);
        expect(typeof p.title).toBe('string');
        expect(p.message).not.toBe('raw');
        expect(p.message).not.toMatch(/^Error:/);
      }
    });

    it('surfaces the request reference when the server sent one', () => {
      const p = presentError({ code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: 'req-99' });
      expect(p.reference).toBe('req-99');
    });

    it('omits the reference when there is none', () => {
      const p = presentError({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
      expect(p.reference).toBeUndefined();
    });
  });

  describe('fieldErrorsFrom', () => {
    it('reads the first message per field from a details payload', () => {
      const out = fieldErrorsFrom({
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        details: { fieldErrors: { quantity: ['Must be positive', 'Other'], sku: 'Required' } },
      });
      expect(out).toEqual({ quantity: 'Must be positive', sku: 'Required' });
    });

    it('returns an empty map when there are no field errors', () => {
      expect(fieldErrorsFrom({ code: 'CONFLICT', message: 'x' })).toEqual({});
      expect(fieldErrorsFrom(null)).toEqual({});
    });
  });

  describe('isRetryable', () => {
    it('is true for transient failures and false for permission failures', () => {
      expect(isRetryable({ code: 'SERVICE_UNAVAILABLE', message: 'x' })).toBe(true);
      expect(isRetryable({ code: 'FORBIDDEN', message: 'x' })).toBe(false);
      expect(isRetryable({ code: 'NOT_FOUND', message: 'x' })).toBe(false);
    });
  });
});
