// Unit tests for SupplierService: the vendor fields from the AFRI-0000_x
// purchase order template, editing and deactivating.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Supplier = {
  id: string; name: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  notes: string | null; vendorCode: string | null; address: string | null; currency: string; paymentTerms: string | null;
  website: string | null; services: string | null; active: boolean; createdAt: Date;
};
type AuditRow = { actorId: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown };

const db = { suppliers: new Map<string, Supplier>(), audit: [] as AuditRow[] };
let seq = 0;

type Where = { name?: { equals: string }; vendorCode?: string; NOT?: { id: string } };
function matches(s: Supplier, where: Where): boolean {
  if (where.NOT && s.id === where.NOT.id) return false;
  if (where.name && s.name.toLowerCase() !== where.name.equals.toLowerCase()) return false;
  if (where.vendorCode !== undefined && s.vendorCode !== where.vendorCode) return false;
  return true;
}

// Mirrors the unique indexes on citext(name) and vendor_code.
function assertUnique(candidate: Supplier) {
  for (const s of db.suppliers.values()) {
    if (s.id === candidate.id) continue;
    if (s.name.toLowerCase() === candidate.name.toLowerCase() || (candidate.vendorCode && s.vendorCode === candidate.vendorCode)) {
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    }
  }
}

function makePrisma(): unknown {
  const tx = {
    supplier: {
      findUnique: async ({ where }: { where: { id: string } }) => db.suppliers.get(where.id) ?? null,
      findFirst: async ({ where }: { where: Where }) => [...db.suppliers.values()].find((s) => matches(s, where)) ?? null,
      create: async ({ data }: { data: Omit<Supplier, 'id' | 'active' | 'createdAt'> }) => {
        const s: Supplier = { ...data, id: `sup-${++seq}`, active: true, createdAt: new Date() };
        assertUnique(s);
        db.suppliers.set(s.id, s);
        return s;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Supplier> }) => {
        const s = { ...db.suppliers.get(where.id)!, ...data };
        assertUnique(s);
        db.suppliers.set(s.id, s);
        return s;
      },
    },
    auditLogEntry: { create: async ({ data }: { data: AuditRow }) => { db.audit.push(data); return data; } },
  };
  return { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
}

vi.mock('../../shared/db.js', () => ({ get prisma() { return makePrisma(); } }));

const { SupplierService } = await import('./procurement.service.js');

beforeEach(() => {
  db.suppliers.clear();
  db.audit.length = 0;
  seq = 0;
});

describe('SupplierService.create', () => {
  it('stores the template fields, tidied, with ZAR as the default currency', async () => {
    const s = await SupplierService.create({
      name: '  Amalgum   Welding ', vendorCode: ' v001', address: '23 Grader Road, Spartan Ext 3',
      paymentTerms: '30 Days Nett', website: 'www.weldingshop.co.za | ', services: 'Workshop Welding Equipment',
    }, 'buyer');
    expect(s).toMatchObject({
      name: 'Amalgum Welding', vendorCode: 'V001', address: '23 Grader Road, Spartan Ext 3', currency: 'ZAR',
      paymentTerms: '30 DAYS NETT', website: 'www.weldingshop.co.za', services: 'Workshop Welding Equipment',
    });
    expect(db.audit).toEqual([expect.objectContaining({ action: 'CREATE', entityType: 'Supplier', entityId: s!.id })]);
  });

  it('spells cash on delivery one way', async () => {
    const a = await SupplierService.create({ name: 'A', paymentTerms: 'COD' }, 'buyer');
    const b = await SupplierService.create({ name: 'B', paymentTerms: 'c.o.d' }, 'buyer');
    expect([a!.paymentTerms, b!.paymentTerms]).toEqual(['C.O.D', 'C.O.D']);
  });

  it('refuses a vendor code another supplier has, naming that supplier', async () => {
    await SupplierService.create({ name: 'Hydac', vendorCode: 'V006' }, 'buyer');
    await expect(SupplierService.create({ name: 'Fast Flame', vendorCode: 'v006' }, 'buyer'))
      .rejects.toMatchObject({ code: 'CONFLICT', message: 'Vendor code V006 is already used by Hydac' });
  });

  it('still refuses a name that differs only in case', async () => {
    await SupplierService.create({ name: 'Afrox' }, 'buyer');
    await expect(SupplierService.create({ name: 'AFROX ' }, 'buyer')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('SupplierService.update', () => {
  it('changes only the fields sent and logs before and after', async () => {
    const s = await SupplierService.create({ name: 'Exclusive Air', contactName: 'Zelda', vendorCode: 'V002' }, 'buyer');
    const after = await SupplierService.update({ id: s!.id, paymentTerms: '30 days nett', currency: 'EUR' }, 'store');
    expect(after).toMatchObject({ name: 'Exclusive Air', contactName: 'Zelda', vendorCode: 'V002', paymentTerms: '30 DAYS NETT', currency: 'EUR' });
    const entry = db.audit.find((a) => a.action === 'UPDATE')!;
    expect(entry).toMatchObject({ actorId: 'store', entityType: 'Supplier', entityId: s!.id });
    expect(entry.before).toMatchObject({ paymentTerms: null, currency: 'ZAR' });
  });

  it('clears an optional field with null or blank text', async () => {
    const s = await SupplierService.create({ name: 'Fast Flame', website: 'www.fastflame.co.za', address: '6 Alberdein Street' }, 'buyer');
    const after = await SupplierService.update({ id: s!.id, website: null, address: '   ' }, 'buyer');
    expect(after).toMatchObject({ website: null, address: null });
  });

  it('deactivates and reactivates', async () => {
    const s = await SupplierService.create({ name: 'BMG' }, 'buyer');
    expect((await SupplierService.update({ id: s!.id, active: false }, 'buyer'))!.active).toBe(false);
    expect((await SupplierService.update({ id: s!.id, active: true }, 'buyer'))!.active).toBe(true);
  });

  it('lets a supplier keep its own name and code', async () => {
    const s = await SupplierService.create({ name: 'Hydac', vendorCode: 'V006' }, 'buyer');
    await expect(SupplierService.update({ id: s!.id, name: 'HYDAC', vendorCode: 'V006' }, 'buyer')).resolves.toMatchObject({ name: 'HYDAC' });
  });

  it("refuses another supplier's name or vendor code", async () => {
    await SupplierService.create({ name: 'Hydac', vendorCode: 'V006' }, 'buyer');
    const s = await SupplierService.create({ name: 'Hansa Flex', vendorCode: 'V069' }, 'buyer');
    await expect(SupplierService.update({ id: s!.id, name: 'hydac' }, 'buyer')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(SupplierService.update({ id: s!.id, vendorCode: 'V006' }, 'buyer')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses an empty name', async () => {
    const s = await SupplierService.create({ name: 'Afrox' }, 'buyer');
    await expect(SupplierService.update({ id: s!.id, name: '  ' }, 'buyer')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('says when the supplier does not exist', async () => {
    await expect(SupplierService.update({ id: 'nope', name: 'X' }, 'buyer')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(SupplierService.getById('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
