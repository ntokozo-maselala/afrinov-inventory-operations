// Whose stock a current-stock row is: the store's own (Stores stock), or held
// for a project (Project Material Through the Store Roadmap, Phase 1). Issuing,
// counting, transferring and adjusting take Stores stock only until the
// project's own stock can be moved, so those screens list Stores stock alone.
import type { CurrentStockRow } from '../api/types';

/** The store's own stock: held for no project. */
export const isStoresStock = (r: Pick<CurrentStockRow, 'heldForProject'>): boolean => !r.heldForProject;

/** One key per balance: an item at a location, held for a project or for none. */
export const balanceKey = (r: Pick<CurrentStockRow, 'materialId' | 'locationId' | 'heldForProject'>): string =>
  `${r.materialId}|${r.locationId}|${r.heldForProject ?? ''}`;

/** "A-1", or "A-1 · held for AFRI-1325" when the stock there is a project's. */
export const locationWithHolder = (r: Pick<CurrentStockRow, 'locationName' | 'heldForProject'>): string =>
  (r.heldForProject ? `${r.locationName} · held for ${r.heldForProject}` : r.locationName);
