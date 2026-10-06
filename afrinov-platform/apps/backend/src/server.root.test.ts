// Smoke tests for the operational identification endpoint and a regression
// guard for the existing liveness/readiness endpoints.
//
// The DB is mocked so /health/ready is deterministic and requires no live
// PostgreSQL. Mirrors the buildServer({ skipConfigValidation: true }) + inject
// pattern used by src/server.test.ts and the route-level test suites.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildServer } from './server.js';
import type { FastifyInstance } from 'fastify';

const queryRaw = vi.fn();

vi.mock('./shared/db.js', () => ({
  get prisma() {
    return { $queryRaw: queryRaw };
  },
}));

describe('operational endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ skipConfigValidation: true });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /', () => {
    it('returns 200 with a JSON service identification payload', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');

      const body = res.json<{
        status: string;
        service: string;
        message: string;
        environment: string;
        version: string;
      }>();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('@afrinov/backend');
      expect(body.version).toBe('0.1.0');
      expect(body.environment).toBe('test');
      expect(body.message).toBe('Afrinov backend is running');
    });

    it('does not perform database queries', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('GET /health (regression)', () => {
    it('returns 200 with status ok', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.json<{ status: string }>().status).toBe('ok');
    });
  });

  describe('GET /health/ready (regression)', () => {
    it('returns 200 ready when the database responds', async () => {
      queryRaw.mockResolvedValueOnce(1);
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string; database: string }>().status).toBe('ready');
      expect(res.json<{ database: string }>().database).toBe('connected');
    });

    it('returns 503 not_ready when the database check fails', async () => {
      queryRaw.mockRejectedValueOnce(new Error('connection refused'));
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json<{ status: string }>().status).toBe('not_ready');
    });
  });
});
