// Unit tests for InventoryService.returnable: what a recipient can still bring
// back. The database is a stub that answers the two queries it makes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const D = (n: number) => new Prisma.Decimal(n);
const calls: Array<{ where: Record<string, unknown> }> = [];
let issues: unknown[] = [];
let returns: Array<{ referenceId: string; quantity: Prisma.Decimal }> = [];

vi.mock('../../shared/db.js', () => ({
  get prisma() {
    return {
      inventoryTransaction: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          calls.push(args);
          return args.where['type'] === 'ISSUE' ? issues : returns;
        },
      },
    };
  },
}));
vi.mock('../../shared/events.js', () => ({ dispatchDomainEvents: async () => undefined }));

const { InventoryService } = await import('./inventory.service.js');

const issue = (id: string, qty: number, over: Record<string, unknown> = {}) => ({
  id, issueId: `slip-${id}`, postedAt: new Date('2026-10-10T08:00:00Z'), materialId: `m-${id}`, locationId: 'l-1',
  quantity: D(-qty), projectNumber: 'AFRI-1325',
  material: { sku: `SKU-${id}`, name: `Item ${id}`, unitOfMeasure: 'each' }, location: { name: 'A-1', active: true },
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  issues = [];
  returns = [];
});

describe('InventoryService.returnable', () => {
  it('lists each issue with what is still out, leaving out those fully returned', async () => {
    issues = [issue('a', 10), issue('b', 4), issue('c', 2)];
    returns = [{ referenceId: 'a', quantity: D(3) }, { referenceId: 'a', quantity: D(2) }, { referenceId: 'b', quantity: D(4) }];
    const rows = await InventoryService.returnable({ recipientId: 'r-1' });
    expect(rows.map((r) => [r.issueTransactionId, r.issued, r.returned, r.outstanding])).toEqual([
      ['a', '10', '5', '5'],
      ['c', '2', '0', '2'],
    ]);
    expect(rows[0]).toMatchObject({ sku: 'SKU-a', name: 'Item a', unitOfMeasure: 'each', locationName: 'A-1', locationActive: true, projectNumber: 'AFRI-1325', issueId: 'slip-a', postedAt: '2026-10-10T08:00:00.000Z' });
  });

  it("asks for the recipient's unreversed issues in the period, and the returns against them", async () => {
    issues = [issue('a', 1)];
    await InventoryService.returnable({ recipientId: 'r-1', from: '2026-09-16', to: '2026-10-16' });
    expect(calls[0]!.where).toMatchObject({ type: 'ISSUE', recipientId: 'r-1', reversesId: null, reversedBy: null });
    expect(calls[0]!.where['postedAt']).toEqual({ gte: new Date('2026-09-16T00:00:00.000Z'), lt: new Date('2026-10-17T00:00:00.000Z') });
    expect(calls[1]!.where).toMatchObject({ type: 'RETURN', referenceType: 'Return', referenceId: { in: ['a'] } });
  });

  it('asks nothing more when there are no issues', async () => {
    expect(await InventoryService.returnable({ recipientId: 'r-1' })).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
