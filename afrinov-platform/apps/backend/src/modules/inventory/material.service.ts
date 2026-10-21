// Material master CRUD with audit. A tool kept as one unit can carry its serial
// number; nothing else can, and no two items share one. Each material is in
// the Stores or the Projects section (material-section.ts).
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { categoryWhere, checkMaterialChange, projectForNewMaterial, sectionOf, type MaterialSection } from './material-section.js';

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
  active?: boolean;
  serialNumber?: string | null;
  /** Projects material only: assigns its project. */
  projectNumber?: string;
}

const withProject = { project: { select: { projectNumber: true, name: true, status: true } } } as const;

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
    const projectNumber = await projectForNewMaterial(input, prisma);

    const created = await prisma.material.create({
      data: {
        sku,
        name: input.name,
        category: input.category,
        unitOfMeasure: input.unitOfMeasure,
        requiredStock: input.requiredStock ?? 0,
        unitCost: input.unitCost ?? null,
        description: input.description ?? null,
        serialNumber,
        projectNumber,
      },
      include: withProject,
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'CREATE',
        entityType: 'Material',
        entityId: created.id,
        after: created as unknown as Prisma.InputJsonValue,
      },
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
    if (input.unitOfMeasure !== undefined) data.unitOfMeasure = input.unitOfMeasure;
    if (input.requiredStock !== undefined) data.requiredStock = input.requiredStock;
    if (input.unitCost !== undefined) data.unitCost = input.unitCost;
    if (input.active !== undefined) data.active = input.active;
    if (input.serialNumber !== undefined) {
      const serialNumber = input.serialNumber?.trim() || null;
      if (serialNumber) await checkSerial(serialNumber, before.category, before.id);
      data.serialNumber = serialNumber;
    }

    const after = await prisma.material.update({ where: { id: input.id }, data, include: withProject });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'UPDATE',
        entityType: 'Material',
        entityId: input.id,
        before: before as unknown as Prisma.InputJsonValue,
        after: after as unknown as Prisma.InputJsonValue,
      },
    });
    return shape(after);
  },
};