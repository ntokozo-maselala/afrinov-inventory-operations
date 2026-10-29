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

  describe('error response handling', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    async function withFetch(response: Response | (() => Promise<Response>)) {
      vi.stubEnv('VITE_FRONTEND_ONLY', 'false');
      vi.stubGlobal('fetch', vi.fn(typeof response === 'function' ? response : async () => response));
      const mod = await import('../api/client');
      return mod;
    }

    async function rejection(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
      return promise.then(
        () => { throw new Error('expected the request to reject'); },
        (e: unknown) => e as { code: string; message: string },
      );
    }

    it('parses the standard error envelope', async () => {
      const { api } = await withFetch(new Response(
        JSON.stringify({ error: { code: 'CONFLICT', message: 'Duplicate SKU', requestId: 'req-5' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ));
      await expect(api.post('/materials', {})).rejects.toMatchObject({
        code: 'CONFLICT', message: 'Duplicate SKU', requestId: 'req-5', status: 409,
      });
    });

    it('substitutes client copy for a non-domain code, discarding the server message', async () => {
      const { api } = await withFetch(new Response(
        JSON.stringify({
          error: { code: 'SERVICE_UNAVAILABLE', message: 'connect ECONNREFUSED 10.0.0.5:5432' },
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ));
      const err = await rejection(api.get("/stock"));
      expect(err.message).not.toMatch(/ECONNREFUSED/);
      expect(err.message).toBe('Afrinov Inventory is temporarily unavailable. Please try again shortly.');
    });

    it('rejects a domain message that looks like a stack trace', async () => {
      const { api } = await withFetch(new Response(
        JSON.stringify({
          error: { code: 'VALIDATION_ERROR', message: 'at Object.<anonymous> (/srv/app/node_modules/x.js:1:1)' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ));
      const err = await rejection(api.post("/materials", {}));
      expect(err.message).not.toMatch(/node_modules|\.js:1:1/);
    });

    it('keeps a safe domain message (the constraint the server enforced)', async () => {
      const { api } = await withFetch(new Response(
        JSON.stringify({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Only 2 of SKU A-1 are available at D-1.' } }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ));
      await expect(api.post('/inventory-issues', {})).rejects.toMatchObject({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Only 2 of SKU A-1 are available at D-1.',
      });
    });

    it('never exposes a raw server message for an unrecognised code', async () => {
      const { api } = await withFetch(new Response(
        JSON.stringify({ error: { code: 'WAT', message: 'PrismaClientKnownRequestError P2025' } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ));
      const err = await rejection(api.get("/x"));
      expect(err.message).not.toMatch(/Prisma|P2025/);
    });

    it('falls back to a status-derived code when the body is not an envelope', async () => {
      const { api } = await withFetch(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
      await expect(api.get('/stock')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 502 });
    });

    it('treats an empty 503 as an unavailable service, not a crash', async () => {
      const { api } = await withFetch(new Response(null, { status: 503 }));
      await expect(api.get('/stock')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });

    it('maps 401 to an unauthenticated error with the approved message', async () => {
      const { api } = await withFetch(new Response(null, { status: 401 }));
      await expect(api.get('/materials')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('maps 403 to forbidden and 404 to not-found', async () => {
      const a = await withFetch(new Response(null, { status: 403 }));
      await expect(a.api.get('/x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      vi.unstubAllGlobals();
      const b = await withFetch(new Response(null, { status: 404 }));
      await expect(b.api.get('/x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('maps 429 to a rate-limit error', async () => {
      const { api } = await withFetch(new Response(null, { status: 429 }));
      await expect(api.get('/x')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    });

    it('reports a network failure as NETWORK_ERROR, never as a thrown TypeError', async () => {
      const { api } = await withFetch(async () => { throw new TypeError('Failed to fetch'); });
      await expect(api.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('reports an aborted/timed-out request as TIMEOUT', async () => {
      const { api } = await withFetch(async () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      });
      await expect(api.get('/x')).rejects.toMatchObject({ code: 'TIMEOUT' });
    });

    it('emits a session-expired event on a 401', async () => {
      const { api, SESSION_EXPIRED_EVENT } = await withFetch(new Response(null, { status: 401 }));
      const seen = vi.fn();
      window.addEventListener(SESSION_EXPIRED_EVENT, seen);
      await api.get('/materials').catch(() => {});
      window.removeEventListener(SESSION_EXPIRED_EVENT, seen);
      expect(seen).toHaveBeenCalledTimes(1);
    });

    it('attaches a request timeout signal', async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      vi.stubEnv('VITE_FRONTEND_ONLY', 'false');
      vi.stubGlobal('fetch', fetchMock);
      const { api } = await import('../api/client');
      await api.get('/materials');
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });
});