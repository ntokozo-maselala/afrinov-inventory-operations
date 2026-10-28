import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isApiError, FRONTEND_ONLY } from '../api/client';
import { resetMockState } from '../mock/mockApi';

describe('api/client.ts — API client utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    resetMockState();
  });

  describe('requests', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    async function sent(call: (api: typeof import('../api/client').api) => Promise<unknown>) {
      const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);
      vi.stubEnv('VITE_FRONTEND_ONLY', 'false');
      const { api } = await import('../api/client');
      await call(api);
      vi.unstubAllEnvs();
      return (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    }

    it('does not label a request with no body as JSON (the server refuses an empty JSON body)', async () => {
      const init = await sent((api) => api.post('/goods-receipts/gr-1/post'));
      expect(init.body).toBeUndefined();
      expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    });

    it('sends a body as JSON', async () => {
      const init = await sent((api) => api.post('/purchase-orders', { supplierId: 's-1' }));
      expect(init.body).toBe('{"supplierId":"s-1"}');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });
  });

  describe('isApiError', () => {
    it('returns true for valid ApiError object', () => {
      const err = { code: 'VALIDATION_ERROR', message: 'Invalid input' };
      expect(isApiError(err)).toBe(true);
    });

    it('returns false for plain Error', () => {
      expect(isApiError(new Error('test'))).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isApiError(null)).toBe(false);
      expect(isApiError(undefined)).toBe(false);
    });

    it('returns false for string', () => {
      expect(isApiError('error message')).toBe(false);
    });

    it('returns false for object missing code', () => {
      expect(isApiError({ message: 'test' })).toBe(false);
    });

    it('returns false for object with non-string code', () => {
      expect(isApiError({ code: 123, message: 'test' })).toBe(false);
    });

    it('returns false for object with non-string message', () => {
      expect(isApiError({ code: 'TEST', message: 123 })).toBe(false);
    });
  });

  describe('FRONTEND_ONLY', () => {
    it('is a boolean', () => {
      expect(typeof FRONTEND_ONLY).toBe('boolean');
    });
  });
});