import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supplierIdSchema } from '../../shared/ids.js';
import { StockItemService } from './stock-item.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

// Zod schema mirrors the existing material create schema but additionally
// accepts the initial stock position. Validation runs at the API boundary.
export const createStockItemSchema = z
  .object({
    sku: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    category: z.enum([
      'FASTENERS_SLUGS_INSULATION',
      'TOOLING_PPE_ELECTRICAL',
      'PROJECT_MATERIAL',
      'CONSUMABLES',
      'TOOLS',
    ]),
    description: z.string().max(1000).optional(),
    unitOfMeasure: z.string().min(1).max(32),
    requiredStock: z.number().nonnegative().optional(),
    unitCost: z.number().nonnegative().optional(),
    initialQuantity: z.number().nonnegative().optional(),
    locationId: z.string().uuid().optional(),
    supplierId: supplierIdSchema.optional(),
  })
  .refine(
    (v) => v.initialQuantity === undefined || v.initialQuantity === 0 || !!v.locationId,
    {
      message: 'A location is required when an initial quantity is supplied',
      path: ['locationId'],
    },
  );

export async function stockItemRoutes(app: FastifyInstance): Promise<void> {
  app.post('/stock-items', { preHandler: [app.authenticate] }, async (req, reply) => {
    // Onboarding a stock item combines two existing permissions: the
    // catalogue write and the inventory-receive write. Both must be present
    // server-side; the UI hides it client-side too.
    await requirePermission(req, PermissionCode.CreateMaterial);
    await requirePermission(req, PermissionCode.ReceiveInventory);

    const parsed = createStockItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid stock-item payload',
          details: parsed.error.flatten(),
        },
      });
    }
    const actorId = (req as unknown as { user: { id: string } }).user.id;
    const result = await StockItemService.createWithInitialStock(parsed.data, actorId);
    return reply.code(201).send(result);
  });
}