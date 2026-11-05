// Real-HTTP + real-database tests for units of measure and the direction of an
// adjustment: every item is on a listed unit, a counted one moves in whole
// numbers on every route that takes a quantity, and the reason decides whether
// an adjustment removes or adds stock.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Unit { code: string; label: string; kind: 'COUNTED' | 'MEASURED'; needsReview: boolean; active: boolean }
type Failure = { error?: { code: string; message: string } };

describe('units of measure over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let washerId: string;
  let cableId: string;
  let rackId: string;
  let otherRackId: string;
  let workerId: string;

  const adjust = (body: Record<string, unknown>) =>
    api<Failure>('POST', '/inventory-adjustments', { materialId: washerId, locationId: rackId, ...body });
  const onHand = async (materialId: string, locationId = rackId) => (await ledgerAndBalance(materialId, locationId)).balance;

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const washer = await api<{ id: string; unitOfMeasure: string }>('POST', '/materials', { sku: `IT-UOM-WSH-${run}`, name: `M16 flat washer ${run}`, category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'EA' });
    expect(washer.status).toBe(200);
    expect(washer.body.unitOfMeasure).toBe('each');
    washerId = washer.body.id;
    const cable = await api<{ id: string }>('POST', '/materials', { sku: `IT-UOM-CBL-${run}`, name: `Welding cable ${run}`, category: 'TOOLING_PPE_ELECTRICAL', unitOfMeasure: 'Metres' });
    expect(cable.status).toBe(200);
    cableId = cable.body.id;
    rackId = (await api<{ id: string }>('POST', '/locations', { name: `IT units rack ${run}`, type: 'RACK' })).body.id;
    otherRackId = (await api<{ id: string }>('POST', '/locations', { name: `IT units rack 2 ${run}`, type: 'RACK' })).body.id;
    workerId = (await api<{ id: string }>('POST', '/recipients', { name: `IT units fitter ${run}`, type: 'WORKER' })).body.id;
    expect((await adjust({ quantity: 750, reasonCode: 'FOUND', reasonNote: 'Opening stock' })).status).toBe(201);
    expect((await api('POST', '/inventory-adjustments', { materialId: cableId, locationId: rackId, quantity: 50, reasonCode: 'FOUND', reasonNote: 'Opening stock' })).status).toBe(201);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('lists the units, counted and measured, in order', async () => {
    const res = await api<Unit[]>('GET', '/units-of-measure');
    expect(res.status).toBe(200);
    expect(res.body.find((u) => u.code === 'each')).toMatchObject({ label: 'Each', kind: 'COUNTED', needsReview: false, active: true });
    expect(res.body.find((u) => u.code === 'm')).toMatchObject({ label: 'Metre', kind: 'MEASURED' });
    expect(res.body.findIndex((u) => u.code === 'each')).toBeLessThan(res.body.findIndex((u) => u.code === 'm'));
  });

  it('refuses an item on a unit that is not on the list', async () => {
    const res = await api<Failure>('POST', '/materials', { sku: `IT-UOM-BAD-${run}`, name: 'Bundle of rods', category: 'CONSUMABLES', unitOfMeasure: 'bundle' });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toBe('"bundle" is not a unit on the list. Choose one, such as each, pair, box, m or kg.');
  });

  it('refuses part of a counted item on every movement, and moves nothing', async () => {
    const whole = `M16 flat washer ${run} is counted in whole numbers (each). Enter 1, 2, 3 …`;
    const issue = await api<Failure>('POST', '/inventory-issues', { recipientId: workerId, lines: [{ materialId: washerId, locationId: rackId, quantity: 0.0001 }] });
    expect([issue.status, issue.body.error?.message]).toEqual([400, whole]);
    const transfer = await api<Failure>('POST', '/inventory-transfers', { materialId: washerId, fromLocationId: rackId, toLocationId: otherRackId, quantity: 2.5 });
    expect([transfer.status, transfer.body.error?.message]).toEqual([400, whole]);
    const adjusted = await adjust({ quantity: -0.5, reasonCode: 'DAMAGE', recipientId: null });
    expect([adjusted.status, adjusted.body.error?.message]).toEqual([400, whole]);
    const counted = await api<Failure>('POST', '/stock-counts', { locationId: rackId, lines: [{ materialId: washerId, expectedQuantity: 750, countedQuantity: 749.5 }] });
    expect([counted.status, counted.body.error?.message]).toEqual([400, whole]);
    expect(await onHand(washerId)).toBe('750');
  });

  it('still moves a measured item in fractions', async () => {
    const res = await api('POST', '/inventory-transfers', { materialId: cableId, fromLocationId: rackId, toLocationId: otherRackId, quantity: 2.5 });
    expect(res.status).toBe(201);
    expect(await onHand(cableId)).toBe('47.5');
  });

  it('lets the reason decide the direction of an adjustment', async () => {
    const gain = await adjust({ quantity: 80, reasonCode: 'DAMAGE', recipientId: null });
    expect([gain.status, gain.body.error?.message]).toEqual([400, 'Damage, loss and scrap remove stock. To add stock, choose Found or Other.']);
    const loss = await adjust({ quantity: -5, reasonCode: 'FOUND', reasonNote: 'Behind rack B' });
    expect([loss.status, loss.body.error?.message]).toEqual([400, 'Found adds stock. To remove stock, choose Damage, Loss, Scrap or Other.']);
    const silent = await adjust({ quantity: 5, reasonCode: 'FOUND' });
    expect([silent.status, silent.body.error?.message]).toEqual([400, 'Say where the stock was found.']);
    expect(await onHand(washerId)).toBe('750');

    expect((await adjust({ quantity: -80, reasonCode: 'DAMAGE', recipientId: null })).status).toBe(201);
    expect((await adjust({ quantity: 5, reasonCode: 'FOUND', reasonNote: 'Behind rack B' })).status).toBe(201);
    expect(await onHand(washerId)).toBe('675');
  });
});
