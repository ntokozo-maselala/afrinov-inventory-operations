// Whose stock a current-stock row is: the store's own (Stores stock), or held
// for a project (Project Material Through the Store Roadmap, Phase 1). Issue
// stock offers a project's own stock to that project (Phase 3); counting,
// transferring and adjusting on screen take Stores stock only until Phase 4.
import type { CurrentStockRow } from '../api/types';

/** The store's own stock: held for no project. */
export const isStoresStock = (r: Pick<CurrentStockRow, 'heldForProject'>): boolean => !r.heldForProject;

/** One key per balance: an item at a location, held for a project or for none. */
export const balanceKey = (r: Pick<CurrentStockRow, 'materialId' | 'locationId' | 'heldForProject'>): string =>
  `${r.materialId}|${r.locationId}|${r.heldForProject ?? ''}`;

/**
 * A movement's project: the one the stock was used for, or, when it names
 * none (a project's own stock received, moved or adjusted), "held for
 * AFRI-1325", so whose stock moved isn't read as who it was used for (Qodo, PR #145).
 */
export const movementProject = (m: { projectNumber?: string | null; heldForProject?: string | null }): string | null =>
  m.projectNumber || (m.heldForProject ? `held for ${m.heldForProject}` : null);

/** "A-1", or "A-1 · held for AFRI-1325" when the stock there is a project's. */
export const locationWithHolder = (r: Pick<CurrentStockRow, 'locationName' | 'heldForProject'>): string =>
  (r.heldForProject ? `${r.locationName} · held for ${r.heldForProject}` : r.locationName);
