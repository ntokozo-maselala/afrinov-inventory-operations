import type { FastifyInstance } from 'fastify';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import { Errors } from '../../shared/errors.js';

/**
 * Retired (system audit D3, ADR-039). Creating an item with stock in one call
 * put stock on the shelf with no order and no count. An item is added on
 * Materials (POST /materials) and its stock received on Receive stock
 * (POST /stock-receipts, or POST /goods-receipts against an order).
 */
export const STOCK_ITEMS_RETIRED =
  'Add the item on Materials, then receive its stock on Receive stock.';

export async function stockItemRoutes(app: FastifyInstance): Promise<void> {
  app.post('/stock-items', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.CreateMaterial);
    await requirePermission(req, PermissionCode.ReceiveInventory);
    throw Errors.validation(STOCK_ITEMS_RETIRED);
  });
}
