// Material master CRUD with audit.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';

export interface CreateMaterialInput {
  sku: string;
  name: string;
  category: 'FASTENERS_SLUGS_INSULATION' | 'TOOLING_PPE_ELECTRICAL' | 'PROJECT_MATERIAL' | 'CONSUMABLES' | 'TOOLS';
  unitOfMeasure: string;
  requiredStock?: number;
  unitCost?: number;
  description?: string;
}

export interface UpdateMaterialInput {
  id: string;
  name?: string;
  description?: string;
  unitOfMeasure?: string;
  requiredStock?: number;
  unitCost?: number;
  active?: boolean;
}

export const MaterialService = {
  async list(filter: { category?: string; active?: boolean; q?: string } = {}) {
    const where: Prisma.MaterialWhereInput = {};
    if (filter.category) where.category = filter.category as Prisma.MaterialWhereInput['category'];
    if (filter.active !== undefined) where.active = filter.active;
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { sku: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    return prisma.material.findMany({ where, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  },

  async getById(id: string) {
    const m = await prisma.material.findUnique({ where: { id } });
    if (!m) throw Errors.notFound('Material');
    return m;
  },

  async create(input: CreateMaterialInput, actorId: string) {
    const sku = input.sku.trim();
    const existing = await prisma.material.findUnique({ where: { sku } });
    if (existing) throw Errors.conflict(`Material with SKU "${sku}" already exists`);

    const created = await prisma.material.create({
      data: {
        sku,
        name: input.name,
        category: input.category,
        unitOfMeasure: input.unitOfMeasure,
        requiredStock: input.requiredStock ?? 0,
        unitCost: input.unitCost ?? null,
        description: input.description ?? null,
      },
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
    return created;
  },

  async update(input: UpdateMaterialInput, actorId: string) {
    const before = await prisma.material.findUnique({ where: { id: input.id } });
    if (!before) throw Errors.notFound('Material');

    const data: Prisma.MaterialUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.unitOfMeasure !== undefined) data.unitOfMeasure = input.unitOfMeasure;
    if (input.requiredStock !== undefined) data.requiredStock = input.requiredStock;
    if (input.unitCost !== undefined) data.unitCost = input.unitCost;
    if (input.active !== undefined) data.active = input.active;

    const after = await prisma.material.update({ where: { id: input.id }, data });
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
    return after;
  },
};