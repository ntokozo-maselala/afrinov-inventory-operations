// The units of measure items can have, and whether each is counted or measured.
import { useApi } from './useApi';
import { unitKindOf, type UnitKind, type UnitOfMeasure } from '../lib/quantity';

export function useUnits(): { units: UnitOfMeasure[] | null; kindOf: (code: string | null | undefined) => UnitKind } {
  const res = useApi<UnitOfMeasure[]>('/units-of-measure');
  return { units: res.data, kindOf: (code) => unitKindOf(res.data, code) };
}
