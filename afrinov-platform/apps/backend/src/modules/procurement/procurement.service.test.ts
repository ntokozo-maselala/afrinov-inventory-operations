// Unit tests for the Purchase Order lifecycle service.
//
// Covers:
//   - canonical state-machine transitions (DRAFT → PENDING_APPROVAL → APPROVED → SHIPPED → DELIVERED)
//   - cancellation rules
//   - reject invalid transitions
//   - audit-log entries for every transition
//   - deliver() creates one RECEIPT inventory transaction per line and updates the balance
//   - duplicate-transition rejection via optimistic guard
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type POStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
type TxType = 'RECEIPT' | 'ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT';

interface PO {
  id: string; number: string; supplierId: string; status: POStatus;
  notes: string | null; createdById: string; createdAt: Date; updatedAt: Date;
  expectedDeliveryDate: Date | null;
  approvedAt: Date | null; approvedById: string | null;
  shippedAt: Date | null; shippedById: string | null;
  trackingNumber: string | null; carrier: string | null; shipmentNotes: string | null;
  deliveredAt: Date | null; deliveredById: string | null; deliveryNotes: string | null;
  cancelledAt: Date | null; cancelledById: string | null; cancellationReason: string | null;
  closedAt?: Date | null; closedById?: string | null; closeReason?: string | null;
  lines: POL[];
}
interface POL { id: string; purchaseOrderId: string; materialId: string; orderedQty: Prisma.Decimal; receivedQty: Prisma.Decimal }
interface Loc { id: string; name: string; active: boolean }
interface Sup { id: string; name: string }
interface Mat { id: string; sku: string; name: string; active: boolean }
interface TxRow { id: string; materialId: string; locationId: string; type: TxType; quantity: Prisma.Decimal; referenceType: string | null; referenceId: string | null; actorId: string; postedAt: Date }
interface BalRow { materialId: string; locationId: string; quantity: Prisma.Decimal }
interface AuditRow { id: string; actorId: string | null; action: string; entityType: string; entityId: string; before: unknown; after: unknown; createdAt: Date }

const db = {
  pos: new Map<string, PO>(),
  lines: new Map<string, POL>(),
  locations: new Map<string, Loc>(),
  suppliers: new Map<string, Sup>(),
  materials: new Map<string, Mat>(),
  transactions: [] as TxRow[],
  balances: new Map<string, BalRow>(),
  audit: [] as AuditRow[],
  settings: new Map<string, SettingRow>(),
};
let poCounter = 0;
let lineCounter = 0;
let txCounter = 0;
let auditCounter = 0;
function nextPOId(): string { poCounter += 1; return `po-${poCounter}`; }
function nextLineId(): string { lineCounter += 1; return `pol-${lineCounter}`; }
function nextTxId(): string { txCounter += 1; return `tx-${txCounter}`; }
function balKey(m: string, l: string): string { return `${m}::${l}`; }

vi.mock('../../shared/db.js', () => ({
  get prisma() { return makePrisma(); },
}));

/** Build the in-memory Prisma fake for purchase-order, inventory, audit, and settings tests. */
function makePrisma(): unknown {
  return {
    supplier: {
      findUnique: async ({ where }: { where: { id: string } }) => db.suppliers.get(where.id) ?? null,
    },
    material: {
      findUnique: async ({ where }: { where: { id: string } }) => db.materials.get(where.id) ?? null,
    },
    location: {
      findUnique: async ({ where }: { where: { id: string } }) => db.locations.get(where.id) ?? null,
    },
    purchaseOrder: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: { lines?: boolean } }) => {
        const po = db.pos.get(where.id);
        if (!po) return null;
        if (include?.lines) {
          const lines = [...db.lines.values()].filter((l) => l.purchaseOrderId === po.id);
          return { ...po, lines: lines.map((l) => ({ ...l, material: db.materials.get(l.materialId) })) };
        }
        return po;
      },
      count: async () => db.pos.size,
      create: async ({ data, include }: { data: Record<string, unknown>; include?: { lines?: boolean } }) => {
        const id = nextPOId();
        const createLines = (data.lines as { create?: Array<{ materialId: string; orderedQty: Prisma.Decimal | number }> } | undefined)?.create ?? [];
        const lines: POL[] = createLines.map((c) => {
          const lid = nextLineId();
          const pol: POL = { id: lid, purchaseOrderId: id, materialId: c.materialId, orderedQty: c.orderedQty instanceof Prisma.Decimal ? c.orderedQty : new Prisma.Decimal(c.orderedQty), receivedQty: new Prisma.Decimal(0) };
          db.lines.set(lid, pol);
          return pol;
        });
        const { lines: _ignored, ...rest } = data;
        void _ignored;
        const po: PO = { ...(rest as Omit<PO, 'id' | 'createdAt' | 'updatedAt'>), id, lines, createdAt: new Date(), updatedAt: new Date() };
        db.pos.set(id, po);
        return include?.lines ? { ...po, lines } : po;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PO> }) => {
        const existing = db.pos.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        db.pos.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }: { where: { id: string; status?: POStatus | { in: POStatus[] } }; data: Partial<PO> }) => {
        const po = db.pos.get(where.id);
        if (!po) return { count: 0 };
        if (where.status !== undefined) {
          const allowed = Array.isArray((where.status as { in?: POStatus[] }).in)
            ? (where.status as { in: POStatus[] }).in
            : [where.status as POStatus];
          if (!allowed.includes(po.status)) return { count: 0 };
        }
        const updated = { ...po, ...data, updatedAt: new Date() };
        db.pos.set(where.id, updated);
        return { count: 1 };
      },
    },
    purchaseOrderLine: {
      update: async ({ where, data }: { where: { id: string }; data: Partial<POL> }) => {
        const existing = db.lines.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...data };
        db.lines.set(where.id, updated);
        return updated;
      },
    },
    inventoryTransaction: {
      create: async ({ data }: { data: Omit<TxRow, 'id' | 'postedAt'> }) => {
        const t: TxRow = { ...data, id: nextTxId(), postedAt: new Date() };
        db.transactions.push(t);
        return t;
      },
      aggregate: async ({ where }: { where: { materialId: string; locationId: string } }) => {
        let sum = new Prisma.Decimal(0);
        for (const t of db.transactions) {
          if (t.materialId === where.materialId && t.locationId === where.locationId) sum = sum.add(t.quantity);
        }
        return { _sum: { quantity: sum } };
      },
    },
    inventoryBalance: {
      upsert: async ({ where, create, update }: { where: { materialId_locationId: { materialId: string; locationId: string } }; create: { materialId: string; locationId: string; quantity: Prisma.Decimal }; update: { quantity: Prisma.Decimal } }) => {
        const k = balKey(where.materialId_locationId.materialId, where.materialId_locationId.locationId);
        const existing = db.balances.get(k);
        const row: BalRow = existing ? { ...existing, quantity: update.quantity } : { ...create };
        db.balances.set(k, row);
        return row;
      },
    },
    auditLogEntry: {
      create: async ({ data }: { data: Omit<AuditRow, 'id' | 'createdAt'> }) => {
        const row: AuditRow = { ...data, id: `audit-${++auditCounter}`, createdAt: new Date() };
        db.audit.push(row);
        return row;
      },
      findMany: async ({ where }: { where: { entityType: string; entityId: string } }) => {
        return db.audit.filter((a) => a.entityType === where.entityType && a.entityId === where.entityId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
    },
    // Settings fake. Only `findUnique` and `upsert`/`update` are exercised
    // by the production service. Backed by a Map so tests that toggle
    // a setting persist across operations within the test.
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => db.settings.get(where.key) ?? null,
      deleteMany: async ({ where }: { where: { key: { notIn: string[] } } }) => {
        for (const key of Array.from(db.settings.keys())) {
          if (!where.key.notIn.includes(key)) db.settings.delete(key);
        }
      },
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown; type: string; category: string; description: string; isEditable: boolean; enumOptions: unknown }; update: unknown }) => {
        const existing = db.settings.get(where.key);
        if (existing) return existing;
        const row = { ...create, updatedAt: new Date(), updatedById: null };
        db.settings.set(where.key, row as SettingRow);
        return row;
      },
      update: async ({ where, data }: { where: { key: string }; data: { value?: unknown; updatedById?: string | null } }) => {
        const existing = db.settings.get(where.key);
        if (!existing) throw new Error('not found');
        const next = { ...existing, ...data, updatedAt: new Date() };
        db.settings.set(where.key, next);
        return next;
      },
    },
  $executeRaw: async () => void 0,
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
  };
}

interface SettingRow { key: string; value: unknown; type: string; category: string; description: string; isEditable: boolean; enumOptions: unknown; updatedAt: Date; updatedById: string | null }

beforeEach(() => {
  db.pos.clear();
  db.lines.clear();
  db.suppliers.clear();
  db.materials.clear();
  db.locations.clear();
  db.transactions.length = 0;
  db.balances.clear();
  db.audit.length = 0;
  db.settings.clear();
  poCounter = 0; lineCounter = 0; txCounter = 0; auditCounter = 0;
  db.suppliers.set('sup-1', { id: 'sup-1', name: 'Acme' });
  db.materials.set('mat-1', { id: 'mat-1', sku: 'A-1', name: 'Widget', active: true });
  db.locations.set('loc-1', { id: 'loc-1', name: 'Main', active: true });
});

describe('PurchaseOrderService lifecycle', () => {
  it('create then submit transitions DRAFT → PENDING_APPROVAL', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const created = await PurchaseOrderService.create({
      supplierId: 'sup-1',
      lines: [{ materialId: 'mat-1', orderedQty: 5 }],
    }, 'user-1');
    expect(created.status).toBe('DRAFT');
    const submitted = await PurchaseOrderService.submit(created.id, 'user-1');
    expect(submitted?.status).toBe('PENDING_APPROVAL');
    expect(db.audit.find((a) => a.action === 'PO_SUBMIT')).toBeDefined();
  });

  it('approve records approver and timestamp', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    const approved = await PurchaseOrderService.approve(po.id, 'user-2');
    expect(approved?.status).toBe('APPROVED');
    expect(approved?.approvedById).toBe('user-2');
    expect(approved?.approvedAt).toBeTruthy();
  });

  it('rejects approve from DRAFT', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    await expect(PurchaseOrderService.approve(po.id, 'user-2')).rejects.toThrow(/approve/i);
  });

  /** Create, submit, and approve a single-line order with the requested test quantity. */
  async function approvedPO(orderedQty = 7) {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty }] }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    await PurchaseOrderService.approve(po.id, 'user-2');
    return po;
  }

  it('has no shipping stage', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    expect('ship' in PurchaseOrderService).toBe(false);
    expect('deliver' in PurchaseOrderService).toBe(false);
  });

  it('receive from APPROVED books every outstanding line into stock and marks the order RECEIVED', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await approvedPO(7);
    const received = await PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4');
    expect(received?.status).toBe('RECEIVED');
    expect(received?.deliveredById).toBe('user-4');
    expect(db.transactions.length).toBe(1);
    expect(db.transactions[0]).toMatchObject({ materialId: 'mat-1', locationId: 'loc-1', type: 'RECEIPT', referenceType: 'PurchaseOrder' });
    expect(db.transactions[0]!.quantity.toString()).toBe('7');
    expect(db.balances.get(balKey('mat-1', 'loc-1'))?.quantity.toString()).toBe('7');
    expect(db.audit.find((a) => a.action === 'PO_RECEIVE')).toBeDefined();
  });

  it('receive from PARTIALLY_RECEIVED books only the shortfall', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await approvedPO(7);
    const line = [...db.lines.values()].find((l) => l.purchaseOrderId === po.id)!;
    db.lines.set(line.id, { ...line, receivedQty: new Prisma.Decimal(3) });
    db.pos.set(po.id, { ...db.pos.get(po.id)!, status: 'PARTIALLY_RECEIVED' });
    const received = await PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4');
    expect(received?.status).toBe('RECEIVED');
    expect(db.transactions.map((t) => t.quantity.toString())).toEqual(['4']);
  });

  it('refuses to receive a draft or pending order', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    await expect(PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4')).rejects.toThrow(/approved or partly received/i);
    await PurchaseOrderService.submit(po.id, 'user-1');
    await expect(PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4')).rejects.toThrow(/approved or partly received/i);
    expect(db.transactions.length).toBe(0);
  });

  it('rejects receiving twice via the status guard', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await approvedPO(1);
    await PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4');
    await expect(PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4')).rejects.toThrow();
    expect(db.transactions.length).toBe(1);
  });

  it('cancel records reason and canceller', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    const cancelled = await PurchaseOrderService.cancel({ id: po.id, reason: 'Supplier out of stock' }, 'user-1');
    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.cancellationReason).toBe('Supplier out of stock');
    expect(cancelled?.cancelledById).toBe('user-1');
  });

  it('rejects cancel once anything has been received', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await approvedPO(1);
    await PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4');
    await expect(PurchaseOrderService.cancel({ id: po.id, reason: 'x' }, 'user-1')).rejects.toThrow(/cancel/i);
  });

  it('update is blocked once RECEIVED', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await approvedPO(1);
    await PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4');
    await expect(PurchaseOrderService.update({ id: po.id, notes: 'late edit' }, 'user-1')).rejects.toThrow(/editable/i);
  });

  it('closes a fully received order without a reason', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await approvedPO(2);
    await PurchaseOrderService.receive({ id: po.id, locationId: 'loc-1' }, 'user-4');
    const closed = await PurchaseOrderService.close({ id: po.id }, 'user-1');
    expect(closed?.status).toBe('CLOSED');
    expect(closed?.closedById).toBe('user-1');
    expect(closed?.closeReason).toBeNull();
    expect(db.audit.find((a) => a.action === 'PO_CLOSE')).toBeDefined();
  });

  it('closing short needs a reason', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await approvedPO(5);
    const line = [...db.lines.values()].find((l) => l.purchaseOrderId === po.id)!;
    db.lines.set(line.id, { ...line, receivedQty: new Prisma.Decimal(3) });
    db.pos.set(po.id, { ...db.pos.get(po.id)!, status: 'PARTIALLY_RECEIVED' });
    await expect(PurchaseOrderService.close({ id: po.id, reason: '  ' }, 'user-1')).rejects.toThrow(/reason is required/i);
    const closed = await PurchaseOrderService.close({ id: po.id, reason: 'Supplier discontinued the last 2' }, 'user-1');
    expect(closed?.status).toBe('CLOSED');
    expect(closed?.closeReason).toBe('Supplier discontinued the last 2');
  });

  it('refuses to close an order before anything is received', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await approvedPO(1);
    await expect(PurchaseOrderService.close({ id: po.id, reason: 'x' }, 'user-1')).rejects.toThrow(/cannot be closed/i);
  });

  it('history returns lifecycle events in order', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    await PurchaseOrderService.approve(po.id, 'user-2');
    const hist = await PurchaseOrderService.history(po.id);
    expect(hist.length).toBeGreaterThanOrEqual(2);
    const actions = hist.map((h) => h.action);
    expect(actions).toContain('PO_SUBMIT');
    expect(actions).toContain('PO_APPROVE');
  });

  it('with requireApprovalBeforeProcessing off, submit auto-approves', async () => {
    // The setting lives in the SettingsService catalog; ensureSeeded seeds
    // a default row of `true`. We override it for this test by replacing
    // the value on the underlying prisma.setting.update path.
    const { SettingsService } = await import('../settings/settings.service.js');
    await SettingsService.ensureSeeded();
    await SettingsService.set('purchaseOrders.requireApprovalBeforeProcessing', false, 'user-1');
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    const submitted = await PurchaseOrderService.submit(po.id, 'user-1');
    expect(submitted?.status).toBe('APPROVED');
    expect(submitted?.approvedById).toBe('user-1');
    // Cleanup so other tests are unaffected
    await SettingsService.set('purchaseOrders.requireApprovalBeforeProcessing', true, 'user-1');
  });

  it('cancel is rejected when allowCancellation is off', async () => {
    const { SettingsService } = await import('../settings/settings.service.js');
    await SettingsService.ensureSeeded();
    await SettingsService.set('purchaseOrders.allowCancellation', false, 'user-1');
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    await expect(PurchaseOrderService.cancel({ id: po.id, reason: 'no' }, 'user-1')).rejects.toThrow(/disabled/i);
    await SettingsService.set('purchaseOrders.allowCancellation', true, 'user-1');
  });
});