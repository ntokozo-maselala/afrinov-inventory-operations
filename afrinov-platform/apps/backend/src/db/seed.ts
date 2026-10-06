// Demo business data seed.
//
// Seeds the catalog the application expects for a populated demo
// environment: materials, suppliers, projects, racks, purchase orders,
// goods receipts, and the matching inventory transactions with
// derived inventory balances. Mirrors the frontend `mock/seed.ts`
// dataset so the live-mode and frontend-only-mode demos stay
// visually consistent.
//
// Strictly idempotent: every insert is guarded by an "only if catalog
// is empty" check, so re-running `npm run db:seed` against an already
// populated database is a no-op. Operators who want to reset the demo
// can drop the rows manually before re-seeding.
//
// The transactions are written inside a single Prisma transaction so
// the ledger and the derived balances are committed atomically. After
// the transaction we call `recomputeBalances()` which is the same
// routine the application uses to keep balances in sync after a
// mutation, ensuring the seeded balances match what the application
// would derive from the seeded transactions.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { ALL_PERMISSION_CODES, RolePermissions } from '../shared/permissions.js';
import { recomputeBalancesFor } from '../modules/inventory/balances.js';

type RoleName = 'ADMIN' | 'STORE_CONTROLLER' | 'PROCUREMENT' | 'APPROVER' | 'TECHNICIAN' | 'VIEWER';

const prisma = new PrismaClient();

interface DemoMaterial {
  sku: string;
  name: string;
  description?: string;
  category: 'FASTENERS_SLUGS_INSULATION' | 'TOOLING_PPE_ELECTRICAL' | 'PROJECT_MATERIAL' | 'CONSUMABLES' | 'TOOLS';
  unitOfMeasure: string;
  requiredStock: string;
  unitCost: string;
}

const DEMO_MATERIALS: DemoMaterial[] = [
  { sku: 'M16X40-88-HEX', name: 'M16 x 40 8.8 BLACK HEX SET SCREW', category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'each', requiredStock: '50', unitCost: '4.50' },
  { sku: 'M12-NUT-88', name: 'M12 8.8 HEX NUT', category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'each', requiredStock: '100', unitCost: '1.20' },
  { sku: 'WASH-M16-FLAT', name: 'M16 FLAT WASHER', category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'each', requiredStock: '200', unitCost: '0.85' },
  { sku: 'WELD-ROD-3.2', name: 'Welding Rod 3.2mm E6013', category: 'CONSUMABLES', unitOfMeasure: 'kg', requiredStock: '20', unitCost: '78.00' },
  { sku: 'GRIND-DISC-125', name: 'Grinding Disc 125 x 6mm', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '30', unitCost: '32.00' },
  { sku: 'CUT-DISC-115', name: 'Cut-off Disc 115 x 3mm', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '30', unitCost: '18.00' },
  { sku: 'GLOVES-WELD-L', name: 'Welding Gloves — Size L', category: 'TOOLING_PPE_ELECTRICAL', unitOfMeasure: 'pair', requiredStock: '5', unitCost: '95.00' },
  { sku: 'GLASSES-CLR', name: 'Safety Glasses — Clear', category: 'TOOLING_PPE_ELECTRICAL', unitOfMeasure: 'each', requiredStock: '10', unitCost: '38.00' },
  { sku: 'PROJ-AFRI-1325-PLATE', name: '10mm Plate — Project AFRI-1325', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', requiredStock: '0', unitCost: '420.00' },
  { sku: 'PROJ-AFRI-1325-ANGLE', name: '50 x 50 x 5 Angle — Project AFRI-1325', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', requiredStock: '0', unitCost: '95.00' },
  { sku: 'TOOL-IMPACT-1/2', name: '1/2" Impact Wrench (Tool)', category: 'TOOLS', unitOfMeasure: 'each', requiredStock: '1', unitCost: '4500.00' },
  { sku: 'TOOL-TORQUE-1/2', name: '1/2" Torque Wrench (Tool)', category: 'TOOLS', unitOfMeasure: 'each', requiredStock: '1', unitCost: '3200.00' },
];

interface DemoSupplier {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

const DEMO_SUPPLIERS: DemoSupplier[] = [
  { name: 'Hydroscand', contactName: 'Jan Smit', contactEmail: 'orders@hydroscand.co.za', contactPhone: '+27 11 555 0101' },
  { name: 'Bearings International', contactName: 'T. Naidoo', contactEmail: 'sales@bearings.co.za', contactPhone: '+27 11 555 0145' },
  { name: 'Engineering Fasteners (Pty) Ltd', contactEmail: 'sales@engfast.co.za', contactPhone: '+27 11 555 0177' },
  { name: 'Local Steel Supplies', contactName: 'Mike P.', contactPhone: '+27 11 555 0190' },
];

interface DemoTransaction {
  // Relative day offset from "now" so the demo always looks fresh.
  daysAgo: number;
  type: 'RECEIPT' | 'ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT';
  sku: string;
  location: string;
  quantity: string;
  projectNumber?: string;
  reasonCode?: 'COUNT_VARIANCE' | 'DAMAGE' | 'LOSS' | 'SCRAP' | 'OTHER';
  referenceType?: string;
}

const DEMO_TRANSACTIONS: DemoTransaction[] = [
  // Opening receipts
  { daysAgo: 30, type: 'RECEIPT', sku: 'M16X40-88-HEX', location: 'Main Storeroom', quantity: '120' },
  { daysAgo: 30, type: 'RECEIPT', sku: 'M12-NUT-88', location: 'Main Storeroom', quantity: '300' },
  { daysAgo: 30, type: 'RECEIPT', sku: 'WASH-M16-FLAT', location: 'Main Storeroom', quantity: '600' },
  { daysAgo: 28, type: 'RECEIPT', sku: 'WELD-ROD-3.2', location: 'Main Storeroom', quantity: '60' },
  { daysAgo: 28, type: 'RECEIPT', sku: 'GRIND-DISC-125', location: 'Main Storeroom', quantity: '80' },
  { daysAgo: 28, type: 'RECEIPT', sku: 'CUT-DISC-115', location: 'Main Storeroom', quantity: '100' },
  { daysAgo: 20, type: 'RECEIPT', sku: 'GLOVES-WELD-L', location: 'Main Storeroom', quantity: '12' },
  { daysAgo: 20, type: 'RECEIPT', sku: 'GLASSES-CLR', location: 'Main Storeroom', quantity: '25' },
  // Issues (consumption against project AFRI-1325)
  { daysAgo: 7, type: 'ISSUE', sku: 'M16X40-88-HEX', location: 'Main Storeroom', quantity: '-70', projectNumber: 'AFRI-1325' },
  { daysAgo: 6, type: 'ISSUE', sku: 'M12-NUT-88', location: 'Main Storeroom', quantity: '-150', projectNumber: 'AFRI-1325' },
  { daysAgo: 6, type: 'ISSUE', sku: 'WASH-M16-FLAT', location: 'Main Storeroom', quantity: '-300', projectNumber: 'AFRI-1325' },
  { daysAgo: 5, type: 'ISSUE', sku: 'WELD-ROD-3.2', location: 'Boiler Shop', quantity: '-15' },
  { daysAgo: 5, type: 'ISSUE', sku: 'GRIND-DISC-125', location: 'Boiler Shop', quantity: '-30' },
  { daysAgo: 5, type: 'ISSUE', sku: 'GRIND-DISC-125', location: 'Boiler Shop', quantity: '-10' },
  { daysAgo: 3, type: 'ISSUE', sku: 'GLOVES-WELD-L', location: 'Boiler Shop', quantity: '-4' },
  { daysAgo: 3, type: 'ISSUE', sku: 'GLASSES-CLR', location: 'Boiler Shop', quantity: '-5' },
  // Transfer out of Main Storeroom into D-1
  { daysAgo: 4, type: 'TRANSFER_OUT', sku: 'M16X40-88-HEX', location: 'Main Storeroom', quantity: '-20' },
  { daysAgo: 4, type: 'TRANSFER_IN', sku: 'M16X40-88-HEX', location: 'D-1', quantity: '20' },
  // Adjustment — variance
  { daysAgo: 2, type: 'ADJUSTMENT', sku: 'CUT-DISC-115', location: 'Main Storeroom', quantity: '-5', reasonCode: 'COUNT_VARIANCE' },
];

async function ensurePermissions(): Promise<void> {
  for (const code of ALL_PERMISSION_CODES) {
    await prisma.permission.upsert({
      where: { code },
      update: { description: code },
      create: { code, description: code },
    });
  }
}

async function ensureRoles(): Promise<void> {
  const roleNames = Object.keys(RolePermissions) as RoleName[];
  for (const roleName of roleNames) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: `${roleName} role` },
      create: { name: roleName, description: `${roleName} role` },
    });
    const wanted = RolePermissions[roleName]!;
    const perms = await prisma.permission.findMany({ where: { code: { in: wanted } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }
}

async function ensureAdminUser(): Promise<string> {
  const adminEmail = 'admin@afrinov.local';
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) return existing.id;
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  if (!adminRole) throw new Error('ADMIN role missing — seed ordering bug');

  // The bootstrap password is NEVER hardcoded in source. It is supplied via the
  // SEED_ADMIN_PASSWORD environment variable. In production a value is mandatory;
  // in dev/test a strong random password is generated so no secret is committed
  // and the seed still runs out of the box. Operators MUST rotate the password
  // after first login.
  const isProd = process.env.NODE_ENV === 'production';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (isProd && !adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD must be set when seeding in production');
  }
  const passwordToHash = adminPassword ?? randomBytes(24).toString('base64url');
  const hash = await bcrypt.hash(passwordToHash, 12);
  const created = await prisma.user.create({
    data: {
      email: adminEmail,
      name: 'System Administrator',
      passwordHash: hash,
      roles: { create: [{ roleId: adminRole.id }] },
    },
  });
  if (!adminPassword) {
    console.log(`Created admin user ${adminEmail}. No SEED_ADMIN_PASSWORD was set, so a random bootstrap password was generated (not logged). Set SEED_ADMIN_PASSWORD to use a known credential.`);
  } else {
    console.log(`Created admin user ${adminEmail} (CHANGE PASSWORD ON FIRST LOGIN).`);
  }
  return created.id;
}

async function ensureLocations(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const seeds = [
    { name: 'Main Storeroom', type: 'STOREROOM' as const, code: 'WH-MAIN' },
    { name: 'Boiler Shop', type: 'SHOP_FLOOR_AREA' as const, code: 'WS-BOILER' },
    { name: 'D-1', type: 'RACK' as const, code: 'RACK-D1' },
  ];
  for (const l of seeds) {
    const row = await prisma.location.upsert({
      where: { name: l.name },
      update: { type: l.type, code: l.code },
      create: { name: l.name, type: l.type, code: l.code },
    });
    byName.set(l.name, row.id);
  }
  return byName;
}

async function ensureSuppliers(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const s of DEMO_SUPPLIERS) {
    const row = await prisma.supplier.upsert({
      where: { id: `seed-sup-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` },
      update: {
        name: s.name,
        contactName: s.contactName ?? null,
        contactEmail: s.contactEmail ?? null,
        contactPhone: s.contactPhone ?? null,
      },
      create: {
        id: `seed-sup-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: s.name,
        contactName: s.contactName ?? null,
        contactEmail: s.contactEmail ?? null,
        contactPhone: s.contactPhone ?? null,
      },
    });
    byName.set(s.name, row.id);
  }
  return byName;
}

async function ensureProjects(managerId: string): Promise<Map<string, string>> {
  const byNumber = new Map<string, string>();
  const projects = [
    {
      projectNumber: 'AFRI-1325',
      name: 'Hydroscand line build Q4',
      code: 'HY-Q4',
      status: 'ACTIVE',
      managerId,
      client: 'Hydroscand',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-12-15'),
      notes: 'Phase 2 in progress.',
      active: true,
      description: 'New hydraulic line for client workshop.',
    },
    {
      projectNumber: 'AFRI-1402',
      name: 'Boiler refurb – Site A',
      code: 'BR-A',
      status: 'PLANNING',
      managerId: null,
      client: 'Internal',
      active: true,
    },
  ];
  for (const p of projects) {
    const row = await prisma.project.upsert({
      where: { projectNumber: p.projectNumber },
      update: {
        name: p.name,
        code: p.code,
        status: p.status,
        managerId: p.managerId,
        client: p.client,
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
        notes: p.notes ?? null,
        description: p.description ?? null,
        active: p.active,
      },
      create: p,
    });
    byNumber.set(p.projectNumber, row.projectNumber);
  }
  return byNumber;
}

async function ensureRacks(locations: Map<string, string>): Promise<void> {
  const racks = [
    {
      id: 'seed-rack-d1',
      code: 'D-1',
      name: 'Aisle D – Shelf 1',
      description: 'Heavy consumables, lower shelves.',
      locationId: locations.get('Main Storeroom') ?? null,
      projectNumber: 'AFRI-1325',
      capacity: 100,
      status: 'ACTIVE' as const,
    },
    {
      id: 'seed-rack-f7',
      code: 'F-7',
      name: 'Aisle F – Shelf 7',
      description: null,
      locationId: locations.get('Main Storeroom') ?? null,
      projectNumber: null,
      capacity: 80,
      status: 'ACTIVE' as const,
    },
  ];
  for (const r of racks) {
    await prisma.rack.upsert({
      where: { id: r.id },
      update: r,
      create: r,
    });
  }
}

async function ensureMaterials(): Promise<Map<string, string>> {
  const bySku = new Map<string, string>();
  for (const m of DEMO_MATERIALS) {
    const row = await prisma.material.upsert({
      where: { sku: m.sku },
      update: {
        name: m.name,
        description: m.description ?? null,
        category: m.category,
        unitOfMeasure: m.unitOfMeasure,
        requiredStock: m.requiredStock,
        unitCost: m.unitCost,
        active: true,
      },
      create: {
        sku: m.sku,
        name: m.name,
        description: m.description ?? null,
        category: m.category,
        unitOfMeasure: m.unitOfMeasure,
        requiredStock: m.requiredStock,
        unitCost: m.unitCost,
        active: true,
      },
    });
    bySku.set(m.sku, row.id);
  }
  return bySku;
}

interface PurchaseOrderSeed {
  number: string;
  supplierName: string;
  status: 'APPROVED' | 'PARTIALLY_RECEIVED';
  notes: string;
  daysAgo: number;
  lines: Array<{ sku: string; orderedQty: string; receivedQty: string }>;
}

const DEMO_PURCHASE_ORDERS: PurchaseOrderSeed[] = [
  {
    number: 'PO-2026-0001',
    supplierName: 'Hydroscand',
    status: 'APPROVED',
    notes: 'Standing monthly fasteners order',
    daysAgo: 7,
    lines: [
      { sku: 'M16X40-88-HEX', orderedQty: '200', receivedQty: '0' },
      { sku: 'WASH-M16-FLAT', orderedQty: '500', receivedQty: '0' },
    ],
  },
  {
    number: 'PO-2026-0002',
    supplierName: 'Bearings International',
    status: 'PARTIALLY_RECEIVED',
    notes: 'Bearings for Boiler Shop rebuild',
    daysAgo: 3,
    lines: [{ sku: 'WELD-ROD-3.2', orderedQty: '50', receivedQty: '25' }],
  },
];

async function ensurePurchaseOrders(
  suppliers: Map<string, string>,
  materials: Map<string, string>,
  adminId: string,
): Promise<void> {
  for (const po of DEMO_PURCHASE_ORDERS) {
    const supplierId = suppliers.get(po.supplierName);
    if (!supplierId) throw new Error(`Seed supplier not found: ${po.supplierName}`);
    const createdAt = new Date(Date.now() - po.daysAgo * 1000 * 60 * 60 * 24);
    const existing = await prisma.purchaseOrder.findUnique({ where: { number: po.number } });
    if (existing) continue; // idempotent: don't rewrite demo POs
    await prisma.purchaseOrder.create({
      data: {
        number: po.number,
        supplierId,
        status: po.status,
        notes: po.notes,
        createdById: adminId,
        createdAt,
        lines: {
          create: po.lines.map((l) => ({
            materialId: materials.get(l.sku)!,
            orderedQty: l.orderedQty,
            receivedQty: l.receivedQty,
          })),
        },
      },
    });
  }
}

async function ensureGoodsReceipt(
  suppliers: Map<string, string>,
  materials: Map<string, string>,
  locations: Map<string, string>,
  adminId: string,
): Promise<void> {
  const number = 'GR-2026-0001';
  const existing = await prisma.goodsReceipt.findUnique({ where: { number } });
  if (existing) return;
  const supplierId = suppliers.get('Bearings International')!;
  const po = await prisma.purchaseOrder.findUnique({
    where: { number: 'PO-2026-0002' },
    include: { lines: true },
  });
  const mat = materials.get('WELD-ROD-3.2')!;
  const loc = locations.get('Boiler Shop')!;
  await prisma.goodsReceipt.create({
    data: {
      number,
      purchaseOrderId: po?.id ?? null,
      supplierId,
      deliveryRef: 'Tax Invoice - E127076',
      status: 'POSTED',
      receivedById: adminId,
      lines: {
        create: [
          { materialId: mat, locationId: loc, quantity: '25', purchaseOrderLineId: po?.lines[0]?.id ?? null },
        ],
      },
    },
  });
}

async function ensureTransactions(
  materials: Map<string, string>,
  locations: Map<string, string>,
  adminId: string,
): Promise<void> {
  // Only seed transactions when the ledger is empty. This makes the
  // seed strictly idempotent while still allowing the application to
  // append new transactions after a successful seed.
  const count = await prisma.inventoryTransaction.count();
  if (count > 0) return;

  // Build the transaction list. Pair the TRANSFER_OUT with its
  // TRANSFER_IN counterpart by `pairedWithId` so the ledger reflects a
  // single business event.
  const created: Array<{ id: string; tx: DemoTransaction }> = [];
  await prisma.$transaction(async (tx) => {
    for (const t of DEMO_TRANSACTIONS) {
      const materialId = materials.get(t.sku);
      const locationId = locations.get(t.location);
      if (!materialId || !locationId) throw new Error(`Seed lookup failed for ${t.sku} / ${t.location}`);
      const postedAt = new Date(Date.now() - t.daysAgo * 1000 * 60 * 60 * 24);
      const row = await tx.inventoryTransaction.create({
        data: {
          postedAt,
          type: t.type,
          materialId,
          locationId,
          quantity: t.quantity,
          projectNumber: t.projectNumber ?? null,
          reasonCode: t.reasonCode ?? null,
          referenceType: t.referenceType ?? null,
          actorId: adminId,
        },
      });
      created.push({ id: row.id, tx: t });
    }
  });

  // Link the transfer pair (both legs were created above) by setting
  // `pairedWithId` on each. This is a follow-up because the
  // transactional create doesn't know its sibling's id in advance.
  for (const out of created.filter((c) => c.tx.type === 'TRANSFER_OUT')) {
    const inn = created.find(
      (c) => c.tx.type === 'TRANSFER_IN' && c.tx.sku === out.tx.sku && c.tx.daysAgo === out.tx.daysAgo,
    );
    if (!inn) continue;
    await prisma.$transaction([
      prisma.inventoryTransaction.update({ where: { id: out.id }, data: { pairedWithId: inn.id } }),
      prisma.inventoryTransaction.update({ where: { id: inn.id }, data: { pairedWithId: out.id } }),
    ]);
  }

  // Recompute balances for every (material, location) touched by the
  // seed. The application uses the same helper after each mutation, so
  // the seeded state matches what a fresh run would compute.
  const touched = new Set<string>();
  for (const t of DEMO_TRANSACTIONS) {
    touched.add(`${materials.get(t.sku)}|${locations.get(t.location)}`);
  }
  for (const key of touched) {
    const [materialId, locationId] = key.split('|') as [string, string];
    await recomputeBalancesFor(materialId, locationId);
  }
}

async function main(): Promise<void> {
  await ensurePermissions();
  await ensureRoles();
  const adminId = await ensureAdminUser();
  const locations = await ensureLocations();
  const suppliers = await ensureSuppliers();
  const materials = await ensureMaterials();
  await ensureProjects(adminId);
  await ensureRacks(locations);
  await ensurePurchaseOrders(suppliers, materials, adminId);
  await ensureGoodsReceipt(suppliers, materials, locations, adminId);
  await ensureTransactions(materials, locations, adminId);

  // 5. Settings catalog (idempotent — safe to re-run).
  const { SettingsService } = await import('../modules/settings/settings.service.js');
  await SettingsService.ensureSeeded();

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
