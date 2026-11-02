// Tool check-out and check-in, on a small in-memory ledger: a loan takes the
// tool off the shelf, a check-in brings it back, and a lost tool is written off.
// Each loan is due back on a date, can be extended, and someone with an
// overdue tool is lent more only with a reason.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

type Row = {
  id: string; materialId: string; locationId: string; type: string; quantity: Prisma.Decimal;
  issueId?: string | null; recipientId?: string | null; projectNumber?: string | null; reasonCode?: string | null;
  reasonNote?: string | null; referenceType?: string | null; referenceId?: string | null; actorId: string; postedAt: Date;
  dueOn?: Date | null;
};
type Extension = { id: string; loanId: string; dueOn: Date; reason: string; actorId: string; createdAt: Date };

const db = vi.hoisted(() => ({
  ledger: [] as Row[],
  extensions: [] as Extension[],
  locks: [] as string[],
  audit: [] as Array<{ action: string; before?: unknown; after?: unknown }>,
  settings: {} as Record<string, unknown>,
  projectEnd: null as string | null,
  materials: [
    { id: 'm-drill', sku: 'TL-0001', name: 'Makita Hand Drill', category: 'TOOLS', unitOfMeasure: 'each', serialNumber: '34322', active: true },
    { id: 'm-scraper', sku: 'TL-0002', name: 'Scraper', category: 'TOOLS', unitOfMeasure: 'each', serialNumber: null, active: true },
    { id: 'm-disc', sku: 'CON-0001', name: 'Grinding disc', category: 'CONSUMABLES', unitOfMeasure: 'each', serialNumber: null, active: true },
  ],
}));
let seq = 0;
const D = (n: number | string) => new Prisma.Decimal(n);
const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
const balance = (materialId: string, locationId: string) =>
  db.ledger.filter((r) => r.materialId === materialId && r.locationId === locationId).reduce((a, r) => a.plus(r.quantity), D(0));

const names: Record<string, string> = { 'l-store': 'Main Storeroom', 'r-sabelo': 'Sabelo', 'r-bukho': 'Bukho', 'u-1': 'Vusi' };
const types: Record<string, string> = { 'r-sabelo': 'WORKER', 'r-bukho': 'CONTRACTOR' };
const matches = (r: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
  const value = (r as unknown as Record<string, unknown>)[k];
  if (v && typeof v === 'object' && 'in' in (v as object)) return (v as { in: unknown[] }).in.includes(value);
  return value === v;
});
const project = () => ({ projectNumber: 'AFRI-1325', active: true, endDate: db.projectEnd ? new Date(`${db.projectEnd}T00:00:00Z`) : null });
const withRelations = (r: Row) => ({
  ...r,
  dueOn: r.dueOn ?? null,
  recipient: r.recipientId ? { name: names[r.recipientId] } : null,
  location: { name: names[r.locationId] },
  actor: { name: names[r.actorId] },
  material: { sku: db.materials.find((m) => m.id === r.materialId)!.sku, name: db.materials.find((m) => m.id === r.materialId)!.name },
  project: r.projectNumber ? project() : null,
  loanExtensions: db.extensions.filter((e) => e.loanId === r.id).map((e) => ({ ...e, actor: { name: names[e.actorId] } })),
});

const client = {
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, key: string) => { db.locks.push(key); return 0; }),
  material: {
    findUnique: async ({ where }: { where: { id: string } }) => db.materials.find((m) => m.id === where.id) ?? null,
    findMany: async ({ where }: { where: { category: string } }) => db.materials.filter((m) => m.category === where.category),
  },
  location: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'l-store' ? { id: 'l-store', active: true } : null) },
  recipient: {
    findUnique: async ({ where }: { where: { id: string } }) => (names[where.id] ? { id: where.id, active: true, name: names[where.id], type: types[where.id] } : null),
  },
  project: { findUnique: async () => project() },
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
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = db.ledger.find((r) => r.id === where.id);
      return row ? withRelations(row) : null;
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => db.ledger.filter((r) => matches(r, where)).map(withRelations),
    groupBy: async ({ where }: { where: Record<string, unknown> }) => {
      const sums = new Map<string, Prisma.Decimal>();
      for (const r of db.ledger.filter((x) => matches(x, where))) sums.set(r.referenceId!, (sums.get(r.referenceId!) ?? D(0)).plus(r.quantity));
      return [...sums].map(([referenceId, quantity]) => ({ referenceId, _sum: { quantity } }));
    },
  },
  toolLoanExtension: {
    create: async ({ data }: { data: Omit<Extension, 'id' | 'createdAt'> }) => {
      const row = { ...data, id: `ext-${++seq}`, createdAt: new Date() };
      db.extensions.push(row);
      return row;
    },
  },
  auditLogEntry: { create: async ({ data }: { data: { action: string } }) => { db.audit.push(data); return data; } },
};

vi.mock('../../shared/db.js', () => ({ prisma: { ...client, $transaction: async (fn: (t: typeof client) => unknown) => fn(client) } }));
vi.mock('../settings/settings.service.js', () => ({
  SettingsService: { getValues: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, db.settings[k]])) },
}));
vi.mock('../../shared/inventory/balances.js', () => ({
  getCurrentBalance: async (materialId: string, locationId: string) => balance(materialId, locationId),
  recomputeBalance: async () => undefined,
  lockInventoryBalances: async () => undefined,
}));

const { ToolLoanService } = await import('./tool-loan.service.js');

const receive = (materialId: string, quantity: number) =>
  db.ledger.push({ id: `tx-${++seq}`, materialId, locationId: 'l-store', type: 'RECEIPT', quantity: D(quantity), actorId: 'u-1', postedAt: new Date() });
const tool = async (materialId: string, now?: Date) => (await ToolLoanService.list(now)).find((t) => t.materialId === materialId)!;
/** A loan already on the books, out since `outDaysAgo` and due on `dueOn` (null: from before due dates). */
const pastLoan = (recipientId: string, outDaysAgo: number, dueOn: Date | null, materialId = 'm-scraper') => {
  const row: Row = {
    id: `tx-${++seq}`, materialId, locationId: 'l-store', type: 'LOAN', quantity: D(-1), actorId: 'u-1',
    recipientId, postedAt: daysFromNow(-outDaysAgo), dueOn: dueOn ? new Date(`${day(dueOn)}T00:00:00Z`) : null,
  };
  db.ledger.push(row);
  return row.id;
};
const lendScraper = (recipientId: string, extra: Record<string, unknown> = {}) => ToolLoanService.checkOut({
  recipientId, actorId: 'u-1', lines: [{ materialId: 'm-scraper', locationId: 'l-store', quantity: 1 }], ...extra,
});

beforeEach(() => {
  db.ledger.length = 0;
  db.extensions.length = 0;
  db.locks.length = 0;
  db.audit.length = 0;
  db.settings = {};
  db.projectEnd = null;
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
    const after = async (days: number) => (await tool('m-drill', daysFromNow(days))).loans[0]!;
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

describe('ToolLoanService due dates', () => {
  it('makes a loan due the default period after check-out, and moves it through its states as the days pass', async () => {
    const { dueOn } = await lendScraper('r-sabelo');
    expect(dueOn).toBe(day(daysFromNow(7)));
    expect(db.ledger.find((r) => r.type === 'LOAN')!.dueOn!.toISOString().slice(0, 10)).toBe(dueOn);
    expect(db.audit[0]).toMatchObject({ after: expect.objectContaining({ dueOn }) });

    const on = async (days: number) => (await tool('m-scraper', daysFromNow(days))).loans[0]!;
    expect(await on(0)).toMatchObject({ dueOn, daysLate: -7, state: 'ON_LOAN', overdue: false, extensions: [] });
    expect(await on(6)).toMatchObject({ daysLate: -1, state: 'DUE_SOON', overdue: false });
    expect(await on(7)).toMatchObject({ daysLate: 0, state: 'DUE_SOON', overdue: false });
    expect(await on(8)).toMatchObject({ daysLate: 1, state: 'OVERDUE', overdue: true });
    expect(await on(21)).toMatchObject({ daysLate: 14, state: 'NEEDS_DECISION', overdue: true });
  });

  it('follows the settings for the loan period and when a loan needs a decision', async () => {
    db.settings = { 'inventory.toolOverdueDays': 2, 'inventory.toolEscalateDays': 3 };
    const { dueOn } = await lendScraper('r-sabelo');
    expect(dueOn).toBe(day(daysFromNow(2)));
    expect(await tool('m-scraper', daysFromNow(5))).toMatchObject({ loans: [expect.objectContaining({ daysLate: 3, state: 'NEEDS_DECISION' })] });
  });

  it('holds the due date to the project end date, and refuses one past it', async () => {
    db.projectEnd = day(daysFromNow(3));
    expect((await lendScraper('r-sabelo', { projectNumber: 'AFRI-1325' })).dueOn).toBe(db.projectEnd);
    await expect(lendScraper('r-sabelo', { projectNumber: 'AFRI-1325', dueOn: day(daysFromNow(5)) }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining(`Project AFRI-1325 ends on ${db.projectEnd}`) });
  });

  it('takes a chosen due date from today up to the longest loan, and only an administrator past it', async () => {
    expect((await lendScraper('r-sabelo', { dueOn: day(daysFromNow(30)) })).dueOn).toBe(day(daysFromNow(30)));
    await expect(lendScraper('r-sabelo', { dueOn: day(daysFromNow(-1)) })).rejects.toMatchObject({ message: 'The due date cannot be before today.' });
    await expect(lendScraper('r-sabelo', { dueOn: day(daysFromNow(31)) })).rejects.toMatchObject({ message: expect.stringContaining('at most 30 days') });
    expect((await lendScraper('r-sabelo', { dueOn: day(daysFromNow(31)), canExceedMaxLoan: true })).dueOn).toBe(day(daysFromNow(31)));
  });

  it('gives a loan from before due dates the default period from when it went out', async () => {
    pastLoan('r-sabelo', 10, null);
    expect(await tool('m-scraper')).toMatchObject({ loans: [expect.objectContaining({ dueOn: day(daysFromNow(-3)), daysLate: 3, state: 'OVERDUE', overdue: true })] });
  });
});

describe('ToolLoanService lending to someone with an overdue tool', () => {
  it('asks for a reason, names the overdue tools, and records the reason with the check-out', async () => {
    const late = pastLoan('r-sabelo', 12, daysFromNow(-5));
    await expect(lendScraper('r-sabelo')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Sabelo has 1 overdue tool: TL-0002 Scraper, 5 days late. Give a reason to lend more anyway.',
      details: { overrideReasonRequired: true, overdueLoans: [expect.objectContaining({ loanId: late, daysLate: 5 })] },
    });
    expect(db.ledger.filter((r) => r.type === 'LOAN')).toHaveLength(1);

    await lendScraper('r-sabelo', { overrideReason: '  Shutdown crew short of scrapers ' });
    expect(db.audit.at(-1)).toMatchObject({ after: expect.objectContaining({ overdueOverride: { reason: 'Shutdown crew short of scrapers', loanIds: [late] } }) });
  });

  it('lends freely to someone whose tools are due today or are all back', async () => {
    pastLoan('r-sabelo', 7, daysFromNow(0));
    const back = pastLoan('r-sabelo', 20, daysFromNow(-13));
    db.ledger.push({ id: 'ret', materialId: 'm-scraper', locationId: 'l-store', type: 'LOAN_RETURN', quantity: D(1), actorId: 'u-1', postedAt: new Date(), referenceType: 'ToolLoan', referenceId: back });
    await expect(lendScraper('r-sabelo')).resolves.toMatchObject({ loanIds: [expect.any(String)] });
  });

  it('refuses outright when the policy blocks it: everyone, or contractors only', async () => {
    pastLoan('r-sabelo', 12, daysFromNow(-5));
    pastLoan('r-bukho', 12, daysFromNow(-2));
    db.settings = { 'inventory.toolOverdueCheckout': 'block-contractors' };
    await expect(lendScraper('r-bukho', { overrideReason: 'Please' })).rejects.toMatchObject({
      code: 'INVALID_STATE', message: 'Bukho has 1 overdue tool: TL-0002 Scraper, 2 days late. Check it in or extend the loan before lending more.',
    });
    await expect(lendScraper('r-sabelo', { overrideReason: 'Short-handed' })).resolves.toBeDefined();
    db.settings = { 'inventory.toolOverdueCheckout': 'block' };
    await expect(lendScraper('r-sabelo', { overrideReason: 'Short-handed' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('ToolLoanService.extend', () => {
  it('gives a later due date with a reason, keeps the history, and clears the overdue flag', async () => {
    const loanId = pastLoan('r-sabelo', 10, daysFromNow(-3));
    const newDue = day(daysFromNow(4));
    const res = await ToolLoanService.extend({ loanId, dueOn: newDue, reason: ' Shutdown over-ran ', actorId: 'u-1' });
    expect(res).toEqual({ loanId, dueOn: newDue, extensionId: expect.any(String) });
    expect(db.locks).toContain(`afrinov:tool:loan:${loanId}`);
    expect(db.audit).toEqual([expect.objectContaining({
      action: 'TOOL_LOAN_EXTEND', before: { dueOn: day(daysFromNow(-3)) }, after: { dueOn: newDue, reason: 'Shutdown over-ran', extensionId: res.extensionId },
    })]);
    expect((await tool('m-scraper')).loans[0]).toMatchObject({
      dueOn: newDue, state: 'ON_LOAN', overdue: false,
      extensions: [{ dueOn: newDue, reason: 'Shutdown over-ran', extendedBy: 'Vusi', extendedAt: expect.any(String) }],
    });
    // The loan row keeps the date agreed at check-out.
    expect(day(db.ledger.find((r) => r.id === loanId)!.dueOn!)).toBe(day(daysFromNow(-3)));
  });

  it('refuses a date that is not later, is before today, or is past the longest loan', async () => {
    const loanId = pastLoan('r-sabelo', 10, daysFromNow(-3));
    const extend = (dueOn: string, canExceedMaxLoan = false) => ToolLoanService.extend({ loanId, dueOn, reason: 'Still needed', actorId: 'u-1', canExceedMaxLoan });
    await expect(extend(day(daysFromNow(-3)))).rejects.toMatchObject({ message: `The new due date must be after the current one, ${day(daysFromNow(-3))}.` });
    await expect(extend(day(daysFromNow(-1)))).rejects.toMatchObject({ message: 'The due date cannot be before today.' });
    // 30 days from when it went out, ten days ago.
    await expect(extend(day(daysFromNow(21)))).rejects.toMatchObject({ message: expect.stringContaining('at most 30 days') });
    await expect(extend(day(daysFromNow(21)), true)).resolves.toBeDefined();
    expect(db.extensions).toHaveLength(1);
  });

  it('refuses without a reason, and for anything but an open check-out', async () => {
    const loanId = pastLoan('r-sabelo', 2, daysFromNow(5));
    await expect(ToolLoanService.extend({ loanId, dueOn: day(daysFromNow(9)), reason: '  ', actorId: 'u-1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ToolLoanService.extend({ loanId: 'nope', dueOn: day(daysFromNow(9)), reason: 'x', actorId: 'u-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(ToolLoanService.extend({ loanId: db.ledger[0]!.id, dueOn: day(daysFromNow(9)), reason: 'x', actorId: 'u-1' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await ToolLoanService.checkIn({ actorId: 'u-1', lines: [{ loanId, quantity: 1, condition: 'GOOD' }] });
    await expect(ToolLoanService.extend({ loanId, dueOn: day(daysFromNow(9)), reason: 'x', actorId: 'u-1' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('all back') });
  });
});
