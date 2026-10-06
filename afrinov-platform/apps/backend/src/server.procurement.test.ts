// The procurement module (purchase orders, goods receipts) is behind the
// PROCUREMENT_ENABLED switch. When off, its routes must not exist at all,
// while supplier routes stay available because inventory depends on them.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildServer } from './server.js';
import { isProcurementEnabled } from './shared/config.js';
import type { FastifyInstance } from 'fastify';

vi.mock('./shared/db.js', () => ({
  get prisma() {
    return { $queryRaw: vi.fn() };
  },
}));

const PROCUREMENT_URLS = [
  ['GET', '/api/v1/purchase-orders'],
  ['POST', '/api/v1/purchase-orders'],
  ['GET', '/api/v1/goods-receipts'],
  ['POST', '/api/v1/goods-receipts'],
] as const;

describe('procurement switch', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('does not register procurement routes when disabled', async () => {
    app = await buildServer({ skipConfigValidation: true, procurementEnabled: false });
    for (const [method, url] of PROCUREMENT_URLS) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('registers procurement routes when enabled', async () => {
    app = await buildServer({ skipConfigValidation: true, procurementEnabled: true });
    for (const [method, url] of PROCUREMENT_URLS) {
      // Unauthenticated, so the route exists but rejects the caller.
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('keeps supplier routes registered when procurement is disabled', async () => {
    app = await buildServer({ skipConfigValidation: true, procurementEnabled: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/suppliers' });
    expect(res.statusCode).toBe(401);
  });
});

describe('isProcurementEnabled', () => {
  it('is off unless PROCUREMENT_ENABLED is "true"', () => {
    expect(isProcurementEnabled({})).toBe(false);
    expect(isProcurementEnabled({ PROCUREMENT_ENABLED: 'false' })).toBe(false);
    expect(isProcurementEnabled({ PROCUREMENT_ENABLED: '1' })).toBe(false);
    expect(isProcurementEnabled({ PROCUREMENT_ENABLED: 'true' })).toBe(true);
    expect(isProcurementEnabled({ PROCUREMENT_ENABLED: 'TRUE' })).toBe(true);
  });
});
