// Real-HTTP + real-database tests for Stores and Projects materials
// (materials sections roadmap, Phase 1): a Projects material belongs to one
// open project and has no Required Stock, and the materials list filters by
// section and by project.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface MaterialRow { id: string; sku: string; section: string; projectNumber: string | null; project: { projectNumber: string } | null; requiredStock: string }

describe('Stores and Projects materials over real HTTP', () => {
  const run = runId();
  const projectNumber = `IT-SEC-${run}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    expect((await api('POST', '/projects', { projectNumber, name: `Sections project ${run}` })).status).toBe(201);
  });

  afterAll(async () => {
    await server?.close();
  });

  const create = (body: Record<string, unknown>) => api<MaterialRow & { error?: { code: string; message: string } }>('POST', '/materials', { unitOfMeasure: 'each', name: `Item ${run}`, ...body });

  it('keeps a Projects material with its project, and lists it by section and project', async () => {
    const res = await create({ sku: `IT-SEC-PIPE-${run}`, category: 'PROJECT_MATERIAL', projectNumber });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ section: 'PROJECTS', projectNumber, project: { projectNumber } });

    const stores = await create({ sku: `IT-SEC-DISC-${run}`, category: 'CONSUMABLES', requiredStock: 10 });
    expect(stores.body).toMatchObject({ section: 'STORES', projectNumber: null });

    const forProject = await api<MaterialRow[]>('GET', `/materials?section=PROJECTS&projectNumber=${projectNumber}`);
    expect(forProject.body.map((m) => m.sku)).toEqual([`IT-SEC-PIPE-${run}`]);
    const storesList = await api<MaterialRow[]>('GET', '/materials?section=STORES');
    expect(storesList.body.map((m) => m.sku)).toContain(`IT-SEC-DISC-${run}`);
    expect(storesList.body.map((m) => m.sku)).not.toContain(`IT-SEC-PIPE-${run}`);
  });

  it('refuses a Projects material without a project, or with Required Stock', async () => {
    const noProject = await create({ sku: `IT-SEC-X1-${run}`, category: 'PROJECT_MATERIAL' });
    expect(noProject.status).toBe(400);
    expect(noProject.body.error?.message).toMatch(/needs the project/);
    const withRequired = await create({ sku: `IT-SEC-X2-${run}`, category: 'PROJECT_MATERIAL', projectNumber, requiredStock: 5 });
    expect(withRequired.status).toBe(400);
    expect(withRequired.body.error?.message).toMatch(/no Required Stock/);
  });

  it('refuses a project on a Stores material, and an unknown section filter', async () => {
    const res = await create({ sku: `IT-SEC-X3-${run}`, category: 'CONSUMABLES', projectNumber });
    expect(res.status).toBe(400);
    expect((await api('GET', '/materials?section=OTHER')).status).toBe(400);
  });
});
