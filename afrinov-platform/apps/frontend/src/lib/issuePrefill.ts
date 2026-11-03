// A project delivery just booked on Receive stock, handed to Issue stock so it
// can be issued straight away: project material isn't shelved, it goes to the
// workshop as soon as it arrives (Project Material Through the Store Roadmap,
// Phase 4). Passed as router state on the link, never in the address.

/** The project the stock is held for, and what arrived, item by item and location. */
export interface IssuePrefill {
  projectNumber: string;
  lines: Array<{ materialId: string; locationId: string; quantity: number }>;
}

/** The prefill in a location's state, or null for any other state. */
export function issuePrefillOf(state: unknown): IssuePrefill | null {
  const s = state as { issuePrefill?: IssuePrefill } | null;
  const p = s?.issuePrefill;
  return p && typeof p.projectNumber === 'string' && Array.isArray(p.lines) ? p : null;
}

/** The setting naming where project deliveries are booked ('' when none). */
export const PROJECT_RECEIVING_LOCATION = 'inventory.projectReceivingLocationId';
