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
import { recomputeBalance, lockInventoryBalances } from '../../shared/inventory/balances.js';
import { assertParent, lockLocationTree } from '../inventory/location.service.js';
import type { MappedImport } from './mapping.js';
import { PROBLEM_TEXT } from './workbook-analysis.js';
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
  /** Existing locations the mapping put in a room. */
  locationsMoved: number;
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
    const blocking = plan.problems.filter((p) => PROBLEM_TEXT[p.code].severity === 'error');
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
      const serials = plan.materials.map((m) => m.serialNumber).filter((x): x is string => !!x);
      const serialTaken = serials.length === 0 ? [] : await tx.material.findMany({ where: { serialNumber: { in: serials, mode: 'insensitive' } }, select: { sku: true, serialNumber: true } });
      if (serialTaken.length > 0) {
        throw Errors.conflict(`${serialTaken.length} serial numbers are already on items, e.g. ${serialTaken.slice(0, 5).map((t) => `${t.serialNumber} (${t.sku})`).join(', ')}. Change them in the mapping file.`);
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
      // Each goes in its room (rooms come first in the plan), by the Locations
      // page's rules and under its lock, so an edit there cannot cross the import.
      await lockLocationTree(tx);
      const locationIds = new Map<string, string>();
      let locationsCreated = 0;
      let locationsMoved = 0;
      for (const l of plan.locations) {
        const parentId = l.parent ? locationIds.get(l.parent) : undefined;
        if (l.parent && !parentId) throw Errors.validation(`The room "${l.parent}" for "${l.name}" is not in the plan`);
        const existing = await tx.location.findFirst({ where: { name: { equals: l.name, mode: 'insensitive' } } });
        if (existing) {
          // Rack or not decides what may stand inside it, so the two must agree.
          // Other kinds (a storeroom the mapping calls a container) keep the platform's.
          if ((existing.type === 'RACK') !== (l.type === 'RACK')) {
            throw Errors.conflict(`${existing.name} is a ${existing.type.toLowerCase().replace(/_/g, ' ')} in the platform; the mapping file makes it a ${l.type.toLowerCase().replace(/_/g, ' ')}. Change its type on the Locations page, or in the mapping file.`);
          }
          locationIds.set(l.name, existing.id);
          if (parentId && existing.parentId !== parentId) {
            if (existing.parentId) {
              throw Errors.conflict(`${existing.name} is already inside another location; the mapping file puts it in ${l.parent}. Move it on the Locations page, or change the mapping file.`);
            }
            await assertParent(tx, parentId, existing);
            // Recorded as the Locations page records a move.
            const moved = await tx.location.update({ where: { id: existing.id }, data: { parentId, updatedById: actorId } });
            await tx.auditLogEntry.create({
              data: {
                actorId, action: 'UPDATE', entityType: 'Location', entityId: existing.id,
                before: existing as unknown as Prisma.InputJsonValue, after: moved as unknown as Prisma.InputJsonValue,
              },
            });
            locationsMoved++;
          }
        } else {
          if (parentId) await assertParent(tx, parentId);
          const created = await tx.location.create({ data: { name: l.name, type: l.type, parentId: parentId ?? null, createdById: actorId } });
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
          // Project material is bought per job and never re-ordered (materials
          // sections roadmap); it lands with no project, to be assigned in the app.
          requiredStock: m.category === 'PROJECT_MATERIAL' ? toDecimal(0) : toDecimal(m.requiredStock),
          unitCost: m.unitCost === null ? null : toDecimal(m.unitCost),
          serialNumber: m.serialNumber,
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
      await lockInventoryBalances(receipts, tx);
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
            locationsMoved,
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
        locationsMoved,
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
