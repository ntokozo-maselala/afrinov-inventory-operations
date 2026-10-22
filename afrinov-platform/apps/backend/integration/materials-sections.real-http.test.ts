// Real-HTTP + real-database tests for Stores and Projects materials
// (materials sections roadmap, Phase 1): a Projects material belongs to one
// open project and has no Required Stock, and the materials list filters by
// section and by project.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

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

  it('leaves Projects material out of stock status, and lists it under its project in the stock value (Phase 4)', async () => {
    const status = await api<Array<{ sku: string }>>('GET', '/reports/stock-status');
    expect(status.body.map((r) => r.sku)).not.toContain(`IT-SEC-PIPE-${run}`);
    const value = await api<{ projects: Array<{ projectNumber: string | null; items: number }>; sections: { PROJECTS: { items: number } } }>('GET', '/reports/stock-value');
    expect(value.body.projects.find((p) => p.projectNumber === projectNumber)).toMatchObject({ items: 1 });
    expect(value.body.sections.PROJECTS.items).toBeGreaterThanOrEqual(1);
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

  it('keeps project material with no project from being issued until it is given one (Phase 3)', async () => {
    // As the workbook import and the migration leave it: Project Material with no project.
    const old = await prisma.material.create({ data: { sku: `IT-SEC-OLD-${run}`, name: 'Old plate', category: 'PROJECT_MATERIAL', unitOfMeasure: 'each' } });
    const loc = await api<{ id: string }>('POST', '/locations', { name: `IT sections rack ${run}`, type: 'RACK' });
    expect((await api('POST', '/inventory-adjustments', { materialId: old.id, locationId: loc.body.id, quantity: 5, reasonCode: 'OTHER' })).status).toBe(201);
    const rcp = await api<{ id: string }>('POST', '/recipients', { name: `IT sections fitter ${run}`, type: 'WORKER' });
    const issue = () => api<{ error?: { message: string } }>('POST', '/inventory-issues', { recipientId: rcp.body.id, projectNumber, lines: [{ materialId: old.id, locationId: loc.body.id, quantity: 1 }] });

    const refused = await issue();
    expect(refused.status).toBe(400);
    expect(refused.body.error?.message).toMatch(/has no project yet, so it can't be issued/);

    const assigned = await api<MaterialRow>('PATCH', `/materials/${old.id}`, { projectNumber });
    expect(assigned.body).toMatchObject({ projectNumber, section: 'PROJECTS' });
    expect((await issue()).status).toBe(201);
  });

  it('issues project material only to its own project, and nothing to a completed project (Phase 5)', async () => {
    const other = `IT-SEC2-${run}`;
    expect((await api('POST', '/projects', { projectNumber: other, name: `Other project ${run}` })).status).toBe(201);
    const pipe = await create({ sku: `IT-SEC-OWN-${run}`, category: 'PROJECT_MATERIAL', projectNumber });
    const disc = await create({ sku: `IT-SEC-DISC2-${run}`, category: 'CONSUMABLES' });
    const loc = await api<{ id: string }>('POST', '/locations', { name: `IT sections shelf ${run}`, type: 'RACK' });
    for (const m of [pipe.body, disc.body]) {
      expect((await api('POST', '/inventory-adjustments', { materialId: m.id, locationId: loc.body.id, quantity: 5, reasonCode: 'OTHER' })).status).toBe(201);
    }
    const rcp = await api<{ id: string }>('POST', '/recipients', { name: `IT sections rigger ${run}`, type: 'WORKER' });
    const issue = (materialId: string, to?: string) => api<{ error?: { message: string } }>('POST', '/inventory-issues', {
      recipientId: rcp.body.id, projectNumber: to, lines: [{ materialId, locationId: loc.body.id, quantity: 1 }],
    });

    const wrong = await issue(pipe.body.id, other);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error?.message).toMatch(/is material for project .*, so it can't be issued to project/);
    expect((await issue(pipe.body.id)).status).toBe(400);
    expect((await issue(pipe.body.id, projectNumber)).status).toBe(201);

    expect((await api('PATCH', `/projects/${other}`, { status: 'COMPLETED' })).status).toBe(200);
    const closed = await issue(disc.body.id, other);
    expect(closed.status).toBe(400);
    expect(closed.body.error?.message).toMatch(/is completed, so no more stock is issued to it/);
  });
});
