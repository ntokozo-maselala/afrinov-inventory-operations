// Real-HTTP + real-database tests for the catalogue counts (ADR-031): Stock
// counts lines, Tools its active tools and Materials every item, so an item in
// two places, a received tool, an item never received, an inactive item with
// stock and stock held for a project must each land on Materials exactly once,
// and the summary must say how the pages relate.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, retireAsBefore, runId, startServer, type TestServer } from './helpers.js';
import { recomputeBalancesFor } from '../src/modules/inventory/balances.js';
import type { CatalogueSummary } from '../src/modules/inventory/catalogue.service.js';

interface StatusRow { materialId: string; sku: string; onHand: string; heldForProjects: string; stockState: string; active: boolean; locations: unknown[] }

const STOCK_PATH = '/reports/stock-status?section=ALL&includeInactive=true';

describe('catalogue counts over real HTTP', () => {
  const run = runId();
  const projectNumber = `IT-CAT-${run}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let before: CatalogueSummary;
  const ids: Record<'twoPlaces' | 'tool' | 'never' | 'inactive' | 'held' | 'project', string> = { twoPlaces: '', tool: '', never: '', inactive: '', held: '', project: '' };

  const add = async (name: string, category: string) => {
    const res = await api<{ id: string }>('POST', '/materials', { sku: `IT-CAT-${name}-${run}`, name: `Catalogue ${name} ${run}`, category, unitOfMeasure: 'each' });
    expect(res.status).toBe(200);
    return res.body.id;
  };
  const stock = async (materialId: string, locationId: string, quantity: number) => {
    const res = await api('POST', '/inventory-adjustments', { materialId, locationId, quantity, reasonCode: 'OTHER', reasonNote: 'Stock for the test' });
    expect(res.status).toBe(201);
  };

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    before = (await api<CatalogueSummary>('GET', '/materials/summary')).body;

    const rackA = (await api<{ id: string }>('POST', '/locations', { name: `IT catalogue A ${run}`, type: 'RACK' })).body.id;
    const rackB = (await api<{ id: string }>('POST', '/locations', { name: `IT catalogue B ${run}`, type: 'RACK' })).body.id;
    expect((await api('POST', '/projects', { projectNumber, name: `Catalogue project ${run}` })).status).toBe(201);

    ids.twoPlaces = await add('TWO', 'CONSUMABLES');
    ids.tool = await add('TOOL', 'TOOLS');
    ids.never = await add('NEVER', 'FASTENERS_SLUGS_INSULATION');
    ids.inactive = await add('OLD', 'CONSUMABLES');
    ids.held = await add('HELD', 'CONSUMABLES');
    ids.project = await add('PROJ', 'PROJECT_MATERIAL');

    await stock(ids.twoPlaces, rackA, 5);
    await stock(ids.twoPlaces, rackB, 3);
    await stock(ids.tool, rackA, 2);
    await stock(ids.inactive, rackA, 4);
    await retireAsBefore(ids.inactive);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    await prisma.inventoryTransaction.create({ data: { materialId: ids.held, locationId: rackA, type: 'RECEIPT', quantity: 6, heldForProject: projectNumber, actorId: admin.id } });
    await recomputeBalancesFor({ materialId: ids.held, locationId: rackA, heldForProject: projectNumber });
  });

  afterAll(async () => {
    await server?.close();
  });

  it('counts each case once, and the lines and items apart', async () => {
    const after = (await api<CatalogueSummary>('GET', '/materials/summary')).body;
    expect(after.items - before.items).toBe(6);
    expect(after.tabs.STORES - before.tabs.STORES).toBe(4);
    expect(after.tabs.TOOLS - before.tabs.TOOLS).toBe(1);
    expect(after.tabs.PROJECTS - before.tabs.PROJECTS).toBe(1);
    expect(after.inactive - before.inactive).toBe(1);
    // The item in two places is two lines; held stock is not on Stock.
    expect(after.stock.lines - before.stock.lines).toBe(4);
    expect(after.stock.items - before.stock.items).toBe(3);
    expect(after.stock.tools - before.stock.tools).toBe(1);
    expect(after.notOnStock.items - before.notOnStock.items).toBe(2);
    expect(after.states.IN_STOCK - before.states.IN_STOCK).toBe(3);
    expect(after.states.HELD_FOR_PROJECT - before.states.HELD_FOR_PROJECT).toBe(1);
    expect(after.states.NEVER_RECEIVED - before.states.NEVER_RECEIVED).toBe(1);
    expect(after.toolsListed - before.toolsListed).toBe(1);
  });

  it('adds up against what the pages actually read', async () => {
    const summary = (await api<CatalogueSummary>('GET', '/materials/summary')).body;
    const materials = (await api<Array<{ id: string; category: string }>>('GET', '/materials')).body;
    const stockRows = (await api<Array<{ materialId: string; category: string; heldForProject: string | null }>>('GET', '/reports/current-stock')).body;
    const tools = (await api<Array<{ materialId: string }>>('GET', '/tools')).body;

    const catalogue = new Set(materials.map((m) => m.id));
    expect(catalogue.size).toBe(materials.length);
    expect(summary.items).toBe(materials.length);
    expect(summary.tabs.STORES + summary.tabs.TOOLS + summary.tabs.PROJECTS).toBe(summary.items);

    const onStock = stockRows.filter((r) => r.category !== 'PROJECT_MATERIAL' && !r.heldForProject);
    expect(onStock).toHaveLength(summary.stock.lines);
    expect(new Set(onStock.map((r) => r.materialId)).size).toBe(summary.stock.items);
    expect(summary.stock.items + summary.notOnStock.items).toBe(summary.tabs.STORES + summary.tabs.TOOLS);
    expect(tools).toHaveLength(summary.toolsListed);

    // Whatever Stock and Tools list is on Materials.
    expect(onStock.every((r) => catalogue.has(r.materialId))).toBe(true);
    expect(tools.every((t) => catalogue.has(t.materialId))).toBe(true);
  });

  it('gives every item its stock state, inactive and Projects items included', async () => {
    const rows = (await api<StatusRow[]>('GET', STOCK_PATH)).body;
    const row = (id: string) => rows.filter((r) => r.materialId === id);
    expect(row(ids.twoPlaces)).toHaveLength(1);
    expect(row(ids.twoPlaces)[0]).toMatchObject({ onHand: '8', stockState: 'IN_STOCK' });
    expect(row(ids.twoPlaces)[0]!.locations).toHaveLength(2);
    expect(row(ids.tool)[0]).toMatchObject({ onHand: '2', stockState: 'IN_STOCK' });
    expect(row(ids.never)[0]).toMatchObject({ onHand: '0', stockState: 'NEVER_RECEIVED' });
    expect(row(ids.inactive)[0]).toMatchObject({ onHand: '4', stockState: 'IN_STOCK', active: false });
    expect(row(ids.held)[0]).toMatchObject({ onHand: '0', heldForProjects: '6', stockState: 'HELD_FOR_PROJECT' });
    expect(row(ids.project)[0]).toMatchObject({ stockState: 'NEVER_RECEIVED' });
  });

  it('keeps the default stock status to active Stores items, for Stock status and reorder', async () => {
    const skus = (await api<StatusRow[]>('GET', '/reports/stock-status')).body.map((r) => r.materialId);
    expect(skus).toContain(ids.twoPlaces);
    expect(skus).not.toContain(ids.inactive);
    expect(skus).not.toContain(ids.project);
  });

  it('refuses an unknown section, and a summary to anyone not signed in', async () => {
    expect((await api('GET', '/reports/stock-status?section=NOPE')).status).toBe(400);
    expect((await client(server.port)('GET', '/materials/summary')).status).toBe(401);
  });
});
