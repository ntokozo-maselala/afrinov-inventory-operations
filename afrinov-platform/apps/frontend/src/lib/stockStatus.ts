// Stock status per item, mirroring the backend rule in
// apps/backend/src/shared/inventory/stock-status.ts (the mock API uses it, so
// frontend-only mode grades stock exactly as the server does).
//
// On hand across all locations as a share of Required Stock: URGENT below one
// band, WARNING below the next, OK otherwise; NOT_SET when Required Stock is 0.

export type StockStatus = 'URGENT' | 'WARNING' | 'OK' | 'NOT_SET';

export interface StatusBands { urgentBelowPercent: number; warningBelowPercent: number }

export const DEFAULT_BANDS: StatusBands = { urgentBelowPercent: 20, warningBelowPercent: 40 };

export function classifyItem(onHand: number, required: number, bands: StatusBands = DEFAULT_BANDS): {
  status: StockStatus; percentOfRequired: number | null; reorderQuantity: number;
} {
  if (!(required > 0)) return { status: 'NOT_SET', percentOfRequired: null, reorderQuantity: 0 };
  const ratio = onHand / required;
  const urgent = bands.urgentBelowPercent / 100;
  const warning = Math.max(bands.warningBelowPercent, bands.urgentBelowPercent) / 100;
  return {
    status: ratio < urgent ? 'URGENT' : ratio < warning ? 'WARNING' : 'OK',
    percentOfRequired: Math.round(ratio * 1000) / 10,
    reorderQuantity: Math.max(0, Math.round((required - onHand) * 10000) / 10000),
  };
}

export const needsAttention = (s: StockStatus | null | undefined) => s === 'URGENT' || s === 'WARNING';

export const STATUS_LABEL: Record<StockStatus, string> = { URGENT: 'Urgent', WARNING: 'Warning', OK: 'OK', NOT_SET: 'Not set' };
export const STATUS_TONE: Record<StockStatus, 'danger' | 'warning' | 'success' | 'neutral'> = {
  URGENT: 'danger', WARNING: 'warning', OK: 'success', NOT_SET: 'neutral',
};
