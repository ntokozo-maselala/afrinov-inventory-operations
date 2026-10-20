// Tool check-out and check-in, on a small in-memory ledger: a loan takes the
// tool off the shelf, a check-in brings it back, and a lost tool is written off.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

type Row = {
  id: string; materialId: string; locationId: string; type: string; quantity: Prisma.Decimal;
  issueId?: string | null; recipientId?: string | null; projectNumber?: string | null; reasonCode?: string | null;
  reasonNote?: string | null; referenceType?: string | null; referenceId?: string | null; actorId: string; postedAt: Date;
};

const db = vi.hoisted(() => ({
  ledger: [] as Row[],
  locks: [] as string[],
  audit: [] as Array<{ action: string }>,
  materials: [
    { id: 'm-drill', sku: 'TL-0001', name: 'Makita Hand Drill', category: 'TOOLS', unitOfMeasure: 'each', serialNumber: '34322', active: true },
    { id: 'm-scraper', sku: 'TL-0002', name: 'Scraper', category: 'TOOLS', unitOfMeasure: 'each', serialNumber: null, active: true },
    { id: 'm-disc', sku: 'CON-0001', name: 'Grinding disc', category: 'CONSUMABLES', unitOfMeasure: 'each', serialNumber: null, active: true },
  ],
}));
let seq = 0;
const D = (n: number | string) => new Prisma.Decimal(n);
const balance = (materialId: string, locationId: string) =>
  db.ledger.filter((r) => r.materialId === materialId && r.locationId === locationId).reduce((a, r) => a.plus(r.quantity), D(0));

const names: Record<string, string> = { 'l-store': 'Main Storeroom', 'r-sabelo': 'Sabelo', 'r-bukho': 'Bukho', 'u-1': 'Vusi' };
const matches = (r: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
  const value = (r as unknown as Record<string, unknown>)[k];
  if (v && typeof v === 'object' && 'in' in (v as object)) return (v as { in: unknown[] }).in.includes(value);
  return value === v;
});

const client = {
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, key: string) => { db.locks.push(key); return 0; }),
  material: {
    findUnique: async ({ where }: { where: { id: string } }) => db.materials.find((m) => m.id === where.id) ?? null,
    findMany: async ({ where }: { where: { category: string } }) => db.materials.filter((m) => m.category === where.category),
  },
  location: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'l-store' ? { id: 'l-store', active: true } : null) },
  recipient: { findUnique: async ({ where }: { where: { id: string } }) => (names[where.id] ? { id: where.id, active: true } : null) },
  project: { findUnique: async () => ({ projectNumber: 'AFRI-1325', active: true }) },
  inventoryBalance: {
    findMany: async ({ where }: { where: { materialId: { in: string[] } } }) => where.materialId.in.flatMap((materialId) =>
      [{ materialId, locationId: 'l-store', quantity: balance(materialId, 'l-store'), location: { name: 'Main Storeroom' } }]),
  },
  inventoryTransaction: {
    create: async ({ data }: { data: Omit<Row, 'id' | 'postedAt'> & { postedAt?: Date } }) => {
      const row = { ...data, id: `tx-${++seq}`, postedAt: data.postedAt ?? new Date() } as Row;
      db.ledger.push(row);
      return row;
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => db.ledger.filter((r) => matches(r, where)).map((r) => ({
      ...r,
      recipient: r.recipientId ? { name: names[r.recipientId] } : null,
      location: { name: names[r.locationId] },
      actor: { name: names[r.actorId] },
      material: { sku: db.materials.find((m) => m.id === r.materialId)!.sku },
    })),
    groupBy: async ({ where }: { where: Record<string, unknown> }) => {
      const sums = new Map<string, Prisma.Decimal>();
      for (const r of db.ledger.filter((x) => matches(x, where))) sums.set(r.referenceId!, (sums.get(r.referenceId!) ?? D(0)).plus(r.quantity));
      return [...sums].map(([referenceId, quantity]) => ({ referenceId, _sum: { quantity } }));
    },
  },
  auditLogEntry: { create: async ({ data }: { data: { action: string } }) => { db.audit.push(data); return data; } },
};

vi.mock('../../shared/db.js', () => ({ prisma: { ...client, $transaction: async (fn: (t: typeof client) => unknown) => fn(client) } }));
vi.mock('../settings/settings.service.js', () => ({ SettingsService: { getValue: async () => 7 } }));
vi.mock('../../shared/inventory/balances.js', () => ({
  getCurrentBalance: async (materialId: string, locationId: string) => balance(materialId, locationId),
  recomputeBalance: async () => undefined,
}));

const { ToolLoanService } = await import('./tool-loan.service.js');

const receive = (materialId: string, quantity: number) =>
  db.ledger.push({ id: `tx-${++seq}`, materialId, locationId: 'l-store', type: 'RECEIPT', quantity: D(quantity), actorId: 'u-1', postedAt: new Date() });
const tool = async (materialId: string) => (await ToolLoanService.list()).find((t) => t.materialId === materialId)!;

beforeEach(() => {
  db.ledger.length = 0;
  db.locks.length = 0;
  db.audit.length = 0;
  seq = 0;
  receive('m-drill', 1);
  receive('m-scraper', 11);
});

describe('ToolLoanService', () => {
  it('checks tools out to one person as one slip, off the shelf but still owned', async () => {
    const { slipId, loanIds } = await ToolLoanService.checkOut({
      recipientId: 'r-sabelo', projectNumber: 'AFRI-1325', note: 'Site job', actorId: 'u-1',
      lines: [{ materialId: 'm-drill', locationId: 'l-store', quantity: 1 }, { materialId: 'm-scraper', locationId: 'l-store', quantity: 3 }],
    });
    expect(loanIds).toHaveLength(2);
    const loans = db.ledger.filter((r) => r.type === 'LOAN');
    expect(loans.map((r) => [r.materialId, r.quantity.toString(), r.issueId, r.recipientId, r.projectNumber, r.reasonNote])).toEqual([
      ['m-drill', '-1', slipId, 'r-sabelo', 'AFRI-1325', 'Site job'],
      ['m-scraper', '-3', slipId, 'r-sabelo', 'AFRI-1325', 'Site job'],
    ]);
    const scraper = await tool('m-scraper');
    expect([scraper.inStore, scraper.onLoan, scraper.owned]).toEqual(['8', '3', '11']);
    expect(scraper.loans).toEqual([expect.objectContaining({ recipientName: 'Sabelo', projectNumber: 'AFRI-1325', quantity: '3', out: '3', locationName: 'Main Storeroom', checkedOutBy: 'Vusi' })]);
    expect((await tool('m-drill')).serialNumber).toBe('34322');
    expect(db.locks).toEqual(['afrinov:tool:m-drill:l-store', 'afrinov:tool:m-scraper:l-store']);
    expect(db.audit).toEqual([expect.objectContaining({ action: 'TOOL_CHECK_OUT' })]);
  });

  it('refuses more than is in store, and anything that is not a tool', async () => {
    await expect(ToolLoanService.checkOut({ recipientId: 'r-sabelo', actorId: 'u-1', lines: [{ materialId: 'm-drill', locationId: 'l-store', quantity: 2 }] }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await expect(ToolLoanService.checkOut({ recipientId: 'r-sabelo', actorId: 'u-1', lines: [{ materialId: 'm-disc', locationId: 'l-store', quantity: 1 }] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('not a tool') });
    // Two lines of one tool are checked as one total.
    await expect(ToolLoanService.checkOut({
      recipientId: 'r-sabelo', actorId: 'u-1',
      lines: [{ materialId: 'm-scraper', locationId: 'l-store', quantity: 6 }, { materialId: 'm-scraper', locationId: 'l-store', quantity: 6 }],
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(db.ledger.filter((r) => r.type === 'LOAN')).toEqual([]);
  });

  it('takes part of a set back in good order and part damaged, then the rest, closing the loan', async () => {
    const { loanIds: [loanId] } = await ToolLoanService.checkOut({ recipientId: 'r-bukho', actorId: 'u-1', lines: [{ materialId: 'm-scraper', locationId: 'l-store', quantity: 3 }] });
    await ToolLoanService.checkIn({ actorId: 'u-1', lines: [{ loanId: loanId!, quantity: 1, condition: 'GOOD' }, { loanId: loanId!, quantity: 1, condition: 'DAMAGED', note: 'Blade bent' }] });
    let scraper = await tool('m-scraper');
    expect([scraper.inStore, scraper.onLoan, scraper.loans[0]?.out]).toEqual(['10', '1', '1']);
    const back = db.ledger.filter((r) => r.type === 'LOAN_RETURN');
    expect(back.map((r) => [r.quantity.toString(), r.reasonCode, r.reasonNote, r.referenceType, r.referenceId, r.recipientId])).toEqual([
      ['1', null, null, 'ToolLoan', loanId, 'r-bukho'],
      ['1', 'DAMAGE', 'Blade bent', 'ToolLoan', loanId, 'r-bukho'],
    ]);
    await expect(ToolLoanService.checkIn({ actorId: 'u-1', lines: [{ loanId: loanId!, quantity: 2, condition: 'GOOD' }] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('only 1 still checked out') });
    await ToolLoanService.checkIn({ actorId: 'u-1', lines: [{ loanId: loanId!, quantity: 1, condition: 'GOOD' }] });
    scraper = await tool('m-scraper');
    expect([scraper.inStore, scraper.onLoan, scraper.loans]).toEqual(['11', '0', []]);
  });

  it('writes off a tool lost on loan, so it is neither out nor owned, and asks what happened', async () => {
    const { loanIds: [loanId] } = await ToolLoanService.checkOut({ recipientId: 'r-sabelo', actorId: 'u-1', lines: [{ materialId: 'm-drill', locationId: 'l-store', quantity: 1 }] });
    await expect(ToolLoanService.checkIn({ actorId: 'u-1', lines: [{ loanId: loanId!, quantity: 1, condition: 'LOST' }] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const { writeOffIds } = await ToolLoanService.checkIn({ actorId: 'u-1', lines: [{ loanId: loanId!, quantity: 1, condition: 'LOST', note: 'Left on site' }] });
    expect(writeOffIds).toHaveLength(1);
    const writeOff = db.ledger.find((r) => r.id === writeOffIds[0])!;
    expect([writeOff.type, writeOff.quantity.toString(), writeOff.reasonCode, writeOff.reasonNote]).toEqual(['ADJUSTMENT', '-1', 'LOSS', 'Lost while checked out to Sabelo: Left on site']);
    const drill = await tool('m-drill');
    expect([drill.inStore, drill.onLoan, drill.owned]).toEqual(['0', '0', '0']);
  });

  it('says how long each loan has been out, and that it is overdue after the days set (7)', async () => {
    await ToolLoanService.checkOut({ recipientId: 'r-sabelo', actorId: 'u-1', lines: [{ materialId: 'm-drill', locationId: 'l-store', quantity: 1 }] });
    const after = async (days: number) => (await ToolLoanService.list(new Date(Date.now() + days * 86_400_000))).find((t) => t.materialId === 'm-drill')!.loans[0]!;
    expect(await after(7)).toMatchObject({ daysOut: 7, overdue: false });
    expect(await after(9)).toMatchObject({ daysOut: 9, overdue: true });
  });

  it('checks in only a check-out', async () => {
    await expect(ToolLoanService.checkIn({ actorId: 'u-1', lines: [{ loanId: db.ledger[0]!.id, quantity: 1, condition: 'GOOD' }] }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(ToolLoanService.checkIn({ actorId: 'u-1', lines: [{ loanId: 'nope', quantity: 1, condition: 'GOOD' }] }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
