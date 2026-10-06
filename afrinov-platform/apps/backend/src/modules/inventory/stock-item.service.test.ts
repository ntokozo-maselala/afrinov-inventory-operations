// Unit tests for StockItemService — the on-board-a-new-stock-item flow.
//
// Verifies the complete vertical slice at the service layer:
//   - SKU uniqueness is enforced
//   - initial quantity creates a RECEIPT transaction in the ledger
//   - the matching balance row is recomputed
//   - an audit entry is written
//   - missing location when quantity > 0 is rejected
//   - duplicate SKU throws a conflict error
//   - zero initial quantity is allowed (pure master-data onboarding)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// ─── In-memory fake ────────────────────────────────────────────────────────

type Material = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  unitOfMeasure: string;
  requiredStock: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};
type TxRow = {
  id: string;
  materialId: string;
  locationId: string;
  type: string;
  quantity: Prisma.Decimal;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string;
  postedAt: Date;
};
type BalRow = { materialId: string; locationId: string; quantity: Prisma.Decimal };
type LocRow = { id: string; name: string; active: boolean };

const db = {
  materials: new Map<string, Material>(),
  skuIndex: new Map<string, string>(),
  transactions: [] as TxRow[],
  balances: new Map<string, BalRow>(),
  locations: new Map<string, LocRow>(),
  audit: [] as { actorId: string; action: string; entityType: string; entityId: string }[],
};

const balKey = (m: string, l: string) => `${m}::${l}`;
let matCounter = 0;
let txCounter = 0;
function nextMaterialId(): string { matCounter += 1; return `mat-${matCounter}`; }
function nextTxId(): string { txCounter += 1; return `tx-${txCounter}`; }

vi.mock('../../shared/db.js', () => ({
  get prisma() {
    return makePrisma();
  },
}));

vi.mock('../../shared/events.js', () => ({
  dispatchDomainEvents: async () => undefined,
}));

function makePrisma(): unknown {
  return {
    location: {
      findUnique: async ({ where }: { where: { id: string } }) => db.locations.get(where.id) ?? null,
    },
    material: {
      findUnique: async ({ where }: { where: { sku: string } | { id: string } }) => {
        if ('sku' in where) {
          const id = db.skuIndex.get(where.sku);
          return id ? db.materials.get(id) ?? null : null;
        }
        return db.materials.get(where.id) ?? null;
      },
      create: async ({ data }: { data: Omit<Material, 'id' | 'createdAt' | 'updatedAt'> }) => {
        if (db.skuIndex.has(data.sku)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const id = nextMaterialId();
        const m: Material = {
          ...data,
          id,
          requiredStock: data.requiredStock instanceof Prisma.Decimal ? data.requiredStock : new Prisma.Decimal(data.requiredStock ?? 0),
          unitCost: data.unitCost ? (data.unitCost instanceof Prisma.Decimal ? data.unitCost : new Prisma.Decimal(data.unitCost)) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        db.materials.set(id, m);
        db.skuIndex.set(data.sku, id);
        return m;
      },
    },
    inventoryTransaction: {
      create: async ({ data }: { data: Omit<TxRow, 'id' | 'postedAt'> }) => {
        const tx: TxRow = { ...data, id: nextTxId(), postedAt: new Date() };
        db.transactions.push(tx);
        return tx;
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
        const row: BalRow = existing
          ? { ...existing, quantity: update.quantity }
          : { materialId: create.materialId, locationId: create.locationId, quantity: create.quantity };
        db.balances.set(k, row);
        return row;
      },
    },
    auditLogEntry: {
      create: async ({ data }: { data: { actorId: string; action: string; entityType: string; entityId: string } }) => {
        db.audit.push({ actorId: data.actorId, action: data.action, entityType: data.entityType, entityId: data.entityId });
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
  };
}

beforeEach(() => {
  db.materials.clear();
  db.skuIndex.clear();
  db.transactions.length = 0;
  db.balances.clear();
  db.locations.clear();
  db.audit.length = 0;
  matCounter = 0;
  txCounter = 0;
  db.locations.set('loc-1', { id: 'loc-1', name: 'Main', active: true });
});

describe('StockItemService.createWithInitialStock', () => {
  it('creates a material with no initial stock and writes an audit entry', async () => {
    const { StockItemService } = await import('./stock-item.service.js');
    const result = await StockItemService.createWithInitialStock(
      { sku: 'NEW-1', name: 'New Item', category: 'CONSUMABLES', unitOfMeasure: 'each' },
      'user-1',
    );
    expect(result.material.sku).toBe('NEW-1');
    expect(result.initialTransactionId).toBeNull();
    expect(db.audit.length).toBe(1);
    expect(db.audit[0]).toMatchObject({ action: 'CREATE', entityType: 'Material', actorId: 'user-1' });
  });

  it('records a RECEIPT transaction and recomputes the balance when initial quantity is provided', async () => {
    const { StockItemService } = await import('./stock-item.service.js');
    const result = await StockItemService.createWithInitialStock(
      { sku: 'NEW-2', name: 'New Item 2', category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'each', initialQuantity: 25, locationId: 'loc-1' },
      'user-1',
    );
    expect(result.initialTransactionId).not.toBeNull();
    expect(db.transactions.length).toBe(1);
    expect(db.transactions[0]).toMatchObject({ type: 'RECEIPT', materialId: result.material.id, locationId: 'loc-1', referenceType: 'InitialStock' });
    expect(db.transactions[0]!.quantity.toString()).toBe('25');
    const bal = db.balances.get(balKey(result.material.id, 'loc-1'));
    expect(bal).toBeDefined();
    expect(bal!.quantity.toString()).toBe('25');
  });

  it('rejects initial quantity without a location', async () => {
    const { StockItemService } = await import('./stock-item.service.js');
    await expect(
      StockItemService.createWithInitialStock(
        { sku: 'NEW-3', name: 'New Item 3', category: 'CONSUMABLES', unitOfMeasure: 'each', initialQuantity: 10 },
        'user-1',
      ),
    ).rejects.toThrow(/location/i);
  });

  it('rejects duplicate SKU', async () => {
    const { StockItemService } = await import('./stock-item.service.js');
    await StockItemService.createWithInitialStock(
      { sku: 'DUP', name: 'First', category: 'CONSUMABLES', unitOfMeasure: 'each' },
      'user-1',
    );
    await expect(
      StockItemService.createWithInitialStock(
        { sku: 'DUP', name: 'Second', category: 'CONSUMABLES', unitOfMeasure: 'each' },
        'user-2',
      ),
    ).rejects.toThrow(/SKU/i);
  });

  it('rejects an inactive location', async () => {
    const { StockItemService } = await import('./stock-item.service.js');
    db.locations.set('loc-dead', { id: 'loc-dead', name: 'Closed', active: false });
    await expect(
      StockItemService.createWithInitialStock(
        { sku: 'NEW-4', name: 'New Item 4', category: 'CONSUMABLES', unitOfMeasure: 'each', initialQuantity: 5, locationId: 'loc-dead' },
        'user-1',
      ),
    ).rejects.toThrow(/inactive/i);
  });

  it('rejects unknown location', async () => {
    const { StockItemService } = await import('./stock-item.service.js');
    await expect(
      StockItemService.createWithInitialStock(
        { sku: 'NEW-5', name: 'New Item 5', category: 'CONSUMABLES', unitOfMeasure: 'each', initialQuantity: 5, locationId: '00000000-0000-0000-0000-000000000000' },
        'user-1',
      ),
    ).rejects.toThrow(/Location not found/i);
  });

  it('rejects negative initial quantity', async () => {
    const { StockItemService } = await import('./stock-item.service.js');
    await expect(
      StockItemService.createWithInitialStock(
        { sku: 'NEW-6', name: 'New Item 6', category: 'CONSUMABLES', unitOfMeasure: 'each', initialQuantity: -3, locationId: 'loc-1' },
        'user-1',
      ),
    ).rejects.toThrow(/negative/i);
  });
});