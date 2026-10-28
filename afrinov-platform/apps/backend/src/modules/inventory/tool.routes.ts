import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ToolLoanService } from './tool-loan.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

export const toolCheckOutSchema = z.object({
  recipientId: z.uuid(),
  projectNumber: z.string().trim().min(1).max(64).optional(),
  note: z.string().max(500).optional(),
  lines: z.array(z.object({
    materialId: z.uuid(),
    locationId: z.uuid(),
    quantity: z.number().positive(),
  })).min(1).max(50),
});

export const toolCheckInSchema = z.object({
  lines: z.array(z.object({
    loanId: z.uuid(),
    quantity: z.number().positive(),
    condition: z.enum(['GOOD', 'DAMAGED', 'LOST']),
    note: z.string().max(500).optional(),
  })).min(1).max(50),
});

const actorId = (req: unknown) => (req as { user: { id: string } }).user.id;

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tools', { preHandler: [app.authenticate] }, async () => ToolLoanService.list());

  app.post('/tools/check-out', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CheckOutTool);
    const parsed = toolCheckOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid check-out payload', details: parsed.error.flatten() } });
    }
    return reply.code(201).send(await ToolLoanService.checkOut({ ...parsed.data, actorId: actorId(req) }));
  });

  app.post('/tools/check-in', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CheckInTool);
    const parsed = toolCheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid check-in payload', details: parsed.error.flatten() } });
    }
    return reply.code(201).send(await ToolLoanService.checkIn({ ...parsed.data, actorId: actorId(req) }));
  });
}
