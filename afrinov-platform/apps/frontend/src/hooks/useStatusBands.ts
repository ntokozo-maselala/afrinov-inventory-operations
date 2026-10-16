// The stock status bands as set under Settings → Inventory, for the words the
// pages say about them ("urgent below 20%"). The defaults stand in while they
// load, and if they cannot be read.
import { useApi } from './useApi';
import { DEFAULT_BANDS, type StatusBands } from '../lib/stockStatus';

const KEYS = ['inventory.urgentBelowPercent', 'inventory.warningBelowPercent'] as const;

export function useStatusBands(): StatusBands {
  const values = useApi<Record<string, unknown>>(`/settings/values?keys=${KEYS.join(',')}`);
  const urgent = Number(values.data?.[KEYS[0]] ?? DEFAULT_BANDS.urgentBelowPercent);
  const warning = Number(values.data?.[KEYS[1]] ?? DEFAULT_BANDS.warningBelowPercent);
  const urgentBelowPercent = Number.isFinite(urgent) ? urgent : DEFAULT_BANDS.urgentBelowPercent;
  // As the rule grades it: warning is never below urgent.
  const warningBelowPercent = Math.max(Number.isFinite(warning) ? warning : DEFAULT_BANDS.warningBelowPercent, urgentBelowPercent);
  return { urgentBelowPercent, warningBelowPercent };
}
