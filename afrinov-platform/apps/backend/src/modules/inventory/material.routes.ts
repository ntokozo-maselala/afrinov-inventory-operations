import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MaterialService } from './material.service.js';
import { LocationService } from './location.service.js';
import { LEFTOVER_CATEGORIES, ProjectLeftoversService } from './project-leftovers.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

export const createMaterialSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['FASTENERS_SLUGS_INSULATION', 'TOOLING_PPE_ELECTRICAL', 'PROJECT_MATERIAL', 'CONSUMABLES', 'TOOLS']),
  unitOfMeasure: z.string().min(1),
  requiredStock: z.number().nonnegative().optional(),
  unitCost: z.number().nonnegative().optional(),
  description: z.string().optional(),
  /** Tools only: the serial number of a tool kept as one unit. */
  serialNumber: z.string().trim().min(1).max(64).optional(),
  /** Project Material only, and required there: the project it is bought for. */
  projectNumber: z.string().trim().min(1).max(64).optional(),
});

export const updateMaterialSchema = z.object({
  name: z.string().min(1).optional(),
  /** null clears it. */
  description: z.string().nullable().optional(),
  unitOfMeasure: z.string().min(1).optional(),
  requiredStock: z.number().nonnegative().optional(),
  /** null clears it: the item then has no price. */
  unitCost: z.number().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
  /** Tools only; null clears it. */
  serialNumber: z.string().trim().min(1).max(64).nullable().optional(),
  /** Project Material only: assigns its project. */
  projectNumber: z.string().trim().min(1).max(64).optional(),
});

export const listMaterialsQuerySchema = z.object({
  category: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
  /** Stores (every category but Project Material) or Projects (Project Material). */
  section: z.enum(['STORES', 'PROJECTS']).optional(),
  /** Projects material for one project. */
  projectNumber: z.string().max(64).optional(),
});

/** A closed project's leftovers to move to Stores, each with its Stores category (Phase 7). */
export const moveLeftoversSchema = z.object({
  items: z.array(z.object({ materialId: z.string().min(1), category: z.enum(LEFTOVER_CATEGORIES) })).min(1).max(500),
});

export async function materialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/materials', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = listMaterialsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid materials filter', details: parsed.error.flatten() },
      });
    }
    const q = parsed.data;
    return MaterialService.list({
      category: q.category,
      active: q.active === 'true' ? true : q.active === 'false' ? false : undefined,
      q: q.q,
      section: q.section,
      projectNumber: q.projectNumber,
    });
  });

  app.get('/materials/:id', { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    return MaterialService.getById(id);
  });

  app.post('/materials', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreateMaterial);
    const parsed = createMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid material payload', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    return MaterialService.create(parsed.data, actorId);
  });

  app.patch('/materials/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.EditMaterial);
    const id = (req.params as { id: string }).id;
    const parsed = updateMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid material payload', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    return MaterialService.update({ id, ...parsed.data }, actorId);
  });

  // A project's material still in stock: once it is closed, its leftovers to move to Stores.
  app.get('/projects/:projectNumber/leftovers', { preHandler: [app.authenticate] }, async (req) => {
    const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
    return ProjectLeftoversService.list(projectNumber);
  });

  app.post('/projects/:projectNumber/leftovers/move', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.EditMaterial);
    const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
    const parsed = moveLeftoversSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid move payload', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    return ProjectLeftoversService.moveToStores(projectNumber, parsed.data.items, actorId);
  });
}

const locationTypeEnum = z.enum(['RACK', 'STOREROOM', 'SHOP_FLOOR_AREA', 'CONTAINER', 'OFF_SITE']);

export const createLocationSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(32).optional(),
  type: locationTypeEnum,
  active: z.boolean().optional(),
  // The room or area it stands in (one level; never a rack).
  parentId: z.string().uuid().optional(),
  address: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  contactPerson: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  contactEmail: z.string().email().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(32).nullable().optional(),
  type: locationTypeEnum.optional(),
  active: z.boolean().optional(),
  // The room or area it stands in; null takes it out.
  parentId: z.string().uuid().nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  contactPerson: z.string().max(120).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  contactEmail: z.string().email().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const locationStatusSchema = z.object({
  active: z.boolean(),
});

export async function locationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/locations', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return LocationService.list({
      q: q['q'],
      type: q['type'] as 'RACK' | 'STOREROOM' | 'SHOP_FLOOR_AREA' | 'CONTAINER' | 'OFF_SITE' | undefined,
      active: q['active'] === 'true' ? true : q['active'] === 'false' ? false : undefined,
      parentId: q['parentId'] || undefined,
    });
  });

  app.get('/locations/:id', { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    return LocationService.getById(id);
  });

  app.post('/locations', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreateLocation);
    const parsed = createLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid location payload', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    const created = await LocationService.create(parsed.data, actorId);
    return reply.code(201).send(created);
  });

  app.patch('/locations/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.EditLocation);
    const id = (req.params as { id: string }).id;
    const parsed = updateLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid location payload', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    return LocationService.update({ id, ...parsed.data }, actorId);
  });

  app.patch('/locations/:id/status', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageLocationStatus);
    const id = (req.params as { id: string }).id;
    const parsed = locationStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid status payload', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    return LocationService.setStatus(id, parsed.data.active, actorId);
  });

  app.delete('/locations/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.DeleteLocation);
    const id = (req.params as { id: string }).id;
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    await LocationService.remove(id, actorId);
    return reply.code(204).send();
  });
}