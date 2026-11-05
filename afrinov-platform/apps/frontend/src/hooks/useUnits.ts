// The units of measure items can have, and whether each is counted or measured.
import { useApi } from './useApi';
import { unitKindOf, type UnitKind, type UnitOfMeasure } from '../lib/quantity';
import type { ApiError } from '../api/client';

export interface UnitsResult {
  /** The list, or null until it has loaded (or when it could not be). */
  units: UnitOfMeasure[] | null;
  /**
   * The kind of a unit. Until the list is in, or if it can't be read, a
   * quantity is taken as measured; the server still refuses part of a counted
   * item, and says so.
   */
  kindOf: (code: string | null | undefined) => UnitKind;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

export function useUnits(): UnitsResult {
  const res = useApi<UnitOfMeasure[]>('/units-of-measure');
  // Anything but a list (a server or a test answering something else) counts as not loaded.
  const units = Array.isArray(res.data) ? res.data : null;
  return { units, kindOf: (code) => unitKindOf(units, code), loading: res.loading, error: res.error, reload: res.reload };
}
