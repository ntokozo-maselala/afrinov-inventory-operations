// Whether an adjustment needs someone else's approval (ADR-028), in one place
// for every path that writes stock off or adds it: a manual adjustment, a tool
// checked in as lost, and reversing an adjustment.
//
// It does when approval is on and the item has no unit cost (its value can't
// be checked), the limit is 0 ("every adjustment waits"), or its exact value,
// quantity × unit cost, is over the limit. The value is rounded to cents only
// for storing and showing, never before the comparison, so R 1 000,004 is
// over a R 1 000 limit.
import { Prisma } from '@prisma/client';
import { SettingsService } from '../settings/settings.service.js';

export const WRITE_OFF_APPROVAL = 'inventory.requireWriteOffApproval';
export const WRITE_OFF_LIMIT = 'inventory.writeOffApprovalAbove';

export interface WriteOffCheck {
  needsApproval: boolean;
  /** quantity × unit cost to the cent, for storing and showing; null with no unit cost. */
  value: Prisma.Decimal | null;
  limit: Prisma.Decimal;
}

/** The rule as set now, read once, for checking many adjustments (a page of Movements). */
export async function writeOffRule(tx?: Prisma.TransactionClient): Promise<(quantity: Prisma.Decimal, unitCost: Prisma.Decimal | null) => WriteOffCheck> {
  const settings = await SettingsService.getValues([WRITE_OFF_APPROVAL, WRITE_OFF_LIMIT], tx);
  const on = settings[WRITE_OFF_APPROVAL] !== false;
  const limit = new Prisma.Decimal(Number(settings[WRITE_OFF_LIMIT]) || 0);
  return (quantity, unitCost) => {
    const exact = unitCost == null ? null : quantity.abs().times(unitCost);
    const needsApproval = on && (exact === null || limit.isZero() || exact.gt(limit));
    return { needsApproval, value: exact?.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) ?? null, limit };
  };
}

export async function checkWriteOff(quantity: Prisma.Decimal, unitCost: Prisma.Decimal | null, tx?: Prisma.TransactionClient): Promise<WriteOffCheck> {
  return (await writeOffRule(tx))(quantity, unitCost);
}
