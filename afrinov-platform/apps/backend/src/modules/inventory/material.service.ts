// Material master CRUD with audit. A tool kept as one unit can carry its serial
// number; nothing else can, and no two items share one. Each material is in
// the Stores or the Projects section (material-section.ts).
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { categoryWhere, checkMaterialChange, projectForNewMaterial, sectionOf, type MaterialSection } from './material-section.js';
import { checkQuantityForUnit, checkUnitOfMeasure } from '../../shared/units.js';
import { checkStatusReason, type MaterialStatusReasonCode } from './material-status.js';

export interface CreateMaterialInput {
  sku: string;
  name: string;
  category: 'FASTENERS_SLUGS_INSULATION' | 'TOOLING_PPE_ELECTRICAL' | 'PROJECT_MATERIAL' | 'CONSUMABLES' | 'TOOLS';
  unitOfMeasure: string;
  requiredStock?: number;
  unitCost?: number;
  description?: string;
  serialNumber?: string;
  /** Projects material only: the project it is bought for. */
  projectNumber?: string;
  /** Each issue is later marked used up or broken. Never on a tool. */
  trackUse?: boolean;
}

export interface SetMaterialStatusInput {
  id: string;
  active: boolean;
  reasonCode: MaterialStatusReasonCode;
  note?: string;
}

export interface UpdateMaterialInput {
  id: string;
  name?: string;
  /** null clears it. */
  description?: string | null;
  unitOfMeasure?: string;
  requiredStock?: number;
  /** null clears it. */
  unitCost?: number | null;
  serialNumber?: string | null;
  /** Projects material only: assigns its project. */
  projectNumber?: string;
  trackUse?: boolean;
}

// Active too, so an order doesn't suggest a deactivated project from an item's tag (Qodo, PR #130).
const withProject = { project: { select: { projectNumber: true, name: true, status: true, active: true } } } as const;

/** A material as the API returns it: with its section and project. */
function shape<M extends { category: string }>(m: M) {
  return { ...m, section: sectionOf(m.category) };
}

/** Refuses a serial number on anything but a tool, or one another item already has. */
async function checkSerial(serialNumber: string, category: string, exceptId?: string) {
  if (category !== 'TOOLS') throw Errors.validation('Only tools have a serial number');
  const holder = await prisma.material.findFirst({ where: { serialNumber: { equals: serialNumber, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { sku: true } });
  if (holder) throw Errors.conflict(`Serial number "${serialNumber}" is already on ${holder.sku}`);
}

/**
 * Refuses a move to a counted unit while the item holds part of one on hand: it
 * could then never be moved. The item's row is held FOR UPDATE first; every
 * movement checked against the unit holds it FOR SHARE (holdUnits), so a
 * movement that adds a part-unit either commits before this looks, and is
 * seen, or waits and is checked against the counted unit.
 */
async function refusePartUnits(materialId: string, name: string, unit: string, tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT 1 FROM materials WHERE id = ${materialId} FOR UPDATE`;
  const parts = (await tx.inventoryBalance.findMany({
    where: { materialId, quantity: { not: 0 } },
    select: { quantity: true, location: { select: { name: true } } },
  })).filter((b) => !b.quantity.isInteger());
  if (parts.length > 0) {
    throw Errors.validation(
      `${name} holds part of a unit (${parts.slice(0, 3).map((b) => `${b.quantity.toString()} at ${b.location.name}`).join(', ')}), so it can't be counted in whole ${unit} yet. Count it to a whole number on Count stock first.`,
      { field: 'unitOfMeasure' },
    );
  }
}

/** Tools are lent and come back, so there is nothing to mark used up or broken. */
function checkTrackUse(trackUse: boolean | undefined, category: string) {
  if (trackUse && category === 'TOOLS') throw Errors.validation('Tools are lent and checked back in, so they do not track use after issue');
}

export const MaterialService = {
  async list(filter: { category?: string; active?: boolean; q?: string; section?: MaterialSection; projectNumber?: string } = {}) {
    const where: Prisma.MaterialWhereInput = {};
    if (filter.section) where.category = categoryWhere(filter.section);
    if (filter.category) where.category = filter.category as Prisma.MaterialWhereInput['category'];
    if (filter.projectNumber) where.projectNumber = filter.projectNumber;
    if (filter.active !== undefined) where.active = filter.active;
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { sku: { contains: filter.q, mode: 'insensitive' } },
        { serialNumber: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.material.findMany({ where, include: withProject, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return rows.map(shape);
  },

  async getById(id: string) {
    const m = await prisma.material.findUnique({ where: { id }, include: withProject });
    if (!m) throw Errors.notFound('Material');
    return shape(m);
  },

  async create(input: CreateMaterialInput, actorId: string) {
    const sku = input.sku.trim();
    const existing = await prisma.material.findUnique({ where: { sku } });
    if (existing) throw Errors.conflict(`Material with SKU "${sku}" already exists`);
    const serialNumber = input.serialNumber?.trim() || null;
    if (serialNumber) await checkSerial(serialNumber, input.category);
    checkTrackUse(input.trackUse, input.category);
    const projectNumber = await projectForNewMaterial(input, prisma);
    const unit = await checkUnitOfMeasure(input.unitOfMeasure, prisma);
    if (input.requiredStock !== undefined) checkQuantityForUnit(input.name, unit, input.requiredStock, 'requiredStock');

    const created = await prisma.$transaction(async (tx) => {
      const material = await tx.material.create({
        data: {
          sku,
          name: input.name,
          category: input.category,
          unitOfMeasure: unit.code,
          requiredStock: input.requiredStock ?? 0,
          unitCost: input.unitCost ?? null,
          description: input.description ?? null,
          serialNumber,
          projectNumber,
          trackUse: input.trackUse ?? false,
        },
        include: withProject,
      });
      // The material row and its audit record commit together, so a change can
      // never be recorded without the history entry that explains it.
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'Material',
          entityId: material.id,
          after: material as unknown as Prisma.InputJsonValue,
        },
      });
      return material;
    });
    return shape(created);
  },

  async update(input: UpdateMaterialInput, actorId: string) {
    const before = await prisma.material.findUnique({ where: { id: input.id } });
    if (!before) throw Errors.notFound('Material');

    const projectNumber = await checkMaterialChange(before, input, prisma);
    const data: Prisma.MaterialUncheckedUpdateInput = {};
    if (projectNumber !== undefined) data.projectNumber = projectNumber;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    // A unit sent unchanged is kept as it is, so an item still on a unit marked
    // for review can be edited without choosing a new one first.
    const newUnit = input.unitOfMeasure !== undefined && input.unitOfMeasure.trim() !== before.unitOfMeasure
      ? await checkUnitOfMeasure(input.unitOfMeasure, prisma)
      : null;
    if (newUnit) data.unitOfMeasure = newUnit.code;
    // Moved to a counted unit, a part-unit Required Stock is made whole first;
    // the stock on hand is checked under the lock, below.
    if (newUnit?.kind === 'COUNTED' && input.requiredStock === undefined) {
      checkQuantityForUnit(input.name ?? before.name, newUnit, before.requiredStock, 'requiredStock');
    }
    if (input.requiredStock !== undefined) {
      const unit = newUnit ?? await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: before.unitOfMeasure }, select: { code: true, kind: true } });
      checkQuantityForUnit(input.name ?? before.name, unit, input.requiredStock, 'requiredStock');
      data.requiredStock = input.requiredStock;
    }
    if (input.unitCost !== undefined) data.unitCost = input.unitCost;
    if (input.trackUse !== undefined) {
      checkTrackUse(input.trackUse, before.category);
      data.trackUse = input.trackUse;
    }
    if (input.serialNumber !== undefined) {
      const serialNumber = input.serialNumber?.trim() || null;
      if (serialNumber) await checkSerial(serialNumber, before.category, before.id);
      data.serialNumber = serialNumber;
    }

    const after = await prisma.$transaction(async (tx) => {
      if (newUnit?.kind === 'COUNTED') await refusePartUnits(before.id, input.name ?? before.name, newUnit.code, tx);
      const material = await tx.material.update({ where: { id: input.id }, data, include: withProject });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'UPDATE',
          entityType: 'Material',
          entityId: input.id,
          before: before as unknown as Prisma.InputJsonValue,
          after: material as unknown as Prisma.InputJsonValue,
        },
      });
      return material;
    });
    return shape(after);
  },

  /**
   * The one way an item changes status (ADR-032). Its row is held FOR UPDATE
   * first; every movement holds it FOR SHARE (checkMaterialActive), so a
   * movement finishes before this looks, or waits and is refused. The status
   * record and the audit entry commit with the change. A change to the status
   * it already has does nothing, so a retry adds no second row.
   */
  async setStatus(input: SetMaterialStatusInput, actorId: string) {
    const note = input.note?.trim() || null;
    checkStatusReason(input.active, input.reasonCode, note);
    const after = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM materials WHERE id = ${input.id} FOR UPDATE`;
      const before = await tx.material.findUnique({ where: { id: input.id }, include: withProject });
      if (!before) throw Errors.notFound('Material');
      if (before.active === input.active) return before;
      const material = await tx.material.update({ where: { id: input.id }, data: { active: input.active }, include: withProject });
      await tx.materialStatusChange.create({
        data: { materialId: input.id, active: input.active, reasonCode: input.reasonCode, note, actorId },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: input.active ? 'ACTIVATE' : 'DEACTIVATE',
          entityType: 'Material',
          entityId: input.id,
          before: { sku: before.sku, name: before.name, active: before.active },
          after: { sku: before.sku, name: before.name, active: input.active, reasonCode: input.reasonCode, note },
        },
      });
      return material;
    });
    return shape(after);
  },
};