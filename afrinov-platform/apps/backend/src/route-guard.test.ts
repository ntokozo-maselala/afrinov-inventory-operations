// Every API route must authenticate its caller, apart from a short, reviewed
// list of public ones (PRA-19, checklist SEC-3). A new route registered without
// `app.authenticate` fails here instead of shipping as an open endpoint.
//
// Authentication runs as a `preHandler` (most routes) or an `onRequest` hook
// (the quotation upload, which must refuse before reading a 10 MB body).
import { describe, it, expect, vi } from 'vitest';
import type { RouteOptions } from 'fastify';
import { buildServer } from './server.js';

vi.mock('./shared/db.js', () => ({
  get prisma() {
    return { $queryRaw: vi.fn() };
  },
}));

/** The only routes anyone may call without a token. */
const PUBLIC_ROUTES = new Set([
  'GET /api/v1/health',
  'GET /api/v1/health/ready',
  'POST /api/v1/auth/login',
]);

function hooks(value: RouteOptions['preHandler'] | RouteOptions['onRequest']): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

describe('route guard', () => {
  it.each([true, false])('authenticates every /api/v1 route except the public ones (procurement %s)', async (procurementEnabled) => {
    const routes: RouteOptions[] = [];
    const app = await buildServer({
      skipConfigValidation: true,
      procurementEnabled,
      apiDocsEnabled: false,
      onRoute: (route) => { routes.push(route); },
    });
    const authenticate = app.authenticate;

    const unguarded: string[] = [];
    const seenPublic: string[] = [];
    for (const route of routes) {
      if (!route.url.startsWith('/api/v1/')) continue;
      const methods = (Array.isArray(route.method) ? route.method : [route.method]).filter((m) => m !== 'HEAD');
      const guarded = [...hooks(route.preHandler), ...hooks(route.onRequest)].includes(authenticate);
      for (const method of methods) {
        const key = `${method} ${route.url}`;
        if (PUBLIC_ROUTES.has(key)) seenPublic.push(key);
        else if (!guarded) unguarded.push(key);
      }
    }
    await app.close();

    expect(unguarded).toEqual([]);
    // The allow-list stays honest: every entry is still a real route.
    expect(seenPublic.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });
});
