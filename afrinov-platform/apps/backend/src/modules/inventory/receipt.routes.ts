// Proof of receipt (ADR-034): confirming an issue or tool loan slip, and
// seeing the signature it was confirmed with.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import { idempotentMutation } from '../../shared/idempotency.js';
import { Errors } from '../../shared/errors.js';
import { PIN_PATTERN, verifyPin } from '../operations/recipient-pin.js';
import { ReceiptConfirmationService, SKIP_REASONS, checkSigner, loadSlip, type ConfirmInput, type Slip } from './receipt-confirmation.service.js';
import { imagesPastKeep, pendingReceipts } from './receipt-check.js';

// A 5 MB photo as base64, with room for the rest of the body.
const CONFIRMATION_BODY_LIMIT = 7_500_000;

const imageSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  data: z.base64().max(7_000_000),
});

export const confirmationSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('PIN'), signerId: z.uuid(), pin: z.string().regex(PIN_PATTERN) }),
  z.object({ method: z.literal('SIGNATURE'), signerId: z.uuid(), image: imageSchema }),
  z.object({ method: z.literal('PAPER'), signerId: z.uuid(), image: imageSchema }),
  z.object({ method: z.literal('NONE'), reason: z.enum(SKIP_REASONS as ['LEFT', 'CANNOT', 'NO_SCREEN', 'DISPUTED', 'OTHER']), note: z.string().max(500).optional() }),
]);

const actorId = (req: unknown) => (req as { user: { id: string } }).user.id;

// The slip each request is for, found before its body is read.
const slipOf = new WeakMap<FastifyRequest, Slip>();

export async function receiptRoutes(app: FastifyInstance): Promise<void> {
  // Who may confirm is checked when the request arrives, before up to 7.5 MB
  // is read: whoever may post that kind of slip.
  app.post('/slips/:slipId/confirmation', {
    onRequest: [app.authenticate, async (req) => {
      const slip = await loadSlip((req.params as { slipId: string }).slipId);
      await requirePermission(req, slip.kind === 'LOAN' ? PermissionCode.CheckOutTool : PermissionCode.IssueInventory);
      slipOf.set(req, slip);
    }],
    bodyLimit: CONFIRMATION_BODY_LIMIT,
  }, async (req, reply) => {
    const parsed = confirmationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid confirmation', details: parsed.error.flatten() } });
    }
    const body = parsed.data;
    const slip = slipOf.get(req)!;
    // Before any PIN is checked, so a try on a slip with nothing to confirm isn't counted (edge case E5).
    if (slip.lines.length === 0) throw Errors.invalidState('Every line on this slip was reversed, so there is nothing to confirm.');
    const actor = actorId(req);
    let input: ConfirmInput;
    if (body.method === 'PIN') {
      // Checked here, outside the confirmation's transaction, so a wrong PIN
      // is counted even though the confirmation is then refused.
      await checkSigner(slip, body.signerId);
      await verifyPin(body.signerId, body.pin);
      input = { slipId: slip.id, method: 'PIN', signerId: body.signerId, actorId: actor };
    } else if (body.method === 'NONE') {
      input = { slipId: slip.id, method: 'NONE', reason: body.reason, note: body.note, actorId: actor };
    } else {
      input = { slipId: slip.id, method: body.method, signerId: body.signerId, image: { contentType: body.image.contentType, data: Buffer.from(body.image.data, 'base64') }, actorId: actor };
    }
    // The PIN stays out of the stored request hash.
    const requestBody = body.method === 'PIN' ? { method: body.method, signerId: body.signerId } : body;
    return idempotentMutation(req, reply, 'POST /slips/:slipId/confirmation', async (tx) => ({
      statusCode: 201,
      body: await ReceiptConfirmationService.confirm(input, tx),
    }), { requestBody });
  });

  // Slips of the last 30 days nobody has confirmed, for the Dashboard when receipt confirmation is Required.
  app.get('/slips/unconfirmed/summary', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    return pendingReceipts();
  });

  // How many images a shorter keep period would remove, so Settings can say before it is saved (edge case E8).
  app.get('/slips/images/past-keep', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageSettings);
    const months = Number((req.query as { months?: string }).months);
    if (!Number.isInteger(months) || months < 0 || months > 240) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'months must be a whole number from 0 to 240' } });
    }
    return { months, count: await imagesPastKeep(months) };
  });

  // A signature is personal information (POPIA): only those who can see issue slips see it.
  app.get('/slips/:slipId/confirmation/image', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const image = await ReceiptConfirmationService.image((req.params as { slipId: string }).slipId);
    return reply
      .type(image.contentType)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .send(image.data);
  });
}
