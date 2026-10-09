// Stock status per item, as the stock workbook's URGENCY column shows it:
// on hand as a share of Required Stock, URGENT below one band, WARNING below
// the next, OK otherwise. The bands are settings (default 20% and 40%).
//
// Two differences from the workbook, both fixes:
//  - an item with no Required Stock is NOT_SET, where the workbook showed 0%
//    and so URGENT whatever was on hand;
//  - on hand is the item's total across every location, because Required
//    Stock is set per item, not per location.
import type { Prisma } from '@prisma/client';
import { SettingsService } from '../../modules/settings/settings.service.js';

export type StockStatus = 'URGENT' | 'WARNING' | 'OK' | 'NOT_SET';

export interface StatusBands {
  /** Below this percentage of Required Stock: URGENT. */
  urgentBelowPercent: number;
  /** Below this percentage: WARNING. Never below the urgent band. */
  warningBelowPercent: number;
}

export const DEFAULT_BANDS: StatusBands = { urgentBelowPercent: 20, warningBelowPercent: 40 };

export interface ItemStatus {
  status: StockStatus;
  /** On hand as a percentage of Required Stock, one decimal; null when Required Stock is not set. */
  percentOfRequired: number | null;
  /** Required Stock less on hand, never below zero: what to order to get back to the required level. */
  reorderQuantity: number;
}

export function classifyItem(onHand: number, required: number, bands: StatusBands = DEFAULT_BANDS): ItemStatus {
  if (!(required > 0)) return { status: 'NOT_SET', percentOfRequired: null, reorderQuantity: 0 };
  const ratio = onHand / required;
  const urgent = bands.urgentBelowPercent / 100;
  const warning = Math.max(bands.warningBelowPercent, bands.urgentBelowPercent) / 100;
  const status: StockStatus = ratio < urgent ? 'URGENT' : ratio < warning ? 'WARNING' : 'OK';
  return {
    status,
    percentOfRequired: Math.round(ratio * 1000) / 10,
    reorderQuantity: Math.max(0, Math.round((required - onHand) * 10000) / 10000),
  };
}

/** True for the statuses that need someone to re-order. */
export const needsAttention = (s: StockStatus) => s === 'URGENT' || s === 'WARNING';

export async function getStatusBands(tx?: Prisma.TransactionClient): Promise<StatusBands> {
  const [urgentBelowPercent, warningBelowPercent] = await Promise.all([
    SettingsService.getValue<number>('inventory.urgentBelowPercent', tx),
    SettingsService.getValue<number>('inventory.warningBelowPercent', tx),
  ]);
  return { urgentBelowPercent, warningBelowPercent };
}
