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
    server = await startServer({ procurementEnabled: true });
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

  // Project on the Order Roadmap, Phase 1: no one gives items a project any
  // more, so leftovers with none are moved to Stores, then issued as Stores stock.
  it('keeps project material with no project from being issued, and moves it to Stores', async () => {
    // As the workbook import and the migration leave it: Project Material with no project.
    const old = await prisma.material.create({ data: { sku: `IT-SEC-OLD-${run}`, name: 'Old plate', category: 'PROJECT_MATERIAL', unitOfMeasure: 'each' } });
    const loc = await api<{ id: string }>('POST', '/locations', { name: `IT sections rack ${run}`, type: 'RACK' });
    expect((await api('POST', '/inventory-adjustments', { materialId: old.id, locationId: loc.body.id, quantity: 5, reasonCode: 'OTHER' })).status).toBe(201);
    const rcp = await api<{ id: string }>('POST', '/recipients', { name: `IT sections fitter ${run}`, type: 'WORKER' });
    const issue = () => api<{ error?: { message: string } }>('POST', '/inventory-issues', { recipientId: rcp.body.id, projectNumber, lines: [{ materialId: old.id, locationId: loc.body.id, quantity: 1 }] });

    const refused = await issue();
    expect(refused.status).toBe(400);
    expect(refused.body.error?.message).toMatch(/has no project, so it isn't issued. Move it to Stores from Project leftovers/);

    const listed = await api<{ project: null; items: Array<{ materialId: string; onHand: string }> }>('GET', '/materials/no-project/leftovers');
    expect(listed.status).toBe(200);
    expect(listed.body.project).toBeNull();
    expect(listed.body.items.find((i) => i.materialId === old.id)).toMatchObject({ onHand: '5' });

    // Only an item that really has no project moves from here.
    const tagged = await create({ sku: `IT-SEC-TAG-${run}`, category: 'PROJECT_MATERIAL', projectNumber });
    const wrong = await api<{ error: { message: string } }>('POST', '/materials/no-project/leftovers/move', { items: [{ materialId: tagged.body.id, category: 'CONSUMABLES' }] });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toMatch(/is not a Projects item with no project/);

    // Not while it is on an open project order: as a Stores item it would be
    // confirmed delivered to site as Stores stock (Qodo, PR #129).
    const supplier = await api<{ id: string }>('POST', '/suppliers', { name: `IT sections move supplier ${run}` });
    const draft = await api<{ id: string; number: string }>('POST', '/purchase-orders', { supplierId: supplier.body.id, projectNumber, lines: [{ materialId: old.id, orderedQty: 1 }] });
    expect([200, 201]).toContain(draft.status);
    const onOrder = await api<{ error: { message: string } }>('POST', '/materials/no-project/leftovers/move', { items: [{ materialId: old.id, category: 'CONSUMABLES' }] });
    expect(onOrder.status).toBe(400);
    expect(onOrder.body.error.message).toMatch(new RegExp(`is on ${draft.body.number}, which is still open, so it stays project material`));
    expect((await api('POST', `/purchase-orders/${draft.body.id}/cancel`, { reason: 'Moving the stock to Stores' })).status).toBe(200);
    // Nor while it is on an open request for quotation, whose award would be a project order.
    const rfq = await api<{ id: string; number: string }>('POST', '/rfqs', { projectNumber, lines: [{ materialId: old.id, quantity: 1 }] });
    expect(rfq.status).toBe(201);
    const onRfq = await api<{ error: { message: string } }>('POST', '/materials/no-project/leftovers/move', { items: [{ materialId: old.id, category: 'CONSUMABLES' }] });
    expect(onRfq.status).toBe(400);
    expect(onRfq.body.error.message).toMatch(new RegExp(`is on ${rfq.body.number}, which is still open`));
    expect((await api('POST', `/rfqs/${rfq.body.id}/cancel`, { reason: 'Moving the stock to Stores' })).status).toBe(200);

    const moved = await api<{ moved: number }>('POST', '/materials/no-project/leftovers/move', { items: [{ materialId: old.id, category: 'CONSUMABLES' }] });
    expect(moved.status).toBe(200);
    expect(moved.body.moved).toBe(1);
    const after = await prisma.material.findUniqueOrThrow({ where: { id: old.id } });
    expect(after).toMatchObject({ category: 'CONSUMABLES', projectNumber: null });
    expect((await api<{ items: Array<{ materialId: string }> }>('GET', '/materials/no-project/leftovers')).body.items.map((i) => i.materialId)).not.toContain(old.id);
    // Now Stores stock, it is issued to any project.
    expect((await issue()).status).toBe(201);
  });

  // Qodo, PR #129: raising a project order for an item and moving it to Stores
  // at the same moment never leaves it both on an open order and in Stores.
  it('never leaves an item on an open project order once it is moved to Stores, however the two overlap', async () => {
    const supplier = await api<{ id: string }>('POST', '/suppliers', { name: `IT sections race supplier ${run}` });
    const items = await Promise.all(Array.from({ length: 8 }, (_, i) => prisma.material.create({
      data: { sku: `IT-SEC-RACE-${run}-${i}`, name: `Race plate ${i}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'each' },
    })));
    await Promise.all(items.flatMap((m) => [
      api('POST', '/purchase-orders', { supplierId: supplier.body.id, projectNumber, lines: [{ materialId: m.id, orderedQty: 1 }] }),
      api('POST', '/materials/no-project/leftovers/move', { items: [{ materialId: m.id, category: 'CONSUMABLES' }] }),
    ]));
    for (const m of items) {
      const now = await prisma.material.findUniqueOrThrow({ where: { id: m.id } });
      const onOrder = await prisma.purchaseOrderLine.count({ where: { materialId: m.id, purchaseOrder: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } } } });
      // One or the other won: on the order and still project material, or moved and on no order.
      expect(onOrder > 0 ? now.category : 'moved').toBe(onOrder > 0 ? 'PROJECT_MATERIAL' : 'moved');
      expect(onOrder + (now.category === 'CONSUMABLES' ? 1 : 0)).toBe(1);
    }
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

  // Project on the Order Roadmap, Phase 1: the order's project applies, whatever the item is tagged with.
  it('orders project material for any project on a project order, never on a Stores order, and nothing for a completed project', async () => {
    const other = `IT-SEC3-${run}`;
    expect((await api('POST', '/projects', { projectNumber: other, name: `Third project ${run}` })).status).toBe(201);
    const pipe = await create({ sku: `IT-SEC-ORD-${run}`, category: 'PROJECT_MATERIAL', projectNumber });
    const disc = await create({ sku: `IT-SEC-DISC3-${run}`, category: 'CONSUMABLES' });
    const supplier = await api<{ id: string }>('POST', '/suppliers', { name: `IT sections supplier ${run}` });
    const order = (materialId: string, to?: string) => api<{ id: string; error?: { message: string } }>('POST', '/purchase-orders', {
      supplierId: supplier.body.id, projectNumber: to, lines: [{ materialId, orderedQty: 2 }],
    });

    expect([200, 201]).toContain((await order(pipe.body.id, other)).status);
    expect([200, 201]).toContain((await order(pipe.body.id, projectNumber)).status);
    // An item with no project goes on a project order too.
    const plain = await prisma.material.create({ data: { sku: `IT-SEC-PLAIN-${run}`, name: 'Plain plate', category: 'PROJECT_MATERIAL', unitOfMeasure: 'each' } });
    expect([200, 201]).toContain((await order(plain.id, other)).status);
    // An order with no project is a Stores order: Stores items only.
    const stores = await order(pipe.body.id);
    expect(stores.status).toBe(400);
    expect(stores.body.error?.message).toMatch(/is project material, so it isn't bought on a Stores order/);

    // A project order holds project material only (Stores ordering roadmap).
    const onProject = await order(disc.body.id, other);
    expect(onProject.status).toBe(400);
    expect(onProject.body.error?.message).toMatch(/is a Stores item, so it isn't bought for project/);
    const beam = await create({ sku: `IT-SEC-BEAM3-${run}`, category: 'PROJECT_MATERIAL', projectNumber: other });
    const draft = await order(beam.body.id, other);
    expect([200, 201]).toContain(draft.status);
    expect((await api('PATCH', `/projects/${other}`, { status: 'COMPLETED' })).status).toBe(200);
    const closed = await order(beam.body.id, other);
    expect(closed.status).toBe(400);
    expect(closed.body.error?.message).toMatch(/is completed, so nothing more is ordered for it/);
    const submit = await api<{ error?: { message: string } }>('POST', `/purchase-orders/${draft.body.id}/submit`);
    expect(submit.status).toBe(400);
  });

  it('moves the leftovers of a completed project to Stores, to be issued to another job (Phase 7)', async () => {
    const job = `IT-SEC4-${run}`;
    const next = `IT-SEC5-${run}`;
    for (const p of [job, next]) expect((await api('POST', '/projects', { projectNumber: p, name: `Job ${p}` })).status).toBe(201);
    const pipe = await create({ sku: `IT-SEC-LEFT-${run}`, category: 'PROJECT_MATERIAL', projectNumber: job, unitCost: 25 });
    const loc = await api<{ id: string }>('POST', '/locations', { name: `IT sections bay ${run}`, type: 'RACK' });
    expect((await api('POST', '/inventory-adjustments', { materialId: pipe.body.id, locationId: loc.body.id, quantity: 10, reasonCode: 'OTHER' })).status).toBe(201);
    const rcp = await api<{ id: string }>('POST', '/recipients', { name: `IT sections welder ${run}`, type: 'WORKER' });
    const issue = (to: string) => api('POST', '/inventory-issues', { recipientId: rcp.body.id, projectNumber: to, lines: [{ materialId: pipe.body.id, locationId: loc.body.id, quantity: 3 }] });
    expect((await issue(job)).status).toBe(201);

    const move = () => api<{ moved: number; error?: { message: string } }>('POST', `/projects/${job}/leftovers/move`, { items: [{ materialId: pipe.body.id, category: 'CONSUMABLES' }] });
    const open = await move();
    expect(open.status).toBe(400);
    expect(open.body.error?.message).toMatch(/is still open/);

    expect((await api('PATCH', `/projects/${job}`, { status: 'COMPLETED' })).status).toBe(200);
    const listed = await api<{ project: { closed: boolean }; items: Array<{ sku: string; onHand: string; value: number | null }> }>('GET', `/projects/${job}/leftovers`);
    expect(listed.body.project.closed).toBe(true);
    expect(listed.body.items).toEqual([expect.objectContaining({ sku: `IT-SEC-LEFT-${run}`, onHand: '7', value: 175 })]);

    expect((await move()).body).toEqual({ moved: 1 });
    const after = await api<MaterialRow & { category: string }>('GET', `/materials/${pipe.body.id}`);
    expect(after.body).toMatchObject({ section: 'STORES', category: 'CONSUMABLES', projectNumber: null });
    expect((await api<{ items: unknown[] }>('GET', `/projects/${job}/leftovers`)).body.items).toEqual([]);

    // Now Stores material: issued to the next job, from the same stock.
    expect((await issue(next)).status).toBe(201);
  });
});
