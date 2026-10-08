// Unit tests for InventoryService — the heart of the system.
// We exercise the service by mocking @prisma/client with an in-memory fake
// that implements only the methods the service uses. This verifies ADR-002
// invariants end-to-end without needing a real database:
//   - receipts add to balance,
//   - issues check & decrement,
//   - transfers are atomic (both legs land, balance moves between locations),
//   - adjustments post signed quantities,
//   - balances are NEVER mutated directly by the service — only via the
//     recompute-balance helper inside the transaction.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// ─── In-memory fake ────────────────────────────────────────────────────────

type TxRow = {
  id: string;
  materialId: string;
  locationId: string;
  type: string;
  quantity: Prisma.Decimal;
  actorId: string;
  postedAt: Date;
  pairedWithId?: string | null;
  reversesId?: string | null;
  reasonCode?: string | null;
  reasonNote?: string | null;
  projectNumber?: string | null;
  recipientId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  actor?: { id: string; name: string };
  material?: { sku: string; name: string };
  location?: { name: string };
};

let trxRows: TxRow[] = [];
let balances = new Map<string, { materialId: string; locationId: string; quantity: Prisma.Decimal }>();
let idSeq = 0;
const users = new Map<string, { id: string; name: string; active: boolean }>([
  ['user-1', { id: 'user-1', name: 'Alice', active: true }],
  ['user-2', { id: 'user-2', name: 'Bob', active: true }],
  ['user-3', { id: 'user-3', name: 'Charlie', active: false }],
]);
// Recipients ("Issued To"); 'user-3' is the id older tests already used.
const recipients = new Map<string, { id: string; name: string; active: boolean }>([
  ['user-3', { id: 'user-3', name: 'Sabelo', active: true }],
  ['rcp-inactive', { id: 'rcp-inactive', name: 'Old forklift', active: false }],
]);
const projects = new Map<string, { projectNumber: string; active: boolean }>([
  ['AFRI-1325', { projectNumber: 'AFRI-1325', active: true }],
  ['P-42', { projectNumber: 'P-42', active: true }],
  ['OLD-1', { projectNumber: 'OLD-1', active: false }],
]);
const auditLog: Array<{ actorId: string; action: string; entityType: string; entityId: string; before: unknown; after: unknown }> = [];

function balKey(materialId: string, locationId: string) { return `${materialId}|${locationId}`; }

type GRStatus = 'DRAFT' | 'SUBMITTED' | 'POSTED';

interface GREntry {
  id: string;
  status: GRStatus;
  purchaseOrderId: string | null;
  lines: { materialId: string; locationId: string; quantity: Prisma.Decimal; purchaseOrderLineId: string | null }[];
}

interface POLineEntry {
  id: string;
  purchaseOrderId: string;
  materialId: string;
  orderedQty: Prisma.Decimal;
  receivedQty: Prisma.Decimal;
}

interface POEntry {
  id: string;
  status: string;
}

const goodsReceipts = new Map<string, GREntry>();
const purchaseOrderLines = new Map<string, POLineEntry>();
const purchaseOrders = new Map<string, POEntry>();

const fakeTx = {
  inventoryTransaction: {
    create: async ({ data }: { data: Omit<TxRow, 'id'> }) => {
      const row: TxRow = { id: `trx-${++idSeq}`, ...data, postedAt: data.postedAt ?? new Date() };
      trxRows.push(row);
      return row;
    },
    update: async ({ where, data, include }: { where: { id: string }; data: Partial<TxRow>; include?: { actor: { select: { id: boolean; name: boolean } }; material?: boolean; location?: boolean } }) => {
      const row = trxRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      if (include?.actor && data.actorId) {
        const u = users.get(data.actorId);
        row.actor = u ? { id: u.id, name: u.name } : undefined;
      }
      if (include?.material) {
        row.material = { sku: 'SKU', name: 'Material' } as TxRow['material'];
      }
      if (include?.location) {
        row.location = { name: 'Location' } as TxRow['location'];
      }
      return row;
    },
    findUnique: async ({ where, include }: { 
      where: { id: string }; 
      include?: {
        actor?: { select: { id: boolean; name: boolean } };
        material?: boolean;
        location?: boolean;
        reversedBy?: { select: { id: boolean } };
      }
    }): Promise<TxRow | null> => {
      const row = trxRows.find((r) => r.id === where.id) ?? null;
      if (!row) return null;
      const out: TxRow & { actor?: { id: string; name: string }; material?: { sku: string; name: string }; location?: { name: string }; reversedBy?: { id: string } | null } = { ...row };
      if (include?.reversedBy) {
        const rev = trxRows.find((r) => r.reversesId === row.id);
        out.reversedBy = rev ? { id: rev.id } : null;
      }
      if (include?.actor) {
        const u = users.get(row.actorId);
        out.actor = u ? { id: u.id, name: u.name } : undefined;
      }
      if (include?.material) {
        out.material = { sku: 'SKU', name: 'Material' };
      }
      if (include?.location) {
        out.location = { name: 'Location' };
      }
      return out as TxRow;
    },
    aggregate: async ({ where }: { where: { materialId: string; locationId: string } }) => {
      const total = trxRows
        .filter((r) => r.materialId === where.materialId && r.locationId === where.locationId)
        .reduce((acc, r) => acc.plus(r.quantity), new Prisma.Decimal(0));
      return { _sum: { quantity: total } };
    },
  },
  inventoryBalance: {
    findUnique: async ({ where }: { where: { materialId_locationId: { materialId: string; locationId: string } } }) => {
      const key = balKey(where.materialId_locationId.materialId, where.materialId_locationId.locationId);
      return balances.get(key) ?? null;
    },
    upsert: async ({ where, update, create }: { where: { materialId_locationId: { materialId: string; locationId: string } }; update: { quantity: Prisma.Decimal }; create: { materialId: string; locationId: string; quantity: Prisma.Decimal } }) => {
      const key = balKey(where.materialId_locationId.materialId, where.materialId_locationId.locationId);
      const existing = balances.get(key);
      if (existing) existing.quantity = update.quantity;
      else balances.set(key, { materialId: create.materialId, locationId: create.locationId, quantity: create.quantity });
      return existing ?? balances.get(key);
    },
  },
  material: {
    findUnique: async () => ({ id: 'mat-1', requiredStock: new Prisma.Decimal(5), active: true }),
  },
  location: {
    findUnique: async () => ({ id: 'loc-1', active: true }),
  },
  recipient: {
    findUnique: async ({ where }: { where: { id: string } }) => recipients.get(where.id) ?? null,
  },
  project: {
    findUnique: async ({ where }: { where: { projectNumber: string } }) => projects.get(where.projectNumber) ?? null,
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const u = users.get(where.id);
      if (!u) return null;
      return { id: u.id, name: u.name, active: u.active };
    },
  },
  auditLogEntry: {
    create: async ({ data }: { data: { actorId: string; action: string; entityType: string; entityId: string; before: unknown; after: unknown } }) => {
      auditLog.push(data);
      return data;
    },
  },
  setting: {
    findUnique: async ({ where }: { where: { key: string } }) => mockSettings.get(where.key) ?? null,
  },
  goodsReceipt: {
    findUnique: async ({ where, include }: { where: { id: string }; include?: { lines?: boolean } }) => {
      const gr = goodsReceipts.get(where.id);
      if (!gr) return null;
      if (include?.lines) return gr;
      return { id: gr.id, status: gr.status, purchaseOrderId: gr.purchaseOrderId } as GREntry;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<GREntry> }) => {
      const gr = goodsReceipts.get(where.id);
      if (!gr) throw new Error('not found');
      Object.assign(gr, data);
      return gr;
    },
  },
  purchaseOrderLine: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      return purchaseOrderLines.get(where.id) ?? null;
    },
    update: async ({ where, data }: { where: { id: string }; data: { receivedQty: { increment: Prisma.Decimal } } }) => {
      const existing = purchaseOrderLines.get(where.id);
      if (!existing) throw new Error('not found');
      existing.receivedQty = existing.receivedQty.plus(data.receivedQty.increment);
      return existing;
    },
    findMany: async ({ where }: { where: { purchaseOrderId: string } }) => {
      return [...purchaseOrderLines.values()].filter((l) => l.purchaseOrderId === where.purchaseOrderId);
    },
  },
  purchaseOrder: {
    findUnique: async ({ where }: { where: { id: string } }) => purchaseOrders.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<POEntry> }) => {
      const po = purchaseOrders.get(where.id);
      if (!po) throw new Error('not found');
      Object.assign(po, data);
      return po;
    },
  },
};

// Mutable per-test settings override. Production code reads from the
// settings table; tests set values here to assert that toggles flow through.
const mockSettings = new Map<string, { value: unknown }>();
function setMockSetting(key: string, value: unknown) {
  mockSettings.set(key, { value });
}
function clearMockSettings() { mockSettings.clear(); }

vi.mock('../../shared/db.js', () => ({
  prisma: {
    $transaction: async (fn: (tx: typeof fakeTx) => Promise<unknown>) => fn(fakeTx),
    setting: fakeTx.setting,
    user: fakeTx.user,
    inventoryTransaction: fakeTx.inventoryTransaction,
    auditLogEntry: fakeTx.auditLogEntry,
  },
}));

vi.mock('../../shared/events.js', () => ({
  dispatchDomainEvents: async () => undefined,
}));

const { InventoryService } = await import('./inventory.service.js');

// Most tests issue one line; this keeps them short. 'user-3' is an active recipient.
async function issueOne(input: {
  materialId: string; locationId: string; quantity: number | string; actorId: string; recipientId?: string; projectNumber?: string;
}): Promise<{ transactionId: string }> {
  const { transactionIds } = await InventoryService.issue({
    recipientId: input.recipientId ?? 'user-3',
    projectNumber: input.projectNumber,
    actorId: input.actorId,
    lines: [{ materialId: input.materialId, locationId: input.locationId, quantity: input.quantity }],
  });
  return { transactionId: transactionIds[0]! };
}

function getBalance(materialId: string, locationId: string): Prisma.Decimal {
  return balances.get(balKey(materialId, locationId))?.quantity ?? new Prisma.Decimal(0);
}

describe('InventoryService — ADR-002 invariants', () => {
  beforeEach(() => {
    trxRows = [];
    balances = new Map();
    clearMockSettings();
    idSeq = 0;
    auditLog.length = 0;
    goodsReceipts.clear();
    purchaseOrderLines.clear();
    purchaseOrders.clear();
  });

  it('a positive adjustment increases the balance', async () => {
    await InventoryService.adjust({
      materialId: 'mat-1',
      locationId: 'loc-1',
      quantity: 10,
      reasonCode: 'COUNT_VARIANCE',
      actorId: 'user-1',
    });
    expect(getBalance('mat-1', 'loc-1').toString()).toBe('10');
    expect(trxRows).toHaveLength(1);
    expect(trxRows[0]?.type).toBe('ADJUSTMENT');
  });

  it('a negative adjustment decreases the balance', async () => {
    await InventoryService.adjust({
      materialId: 'mat-1', locationId: 'loc-1', quantity: 12, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
    });
    await InventoryService.adjust({
      materialId: 'mat-1', locationId: 'loc-1', quantity: -3, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
    });
    expect(getBalance('mat-1', 'loc-1').toString()).toBe('9');
  });

  it('issue reduces balance and refuses to over-issue', async () => {
    await InventoryService.adjust({
      materialId: 'mat-1', locationId: 'loc-1', quantity: 5, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
    });
    await issueOne({
      materialId: 'mat-1', locationId: 'loc-1', quantity: 3, actorId: 'u',
    });
    expect(getBalance('mat-1', 'loc-1').toString()).toBe('2');
    await expect(
      issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 100, actorId: 'u' }),
    ).rejects.toThrow(/available/);
  });

  it('transfer moves stock atomically: out & in both land, paired together', async () => {
    await InventoryService.adjust({
      materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
    });
    await InventoryService.transfer({
      materialId: 'mat-1',
      fromLocationId: 'loc-1',
      toLocationId: 'loc-2',
      quantity: 4,
      actorId: 'u',
    });
    expect(getBalance('mat-1', 'loc-1').toString()).toBe('6');
    expect(getBalance('mat-1', 'loc-2').toString()).toBe('4');

    const out = trxRows.find((r) => r.type === 'TRANSFER_OUT');
    const inn = trxRows.find((r) => r.type === 'TRANSFER_IN');
    expect(out).toBeDefined();
    expect(inn).toBeDefined();
    expect(out!.pairedWithId).toBe(inn!.id);
    expect(inn!.pairedWithId).toBe(out!.id);
  });

  it('transfer refuses to over-transfer', async () => {
    await InventoryService.adjust({
      materialId: 'mat-1', locationId: 'loc-1', quantity: 3, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
    });
    await expect(
      InventoryService.transfer({
        materialId: 'mat-1', fromLocationId: 'loc-1', toLocationId: 'loc-2', quantity: 10, actorId: 'u',
      }),
    ).rejects.toThrow(/available/);
  });

  it('transfer refuses same source and destination', async () => {
    await expect(
      InventoryService.transfer({
        materialId: 'mat-1', fromLocationId: 'loc-1', toLocationId: 'loc-1', quantity: 1, actorId: 'u',
      }),
    ).rejects.toThrow(/differ/);
  });

  it('rejects zero-quantity issues and adjustments', async () => {
    await expect(
      issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 0, actorId: 'u' }),
    ).rejects.toThrow();
    await expect(
      InventoryService.adjust({ materialId: 'mat-1', locationId: 'loc-1', quantity: 0, reasonCode: 'OTHER', actorId: 'u' }),
    ).rejects.toThrow();
  });

  // ── No negative stock ────────────────────────────────────────────────
  // A fixed rule, not a setting. A leftover row from the retired
  // inventory.enableNegativeStockPrevention setting must not switch it off.
  describe('no negative stock', () => {
    beforeEach(() => {
      setMockSetting('inventory.enableNegativeStockPrevention', false);
    });

    it('refuses an issue larger than the balance', async () => {
      await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 2, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      await expect(
        issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 5, actorId: 'u' }),
      ).rejects.toThrow(/only 2 available/);
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('2');
    });

    it('refuses a negative adjustment larger than the balance', async () => {
      await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 2, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      await expect(
        InventoryService.adjust({ materialId: 'mat-1', locationId: 'loc-1', quantity: -3, reasonCode: 'LOSS', actorId: 'u' }),
      ).rejects.toThrow(/only 2 available/);
      expect(trxRows).toHaveLength(1);
    });

    it.each(['issue', 'adjust'] as const)('%s enforces fractional stock boundaries with the retired toggle disabled', async (operation) => {
      await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: '0.125', reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      const take = (quantity: string) => operation === 'issue'
        ? issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity, actorId: 'u' })
        : InventoryService.adjust({ materialId: 'mat-1', locationId: 'loc-1', quantity: `-${quantity}`, reasonCode: 'LOSS', actorId: 'u' });
      await expect(take('0.126')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      expect(trxRows).toHaveLength(1);
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('0.125');
      await take('0.125');
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('0');
      await expect(take('0.001')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      expect(trxRows).toHaveLength(2);
    });

    it('allows taking the balance to exactly zero', async () => {
      await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 2, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      await issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 2, actorId: 'u' });
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('0');
    });
  });

  // ── Issued To ─────────────────────────────────────────────────────────
  describe('issue recipient', () => {
    it('records who received the stock', async () => {
      await InventoryService.adjust({ materialId: 'mat-1', locationId: 'loc-1', quantity: 5, reasonCode: 'COUNT_VARIANCE', actorId: 'u' });
      await issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 2, actorId: 'u', recipientId: 'user-3' });
      expect(trxRows.at(-1)).toMatchObject({ type: 'ISSUE', recipientId: 'user-3' });
    });

    it('refuses an unknown recipient', async () => {
      await InventoryService.adjust({ materialId: 'mat-1', locationId: 'loc-1', quantity: 5, reasonCode: 'COUNT_VARIANCE', actorId: 'u' });
      await expect(
        issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 2, actorId: 'u', recipientId: 'nobody' }),
      ).rejects.toThrow(/Recipient not found/);
      expect(trxRows).toHaveLength(1);
    });

    it('refuses an inactive recipient', async () => {
      await InventoryService.adjust({ materialId: 'mat-1', locationId: 'loc-1', quantity: 5, reasonCode: 'COUNT_VARIANCE', actorId: 'u' });
      await expect(
        issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 2, actorId: 'u', recipientId: 'rcp-inactive' }),
      ).rejects.toThrow(/inactive/);
    });
  });

  // ── Issuing several items at once ─────────────────────────────────────
  describe('issue with several lines', () => {
    async function stock(qty: number, locationId = 'loc-1') {
      await InventoryService.adjust({ materialId: 'mat-1', locationId, quantity: qty, reasonCode: 'COUNT_VARIANCE', actorId: 'u' });
    }

    it('books every line for one recipient and project', async () => {
      await stock(10);
      await stock(4, 'loc-2');
      const { transactionIds } = await InventoryService.issue({
        recipientId: 'user-3', projectNumber: 'AFRI-1325', actorId: 'u',
        lines: [
          { materialId: 'mat-1', locationId: 'loc-1', quantity: 3 },
          { materialId: 'mat-1', locationId: 'loc-2', quantity: 4 },
        ],
      });
      expect(transactionIds).toHaveLength(2);
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('7');
      expect(getBalance('mat-1', 'loc-2').toString()).toBe('0');
      for (const id of transactionIds) {
        expect(trxRows.find((r) => r.id === id)).toMatchObject({ type: 'ISSUE', recipientId: 'user-3', projectNumber: 'AFRI-1325' });
      }
    });

    it('checks two lines for the same item as one total, and books nothing if it is short', async () => {
      await stock(5);
      await expect(InventoryService.issue({
        recipientId: 'user-3', actorId: 'u',
        lines: [
          { materialId: 'mat-1', locationId: 'loc-1', quantity: 3 },
          { materialId: 'mat-1', locationId: 'loc-1', quantity: 3 },
        ],
      })).rejects.toThrow(/Cannot issue 6 .*only 5 available/);
      expect(trxRows).toHaveLength(1);
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('5');
    });

    it('requires a recipient and at least one line', async () => {
      await expect(InventoryService.issue({ recipientId: '', actorId: 'u', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] }))
        .rejects.toThrow(/Choose who the stock is issued to/);
      await expect(InventoryService.issue({ recipientId: 'user-3', actorId: 'u', lines: [] }))
        .rejects.toThrow(/at least one item/);
    });

    it('refuses an unknown or inactive project', async () => {
      await stock(5);
      await expect(issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 1, actorId: 'u', projectNumber: 'NOPE' }))
        .rejects.toThrow(/Project not found/);
      await expect(issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 1, actorId: 'u', projectNumber: 'OLD-1' }))
        .rejects.toThrow(/Project is inactive/);
      expect(trxRows).toHaveLength(1);
    });
  });

  // ── Reversal ──────────────────────────────────────────────────────────
  describe('reverse', () => {
    afterEach(() => vi.restoreAllMocks());

    it.each(['outTransactionId', 'inTransactionId'] as const)(
      'checks destination stock before writing either leg when reversing %s', async (selectedLeg) => {
        await InventoryService.adjust({
          materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
        });
        const transfer = await InventoryService.transfer({
          materialId: 'mat-1', fromLocationId: 'loc-1', toLocationId: 'loc-2', quantity: 6, actorId: 'u',
        });
        await issueOne({ materialId: 'mat-1', locationId: 'loc-2', quantity: 1, actorId: 'u' });
        const rowsBefore = trxRows.map((row) => ({ ...row }));
        const auditBefore = [...auditLog];

        await expect(InventoryService.reverse({
          transactionId: transfer[selectedLeg], reason: 'Wrong destination', actorId: 'user-2',
        })).rejects.toMatchObject({
          code: 'INSUFFICIENT_BALANCE',
          details: { materialId: 'mat-1', locationId: 'loc-2', requested: '6', available: '5' },
        });

        expect(trxRows).toEqual(rowsBefore);
        expect(auditLog).toEqual(auditBefore);
        expect(getBalance('mat-1', 'loc-1').toString()).toBe('4');
        expect(getBalance('mat-1', 'loc-2').toString()).toBe('5');
      },
    );

    it('rejects a transfer with a missing partner before recording a reversal', async () => {
      trxRows.push({
        id: 'out', materialId: 'mat-1', locationId: 'loc-1', type: 'TRANSFER_OUT',
        quantity: new Prisma.Decimal(-2), actorId: 'u', postedAt: new Date(), pairedWithId: 'missing',
      });
      await expect(InventoryService.reverse({
        transactionId: 'out', reason: 'Wrong destination', actorId: 'user-2',
      })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(trxRows).toHaveLength(1);
      expect(auditLog).toEqual([]);
    });

    it('rejects a transfer when only its partner has already been reversed', async () => {
      await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      const { outTransactionId, inTransactionId } = await InventoryService.transfer({
        materialId: 'mat-1', fromLocationId: 'loc-1', toLocationId: 'loc-2', quantity: 6, actorId: 'u',
      });
      trxRows.push({
        ...trxRows.find((row) => row.id === inTransactionId)!,
        id: 'existing-reversal', reversesId: inTransactionId, quantity: new Prisma.Decimal(-6),
      });
      const rowsBefore = trxRows.map((row) => ({ ...row }));
      const auditBefore = [...auditLog];
      await expect(InventoryService.reverse({
        transactionId: outTransactionId, reason: 'Wrong destination', actorId: 'user-2',
      })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(trxRows).toEqual(rowsBefore);
      expect(auditLog).toEqual(auditBefore);
    });

    it('preserves issue metadata and records a trimmed reason in the ledger and audit', async () => {
      await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: '0.125', reasonCode: 'COUNT_VARIANCE', actorId: 'user-1',
      });
      const { transactionId } = await issueOne({
        materialId: 'mat-1', locationId: 'loc-1', quantity: '0.125', actorId: 'user-1',
        recipientId: 'user-3', projectNumber: 'P-42',
      });
      const original = { ...trxRows.find((row) => row.id === transactionId)! };
      const { reversalIds } = await InventoryService.reverse({
        transactionId, reason: '  Wrong project  ', actorId: 'user-2',
      });
      expect(reversalIds).toHaveLength(1);
      expect(trxRows.find((row) => row.id === reversalIds[0])).toMatchObject({
        type: 'ISSUE', materialId: 'mat-1', locationId: 'loc-1', actorId: 'user-2',
        recipientId: 'user-3', projectNumber: 'P-42', reasonNote: 'Wrong project', reversesId: transactionId,
      });
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('0.125');
      expect(trxRows.find((row) => row.id === transactionId)).toEqual(original);
      expect(auditLog.at(-1)).toMatchObject({
        action: 'REVERSE', entityType: 'InventoryTransaction', entityId: transactionId,
        actorId: 'user-2', after: { reversalIds, reason: 'Wrong project' },
      });
    });

    it.each(['P2002', 'P2028'])( 'handles database error %s without writing a reversal', async (code) => {
      const { transactionId } = await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 2, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      const failure = new Prisma.PrismaClientKnownRequestError('Database failure', { code, clientVersion: '5.22.0' });
      vi.spyOn(fakeTx.inventoryTransaction, 'create').mockRejectedValueOnce(failure);
      const auditBefore = [...auditLog];
      const result = InventoryService.reverse({ transactionId, reason: 'Duplicate count', actorId: 'user-2' });
      if (code === 'P2002') {
        await expect(result).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
      } else {
        await expect(result).rejects.toBe(failure);
      }
      expect(trxRows).toHaveLength(1);
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('2');
      expect(auditLog).toEqual(auditBefore);
    });

    it('posts an opposite entry of the same type and restores the balance', async () => {
      await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'user-1',
      });
      const { transactionId } = await issueOne({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 4, actorId: 'user-1', projectNumber: 'AFRI-1325',
      });

      const { reversalIds } = await InventoryService.reverse({ transactionId, reason: 'Wrong item scanned', actorId: 'user-2' });

      expect(getBalance('mat-1', 'loc-1').toString()).toBe('10');
      const reversal = trxRows.find((r) => r.id === reversalIds[0])!;
      expect(reversal).toMatchObject({
        type: 'ISSUE',
        reversesId: transactionId,
        actorId: 'user-2',
        reasonNote: 'Wrong item scanned',
        projectNumber: 'AFRI-1325',
      });
      expect(reversal.quantity.toString()).toBe('4');
      expect(auditLog.at(-1)).toMatchObject({ action: 'REVERSE', entityId: transactionId, actorId: 'user-2' });
    });

    it('never changes the original transaction', async () => {
      const { transactionId } = await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'user-1',
      });
      const before = { ...trxRows.find((r) => r.id === transactionId)! };
      await InventoryService.reverse({ transactionId, reason: 'Counted twice', actorId: 'user-2' });
      expect(trxRows.find((r) => r.id === transactionId)).toEqual(before);
    });

    it.each(['outTransactionId', 'inTransactionId'] as const)('reverses both transfer legs starting from %s', async (selectedLeg) => {
      await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      const transfer = await InventoryService.transfer({
        materialId: 'mat-1', fromLocationId: 'loc-1', toLocationId: 'loc-2', quantity: 6, actorId: 'u',
      });

      const { reversalIds } = await InventoryService.reverse({ transactionId: transfer[selectedLeg], reason: 'Wrong rack', actorId: 'u' });

      expect(reversalIds).toHaveLength(2);
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('10');
      expect(getBalance('mat-1', 'loc-2').toString()).toBe('0');
      const [out, inn] = reversalIds.map((id) => trxRows.find((r) => r.id === id)!);
      expect(out!.type).toBe('TRANSFER_OUT');
      expect(inn!.type).toBe('TRANSFER_IN');
      expect(out!.pairedWithId).toBe(inn!.id);
      expect(inn!.pairedWithId).toBe(out!.id);
      expect(out!.reversesId).toBe(transfer.outTransactionId);
      expect(inn!.reversesId).toBe(transfer.inTransactionId);
      expect(out!.quantity.toString()).toBe('6');
      expect(inn!.quantity.toString()).toBe('-6');
    });

    it('refuses to reverse a movement twice', async () => {
      const { transactionId } = await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      await InventoryService.reverse({ transactionId, reason: 'Counted twice', actorId: 'u' });
      await expect(
        InventoryService.reverse({ transactionId, reason: 'Again', actorId: 'u' }),
      ).rejects.toThrow(/already been reversed/);
    });

    it('refuses to reverse a reversal', async () => {
      const { transactionId } = await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      const { reversalIds } = await InventoryService.reverse({ transactionId, reason: 'Counted twice', actorId: 'u' });
      await expect(
        InventoryService.reverse({ transactionId: reversalIds[0]!, reason: 'Undo', actorId: 'u' }),
      ).rejects.toThrow(/cannot itself be reversed/);
    });

    it('refuses to reverse stock received against a purchase order', async () => {
      goodsReceipts.set('gr-1', { id: 'gr-1', status: 'POSTED', purchaseOrderId: 'po-1', lines: [] });
      trxRows.push({
        id: 'gr-trx', materialId: 'mat-1', locationId: 'loc-1', type: 'RECEIPT', quantity: new Prisma.Decimal(5),
        actorId: 'u', postedAt: new Date(), referenceType: 'GoodsReceipt', referenceId: 'gr-1',
      });
      await expect(
        InventoryService.reverse({ transactionId: 'gr-trx', reason: 'Wrong supplier', actorId: 'u' }),
      ).rejects.toThrow(/purchase order/);
    });

    it('reverses stock received at the counter (no purchase order)', async () => {
      goodsReceipts.set('gr-2', { id: 'gr-2', status: 'POSTED', purchaseOrderId: null, lines: [] });
      trxRows.push({
        id: 'counter-trx', materialId: 'mat-1', locationId: 'loc-1', type: 'RECEIPT', quantity: new Prisma.Decimal(5),
        actorId: 'u', postedAt: new Date(), referenceType: 'GoodsReceipt', referenceId: 'gr-2',
      });
      balances.set('mat-1|loc-1', { materialId: 'mat-1', locationId: 'loc-1', quantity: new Prisma.Decimal(5) });
      const { reversalIds } = await InventoryService.reverse({ transactionId: 'counter-trx', reason: 'Booked twice', actorId: 'u' });
      expect(trxRows.find((r) => r.id === reversalIds[0])).toMatchObject({ type: 'RECEIPT', referenceId: 'gr-2', reversesId: 'counter-trx' });
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('0');
    });

    it('refuses when the stock has already been used', async () => {
      const { transactionId } = await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      await issueOne({ materialId: 'mat-1', locationId: 'loc-1', quantity: 8, actorId: 'u' });
      await expect(
        InventoryService.reverse({ transactionId, reason: 'Counted twice', actorId: 'u' }),
      ).rejects.toThrow(/still in stock/);
      expect(getBalance('mat-1', 'loc-1').toString()).toBe('2');
    });

    it('requires a reason', async () => {
      const { transactionId } = await InventoryService.adjust({
        materialId: 'mat-1', locationId: 'loc-1', quantity: 10, reasonCode: 'COUNT_VARIANCE', actorId: 'u',
      });
      await expect(
        InventoryService.reverse({ transactionId, reason: '   ', actorId: 'u' }),
      ).rejects.toThrow(/reason is required/);
    });

    it('rejects a transaction that does not exist', async () => {
      await expect(
        InventoryService.reverse({ transactionId: 'missing', reason: 'Typo', actorId: 'u' }),
      ).rejects.toThrow(/InventoryTransaction not found/);
    });
  });

  // ── postGoodsReceipt ───────────────────────────────────────────────────
  describe('postGoodsReceipt', () => {
    beforeEach(() => {
      goodsReceipts.clear();
      purchaseOrderLines.clear();
      purchaseOrders.clear();
    });

    it('posts a SUBMITTED receipt, creates RECEIPT transactions, and sets status to POSTED', async () => {
      goodsReceipts.set('gr-1', {
        id: 'gr-1',
        status: 'SUBMITTED',
        purchaseOrderId: null,
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(10), purchaseOrderLineId: null }],
      });

      await InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' });

      const receipt = trxRows.find((r) => r.type === 'RECEIPT');
      expect(receipt).toBeDefined();
      expect(receipt!.materialId).toBe('m-1');
      expect(receipt!.locationId).toBe('l-1');
      expect(receipt!.quantity.toString()).toBe('10');
      expect(receipt!.referenceType).toBe('GoodsReceipt');
      expect(receipt!.referenceId).toBe('gr-1');
      expect(receipt!.actorId).toBe('user-1');

      const gr = goodsReceipts.get('gr-1');
      expect(gr?.status).toBe('POSTED');
    });

    it('throws when goods receipt is not found', async () => {
      await expect(
        InventoryService.postGoodsReceipt({ goodsReceiptId: 'missing', actorId: 'user-1' }),
      ).rejects.toThrow(/GoodsReceipt not found/);
    });

    it('throws when status is DRAFT', async () => {
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'DRAFT', purchaseOrderId: null, lines: [],
      });
      await expect(
        InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' }),
      ).rejects.toThrow(/SUBMITTED before posting/);
    });

    it('throws when status is already POSTED', async () => {
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'POSTED', purchaseOrderId: null, lines: [],
      });
      await expect(
        InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' }),
      ).rejects.toThrow(/already posted/);
    });

    it('updates linked PO line receivedQty when PO line is referenced', async () => {
      purchaseOrderLines.set('pol-1', {
        id: 'pol-1', purchaseOrderId: 'po-1', materialId: 'm-1',
        orderedQty: new Prisma.Decimal(10), receivedQty: new Prisma.Decimal(2),
      });
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: 'po-1',
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(3), purchaseOrderLineId: 'pol-1' }],
      });
      purchaseOrders.set('po-1', { id: 'po-1', status: 'APPROVED' });

      await InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' });

      const poLine = purchaseOrderLines.get('pol-1');
      expect(poLine?.receivedQty.toString()).toBe('5');
    });

    it('throws when receiving more than the ordered quantity on a PO line', async () => {
      purchaseOrderLines.set('pol-1', {
        id: 'pol-1', purchaseOrderId: 'po-1', materialId: 'm-1',
        orderedQty: new Prisma.Decimal(3), receivedQty: new Prisma.Decimal(2),
      });
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: 'po-1',
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(5), purchaseOrderLineId: 'pol-1' }],
      });

      await expect(
        InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' }),
      ).rejects.toThrow(/exceed the ordered quantity/);
    });

    it('skips PO line check when purchaseOrderLineId is null but line is valid', async () => {
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: null,
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(10), purchaseOrderLineId: null }],
      });

      await InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' });

      expect(trxRows.filter((r) => r.type === 'RECEIPT')).toHaveLength(1);
      expect(goodsReceipts.get('gr-1')?.status).toBe('POSTED');
    });

    it('skips PO line check gracefully when the PO line is missing from DB', async () => {
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: 'po-1',
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(3), purchaseOrderLineId: 'pol-missing' }],
      });
      purchaseOrders.set('po-1', { id: 'po-1', status: 'APPROVED' });

      await InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' });

      expect(trxRows.filter((r) => r.type === 'RECEIPT')).toHaveLength(1);
    });

    it.each(['CANCELLED', 'CLOSED', 'DRAFT'])('refuses to post against a purchase order that is now %s', async (status) => {
      purchaseOrderLines.set('pol-1', {
        id: 'pol-1', purchaseOrderId: 'po-1', materialId: 'm-1',
        orderedQty: new Prisma.Decimal(3), receivedQty: new Prisma.Decimal(0),
      });
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: 'po-1',
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(3), purchaseOrderLineId: 'pol-1' }],
      });
      purchaseOrders.set('po-1', { id: 'po-1', status });

      await expect(
        InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' }),
      ).rejects.toThrow(new RegExp(`status ${status}`));
      expect(trxRows).toHaveLength(0);
      expect(goodsReceipts.get('gr-1')?.status).toBe('SUBMITTED');
    });

    it('transitions PO to RECEIVED when all lines are fully received', async () => {
      purchaseOrderLines.set('pol-1', {
        id: 'pol-1', purchaseOrderId: 'po-1', materialId: 'm-1',
        orderedQty: new Prisma.Decimal(3), receivedQty: new Prisma.Decimal(0),
      });
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: 'po-1',
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(3), purchaseOrderLineId: 'pol-1' }],
      });
      purchaseOrders.set('po-1', { id: 'po-1', status: 'APPROVED' });

      await InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' });

      expect(purchaseOrders.get('po-1')?.status).toBe('RECEIVED');
    });

    it('transitions PO to PARTIALLY_RECEIVED when not all lines are fully received', async () => {
      purchaseOrderLines.set('pol-1', {
        id: 'pol-1', purchaseOrderId: 'po-1', materialId: 'm-1',
        orderedQty: new Prisma.Decimal(10), receivedQty: new Prisma.Decimal(0),
      });
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: 'po-1',
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(5), purchaseOrderLineId: 'pol-1' }],
      });
      purchaseOrders.set('po-1', { id: 'po-1', status: 'APPROVED' });

      await InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' });

      const poLine = purchaseOrderLines.get('pol-1');
      expect(poLine?.receivedQty.toString()).toBe('5');
      expect(purchaseOrders.get('po-1')?.status).toBe('PARTIALLY_RECEIVED');
    });

    it('does not transition PO status when purchaseOrderId is null', async () => {
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: null,
        lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(5), purchaseOrderLineId: null }],
      });

      await InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' });

      expect(goodsReceipts.get('gr-1')?.status).toBe('POSTED');
    });

    it('posts multiple lines in a single receipt', async () => {
      goodsReceipts.set('gr-1', {
        id: 'gr-1', status: 'SUBMITTED', purchaseOrderId: null,
        lines: [
          { materialId: 'm-1', locationId: 'l-1', quantity: new Prisma.Decimal(10), purchaseOrderLineId: null },
          { materialId: 'm-2', locationId: 'l-2', quantity: new Prisma.Decimal(20), purchaseOrderLineId: null },
        ],
      });

      await InventoryService.postGoodsReceipt({ goodsReceiptId: 'gr-1', actorId: 'user-1' });

      expect(trxRows.filter((r) => r.type === 'RECEIPT')).toHaveLength(2);
    });
  });
});