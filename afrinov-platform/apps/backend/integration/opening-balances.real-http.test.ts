// Real-database tests for the workbook import's final step: projects,
// recipients and suppliers, items, locations and dated opening-balance
// receipts, all or nothing, and never twice.
//
// Opening balances can be imported once per database, so the happy path needs
// the fresh database the integration recipe creates; on a database that has
// already had an import, those tests are skipped.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';
import { OpeningBalanceService, OPENING_BALANCE_REFERENCE, previousImport } from '../src/modules/migration/opening-balance.service.js';
import type { MappedImport, PlannedMaterial } from '../src/modules/migration/mapping.js';

describe('opening balance import against a real database', () => {
  const run = runId();
  const rackName = `IT OB rack ${run}`;
  const existingName = `IT OB Store ${run}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let actorId: string;
  let existingLocationId: string;
  let alreadyImported = false;

  const material = (sku: string, balances: PlannedMaterial['balances'], extra: Partial<PlannedMaterial> = {}): PlannedMaterial => ({
    sku, name: `Opening item ${sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each',
    requiredStock: 10, unitCost: 42.05, oldProductIds: ['P-001'], balances, ...extra,
  });

  const plan = (materials: PlannedMaterial[]): MappedImport => ({
    materials,
    // The existing location is named in another case: it must be reused, not duplicated.
    locations: [{ name: rackName, type: 'RACK' }, { name: existingName.toUpperCase(), type: 'STOREROOM' }],
    problems: [],
  });

  const balances = (): PlannedMaterial['balances'] => [{ location: rackName, quantity: 12 }, { location: existingName.toUpperCase(), quantity: 3.5 }];

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    actorId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id;
    const loc = await api<{ id: string }>('POST', '/locations', { name: existingName, type: 'STOREROOM' });
    expect(loc.status).toBe(201);
    existingLocationId = loc.body.id;
    alreadyImported = (await previousImport()) !== null;
    // Already in the platform, under another case: the import leaves them alone.
    expect((await api('POST', '/projects', { projectNumber: `it-obp-old-${run}`, name: 'Existing project' })).status).toBe(201);
    expect((await api('POST', '/recipients', { name: `IT OB Fitter ${run}`, type: 'WORKER' })).status).toBe(201);
    expect((await api('POST', '/suppliers', { name: `IT OB Supplier ${run}` })).status).toBe(201);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('refuses SKUs that already exist, and writes nothing, not even the projects', async () => {
    const taken = await api<{ sku: string }>('POST', '/materials', { sku: `IT-OB-TAKEN-${run}`, name: 'Taken', category: 'CONSUMABLES', unitOfMeasure: 'each' });
    expect(taken.status).toBe(200);
    await expect(OpeningBalanceService.import({
      plan: plan([material(`it-ob-taken-${run}`, balances()), material(`IT-OB-NEW-${run}`, balances())]),
      masterData: { projects: [{ projectNumber: `IT-OBP-ROLLBACK-${run}`, name: null }], recipients: [], suppliers: [] },
      openingDate: new Date('2026-10-01T00:00:00Z'), actorId, sourceFile: 'test.xlsm',
    })).rejects.toMatchObject({ code: alreadyImported ? 'INVALID_STATE' : 'CONFLICT' });
    expect(await prisma.material.findUnique({ where: { sku: `IT-OB-NEW-${run}` } })).toBeNull();
    expect(await prisma.location.findFirst({ where: { name: rackName } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { projectNumber: `IT-OBP-ROLLBACK-${run}` } })).toBeNull();
  });

  it('refuses an opening date in the future', async () => {
    await expect(OpeningBalanceService.import({
      plan: plan([material(`IT-OB-FUT-${run}`, balances())]),
      openingDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), actorId, sourceFile: 'test.xlsm',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('creates the items and locations and posts one dated receipt per item and location', async (ctx) => {
    if (alreadyImported) ctx.skip();
    const result = await OpeningBalanceService.import({
      plan: plan([
        material(`IT-OB-1-${run}`, balances()),
        material(`IT-OB-2-${run}`, [{ location: rackName, quantity: 0 }], { unitCost: null, oldProductIds: [] }),
      ]),
      masterData: {
        projects: [{ projectNumber: `IT-OBP-NEW-${run}`, name: 'Pump overhaul' }, { projectNumber: `IT-OBP-OLD-${run}`, name: null }],
        recipients: [{ name: `IT OB Forklift ${run}`, type: 'MACHINE' }, { name: `it ob fitter ${run}`, type: 'WORKER' }],
        suppliers: [
          { name: `IT OB New Supplier ${run}`, contactName: 'Jo', contactEmail: 'jo@example.com', contactPhone: null },
          { name: `it ob supplier ${run}`, contactName: null, contactEmail: null, contactPhone: null },
        ],
      },
      openingDate: new Date('2026-10-01T00:00:00Z'), actorId, sourceFile: 'workbook.xlsm',
    });
    expect(result).toMatchObject({
      materialsCreated: 2, locationsCreated: 1, locationsReused: 1, balancesPosted: 2, zeroBalances: 1,
      projects: { created: 1, existing: 1 }, recipients: { created: 1, existing: 1 }, suppliers: { created: 1, existing: 1 },
    });
    expect(await prisma.project.findUnique({ where: { projectNumber: `IT-OBP-NEW-${run}` } })).toMatchObject({ name: 'Pump overhaul', status: 'ACTIVE', active: true });
    expect(await prisma.project.findUnique({ where: { projectNumber: `it-obp-old-${run}` } })).toMatchObject({ name: 'Existing project' });
    expect(await prisma.recipient.findFirst({ where: { name: `IT OB Forklift ${run}` } })).toMatchObject({ type: 'MACHINE', active: true });
    expect(await prisma.recipient.count({ where: { name: { equals: `IT OB Fitter ${run}`, mode: 'insensitive' } } })).toBe(1);
    expect(await prisma.supplier.findFirst({ where: { name: `IT OB New Supplier ${run}` } })).toMatchObject({ contactName: 'Jo', contactEmail: 'jo@example.com' });
    expect(await prisma.supplier.count({ where: { name: { equals: `IT OB Supplier ${run}`, mode: 'insensitive' } } })).toBe(1);

    const first = await prisma.material.findUniqueOrThrow({ where: { sku: `IT-OB-1-${run}` } });
    expect(first).toMatchObject({ category: 'CONSUMABLES', unitOfMeasure: 'each', description: 'Workbook Product ID: P-001' });
    expect(first.unitCost?.toString()).toBe('42.05');
    expect(first.requiredStock.toString()).toBe('10');
    expect((await prisma.material.findUniqueOrThrow({ where: { sku: `IT-OB-2-${run}` } })).unitCost).toBeNull();

    const rack = await prisma.location.findFirstOrThrow({ where: { name: rackName } });
    expect(rack.type).toBe('RACK');
    expect(await prisma.location.count({ where: { name: { equals: existingName, mode: 'insensitive' } } })).toBe(1);

    for (const [locationId, qty] of [[rack.id, '12'], [existingLocationId, '3.5']] as const) {
      const { ledger, balance } = await ledgerAndBalance(first.id, locationId);
      expect(ledger).toBe(qty);
      expect(balance).toBe(qty);
    }

    const receipts = await prisma.inventoryTransaction.findMany({ where: { materialId: first.id } });
    expect(receipts).toHaveLength(2);
    for (const r of receipts) {
      expect(r).toMatchObject({ type: 'RECEIPT', referenceType: OPENING_BALANCE_REFERENCE, referenceId: result.importId, actorId });
      expect(r.postedAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    }
    const audit = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityType: 'WorkbookImport', entityId: result.importId } });
    expect(audit).toMatchObject({ action: 'IMPORT_OPENING_BALANCES', actorId });

    // The stock shows through the API like any other receipt.
    const stock = await api<Array<{ locationId: string; quantity: string }>>('GET', `/reports/current-stock?materialId=${first.id}`);
    expect(stock.body.map((s) => [s.locationId, Number(s.quantity)]).sort()).toEqual([[existingLocationId, 3.5], [rack.id, 12]].sort());
  });

  it('refuses a second import, which would count the stock twice', async (ctx) => {
    if (alreadyImported) ctx.skip();
    await expect(OpeningBalanceService.import({
      plan: plan([material(`IT-OB-AGAIN-${run}`, balances())]),
      openingDate: new Date('2026-10-02T00:00:00Z'), actorId, sourceFile: 'workbook.xlsm',
    })).rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringMatching(/already imported \(dated 2026-10-01\)/) });
    expect(await prisma.material.findUnique({ where: { sku: `IT-OB-AGAIN-${run}` } })).toBeNull();
  });
});
