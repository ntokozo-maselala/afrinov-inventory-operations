import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ProjectService, PROJECT_STATUSES, type ProjectStatus } from './project.service.js';
import { ProjectScheduleService, type ScheduleActor } from './project-schedule.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission, userHasPermission } from '../../shared/authorization.js';
import { Errors } from '../../shared/errors.js';
import { idempotentMutation } from '../../shared/idempotency.js';

const projectStatusEnum = z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]);

export const createProjectSchema = z.object({
  projectNumber: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  code: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  status: projectStatusEnum.optional(),
  managerId: z.uuid().optional(),
  client: z.string().max(200).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
  active: z.boolean().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(64).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  status: projectStatusEnum.optional(),
  managerId: z.uuid().nullable().optional(),
  client: z.string().max(200).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

// ── Job tracking (ADR-032, Project Tracking Roadmap, Phase 1) ─────────────
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date as YYYY-MM-DD');
const scheduleStatusEnum = z.enum(['PLANNING', 'ACTIVE', 'DONE', 'CANCELLED']);

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(120),
  template: z.string().max(120).optional(),
  dueDate: day.nullable().optional(),
  alsoCovers: z.array(z.string().max(64)).max(10).optional(),
});

export const updateScheduleSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  dueDate: day.nullable().optional(),
  alsoCovers: z.array(z.string().max(64)).max(10).optional(),
  status: scheduleStatusEnum.optional(),
});

export const procurementQuerySchema = z.object({ scheduleId: z.string().min(1).optional() });

export const boardQuerySchema = z.object({
  managerId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
});

export const nextMonthSchema = z.object({ name: z.string().min(1).max(120).optional() });

export const replanSchema = z.object({
  reason: z.string().min(1).max(500),
  steps: z.array(z.object({ id: z.string().min(1), baselineStart: day, baselineEnd: day })).min(1).max(60),
});

export const addStepSchema = z.object({
  name: z.string().min(1).max(100),
  position: z.number().int().min(1).optional(),
  baselineStart: day.nullable().optional(),
  baselineEnd: day.nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  reason: z.string().max(500).optional(),
});

export const updateStepSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  position: z.number().int().min(1).optional(),
  baselineStart: day.nullable().optional(),
  baselineEnd: day.nullable().optional(),
  forecastStart: day.nullable().optional(),
  forecastEnd: day.nullable().optional(),
  actualStart: day.nullable().optional(),
  actualEnd: day.nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  assigneeId: z.uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  shiftLaterBy: z.number().int().min(-260).max(260).optional(),
});

/** The body as the schema reads it, or a validation error through the shared envelope. */
function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw Errors.validation(`Invalid ${what}`, parsed.error.flatten() as unknown as Record<string, unknown>);
  return parsed.data;
}

/** Who is asking: Admin (manage:project_schedule) changes any project's schedules, a project's manager only that project's. */
async function scheduleActor(req: FastifyRequest): Promise<ScheduleActor> {
  return { id: actorId(req), manageAll: await userHasPermission(req, PermissionCode.ManageProjectSchedule) };
}

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

export async function projectRoutes(app: FastifyInstance, opts: { procurementEnabled?: boolean } = {}): Promise<void> {
  // What a Procurement step stands on (Phase 4): the project's orders, without
  // prices. Only while purchase orders are switched on, as their own routes.
  if (opts.procurementEnabled) {
    app.get('/projects/:projectNumber/procurement', { preHandler: [app.authenticate] }, async (req) => {
      const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
      const q = parse(procurementQuerySchema, req.query, 'query');
      const seesOrders = await userHasPermission(req, PermissionCode.ViewPurchaseOrder)
        || await userHasPermission(req, PermissionCode.ReceivePurchaseOrder);
      return ProjectScheduleService.procurementFor(projectNumber, q.scheduleId, { ...(await scheduleActor(req)), seesOrders });
    });
  }

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

  // ── Schedules and steps ────────────────────────────────────────────────
  // Anyone signed in can see them; only the project's manager and Admin change them.
  app.get('/project-step-templates', { preHandler: [app.authenticate] }, async () => ProjectScheduleService.templates());

  // The board of open jobs, and the signed-in user's own steps (Phase 3).
  app.get('/project-board', { preHandler: [app.authenticate] }, async (req) => {
    const q = parse(boardQuerySchema, req.query, 'board filter');
    return ProjectScheduleService.board(q);
  });

  app.get('/my-project-steps', { preHandler: [app.authenticate] }, async (req) => ProjectScheduleService.mySteps(actorId(req)));

  app.get('/projects/:projectNumber/schedules', { preHandler: [app.authenticate] }, async (req) => {
    const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
    return ProjectScheduleService.listForProject(projectNumber);
  });

  app.post('/projects/:projectNumber/schedules', { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
    const body = parse(createScheduleSchema, req.body, 'schedule');
    const actor = await scheduleActor(req);
    return idempotentMutation(req, reply, 'POST /projects/:projectNumber/schedules', async (tx) => ({
      statusCode: 201,
      body: await ProjectScheduleService.create(projectNumber, body, actor, tx),
    }));
  });

  app.get('/projects/:projectNumber/assignees', { preHandler: [app.authenticate] }, async (req) => {
    const projectNumber = decodeURIComponent((req.params as { projectNumber: string }).projectNumber);
    return ProjectScheduleService.assignees(projectNumber, await scheduleActor(req));
  });

  app.get('/project-schedules/:id', { preHandler: [app.authenticate] }, async (req) => {
    return ProjectScheduleService.get((req.params as { id: string }).id);
  });

  app.patch('/project-schedules/:id', { preHandler: [app.authenticate] }, async (req) => {
    const body = parse(updateScheduleSchema, req.body, 'schedule');
    return ProjectScheduleService.update((req.params as { id: string }).id, body, await scheduleActor(req));
  });

  app.post('/project-schedules/:id/next-month', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = parse(nextMonthSchema, req.body, 'next month');
    const actor = await scheduleActor(req);
    return idempotentMutation(req, reply, 'POST /project-schedules/:id/next-month', async (tx) => ({
      statusCode: 201,
      body: await ProjectScheduleService.nextMonth(id, body, actor, tx),
    }));
  });

  app.post('/project-schedules/:id/replan', { preHandler: [app.authenticate] }, async (req) => {
    const body = parse(replanSchema, req.body, 're-plan');
    return ProjectScheduleService.replan((req.params as { id: string }).id, body, await scheduleActor(req));
  });

  app.post('/project-schedules/:id/steps', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = parse(addStepSchema, req.body, 'step');
    const actor = await scheduleActor(req);
    return idempotentMutation(req, reply, 'POST /project-schedules/:id/steps', async (tx) => ({
      statusCode: 201,
      body: await ProjectScheduleService.addStep(id, body, actor, tx),
    }));
  });

  app.patch('/project-steps/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = parse(updateStepSchema, req.body, 'step');
    const actor = await scheduleActor(req);
    return idempotentMutation(req, reply, 'PATCH /project-steps/:id', async (tx) => ({
      statusCode: 200,
      body: await ProjectScheduleService.updateStep(id, body, actor, tx),
    }));
  });

  app.delete('/project-steps/:id', { preHandler: [app.authenticate] }, async (req) => {
    const reason = (req.query as { reason?: string }).reason;
    return ProjectScheduleService.removeStep((req.params as { id: string }).id, { reason }, await scheduleActor(req));
  });
}