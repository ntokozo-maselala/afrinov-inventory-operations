// The API docs must describe exactly the routes the server registers, and be
// served only where they are switched on.
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { buildServer } from '../server.js';
import { isApiDocsEnabled } from '../shared/config.js';
import { API_PREFIX, buildOpenApiDocument, operationsFor } from './document.js';

vi.mock('../shared/db.js', () => ({
  get prisma() {
    return { $queryRaw: vi.fn() };
  },
}));

/** `METHOD /path` for every /api/v1 route the server registers. */
async function registeredApiRoutes(procurementEnabled: boolean): Promise<string[]> {
  const routes: string[] = [];
  const onRoute = (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || !route.url.startsWith(`${API_PREFIX}/`)) continue;
      routes.push(`${method} ${route.url.slice(API_PREFIX.length)}`);
    }
  };
  const app = await buildServer({ skipConfigValidation: true, procurementEnabled, apiDocsEnabled: false, onRoute });
  await app.close();
  return routes.sort();
}

function documentedRoutes(procurementEnabled: boolean): string[] {
  return operationsFor({ procurementEnabled })
    .map((op) => `${op.method.toUpperCase()} ${op.path}`)
    .sort();
}

describe('OpenAPI document', () => {
  it.each([true, false])('documents exactly the registered routes (procurement %s)', async (procurementEnabled) => {
    expect(documentedRoutes(procurementEnabled)).toEqual(await registeredApiRoutes(procurementEnabled));
  });

  it('generates a valid document with request bodies from the route schemas', () => {
    const doc = buildOpenApiDocument({ procurementEnabled: true });
    expect(doc.openapi).toBe('3.0.3');

    const issue = doc.paths['/inventory-issues']?.post;
    const schema = issue?.requestBody && 'content' in issue.requestBody
      ? issue.requestBody.content['application/json']?.schema
      : undefined;
    expect(schema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['materialId', 'locationId', 'quantity']),
    });
    expect(Object.keys(issue?.responses ?? {})).toEqual(expect.arrayContaining(['201', '401', '403', '422']));
  });

  it('leaves login public and protects everything else', () => {
    const doc = buildOpenApiDocument({ procurementEnabled: false });
    expect(doc.paths['/auth/login']?.post?.security).toEqual([]);
    expect(doc.paths['/materials']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/purchase-orders']).toBeUndefined();
  });
});

describe('serving the docs', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('serves the UI and the document when enabled', async () => {
    app = await buildServer({ skipConfigValidation: true, apiDocsEnabled: true });

    const json = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(json.statusCode).toBe(200);
    expect(json.json().info.title).toBe('Afrinov Inventory & Operations API');

    const ui = await app.inject({ method: 'GET', url: '/api/docs/' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    // The UI gets a CSP that lets its own scripts run, without forcing HTTPS.
    const csp = String(ui.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('keeps the strict CSP on API responses', async () => {
    app = await buildServer({ skipConfigValidation: true, apiDocsEnabled: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
  });

  it('serves nothing when disabled', async () => {
    app = await buildServer({ skipConfigValidation: true, apiDocsEnabled: false });
    expect((await app.inject({ method: 'GET', url: '/api/docs/json' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/docs/' })).statusCode).toBe(404);
  });
});

describe('isApiDocsEnabled', () => {
  it('is on outside production unless switched off', () => {
    expect(isApiDocsEnabled('development', {})).toBe(true);
    expect(isApiDocsEnabled('test', {})).toBe(true);
    expect(isApiDocsEnabled('development', { API_DOCS_ENABLED: 'false' })).toBe(false);
  });

  it('is off in production unless switched on', () => {
    expect(isApiDocsEnabled('production', {})).toBe(false);
    expect(isApiDocsEnabled('production', { API_DOCS_ENABLED: 'true' })).toBe(true);
    expect(isApiDocsEnabled('production', { API_DOCS_ENABLED: 'TRUE' })).toBe(true);
  });
});
