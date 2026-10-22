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
  id: string; number: string; revision?: number; supplierId: string; status: POStatus;
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
interface POL { id: string; purchaseOrderId: string; materialId: string; orderedQty: Prisma.Decimal; receivedQty: Prisma.Decimal; unitPrice?: number | null; deliveryDate?: Date | null }
interface Loc { id: string; name: string; active: boolean }
interface Sup { id: string; name: string; active: boolean; currency?: string; paymentTerms?: string | null }
interface Mat { id: string; sku: string; name: string; active: boolean; category?: string; projectNumber?: string | null }
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
  projects: new Map<string, { projectNumber: string; active: boolean; status?: string }>(),
  users: new Map<string, { id: string; name: string; approvalLimit: Prisma.Decimal | null; canApprove: boolean }>(),
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

function makePrisma(): unknown {
  return {
    supplier: {
      findUnique: async ({ where }: { where: { id: string } }) => db.suppliers.get(where.id) ?? null,
    },
    project: {
      findUnique: async ({ where }: { where: { projectNumber: string } }) => db.projects.get(where.projectNumber) ?? null,
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => db.users.get(where.id) ?? null,
      // Stands in for "active users whose role holds approve:purchase_order".
      findMany: async () => [...db.users.values()].filter((u) => u.canApprove),
    },
    material: {
      findUnique: async ({ where }: { where: { id: string } }) => db.materials.get(where.id) ?? null,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => db.materials.get(id)).filter((m): m is Mat => !!m),
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
      findMany: async ({ where, include, orderBy }: { where?: { number?: { startsWith?: string }; status?: POStatus }; include?: { lines?: unknown }; orderBy?: { createdAt?: 'asc' | 'desc' } } = {}) => {
        const rows = [...db.pos.values()]
          .filter((p) => !where?.number?.startsWith || p.number.startsWith(where.number.startsWith))
          .filter((p) => !where?.status || p.status === where.status)
          .map((p) => (include?.lines ? { ...p, lines: [...db.lines.values()].filter((l) => l.purchaseOrderId === p.id) } : p));
        if (orderBy?.createdAt) rows.sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * (orderBy.createdAt === 'asc' ? 1 : -1));
        return rows;
      },
      create: async ({ data, include }: { data: Record<string, unknown>; include?: { lines?: boolean } }) => {
        const id = nextPOId();
        const createLines = (data.lines as { create?: Array<{ materialId: string; orderedQty: Prisma.Decimal | number; unitPrice?: number | null; deliveryDate?: Date | null }> } | undefined)?.create ?? [];
        const lines: POL[] = createLines.map((c) => {
          const lid = nextLineId();
          const pol: POL = { id: lid, purchaseOrderId: id, materialId: c.materialId, orderedQty: c.orderedQty instanceof Prisma.Decimal ? c.orderedQty : new Prisma.Decimal(c.orderedQty), receivedQty: new Prisma.Decimal(0), unitPrice: c.unitPrice ?? null, deliveryDate: c.deliveryDate ?? null };
          db.lines.set(lid, pol);
          return pol;
        });
        const { lines: _ignored, ...rest } = data;
        void _ignored;
        // Column defaults Postgres would fill.
        const po: PO = { revision: 0, ...(rest as Omit<PO, 'id' | 'createdAt' | 'updatedAt'>), id, lines, createdAt: new Date(), updatedAt: new Date() };
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
      findMany: async ({ where }: { where: { purchaseOrderId: string } }) => [...db.lines.values()].filter((l) => l.purchaseOrderId === where.purchaseOrderId),
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
      findMany: async ({ where }: { where?: { key?: { in?: string[] } } } = {}) =>
        [...db.settings.values()].filter((r) => !where?.key?.in || where.key.in.includes(r.key)),
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
  db.projects.clear();
  db.users.clear();
  db.users.set('user-1', { id: 'user-1', name: 'Thandi Buyer', approvalLimit: null, canApprove: false });
  // As on the template: Ona Moloane under R500 000, Simbongile Bantubani from R500 000.
  db.users.set('u-ona', { id: 'u-ona', name: 'Ona Moloane', approvalLimit: new Prisma.Decimal(500000), canApprove: true });
  db.users.set('u-sb', { id: 'u-sb', name: 'Simbongile Bantubani', approvalLimit: null, canApprove: true });
  poCounter = 0; lineCounter = 0; txCounter = 0; auditCounter = 0;
  db.suppliers.set('sup-1', { id: 'sup-1', name: 'Acme', active: true });
  db.materials.set('mat-1', { id: 'mat-1', sku: 'A-1', name: 'Widget', active: true });
  db.locations.set('loc-1', { id: 'loc-1', name: 'Main', active: true });
});

describe('PurchaseOrderService lifecycle', () => {
  it('create then submit transitions DRAFT → PENDING_APPROVAL', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const created = await PurchaseOrderService.create({
      supplierId: 'sup-1',
      lines: [{ materialId: 'mat-1', orderedQty: 5, unitPrice: 10 }],
    }, 'user-1');
    expect(created.status).toBe('DRAFT');
    const submitted = await PurchaseOrderService.submit(created.id, 'user-1');
    expect(submitted?.status).toBe('PENDING_APPROVAL');
    expect(db.audit.find((a) => a.action === 'PO_SUBMIT')).toBeDefined();
  });

  it('refuses a new order for an inactive supplier', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.suppliers.set('sup-1', { id: 'sup-1', name: 'Acme', active: false });
    await expect(PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Acme is inactive. Reactivate the supplier to order from them.' });
  });

  it('approve records approver and timestamp', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    const approved = await PurchaseOrderService.approve(po.id, 'user-2');
    expect(approved?.status).toBe('APPROVED');
    expect(approved?.approvedById).toBe('user-2');
    expect(approved?.approvedAt).toBeTruthy();
  });

  it('rejects approve from DRAFT', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1');
    await expect(PurchaseOrderService.approve(po.id, 'user-2')).rejects.toThrow(/approve/i);
  });

  async function approvedPO(orderedQty = 7) {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty, unitPrice: 10 }] }, 'user-1');
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
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1');
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
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1');
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
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1');
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
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1');
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
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1');
    await expect(PurchaseOrderService.cancel({ id: po.id, reason: 'no' }, 'user-1')).rejects.toThrow(/disabled/i);
    await SettingsService.set('purchaseOrders.allowCancellation', true, 'user-1');
  });
});

describe('PurchaseOrderService and project material with no project (materials sections Phase 3)', () => {
  it('refuses to order it until it has its project', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.materials.set('mat-old', { id: 'mat-old', sku: 'OLD-PLATE', name: 'Plate', active: true, category: 'PROJECT_MATERIAL', projectNumber: null });
    await expect(PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-old', orderedQty: 2 }] }, 'user-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/OLD-PLATE has no project yet, so it can't be ordered/) });
    db.materials.set('mat-old', { ...db.materials.get('mat-old')!, projectNumber: '1369' });
    db.projects.set('1369', { projectNumber: '1369', active: true });
    expect(await PurchaseOrderService.create({ supplierId: 'sup-1', projectNumber: '1369', lines: [{ materialId: 'mat-old', orderedQty: 2 }] }, 'user-1')).toMatchObject({ status: 'DRAFT' });
  });

  it('refuses to submit a draft holding such an item, raised before the rule', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.materials.set('mat-old', { id: 'mat-old', sku: 'OLD-PLATE', name: 'Plate', active: true, category: 'PROJECT_MATERIAL', projectNumber: '1369' });
    db.projects.set('1369', { projectNumber: '1369', active: true });
    const draft = await PurchaseOrderService.create({ supplierId: 'sup-1', projectNumber: '1369', lines: [{ materialId: 'mat-old', orderedQty: 2 }] }, 'user-1');
    // As a draft from before Phase 3 would be: its item has no project.
    db.materials.set('mat-old', { ...db.materials.get('mat-old')!, projectNumber: null });
    await expect(PurchaseOrderService.submit(draft.id, 'user-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/OLD-PLATE has no project yet/) });
    expect(db.pos.get(draft.id)!.status).toBe('DRAFT');
  });
});

describe('PurchaseOrderService and project material (materials sections Phase 6)', () => {
  beforeEach(() => {
    db.projects.set('1369', { projectNumber: '1369', active: true, status: 'ACTIVE' });
    db.projects.set('1402', { projectNumber: '1402', active: true, status: 'PLANNING' });
    db.projects.set('1200', { projectNumber: '1200', active: true, status: 'COMPLETED' });
    db.materials.set('pipe-1369', { id: 'pipe-1369', sku: '1369-PIPE', name: 'Pipe', active: true, category: 'PROJECT_MATERIAL', projectNumber: '1369' });
    db.materials.set('pipe-1402', { id: 'pipe-1402', sku: '1402-PIPE', name: 'Pipe', active: true, category: 'PROJECT_MATERIAL', projectNumber: '1402' });
  });
  const order = (projectNumber: string | undefined, ...materialIds: string[]) => import('./procurement.service.js').then(({ PurchaseOrderService }) =>
    PurchaseOrderService.create({ supplierId: 'sup-1', projectNumber, lines: materialIds.map((materialId) => ({ materialId, orderedQty: 1 })) }, 'user-1'));

  it('orders it, with Stores items, for its own project', async () => {
    expect(await order('1369', 'pipe-1369', 'mat-1')).toMatchObject({ status: 'DRAFT', projectNumber: '1369' });
  });

  it('refuses it on an order for another project, for none, or with another project\'s material', async () => {
    await expect(order('1402', 'pipe-1369')).rejects.toMatchObject({ message: "1369-PIPE is material for project 1369, so it can't be ordered for project 1402." });
    await expect(order(undefined, 'pipe-1369')).rejects.toMatchObject({ message: '1369-PIPE is material for project 1369: order it for that project.' });
    await expect(order('1369', 'pipe-1369', 'pipe-1402')).rejects.toMatchObject({ message: expect.stringMatching(/One order can't hold material for two projects \(1369 and 1402\)/) });
    expect(db.pos.size).toBe(0);
  });

  it('refuses an order for a completed project, even of Stores items', async () => {
    await expect(order('1200', 'mat-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Project 1200 is completed, so nothing more is ordered for it.' });
  });

  it('refuses moving an order with project material to another project', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await order('1369', 'pipe-1369');
    await expect(PurchaseOrderService.update({ id: po.id, projectNumber: '1402' }, 'user-1'))
      .rejects.toMatchObject({ message: expect.stringMatching(/can't be ordered for project 1402/) });
    await expect(PurchaseOrderService.update({ id: po.id, projectNumber: null }, 'user-1'))
      .rejects.toMatchObject({ message: expect.stringMatching(/order it for that project/) });
  });

  it('still edits an order whose project has closed, if the project is left alone', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await order('1369', 'pipe-1369');
    db.projects.set('1369', { projectNumber: '1369', active: true, status: 'COMPLETED' });
    expect(await PurchaseOrderService.update({ id: po.id, projectNumber: '1369', notes: 'Call before delivery' }, 'user-1')).toMatchObject({ notes: 'Call before delivery' });
  });

  it('refuses to submit a draft whose project has closed, or that breaks the rule from before it', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const closed = await order('1369', 'pipe-1369');
    db.projects.set('1369', { projectNumber: '1369', active: true, status: 'CANCELLED' });
    await expect(PurchaseOrderService.submit(closed.id, 'user-1')).rejects.toMatchObject({ message: 'Project 1369 is cancelled, so nothing more is ordered for it.' });

    // As a draft from before Phase 6 could be: a project item on an order with no project.
    const old = await order(undefined, 'mat-1');
    const line = [...db.lines.values()].find((l) => l.purchaseOrderId === old.id)!;
    line.materialId = 'pipe-1402';
    await expect(PurchaseOrderService.submit(old.id, 'user-1')).rejects.toMatchObject({ message: expect.stringMatching(/1402-PIPE is material for project 1402: order it for that project/) });
    expect(db.pos.get(old.id)!.status).toBe('DRAFT');
  });
});

describe('PurchaseOrderService prices and VAT (procurement roadmap Phase 2)', () => {
  it('keeps the unit prices, the supplier currency and the VAT setting on a rand order', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const { SettingsService } = await import('../settings/settings.service.js');
    await SettingsService.ensureSeeded();
    await SettingsService.set('purchaseOrders.vatRate', 15, 'user-1');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 3, unitPrice: 12.5 }] }, 'user-1');
    expect(po).toMatchObject({ currency: 'ZAR', vatRate: 15 });
    const read = await PurchaseOrderService.getById(po.id);
    expect(read.lines[0]).toMatchObject({ subtotal: '37.50', vat: '5.63', net: '43.13' });
    expect(read.totals).toEqual({ subtotal: '37.50', vat: '5.63', net: '43.13', unpricedLines: 0 });
  });

  it('starts a foreign-currency order at 0% VAT', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.suppliers.set('sup-eu', { id: 'sup-eu', name: 'HS SRL', active: true, currency: 'EUR' });
    const po = await PurchaseOrderService.create({ supplierId: 'sup-eu', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 100 }] }, 'user-1');
    expect(po).toMatchObject({ currency: 'EUR', vatRate: 0 });
  });

  it('takes a VAT rate given on the order over the default', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.suppliers.set('sup-eu', { id: 'sup-eu', name: 'HS SRL', active: true, currency: 'EUR' });
    const po = await PurchaseOrderService.create({ supplierId: 'sup-eu', vatRate: 15, lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    expect(po.vatRate).toBe(15);
  });

  it('leaves lines without a price out of the totals, and counts them', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.materials.set('mat-2', { id: 'mat-2', sku: 'B-1', name: 'Bolt', active: true });
    const po = await PurchaseOrderService.create({
      supplierId: 'sup-1', vatRate: 15, lines: [{ materialId: 'mat-1', orderedQty: 2, unitPrice: 10 }, { materialId: 'mat-2', orderedQty: 5 }],
    }, 'user-1');
    const read = await PurchaseOrderService.getById(po.id);
    expect(read.lines[1]).toMatchObject({ subtotal: null, vat: null, net: null });
    expect(read.totals).toEqual({ subtotal: '20.00', vat: '3.00', net: '23.00', unpricedLines: 1 });
  });

  it('changes line prices and the VAT rate while the order is editable, and logs both', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', vatRate: 15, lines: [{ materialId: 'mat-1', orderedQty: 4 }] }, 'user-1');
    const lineId = (await PurchaseOrderService.getById(po.id)).lines[0]!.id;
    await PurchaseOrderService.update({ id: po.id, vatRate: 0, linePrices: [{ lineId, unitPrice: 2.5 }] }, 'user-2');
    const read = await PurchaseOrderService.getById(po.id);
    expect(read.totals).toEqual({ subtotal: '10.00', vat: '0.00', net: '10.00', unpricedLines: 0 });
    const entry = db.audit.filter((a) => a.action === 'UPDATE' && a.entityId === po.id).pop()!;
    // The mock keeps the rate as a number; Postgres returns a Decimal, logged as text.
    expect(entry.before).toMatchObject({ unitPrices: [{ lineId, unitPrice: null }] });
    expect(String((entry.before as { vatRate: unknown }).vatRate)).toBe('15');
    expect(entry.after).toMatchObject({ unitPrices: [{ lineId, unitPrice: '2.5' }] });
    expect(String((entry.after as { vatRate: unknown }).vatRate)).toBe('0');
  });

  it('refuses a price for a line on another order', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const a = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    const b = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    const otherLine = (await PurchaseOrderService.getById(b.id)).lines[0]!.id;
    await expect(PurchaseOrderService.update({ id: a.id, linePrices: [{ lineId: otherLine, unitPrice: 1 }] }, 'user-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('PurchaseOrderService order details (procurement roadmap Phase 3)', () => {
  async function seededSettings() {
    const { SettingsService } = await import('../settings/settings.service.js');
    await SettingsService.ensureSeeded();
    return SettingsService;
  }

  it('fills what was left out as the template does: supplier terms, the delivery block from Settings, the buyer as contact', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const settings = await seededSettings();
    await settings.set('purchaseOrders.deliveryContactName', 'Site storeman', 'user-1');
    db.suppliers.set('sup-1', { id: 'sup-1', name: 'Acme', active: true, paymentTerms: '30 DAYS NETT' });
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    expect(po).toMatchObject({
      paymentTerms: '30 DAYS NETT', deliveryMethod: 'DELIVERY', deliveryTo: 'Afrinov (PTY) Ltd',
      deliveryAddress: '10 Lime Street, Icon Industrial Park\nSunderland Ridge, Centurion 0157', deliveryCountry: 'South Africa',
      deliveryContactName: 'Site storeman', afrinovContact: 'Thandi Buyer',
    });
    expect((po as { projectNumber?: string | null }).projectNumber ?? null).toBeNull();
  });

  it('keeps what the buyer typed, tidied, over the defaults', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    await seededSettings();
    db.projects.set('M-1325', { projectNumber: 'M-1325', active: true });
    const po = await PurchaseOrderService.create({
      supplierId: 'sup-1', projectNumber: 'M-1325', paymentTerms: 'cod', settlementDiscount: 2.5, shippingTerms: 'DAP Centurion',
      penaltiesApply: true, deliveryAddress: '  Plant 3 \n\n  Rustenburg  ', afrinovContact: 'Procurement desk',
      lines: [{ materialId: 'mat-1', orderedQty: 1, deliveryDate: '2026-11-02' }],
    }, 'user-1');
    expect(po).toMatchObject({
      projectNumber: 'M-1325', paymentTerms: 'C.O.D', settlementDiscount: 2.5, shippingTerms: 'DAP Centurion',
      penaltiesApply: true, deliveryAddress: 'Plant 3\nRustenburg', afrinovContact: 'Procurement desk',
    });
    expect([...db.lines.values()][0]!.deliveryDate).toEqual(new Date('2026-11-02T00:00:00Z'));
  });

  it('leaves the delivery block empty when the goods are collected', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    await seededSettings();
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', deliveryMethod: 'COLLECTION', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    expect(po).toMatchObject({ deliveryMethod: 'COLLECTION' });
    expect((po as { deliveryTo?: string | null }).deliveryTo ?? null).toBeNull();
  });

  it('refuses an unknown or inactive project', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.projects.set('M-OLD', { projectNumber: 'M-OLD', active: false });
    await expect(PurchaseOrderService.create({ supplierId: 'sup-1', projectNumber: 'M-NOPE', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'No project M-NOPE' });
    await expect(PurchaseOrderService.create({ supplierId: 'sup-1', projectNumber: 'M-OLD', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Project M-OLD is inactive' });
  });

  it('edits details and line delivery dates, logging only what changed', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    await seededSettings();
    // penaltiesApply given: the mock does not fill column defaults the way Postgres does.
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', penaltiesApply: false, lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    const lineId = [...db.lines.values()][0]!.id;
    await PurchaseOrderService.update({ id: po.id, shippingTerms: 'Ex works', penaltiesApply: true, lineDeliveryDates: [{ lineId, deliveryDate: '2026-12-01' }] }, 'user-2');
    expect(db.pos.get(po.id)).toMatchObject({ shippingTerms: 'Ex works', penaltiesApply: true });
    const entry = db.audit.filter((a) => a.action === 'UPDATE' && a.entityId === po.id).pop()!;
    expect(entry.before).toEqual({ shippingTerms: null, penaltiesApply: false, deliveryDates: [{ lineId, deliveryDate: null }] });
    expect(entry.after).toEqual({ shippingTerms: 'Ex works', penaltiesApply: true, deliveryDates: [{ lineId, deliveryDate: '2026-12-01' }] });
  });

  it('clears a detail with null', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    await seededSettings();
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', shippingTerms: 'FOB', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    await PurchaseOrderService.update({ id: po.id, shippingTerms: null }, 'user-1');
    expect(db.pos.get(po.id)!).toMatchObject({ shippingTerms: null });
  });
});

describe('PurchaseOrderService approval by value (procurement roadmap Phase 4)', () => {
  /** A submitted rand order of `price` + 15% VAT. */
  async function submitted(price: number, extra: Record<string, unknown> = {}) {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', vatRate: 15, lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: price }], ...extra }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    return po.id;
  }

  it('lets an approver approve an order within their limit (total including VAT)', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const id = await submitted(434782.61); // R500 000.00 with VAT
    expect(await PurchaseOrderService.approve(id, 'u-ona')).toMatchObject({ status: 'APPROVED', approvedById: 'u-ona' });
  });

  it('refuses an order over the limit and names who can approve it', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const id = await submitted(434782.62); // R500 000.01 with VAT
    await expect(PurchaseOrderService.approve(id, 'u-ona')).rejects.toMatchObject({
      statusCode: 403, message: expect.stringMatching(/your approval limit is R 500\s000,00\. Ask Simbongile Bantubani to approve it\.$/),
    });
    expect(db.pos.get(id)!.status).toBe('PENDING_APPROVAL');
    expect(await PurchaseOrderService.approve(id, 'u-sb')).toMatchObject({ status: 'APPROVED' });
  });

  it('refuses an order with unpriced lines, for everyone', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    await expect(PurchaseOrderService.approve(po.id, 'u-sb')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/^1 line has no price/) });
  });

  it('needs an approver without a limit for an order in another currency', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.suppliers.set('sup-eu', { id: 'sup-eu', name: 'HS SRL', active: true, currency: 'EUR' });
    const po = await PurchaseOrderService.create({ supplierId: 'sup-eu', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    await expect(PurchaseOrderService.approve(po.id, 'u-ona')).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/^This order is in EUR/) });
  });

  it('tells the reader whether they can approve, and who can', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const id = await submitted(600000);
    const asOna = await PurchaseOrderService.approval(id, 'u-ona');
    expect(asOna).toMatchObject({ canApprove: false, myLimit: '500000', net: '690000.00', approvers: [{ name: 'Simbongile Bantubani' }] });
    expect(asOna.reason).toMatch(/your approval limit is/);
    expect(await PurchaseOrderService.approval(id, 'u-sb')).toMatchObject({ canApprove: true, reason: null });
    expect(await PurchaseOrderService.approval(id, 'user-1')).toMatchObject({ canApprove: false, reason: null, myLimit: null });
  });

  it('lists the orders waiting for an approver: within their limit and priced, oldest first', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const newer = await submitted(1000);
    const older = await submitted(2000);
    const over = await submitted(600000); // R690 000 with VAT: over Ona's limit
    db.pos.get(older)!.createdAt = new Date('2026-01-01');
    db.pos.get(newer)!.createdAt = new Date('2026-02-01');
    const unpriced = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }, 'user-1');
    await PurchaseOrderService.submit(unpriced.id, 'user-1');
    await PurchaseOrderService.create({ supplierId: 'sup-1', vatRate: 15, lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 5 }] }, 'user-1'); // a draft

    expect((await PurchaseOrderService.awaitingApproval('u-ona')).map((p) => p.id)).toEqual([older, newer]);
    expect((await PurchaseOrderService.awaitingApproval('u-sb')).map((p) => p.id)).toEqual([older, newer, over]);
    expect(await PurchaseOrderService.awaitingApproval('user-1')).toEqual([]);
  });

  it('sends an approved order back for approval when an edit takes it past the approver\'s limit', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const id = await submitted(100000);
    await PurchaseOrderService.approve(id, 'u-ona');
    const lineId = [...db.lines.values()].find((l) => l.purchaseOrderId === id)!.id;
    await PurchaseOrderService.update({ id, linePrices: [{ lineId, unitPrice: 200000 }] }, 'user-1'); // R230 000: still within
    expect(db.pos.get(id)).toMatchObject({ status: 'APPROVED', approvedById: 'u-ona' });
    await PurchaseOrderService.update({ id, linePrices: [{ lineId, unitPrice: 450000 }] }, 'user-1'); // R517 500
    expect(db.pos.get(id)).toMatchObject({ status: 'PENDING_APPROVAL', approvedById: null, approvedAt: null });
  });
});

describe('PurchaseOrderService numbers and revisions (procurement roadmap Phase 6)', () => {
  const line = [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }];

  it('numbers new orders AFRI-0001, AFRI-0002, …, past older PO-YYYY numbers', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    db.pos.set('old', { id: 'old', number: 'PO-2026-0009' } as never);
    const a = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: line }, 'user-1');
    const b = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: line }, 'user-1');
    expect([a.number, b.number]).toEqual(['AFRI-0001', 'AFRI-0002']);
  });

  it('starts at the number in Settings, then carries on from the highest issued', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const { SettingsService } = await import('../settings/settings.service.js');
    await SettingsService.ensureSeeded();
    await SettingsService.set('purchaseOrders.firstNumber', 412, 'user-1');
    expect((await PurchaseOrderService.create({ supplierId: 'sup-1', lines: line }, 'user-1')).number).toBe('AFRI-0412');
    expect((await PurchaseOrderService.create({ supplierId: 'sup-1', lines: line }, 'user-1')).number).toBe('AFRI-0413');
    // A lower setting never reuses a number.
    await SettingsService.set('purchaseOrders.firstNumber', 5, 'user-1');
    expect((await PurchaseOrderService.create({ supplierId: 'sup-1', lines: line }, 'user-1')).number).toBe('AFRI-0414');
    await SettingsService.set('purchaseOrders.firstNumber', 1, 'user-1');
  });

  it('keeps revision 0 while the order is a draft, whatever is edited', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: line }, 'user-1');
    await PurchaseOrderService.update({ id: po.id, shippingTerms: 'Ex works' }, 'user-1');
    expect(db.pos.get(po.id)!.revision).toBe(0);
  });

  it('raises the revision each time an approved order is changed, and logs it', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', lines: line }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    await PurchaseOrderService.approve(po.id, 'u-sb');
    await PurchaseOrderService.update({ id: po.id, shippingTerms: 'Ex works' }, 'user-1');
    expect(db.pos.get(po.id)!.revision).toBe(1);
    await PurchaseOrderService.update({ id: po.id, shippingTerms: 'Delivered to site' }, 'user-1');
    expect(db.pos.get(po.id)!.revision).toBe(2);
    const entry = db.audit.filter((a) => a.action === 'UPDATE' && a.entityId === po.id).pop()!;
    expect(entry.before).toEqual({ shippingTerms: 'Ex works', revision: 1 });
    expect(entry.after).toEqual({ shippingTerms: 'Delivered to site', revision: 2 });
  });

  it('raises no revision and writes no log for a save that changes nothing', async () => {
    const { PurchaseOrderService } = await import('./procurement.service.js');
    const po = await PurchaseOrderService.create({ supplierId: 'sup-1', shippingTerms: 'FOB', lines: line }, 'user-1');
    await PurchaseOrderService.submit(po.id, 'user-1');
    await PurchaseOrderService.approve(po.id, 'u-sb');
    const lineId = [...db.lines.values()].find((l) => l.purchaseOrderId === po.id)!.id;
    const logged = db.audit.length;
    await PurchaseOrderService.update({ id: po.id, shippingTerms: 'FOB', vatRate: 15, linePrices: [{ lineId, unitPrice: 10 }] }, 'user-1');
    expect(db.pos.get(po.id)!.revision).toBe(0);
    expect(db.audit.length).toBe(logged);
  });
});