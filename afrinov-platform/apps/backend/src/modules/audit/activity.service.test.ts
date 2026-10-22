// Other activity: which audit entries the Movements page shows, how each is
// described, and how the list pages.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { auditFindMany, userFindMany, locationFindMany } = vi.hoisted(() => ({
  auditFindMany: vi.fn(), userFindMany: vi.fn(), locationFindMany: vi.fn(),
}));
vi.mock('../../shared/db.js', () => ({
  prisma: {
    auditLogEntry: { findMany: auditFindMany },
    user: { findMany: userFindMany },
    location: { findMany: locationFindMany },
  },
}));

const { activityWhere, describeActivity, ActivityService, ACTIVITY_TYPES } = await import('./activity.service.js');

const at = new Date('2026-10-12T09:30:00.000Z');
const entry = (over: Partial<Parameters<typeof describeActivity>[0]>) => ({
  id: 'a-1', action: 'CREATE', entityType: 'Material', entityId: 'm-1', actorId: 'u-1', before: null, after: null, createdAt: at, ...over,
});
const say = (over: Partial<Parameters<typeof describeActivity>[0]>, names = new Map<string, string>()) => describeActivity(entry(over), names);

describe('activityWhere', () => {
  it('shows only shop activity: never purchase orders, goods receipts or ledger entries', () => {
    const where = activityWhere({});
    expect(where.entityType).toEqual({ in: [...ACTIVITY_TYPES] });
    for (const hidden of ['PurchaseOrder', 'GoodsReceipt', 'InventoryTransaction', 'StockCount']) expect(ACTIVITY_TYPES).not.toContain(hidden);
    expect(activityWhere({ entityType: 'PurchaseOrder' }).entityType).toBe('__none__');
    // Settings changes stay in Settings > Change history only.
    expect(ACTIVITY_TYPES).not.toContain('Setting');
    expect(activityWhere({ entityType: 'Setting' }).entityType).toBe('__none__');
  });

  it('applies the whole-day date rule, a type and who did it', () => {
    expect(activityWhere({ from: '2026-10-12', to: '2026-10-12', entityType: 'User', actorId: 'u-1' })).toEqual({
      entityType: 'User',
      actorId: 'u-1',
      createdAt: { gte: new Date('2026-10-12T00:00:00.000Z'), lt: new Date('2026-10-13T00:00:00.000Z') },
    });
  });
});

describe('describeActivity', () => {
  it('describes items added and edited, naming what changed', () => {
    expect(say({ after: { sku: 'WSHR-16', name: 'Flat washer' } })).toEqual({ summary: 'Added item WSHR-16 Flat washer', link: '/materials/m-1' });
    expect(say({ action: 'UPDATE', before: { sku: 'WSHR-16', name: 'Flat washer', requiredStock: '10', active: true }, after: { sku: 'WSHR-16', name: 'Flat washer', requiredStock: '20', active: false } }).summary)
      .toBe('Edited item WSHR-16 Flat washer: deactivated it; changed required stock');
  });

  it('describes locations, racks, projects, recipients and suppliers', () => {
    const names = new Map([['loc-9', 'D-1'], ['r-1', 'R-01 Rack one']]);
    expect(say({ entityType: 'Location', action: 'DEACTIVATE', entityId: 'loc-9', after: { active: false } }, names).summary).toBe('Deactivated location D-1');
    expect(say({ entityType: 'Location', action: 'DELETE', before: { name: 'Old shed' } }).summary).toBe('Deleted location Old shed');
    expect(say({ entityType: 'Rack', action: 'ARCHIVE', entityId: 'r-1', after: { status: 'INACTIVE' } }, names).summary).toBe('Archived rack R-01 Rack one');
    // Racks to locations: the entry carries the rack's record, so it names itself with no Rack table.
    expect(say({ entityType: 'Rack', action: 'MOVE_TO_LOCATION', entityId: 'r-gone', before: { code: 'D-1', name: 'Aisle D' }, after: { locationName: 'D-1' } }))
      .toEqual({ summary: 'Rack D-1 Aisle D became location D-1', link: '/locations' });
    expect(say({ entityType: 'Rack', action: 'DISCARD', entityId: 'r-gone', before: { code: 'CHK-8849', name: 'Check rack' }, after: { dropped: [] } }).summary)
      .toBe('Discarded rack CHK-8849 Check rack');
    expect(say({ entityType: 'Project', action: 'CREATE', entityId: 'AFRI-1325', after: { name: 'Hydroscand line' } }).summary).toBe('Added project AFRI-1325 Hydroscand line');
    expect(say({ entityType: 'Recipient', action: 'CREATE', after: { name: 'Sabelo', type: 'WORKER' } }).summary).toBe('Added recipient Sabelo (worker)');
    expect(say({ entityType: 'Supplier', action: 'CREATE', entityId: 's-1', after: { name: 'Hydroscand' } })).toEqual({ summary: 'Added supplier Hydroscand', link: '/suppliers/s-1' });
  });

  it('describes users and imports', () => {
    expect(say({ entityType: 'User', action: 'CREATE', after: { name: 'Thabo', email: 't@a.co.za', roles: ['STORE_CONTROLLER'] } }).summary)
      .toBe('Added user Thabo (t@a.co.za) as store controller');
    expect(say({ entityType: 'User', action: 'UPDATE', before: { name: 'Thabo', active: true, roles: ['VIEWER'] }, after: { name: 'Thabo', active: true, roles: ['ADMIN'] } }).summary)
      .toBe('Edited user Thabo: changed roles');
    expect(say({ entityType: 'WorkbookImport', action: 'IMPORT_OPENING_BALANCES', after: { sourceFile: 'stock.xlsm', materials: 120, balances: 140, openingDate: '2026-10-01' } }).summary)
      .toBe('Imported opening balances from stock.xlsm: 120 items, 140 balances as at 2026-10-01');
  });

  it('still says something for an action it has no sentence for', () => {
    expect(say({ entityType: 'Supplier', action: 'MERGE', entityId: 's-1' })).toEqual({ summary: 'Merge Supplier s-1', link: null });
  });
});

describe('ActivityService.list', () => {
  beforeEach(() => {
    auditFindMany.mockReset();
    userFindMany.mockReset().mockResolvedValue([{ id: 'u-1', name: 'Vusi' }]);
    locationFindMany.mockReset().mockResolvedValue([{ id: 'l-1', name: 'Boiler Shop' }]);
  });

  it('names who did it and the location an entry only refers to by id', async () => {
    auditFindMany.mockResolvedValue([
      entry({ id: 'a-2', entityType: 'Location', action: 'DEACTIVATE', entityId: 'l-1', after: { active: false } }),
      entry({ id: 'a-1', actorId: 'u-gone', after: { sku: 'X', name: 'Y' } }),
      entry({ id: 'a-0', actorId: null, entityType: 'WorkbookImport', action: 'IMPORT_OPENING_BALANCES', entityId: 'i-1', after: { materials: 2, balances: 3 } }),
    ]);
    const rows = await ActivityService.list({});
    expect(rows.map((r) => [r.actorName, r.summary])).toEqual([
      ['Vusi', 'Deactivated location Boiler Shop'],
      ['Unknown user', 'Added item X Y'],
      ['System', 'Imported opening balances: 2 items, 3 balances'],
    ]);
    expect(rows[0]!.cursor).toBe('2026-10-12T09:30:00.000Z_a-2');
    expect(locationFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['l-1'] } } }));
  });

  it('names an archived rack from its own audit entries, with no Rack table, and links to rack locations', async () => {
    auditFindMany.mockImplementation(async (args: { where?: { entityType?: string } }) => (args.where?.entityType === 'Rack'
      // The rack's earlier entries: its creation carries its code and name.
      ? [{ entityId: 'r-1', before: null, after: { code: 'R-01', name: 'Rack one' } }]
      : [entry({ id: 'a-9', entityType: 'Rack', action: 'ARCHIVE', entityId: 'r-1', before: { status: 'FULL' }, after: { status: 'INACTIVE' } })]));
    const rows = await ActivityService.list({});
    expect(rows.map((r) => [r.summary, r.link])).toEqual([['Archived rack R-01 Rack one', '/locations?type=RACK']]);
    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityType: 'Rack', entityId: { in: ['r-1'] }, action: { not: 'ARCHIVE' } } }));
  });

  it('pages newest first, ties by id, continuing after the cursor, at most 500 rows', async () => {
    auditFindMany.mockResolvedValue([]);
    await ActivityService.list({ before: '2026-10-12T09:30:00.000Z_a-2', limit: 9999 });
    const args = auditFindMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(500);
    expect(args.where.AND[1]).toEqual({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: 'a-2' } }] });
  });
});
