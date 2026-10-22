// Names a location by id, with its room ("D-1 · Main Storeroom"), for lists
// that carry only a location's id and name, such as stock lines from the
// current-stock report. Looks the rooms up from GET /locations; until they
// arrive, or if they cannot be read, a location is named as it came.
import { useMemo } from 'react';
import { useApi } from './useApi';
import type { NamedLocation } from '../lib/locations';

export function useLocationLabel(): (locationId: string, name: string) => string {
  const locations = useApi<Array<{ id: string } & NamedLocation>>('/locations');
  return useMemo(() => {
    const room = new Map((Array.isArray(locations.data) ? locations.data : []).map((l) => [l.id, l.parent?.name]));
    return (locationId: string, name: string) => {
      const r = room.get(locationId);
      return r ? `${name} · ${r}` : name;
    };
  }, [locations.data]);
}
