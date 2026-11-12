import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ToolLoanService } from './tool-loan.service.js';
import { ToolRepairService } from './tool-repair.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission, userHasPermission } from '../../shared/authorization.js';
import { idempotentMutation } from '../../shared/idempotency.js';
import { Errors } from '../../shared/errors.js';
import { storedQuantity } from '../../shared/decimal.js';

/** Marking a tool held for repair as repaired (system audit B2). */
export const toolRepairedSchema = z.object({ note: z.string().trim().max(500).optional() });
/** Writing it off instead: why it can't be repaired. */
export const toolRepairWriteOffSchema = z.object({ note: z.string().trim().min(1).max(500) });

export const toolCheckOutSchema = z.object({
  recipientId: z.uuid(),
  projectNumber: z.string().trim().min(1).max(64).optional(),
  note: z.string().max(500).optional(),
  // YYYY-MM-DD. Omitted: the default loan period, capped at the project's end date.
  dueOn: z.iso.date().optional(),
  // Why tools are lent to someone who already has an overdue one.
  overrideReason: z.string().max(500).optional(),
  lines: z.array(z.object({
    materialId: z.uuid(),
    locationId: z.uuid(),
    quantity: storedQuantity,
  })).min(1).max(50),
});

export const toolCheckInSchema = z.object({
  lines: z.array(z.object({
    loanId: z.uuid(),
    quantity: storedQuantity,
    condition: z.enum(['GOOD', 'DAMAGED', 'LOST']),
    note: z.string().max(500).optional(),
    // Where it goes back to, when the location it was lent from has closed (system audit A2).
    locationId: z.uuid().optional(),
  })).min(1).max(50),
});

export const toolLoanDueDateSchema = z.object({
  dueOn: z.iso.date(),
  reason: z.string().trim().min(1).max(500),
});

const actorId = (req: unknown) => (req as { user: { id: string } }).user.id;

// Whoever may change the loan settings may lend past the longest loan they set.
const canExceedMaxLoan = (req: FastifyRequest) => userHasPermission(req, PermissionCode.ManageSettings);

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  // view:reports, as the ledger it is read from (system audit F6).
  app.get('/tools', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    return ToolLoanService.list();
  });

  app.post('/tools/check-out', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CheckOutTool);
    const parsed = toolCheckOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid check-out payload', details: parsed.error.flatten() } });
    }
    const exceed = parsed.data.dueOn ? await canExceedMaxLoan(req) : false;
    // Retry-safe with an Idempotency-Key, as every stock movement is (system audit B3).
    return idempotentMutation(req, reply, 'POST /tools/check-out', async (tx) => ({
      statusCode: 201,
      body: await ToolLoanService.checkOut({ ...parsed.data, canExceedMaxLoan: exceed, actorId: actorId(req) }, tx),
    }));
  });

  app.post('/tools/check-in', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CheckInTool);
    const parsed = toolCheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid check-in payload', details: parsed.error.flatten() } });
    }
    // Lost is a write-off: the store's to post, not the borrower's (segregation of duties).
    if (parsed.data.lines.some((l) => l.condition === 'LOST') && !(await userHasPermission(req, PermissionCode.AdjustInventory))) {
      throw Errors.forbidden('Checking a tool in as lost writes it off, which the store does. Check it in as good or damaged, or ask the store to write it off.');
    }
    return idempotentMutation(req, reply, 'POST /tools/check-in', async (tx) => ({
      statusCode: 201,
      body: await ToolLoanService.checkIn({ ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  // A tool checked in damaged is held until repaired or written off (system audit B2): the store's to decide.
  app.post('/tools/repairs/:id/repaired', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.AdjustInventory);
    const parsed = toolRepairedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid repair note', details: parsed.error.flatten() } });
    }
    const { id } = req.params as { id: string };
    return idempotentMutation(req, reply, 'POST /tools/repairs/:id/repaired', async (tx) => ({
      statusCode: 200,
      body: await ToolRepairService.markRepaired(id, parsed.data.note, actorId(req), tx),
    }));
  });

  app.post('/tools/repairs/:id/write-off', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.AdjustInventory);
    const parsed = toolRepairWriteOffSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Say why it can\'t be repaired', details: parsed.error.flatten() } });
    }
    const { id } = req.params as { id: string };
    // Over the write-off limit, it waits for someone else (202), and the tool stays held.
    return idempotentMutation(req, reply, 'POST /tools/repairs/:id/write-off', async (tx) => {
      const outcome = await ToolRepairService.writeOff(id, parsed.data.note, actorId(req), tx);
      return { statusCode: outcome.status === 'POSTED' ? 201 : 202, body: outcome };
    });
  });

  // A later or earlier due date, with a reason. The permission keeps its first name, extend:tool_loan.
  app.post('/tools/loans/:id/due-date', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ExtendToolLoan);
    const parsed = toolLoanDueDateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'A new due date and a reason are required', details: parsed.error.flatten() } });
    }
    const { id } = req.params as { id: string };
    const exceed = await canExceedMaxLoan(req);
    return idempotentMutation(req, reply, 'POST /tools/loans/:id/due-date', async (tx) => ({
      statusCode: 201,
      body: await ToolLoanService.changeDueDate({ loanId: id, ...parsed.data, canExceedMaxLoan: exceed, actorId: actorId(req) }, tx),
    }));
  });

  // One loan from check-out to now, for the movement detail on Movements.
  app.get('/tools/loans/:id/history', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const { id } = req.params as { id: string };
    return ToolLoanService.history(id);
  });
}
