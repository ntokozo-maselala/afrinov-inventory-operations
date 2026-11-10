// The Issued stock report: issue slips, each with every line that one issue
// posted, newest first; reversals are not slips.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany, groupBy, receipts } = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn(), receipts: vi.fn() }));
vi.mock('../../shared/db.js', () => ({
  prisma: { inventoryTransaction: { findMany, groupBy }, goodsReceipt: { findMany: vi.fn(async () => []) }, consumableOutcome: { groupBy: vi.fn(async () => []) }, setting: { findMany: vi.fn(async () => []) }, receiptConfirmation: { findMany: receipts } },
}));

const { InventoryService } = await import('./inventory.service.js');

const at = new Date('2026-09-25T08:00:00.000Z');
const line = (id: string, issueId: string, sku: string, over: Record<string, unknown> = {}) => ({
  id, issueId, postedAt: at, type: 'ISSUE', materialId: `m-${sku}`, locationId: 'l-1', quantity: { toString: () => '-2' },
  actorId: 'u-1', recipientId: 'r-1', reasonCode: null, reasonNote: null, projectNumber: 'AFRI-1325', referenceType: 'Project', referenceId: 'AFRI-1325',
  reversesId: null, pairedWithId: null,
  material: { sku, name: sku === 'A' ? 'Angle grinder disc' : 'Bolt', unitOfMeasure: 'each' }, location: { name: 'Boiler Shop' },
  actor: { id: 'u-1', name: 'Vusi', email: 'v@x' }, reversedBy: null, recipient: { name: 'Sabelo', type: 'WORKER' },
  ...over,
});

describe('InventoryService.issueSlips', () => {
  beforeEach(() => {
    findMany.mockReset();
    receipts.mockReset().mockResolvedValue([]);
    groupBy.mockReset().mockResolvedValue([{ referenceId: 'tx-2', _sum: { quantity: { toString: () => '1' } } }]);
  });

  it('returns each slip with all its lines, who it went to, the project and who issued it', async () => {
    findMany
      .mockResolvedValueOnce([{ issueId: 'iss-2', postedAt: at }, { issueId: 'iss-1', postedAt: at }])
      .mockResolvedValueOnce([
        line('tx-3', 'iss-2', 'B'),
        line('tx-2', 'iss-2', 'A'),
        line('tx-1', 'iss-1', 'A', { recipient: { name: 'Forklift', type: 'MACHINE' }, projectNumber: null }),
        line('tx-9', 'iss-2', 'A', { reversesId: 'tx-2' }),
      ]);
    const slips = await InventoryService.issueSlips({ from: '2026-09-25', materialId: 'm-A' });
    expect(slips.map((s) => [s.id, s.recipientName, s.projectNumber, s.issuedByName, s.lines.map((l) => l.id)])).toEqual([
      ['iss-2', 'Sabelo', 'AFRI-1325', 'Vusi', ['tx-2', 'tx-3']],
      ['iss-1', 'Forklift', null, 'Vusi', ['tx-1']],
    ]);
    expect(slips[0]!.cursor).toBe('2026-09-25T08:00:00.000Z_iss-2');
    expect(slips[0]!.lines[0]!.returnedQuantity).toBe('1');
    // The slip is chosen by any matching line, then filled with all of its lines.
    expect(findMany.mock.calls[1]![0].where).toEqual({ issueId: { in: ['iss-2', 'iss-1'] }, type: 'ISSUE' });
  });

  it('pages by time then slip id, takes one row per slip and never a reversal', async () => {
    findMany.mockResolvedValueOnce([]);
    expect(await InventoryService.issueSlips({ before: '2026-09-25T08:00:00.000Z_iss-2', limit: 999 })).toEqual([]);
    const args = findMany.mock.calls[0]![0];
    expect(args.distinct).toEqual(['issueId']);
    expect(args.orderBy).toEqual([{ postedAt: 'desc' }, { issueId: 'desc' }]);
    expect(args.take).toBe(200);
    expect(args.where.AND).toEqual(expect.arrayContaining([
      { issueId: { not: null }, reversesId: null },
      { OR: [{ postedAt: { lt: at } }, { postedAt: at, issueId: { lt: 'iss-2' } }] },
    ]));
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('InventoryService.issueSlips and receipts (ADR-034)', () => {
  beforeEach(() => {
    findMany.mockReset();
    groupBy.mockReset().mockResolvedValue([]);
    receipts.mockReset().mockResolvedValue([]);
  });

  it('attaches each slip’s receipt, and null where nothing is recorded', async () => {
    findMany
      .mockResolvedValueOnce([{ issueId: 'iss-2', postedAt: at }, { issueId: 'iss-1', postedAt: at }])
      .mockResolvedValueOnce([line('tx-2', 'iss-2', 'A'), line('tx-1', 'iss-1', 'B')]);
    receipts.mockResolvedValueOnce([{
      slipId: 'iss-1', method: 'PIN', signerId: 'r-1', reason: null, note: null, linesFingerprint: 'stale', confirmedAt: at, imageRemovedAt: null,
      signer: { name: 'Sabelo' }, capturedBy: { name: 'Vusi' }, image: null,
    }]);
    const slips = await InventoryService.issueSlips({});
    expect(slips.map((s) => [s.id, s.recipientId, s.receipt?.method ?? null])).toEqual([['iss-2', 'r-1', null], ['iss-1', 'r-1', 'PIN']]);
    // Its fingerprint doesn't match the lines shown, so it reads as changed after it was confirmed.
    expect(slips[1]!.receipt).toMatchObject({ signerName: 'Sabelo', capturedByName: 'Vusi', changed: true });
  });

  it('lists only the slips not confirmed, passing over the confirmed ones', async () => {
    findMany
      .mockResolvedValueOnce([{ issueId: 'iss-3', postedAt: at }, { issueId: 'iss-2', postedAt: at }, { issueId: 'iss-1', postedAt: at }])
      .mockResolvedValueOnce([line('tx-3', 'iss-3', 'A'), line('tx-1', 'iss-1', 'A')]);
    receipts.mockResolvedValueOnce([{ slipId: 'iss-2' }]);
    const slips = await InventoryService.issueSlips({ receipt: 'unconfirmed' });
    expect(slips.map((s) => s.id)).toEqual(['iss-3', 'iss-1']);
    // Read in batches of 200, whatever the page size, so a page fills past confirmed slips.
    expect(findMany.mock.calls[0]![0].take).toBe(200);
    expect(receipts.mock.calls[0]![0].where).toEqual({ slipId: { in: ['iss-3', 'iss-2', 'iss-1'] }, method: { not: 'NONE' } });
  });

  it('reads on to the next batch until the page is full, starting after the last slip read', async () => {
    const batch = Array.from({ length: 200 }, (_, i) => ({ issueId: `c-${String(999 - i).padStart(4, '0')}`, postedAt: at }));
    findMany
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([{ issueId: 'iss-0', postedAt: at }])
      .mockResolvedValueOnce([line('tx-0', 'iss-0', 'A')]);
    receipts.mockResolvedValueOnce(batch.map((h) => ({ slipId: h.issueId }))).mockResolvedValueOnce([]);
    const slips = await InventoryService.issueSlips({ receipt: 'unconfirmed', limit: 5 });
    expect(slips.map((s) => s.id)).toEqual(['iss-0']);
    expect(findMany.mock.calls[1]![0].where.AND).toEqual(expect.arrayContaining([
      { OR: [{ postedAt: { lt: at } }, { postedAt: at, issueId: { lt: batch[199]!.issueId } }] },
    ]));
  });
});
