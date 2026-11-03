// The Movements filter: which ledger rows a date range, location, user and
// search select, and how the paging cursor continues a list. Tool loan due
// date changes are listed among the movements and paged with them, as are used
// up and broken marks that have no return to show them, and their withdrawals.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany, changeFindMany, outcomeFindMany, outcomeGroupBy } = vi.hoisted(() => ({
  findMany: vi.fn(), changeFindMany: vi.fn(), outcomeFindMany: vi.fn(), outcomeGroupBy: vi.fn(),
}));
vi.mock('../../shared/db.js', () => ({
  prisma: {
    inventoryTransaction: { findMany, groupBy: vi.fn(async () => []) },
    toolLoanExtension: { findMany: changeFindMany },
    consumableOutcome: { findMany: outcomeFindMany, groupBy: outcomeGroupBy },
    goodsReceipt: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('../settings/settings.service.js', () => ({ SettingsService: { getValues: async () => ({}) } }));

const {
  historyWhere, historyCursor, InventoryService, listsDueDateChanges, dueDateChangeWhere, mergeNewestFirst, listsOutcomeEvents, outcomeEventWhere,
} = await import('./inventory.service.js');

describe('historyWhere', () => {
  it('treats days as whole UTC days and includes the last one', () => {
    const where = historyWhere({ from: '2026-10-01', to: '2026-10-31' });
    expect(where.postedAt).toEqual({ gte: new Date('2026-10-01T00:00:00.000Z'), lt: new Date('2026-11-01T00:00:00.000Z') });
  });

  it('accepts a single day as both ends', () => {
    expect(historyWhere({ from: '2026-10-12', to: '2026-10-12' }).postedAt)
      .toEqual({ gte: new Date('2026-10-12T00:00:00.000Z'), lt: new Date('2026-10-13T00:00:00.000Z') });
  });

  it('keeps an exact time as an inclusive end, for callers that pass one', () => {
    expect(historyWhere({ to: '2026-10-12T10:30:00.000Z' }).postedAt).toEqual({ lte: new Date('2026-10-12T10:30:00.000Z') });
  });

  it('refuses a start after the end, and a date that is not one', () => {
    expect(() => historyWhere({ from: '2026-10-31', to: '2026-10-01' })).toThrow(/start date is after the end date/);
    expect(() => historyWhere({ from: 'last week' })).toThrow(/Invalid from date/);
  });

  it('filters by location and by who posted it', () => {
    expect(historyWhere({ locationId: 'l-1', actorId: 'u-1' })).toMatchObject({ locationId: 'l-1', actorId: 'u-1' });
  });

  it('filters by a room and the locations inside it, which wins over the one location', () => {
    expect(historyWhere({ locationId: 'room', locationIds: ['room', 'rack-1'] })).toMatchObject({ locationId: { in: ['room', 'rack-1'] } });
    expect(historyWhere({ locationId: 'room' })).toMatchObject({ locationId: 'room' });
  });

  it('filters by who it was issued to, including issues with no recipient recorded', () => {
    expect(historyWhere({ recipientId: 'r-1' }).recipientId).toBe('r-1');
    expect(historyWhere({ recipientId: '__none__' }).recipientId).toBeNull();
  });

  it('searches item code and name, location, project and who it was issued to, ignoring case', () => {
    const where = historyWhere({ q: '  disc ' });
    const contains = { contains: 'disc', mode: 'insensitive' };
    expect(where.AND).toEqual([{
      OR: [
        { material: { sku: contains } },
        { material: { name: contains } },
        { location: { name: contains } },
        { projectNumber: contains },
        { recipient: { name: contains } },
      ],
    }]);
    expect(historyWhere({ q: '   ' }).AND).toBeUndefined();
  });

  it('selects each report: issued stock, transfers by their out leg, write-offs without count differences', () => {
    expect(historyWhere({ report: 'issued', type: 'RECEIPT' }).type).toBe('ISSUE');
    expect(historyWhere({ report: 'transfers' }).type).toBe('TRANSFER_OUT');
    expect(historyWhere({ report: 'loans' }).type).toEqual({ in: ['LOAN', 'LOAN_RETURN'] });
    expect(historyWhere({ report: 'returned', recipientId: 'r-1' })).toMatchObject({ type: 'RETURN', recipientId: 'r-1' });
    const writeoffs = historyWhere({ report: 'writeoffs', q: 'disc' });
    expect(writeoffs.type).toBe('ADJUSTMENT');
    // Unreferenced adjustments must stay in: NULL <> 'StockCount' is not true in SQL.
    expect(writeoffs.AND).toEqual([{ OR: [{ referenceType: null }, { referenceType: { not: 'StockCount' } }] }, expect.objectContaining({ OR: expect.any(Array) })]);
  });
});

describe('queryHistory paging', () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
    changeFindMany.mockReset().mockResolvedValue([]);
    outcomeFindMany.mockReset().mockResolvedValue([]);
    outcomeGroupBy.mockReset().mockResolvedValue([]);
  });

  it('orders newest first with ties broken by id, and continues after the cursor', async () => {
    const cursor = historyCursor({ postedAt: new Date('2026-10-05T08:00:00.000Z'), id: 'tx-9' });
    expect(cursor).toBe('2026-10-05T08:00:00.000Z_tx-9');
    await InventoryService.queryHistory({ from: '2026-10-01', before: cursor, limit: 100 });
    const args = findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ postedAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(100);
    expect(args.where.AND[1]).toEqual({
      OR: [
        { postedAt: { lt: new Date('2026-10-05T08:00:00.000Z') } },
        { postedAt: new Date('2026-10-05T08:00:00.000Z'), id: { lt: 'tx-9' } },
      ],
    });
  });

  it('caps a page at 1000 rows unless the caller allows more', async () => {
    await InventoryService.queryHistory({ limit: 50_000 });
    expect(findMany.mock.calls[0]![0].take).toBe(1000);
  });

  it('refuses a cursor it did not issue', async () => {
    await expect(InventoryService.queryHistory({ before: 'nonsense' })).rejects.toThrow(/Invalid paging cursor/);
  });

  it('says which issue each return came back from: its date, slip and location', async () => {
    const back = {
      id: 'ret-1', postedAt: new Date('2026-10-03T09:00:00Z'), type: 'RETURN', materialId: 'm-1', locationId: 'l-2', quantity: '3', actorId: 'u-1',
      recipientId: 'r-1', reasonCode: null, reasonNote: 'Job done', projectNumber: 'AFRI-1325', referenceType: 'Return', referenceId: 'iss-1',
      reversesId: null, pairedWithId: null, issueId: null,
      material: { sku: 'DISC', name: 'Disc', unitOfMeasure: 'each' }, location: { name: 'B-2' }, actor: { name: 'Vusi' },
      recipient: { name: 'Sabelo', type: 'WORKER' }, reversedBy: null,
    };
    findMany.mockReset()
      .mockResolvedValueOnce([back])
      .mockResolvedValueOnce([{ id: 'iss-1', postedAt: new Date('2026-09-28T07:30:00Z'), issueId: 'slip-9', location: { name: 'A-1' } }]);
    const [row] = await InventoryService.queryHistory({ report: 'returned' });
    expect(findMany.mock.calls[1]![0].where).toEqual({ id: { in: ['iss-1'] } });
    expect(row!.returnOf).toEqual({ id: 'iss-1', postedAt: '2026-09-28T07:30:00.000Z', issueId: 'slip-9', locationName: 'A-1' });
    expect(row!.locationName).toBe('B-2');
  });
});

describe('due date changes among the movements', () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
    changeFindMany.mockReset().mockResolvedValue([]);
    outcomeFindMany.mockReset().mockResolvedValue([]);
    outcomeGroupBy.mockReset().mockResolvedValue([]);
  });

  it('are listed on all movements and the tool loans report, unless a type or issue slips narrow it', () => {
    expect(listsDueDateChanges({})).toBe(true);
    expect(listsDueDateChanges({ report: 'loans', recipientId: 'r-1' })).toBe(true);
    for (const report of ['issued', 'transfers', 'writeoffs', 'returned'] as const) expect(listsDueDateChanges({ report })).toBe(false);
    expect(listsDueDateChanges({ type: 'ISSUE' })).toBe(false);
    expect(listsDueDateChanges({ issueIds: ['s-1'] })).toBe(false);
  });

  it('are chosen by when and by whom they were made, and by their loan for everything else', () => {
    const where = dueDateChangeWhere({ from: '2026-10-01', to: '2026-10-31', actorId: 'u-1', materialId: 'm-1', recipientId: 'r-1', report: 'loans' });
    expect(where.createdAt).toEqual({ gte: new Date('2026-10-01T00:00:00.000Z'), lt: new Date('2026-11-01T00:00:00.000Z') });
    expect(where.actorId).toBe('u-1');
    // The loan is matched on its item and person, not on when it went out or who lent it.
    expect(where.loan).toEqual({ materialId: 'm-1', recipientId: 'r-1' });
  });

  it('keeps each list in its own order and breaks a tie in time by id', () => {
    const at = (iso: string) => new Date(iso);
    const a = [{ id: 'a-2', t: at('2026-10-05T10:00:00Z') }, { id: 'a-1', t: at('2026-10-03T10:00:00Z') }];
    const b = [{ id: 'b-9', t: at('2026-10-05T10:00:00Z') }, { id: 'b-1', t: at('2026-10-04T10:00:00Z') }];
    const merged = mergeNewestFirst(a, (x) => x.t, b, (x) => x.t, (x) => x.id, 3);
    expect(merged.map((m) => ('a' in m ? m.a.id : m.b.id))).toEqual(['b-9', 'a-2', 'b-1']);
  });

  it('come back as rows with no quantity, naming the date before and after, newest first among the movements', async () => {
    const loan = {
      id: 'loan-1', postedAt: new Date('2026-10-01T08:00:00Z'), type: 'LOAN', materialId: 'm-1', locationId: 'l-1', quantity: '-1', actorId: 'u-1',
      recipientId: 'r-1', reasonCode: null, reasonNote: null, projectNumber: 'AFRI-1325', referenceType: null, referenceId: null,
      reversesId: null, pairedWithId: null, issueId: 'slip-1', overdueOverrideReason: 'Second crew',
      material: { sku: 'TW-200', name: 'Torque wrench', unitOfMeasure: 'each' }, location: { name: 'Main store' }, actor: { name: 'Thabo' },
      recipient: { name: 'Khodani', type: 'WORKER' }, reversedBy: null,
    };
    const change = {
      id: 'ext-1', loanId: 'loan-1', createdAt: new Date('2026-10-09T09:14:00Z'), dueOn: new Date('2026-10-14T00:00:00Z'), reason: 'Pour delayed', actorId: 'u-2',
      actor: { name: 'Lerato' },
      loan: { ...loan, material: { sku: 'TW-200', name: 'Torque wrench', unitOfMeasure: 'each' }, location: { name: 'Main store' }, recipient: { name: 'Khodani', type: 'WORKER' } },
    };
    findMany.mockReset()
      .mockResolvedValueOnce([loan])
      // The loans' dates: agreed for the 8th, then the change.
      .mockResolvedValueOnce([{ id: 'loan-1', postedAt: loan.postedAt, dueOn: new Date('2026-10-08T00:00:00Z'), loanExtensions: [{ id: 'ext-1', createdAt: change.createdAt, dueOn: change.dueOn }] }]);
    changeFindMany.mockResolvedValueOnce([change]);

    const rows = await InventoryService.queryHistory({ report: 'loans', limit: 10 });
    expect(changeFindMany.mock.calls[0]![0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(rows.map((r) => r.type)).toEqual(['DUE_DATE_CHANGE', 'LOAN']);
    expect(rows[0]).toMatchObject({
      id: 'ext-1', cursor: '2026-10-09T09:14:00.000Z_ext-1', quantity: null, dueOn: '2026-10-14', previousDueOn: '2026-10-08',
      reasonNote: 'Pour delayed', actorName: 'Lerato', recipientName: 'Khodani', projectNumber: 'AFRI-1325', referenceId: 'loan-1', materialSku: 'TW-200',
    });
    expect(rows[1]).toMatchObject({ dueOn: '2026-10-08', currentDueOn: '2026-10-14', overdueOverrideReason: 'Second crew', previousDueOn: null });
  });
});

// ADR-026: every counter visit is on Movements. A return's row shows the marks
// booked with it; a mark with nothing back on the shelf, and every withdrawal,
// is a row of its own.
describe('used up and broken among the movements', () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
    changeFindMany.mockReset().mockResolvedValue([]);
    outcomeFindMany.mockReset().mockResolvedValue([]);
    outcomeGroupBy.mockReset().mockResolvedValue([]);
  });

  it('are listed on all movements and the returned stock report, unless a type or issue slips narrow it', () => {
    expect(listsOutcomeEvents({})).toBe(true);
    expect(listsOutcomeEvents({ report: 'returned', recipientId: 'r-1' })).toBe(true);
    for (const report of ['issued', 'transfers', 'writeoffs', 'loans'] as const) expect(listsOutcomeEvents({ report })).toBe(false);
    expect(listsOutcomeEvents({ type: 'RETURN' })).toBe(false);
    expect(listsOutcomeEvents({ issueIds: ['s-1'] })).toBe(false);
  });

  it('are the marks with no return and every withdrawal, chosen by when and by whom, and by their issue for everything else', () => {
    const where = outcomeEventWhere({ from: '2026-11-03', to: '2026-11-03', actorId: 'u-1', materialId: 'm-1', recipientId: 'r-1' });
    expect(where.OR).toEqual([{ withdrawsId: { not: null } }, { returnTransactionId: null }]);
    expect(where.createdAt).toEqual({ gte: new Date('2026-11-03T00:00:00.000Z'), lt: new Date('2026-11-04T00:00:00.000Z') });
    expect(where.actorId).toBe('u-1');
    expect(where.issue).toEqual({ materialId: 'm-1', recipientId: 'r-1' });
  });

  it('show the marks on the return booked with them, and a mark or withdrawal of its own as a row with no quantity', async () => {
    const material = { sku: 'CUT-115', name: 'Cut-off disc', unitOfMeasure: 'each', trackUse: true };
    const back = {
      id: 'ret-1', postedAt: new Date('2026-11-03T09:39:00Z'), type: 'RETURN', materialId: 'm-1', locationId: 'l-1', quantity: '2', actorId: 'u-1',
      recipientId: 'r-1', reasonCode: null, reasonNote: null, projectNumber: null, referenceType: 'Return', referenceId: 'iss-1',
      reversesId: null, pairedWithId: null, issueId: 'slip-1',
      material, location: { name: 'Main' }, actor: { name: 'Vusi' }, recipient: { name: 'Khodani', type: 'WORKER' }, reversedBy: null,
    };
    const issue = {
      id: 'iss-1', postedAt: new Date('2026-11-03T09:38:00Z'), issueId: 'slip-1', materialId: 'm-1', locationId: 'l-1', recipientId: 'r-1',
      projectNumber: null, material, location: { name: 'Main' }, recipient: { name: 'Khodani', type: 'WORKER' },
    };
    const qty = (n: string) => ({ toString: () => n });
    const mark = (over: Record<string, unknown>) => ({
      issueTransactionId: 'iss-1', outcome: 'USED_UP', quantity: qty('3'), note: null, withdrawsId: null, returnTransactionId: null,
      actorId: 'u-1', actor: { name: 'Vusi' }, issue, ...over,
    });
    findMany.mockReset()
      .mockResolvedValueOnce([back])
      .mockResolvedValueOnce([{ id: 'iss-1', postedAt: issue.postedAt, issueId: 'slip-1', location: { name: 'Main' } }]);
    outcomeFindMany.mockResolvedValueOnce([
      mark({ id: 'wd-1', createdAt: new Date('2026-11-03T10:20:00Z'), outcome: 'BROKEN', quantity: qty('1'), withdrawsId: 'o-2', note: 'Belonged to Sabelo' }),
      mark({ id: 'o-9', createdAt: new Date('2026-11-03T10:15:00Z') }),
    ]);
    outcomeGroupBy.mockResolvedValueOnce([
      { returnTransactionId: 'ret-1', outcome: 'USED_UP', _sum: { quantity: qty('2') } },
      { returnTransactionId: 'ret-1', outcome: 'BROKEN', _sum: { quantity: qty('1') } },
    ]);

    const rows = await InventoryService.queryHistory({ limit: 10 });
    expect(outcomeGroupBy.mock.calls[0]![0].where).toEqual({ returnTransactionId: { in: ['ret-1'] }, withdrawsId: null });
    expect(rows.map((r) => r.type)).toEqual(['OUTCOME_WITHDRAWN', 'USED_UP', 'RETURN']);
    expect(rows[0]).toMatchObject({ quantity: null, brokenQuantity: '1', usedUpQuantity: null, reasonNote: 'Belonged to Sabelo', recipientName: 'Khodani', referenceId: 'iss-1' });
    expect(rows[1]).toMatchObject({ quantity: null, usedUpQuantity: '3', cursor: '2026-11-03T10:15:00.000Z_o-9', returnOf: { id: 'iss-1', issueId: 'slip-1', locationName: 'Main' } });
    expect(rows[2]).toMatchObject({ quantity: '2', usedUpQuantity: '2', brokenQuantity: '1', recipientName: 'Khodani' });
  });
});
