// Over-delivery (system audit A8, ADR-040). A supplier sends 105 of 100: up
// to purchaseOrders.overDeliveryPercent of the ordered quantity may be received
// over what was ordered, each such line with a reason, and the order line then
// shows the extra. At 0% (the default) nothing over the order is received.
import { Prisma } from '@prisma/client';
import { SettingsService } from '../settings/settings.service.js';

export const OVER_DELIVERY_PERCENT = 'purchaseOrders.overDeliveryPercent';

/** The allowance as set now, as a fraction of the ordered quantity (5% -> 0.05). */
export async function overDeliveryShare(tx?: Prisma.TransactionClient): Promise<Prisma.Decimal> {
  const pct = Number(await SettingsService.getValue<number>(OVER_DELIVERY_PERCENT, tx)) || 0;
  return new Prisma.Decimal(Math.min(Math.max(pct, 0), 100)).div(100);
}

/** The most an order line may receive in all: what was ordered, plus the allowance, to 4 places. */
export function mostReceivable(orderedQty: Prisma.Decimal, share: Prisma.Decimal): Prisma.Decimal {
  return orderedQty.times(share.plus(1)).toDecimalPlaces(4, Prisma.Decimal.ROUND_DOWN);
}
