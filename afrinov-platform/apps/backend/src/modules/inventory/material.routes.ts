import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MaterialService } from './material.service.js';
import { STATUS_REASONS, type MaterialStatusReasonCode } from './material-status.js';
import { CatalogueService } from './catalogue.service.js';
import { LocationService } from './location.service.js';
import { idempotentMutation } from '../../shared/idempotency.js';
import { LEFTOVER_CATEGORIES, ProjectLeftoversService } from './project-leftovers.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission, userHasPermission } from '../../shared/authorization.js';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { listUnits } from '../../shared/units.js';

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
  /** Mark each issue used up or broken later (discs, blades, bits). Never on a tool. */
  trackUse: z.boolean().optional(),
});

export const updateMaterialSchema = z.object({
  name: z.string().min(1).optional(),
  /** null clears it. */
  description: z.string().nullable().optional(),
  unitOfMeasure: z.string().min(1).optional(),
  requiredStock: z.number().nonnegative().optional(),
  /** null clears it: the item then has no price. A change needs edit:unit_cost and a reason (ADR-039). */
  unitCost: z.number().nonnegative().nullable().optional(),
  unitCostReason: z.string().trim().max(500).optional(),
  /** Tools only; null clears it. */
  serialNumber: z.string().trim().min(1).max(64).nullable().optional(),
  /** Project Material only: assigns its project. */
  projectNumber: z.string().trim().min(1).max(64).optional(),
  /** Never on a tool. Switching it off keeps the outcomes already recorded. */
  trackUse: z.boolean().optional(),
});

export const materialStatusSchema = z.object({
  active: z.boolean(),
  /** From the list for that change (material-status.ts). */
  reasonCode: z.enum(STATUS_REASONS),
  /** Required when the reason is OTHER. */
  note: z.string().trim().max(500).optional(),
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

/**
 * A closed project's leftovers to move to Stores (Phase 7), each with the Stores
 * category it becomes. Left out for an item that keeps its category (a Stores
 * item, or another project's item) whose held stock alone moves (Qodo, PR #149).
 */
export const moveLeftoversSchema = z.object({
  items: z.array(z.object({ materialId: z.string().min(1), category: z.enum(LEFTOVER_CATEGORIES).optional() })).min(1).max(500),
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

  // How the catalogue adds up against Stock and Tools (ADR-031). It says what is
  // in stock, so it takes the permission Stock does.
  app.get('/materials/summary', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    return CatalogueService.summary();
  });

  // The units an item can have, and whether each is counted or measured.
  app.get('/units-of-measure', { preHandler: [app.authenticate] }, async () => listUnits(prisma));

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
    return MaterialService.create(parsed.data, actorId, { canSetCost: await userHasPermission(req, PermissionCode.EditUnitCost) });
  });

  app.patch('/materials/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    // A change of unit cost alone is for whoever sets costs (Procurement, Admin),
    // who may not edit the rest of the item (system audit C1).
    const fields = Object.keys((req.body as Record<string, unknown> | null) ?? {});
    const costOnly = fields.length > 0 && fields.every((f) => f === 'unitCost' || f === 'unitCostReason');
    const canSetCost = await userHasPermission(req, PermissionCode.EditUnitCost);
    if (!(costOnly && canSetCost)) await requirePermission(req, PermissionCode.EditMaterial);
    const id = (req.params as { id: string }).id;
    // Refused rather than ignored: an item's status changes only with a reason, on its own route.
    if ((req.body as { active?: unknown } | null)?.active !== undefined) {
      throw Errors.validation('An item is deactivated or reactivated on its status route, with a reason', { field: 'active' });
    }
    const parsed = updateMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid material payload', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    return MaterialService.update({ id, ...parsed.data }, actorId, { canSetCost });
  });

  // System audit C3: every change of the item's unit cost, with who and why.
  app.get('/materials/:id/cost-history', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    return MaterialService.costHistory((req.params as { id: string }).id);
  });

  app.get('/materials/:id/deactivation-check', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.EditMaterial);
    return MaterialService.deactivationCheck((req.params as { id: string }).id);
  });

  app.patch('/materials/:id/status', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.EditMaterial);
    const id = (req.params as { id: string }).id;
    const parsed = materialStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Choose a reason for the change', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    return MaterialService.setStatus({ id, ...parsed.data, reasonCode: parsed.data.reasonCode as MaterialStatusReasonCode }, actorId);
  });

  // Projects items with no project still in stock: they aren't issued, so they
  // move to Stores (Project on the Order Roadmap, Phase 1). Their own route, so
  // no project number can be mistaken for them.
  app.get('/materials/no-project/leftovers', { preHandler: [app.authenticate] }, async () => ProjectLeftoversService.listUnassigned());

  app.post('/materials/no-project/leftovers/move', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.EditMaterial);
    const parsed = moveLeftoversSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid move payload', details: parsed.error.flatten() },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    // Retry-safe, as every stock movement is (system audit B3).
    return idempotentMutation(req, reply, 'POST /materials/no-project/leftovers/move', async (tx) => ({
      statusCode: 200,
      body: await ProjectLeftoversService.moveToStores(null, parsed.data.items, actorId, tx),
    }));
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
    return idempotentMutation(req, reply, 'POST /projects/:projectNumber/leftovers/move', async (tx) => ({
      statusCode: 200,
      body: await ProjectLeftoversService.moveToStores(projectNumber, parsed.data.items, actorId, tx),
    }));
  });
}

const locationTypeEnum = z.enum(['RACK', 'STOREROOM', 'SHOP_FLOOR_AREA', 'CONTAINER', 'OFF_SITE']);

export const createLocationSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(32).optional(),
  type: locationTypeEnum,
  active: z.boolean().optional(),
  // The room or area it stands in (one level; never a rack).
  parentId: z.uuid().optional(),
  address: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  contactPerson: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  contactEmail: z.email().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(32).nullable().optional(),
  type: locationTypeEnum.optional(),
  active: z.boolean().optional(),
  // The room or area it stands in; null takes it out.
  parentId: z.uuid().nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  contactPerson: z.string().max(120).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  contactEmail: z.email().max(120).nullable().optional(),
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

  // System audit A1: what must be dealt with before the location can be deactivated.
  app.get('/locations/:id/deactivation-check', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageLocationStatus);
    const id = (req.params as { id: string }).id;
    return LocationService.deactivationCheck(id);
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