import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProjectService, PROJECT_STATUSES, type ProjectStatus } from './project.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

const projectStatusEnum = z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]);

const createProjectSchema = z.object({
  projectNumber: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  code: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  status: projectStatusEnum.optional(),
  managerId: z.string().uuid().optional(),
  client: z.string().max(200).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
  active: z.boolean().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(64).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  status: projectStatusEnum.optional(),
  managerId: z.string().uuid().nullable().optional(),
  client: z.string().max(200).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return ProjectService.list({
      q: q['q'],
      status: q['status'] as 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | undefined,
      active: q['active'] === 'true' ? true : q['active'] === 'false' ? false : undefined,
    });
  });

  app.get('/projects/:projectNumber', { preHandler: [app.authenticate] }, async (req) => {
    const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
    return ProjectService.getById(projectNumber);
  });

  app.post('/projects', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageProjects);
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid project payload', details: parsed.error.flatten() },
      });
    }
    const created = await ProjectService.create(parsed.data, actorId(req));
    return reply.code(201).send(created);
  });

  app.patch('/projects/:projectNumber', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageProjects);
    const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid project payload', details: parsed.error.flatten() },
      });
    }
    return ProjectService.update({ projectNumber, ...parsed.data }, actorId(req));
  });

  app.delete('/projects/:projectNumber', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageProjects);
    const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
    const after = await ProjectService.archive(projectNumber, actorId(req));
    return reply.send(after);
  });
}