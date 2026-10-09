// Loads the checked workbook plan into the platform: projects, recipients and
// suppliers, the locations, the items and one dated "Opening balance" receipt
// per item and location. All or nothing, in one database transaction.
// Projects, recipients and suppliers that already exist are left as they are.
//
// It runs once. It refuses when opening balances have been imported before
// (a second run would count the stock twice) or when any planned SKU already
// exists. To rehearse, import into a copy of the database and throw the copy
// away; the go-live import runs on production after the stock count.
import { randomUUID } from 'node:crypto';
import { InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal } from '../../shared/decimal.js';
import { recomputeBalance } from '../../shared/inventory/balances.js';
import type { MappedImport } from './mapping.js';
import type { MasterDataPlan } from './master-data.js';

export const OPENING_BALANCE_REFERENCE = 'OpeningBalance';

export interface OpeningBalanceInput {
  plan: MappedImport;
  /** Projects, recipients and suppliers from master-data.xlsx. */
  masterData?: MasterDataPlan;
  /** The date the balances are true on (the stock count). Not in the future. */
  openingDate: Date;
  actorId: string;
  /** Workbook file name, kept in the audit log. */
  sourceFile: string;
}

export interface OpeningBalanceResult {
  importId: string;
  locationsCreated: number;
  locationsReused: number;
  materialsCreated: number;
  balancesPosted: number;
  /** Rows with nothing on hand: the item is created, no receipt is posted. */
  zeroBalances: number;
  projects: { created: number; existing: number };
  recipients: { created: number; existing: number };
  suppliers: { created: number; existing: number };
}

export async function previousImport(): Promise<{ importId: string; postedAt: Date } | null> {
  const t = await prisma.inventoryTransaction.findFirst({
    where: { referenceType: OPENING_BALANCE_REFERENCE },
    orderBy: { postedAt: 'asc' },
    select: { referenceId: true, postedAt: true },
  });
  return t ? { importId: t.referenceId ?? '', postedAt: t.postedAt } : null;
}

export const OpeningBalanceService = {
  async import(input: OpeningBalanceInput): Promise<OpeningBalanceResult> {
    const { plan, openingDate, actorId } = input;
    if (Number.isNaN(openingDate.getTime())) throw Errors.validation('Invalid opening date');
    if (openingDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw Errors.validation('The opening date cannot be in the future');
    if (plan.materials.length === 0) throw Errors.validation('Nothing to import');
    const blocking = plan.problems.filter((p) => !['UNUSED_MAPPING_ROW', 'SKU_JOINS_DIFFERENT_NAMES'].includes(p.code));
    if (blocking.length > 0) throw Errors.validation(`The mapping has ${blocking.length} blocking problems; run the dry run and fix them first`);

    const importId = randomUUID();
    return prisma.$transaction(async (tx) => {
      // One import at a time, and never twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:opening-balance'))`;
      const earlier = await tx.inventoryTransaction.findFirst({
        where: { referenceType: OPENING_BALANCE_REFERENCE },
        select: { postedAt: true },
      });
      if (earlier) {
        throw Errors.invalidState(`Opening balances were already imported (dated ${earlier.postedAt.toISOString().slice(0, 10)}). Importing again would count the stock twice.`);
      }
      const actor = await tx.user.findUnique({ where: { id: actorId } });
      if (!actor || !actor.active) throw Errors.validation('The importing user does not exist or is inactive');

      const skus = plan.materials.map((m) => m.sku);
      const taken = await tx.material.findMany({ where: { sku: { in: skus, mode: 'insensitive' } }, select: { sku: true } });
      if (taken.length > 0) {
        throw Errors.conflict(`${taken.length} SKUs already exist, e.g. ${taken.slice(0, 5).map((t) => t.sku).join(', ')}. Change them in the mapping file.`);
      }

      const master = input.masterData ?? { projects: [], recipients: [], suppliers: [] };
      const projects = { created: 0, existing: 0 };
      for (const p of master.projects) {
        const existing = await tx.project.findFirst({ where: { projectNumber: { equals: p.projectNumber, mode: 'insensitive' } }, select: { projectNumber: true } });
        if (existing) { projects.existing++; continue; }
        await tx.project.create({ data: { projectNumber: p.projectNumber, name: p.name, status: 'ACTIVE' } });
        projects.created++;
      }
      const recipients = { created: 0, existing: 0 };
      for (const r of master.recipients) {
        const existing = await tx.recipient.findFirst({ where: { name: { equals: r.name, mode: 'insensitive' } }, select: { id: true } });
        if (existing) { recipients.existing++; continue; }
        await tx.recipient.create({ data: { name: r.name, type: r.type } });
        recipients.created++;
      }
      const suppliers = { created: 0, existing: 0 };
      for (const s of master.suppliers) {
        const existing = await tx.supplier.findFirst({ where: { name: { equals: s.name, mode: 'insensitive' } }, select: { id: true } });
        if (existing) { suppliers.existing++; continue; }
        await tx.supplier.create({ data: s });
        suppliers.created++;
      }

      // Locations: reuse one with the same name (any case), otherwise create it.
      const locationIds = new Map<string, string>();
      let locationsCreated = 0;
      for (const l of plan.locations) {
        const existing = await tx.location.findFirst({ where: { name: { equals: l.name, mode: 'insensitive' } }, select: { id: true } });
        if (existing) {
          locationIds.set(l.name, existing.id);
        } else {
          const created = await tx.location.create({ data: { name: l.name, type: l.type, createdById: actorId } });
          locationIds.set(l.name, created.id);
          locationsCreated++;
        }
      }

      const materials = plan.materials.map((m) => ({ id: randomUUID(), m }));
      await tx.material.createMany({
        data: materials.map(({ id, m }) => ({
          id,
          sku: m.sku,
          name: m.name,
          category: m.category,
          unitOfMeasure: m.unitOfMeasure,
          requiredStock: toDecimal(m.requiredStock),
          unitCost: m.unitCost === null ? null : toDecimal(m.unitCost),
          description: m.oldProductIds.length > 0 ? `Workbook Product ID: ${m.oldProductIds.join(', ')}` : null,
        })),
      });

      const receipts: Prisma.InventoryTransactionCreateManyInput[] = [];
      let zeroBalances = 0;
      for (const { id, m } of materials) {
        for (const b of m.balances) {
          const locationId = locationIds.get(b.location);
          if (!locationId) throw Errors.validation(`Location "${b.location}" is not in the plan`);
          if (b.quantity <= 0) { zeroBalances++; continue; }
          receipts.push({
            materialId: id,
            locationId,
            type: InventoryTransactionType.RECEIPT,
            quantity: toDecimal(b.quantity),
            referenceType: OPENING_BALANCE_REFERENCE,
            referenceId: importId,
            reasonNote: 'Opening balance from the stock workbook',
            actorId,
            postedAt: openingDate,
          });
        }
      }
      await tx.inventoryTransaction.createMany({ data: receipts });
      for (const r of receipts) await recomputeBalance(r.materialId, r.locationId, tx);

      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'IMPORT_OPENING_BALANCES',
          entityType: 'WorkbookImport',
          entityId: importId,
          after: {
            sourceFile: input.sourceFile,
            openingDate: openingDate.toISOString().slice(0, 10),
            materials: materials.length,
            locationsCreated,
            balances: receipts.length,
            projectsCreated: projects.created,
            recipientsCreated: recipients.created,
            suppliersCreated: suppliers.created,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        importId,
        locationsCreated,
        locationsReused: plan.locations.length - locationsCreated,
        materialsCreated: materials.length,
        balancesPosted: receipts.length,
        zeroBalances,
        projects,
        recipients,
        suppliers,
      };
    }, { timeout: 5 * 60_000, maxWait: 30_000 });
  },
};
