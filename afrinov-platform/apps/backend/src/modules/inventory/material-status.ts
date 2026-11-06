// Why an item was deactivated or reactivated (ADR-032). A status change moves no
// stock, so it is kept out of the ledger; it has its own record and its own row
// on Movements, and says why from a short list, so the reasons can be reported on.
import { Errors } from '../../shared/errors.js';

/** What a status change's Movements row points at. */
export const STATUS_CHANGE_REFERENCE = 'MaterialStatusChange';

export const DEACTIVATE_REASONS = ['OBSOLETE', 'SUPERSEDED', 'SUPPLIER_DISCONTINUED', 'CREATED_IN_ERROR', 'OTHER'] as const;
export const REACTIVATE_REASONS = ['BACK_IN_USE', 'STOCK_CAME_BACK', 'DEACTIVATED_IN_ERROR', 'OTHER'] as const;
export const STATUS_REASONS = [...new Set([...DEACTIVATE_REASONS, ...REACTIVATE_REASONS])] as [string, ...string[]];

export type MaterialStatusReasonCode = (typeof DEACTIVATE_REASONS)[number] | (typeof REACTIVATE_REASONS)[number];

/** Refuses a reason that doesn't belong to the change, and Other with nothing to say why. */
export function checkStatusReason(active: boolean, reasonCode: string, note: string | null): void {
  const allowed: readonly string[] = active ? REACTIVATE_REASONS : DEACTIVATE_REASONS;
  if (!allowed.includes(reasonCode)) {
    throw Errors.validation(`That reason is not one for ${active ? 'reactivating' : 'deactivating'} an item`, { field: 'reasonCode' });
  }
  if (reasonCode === 'OTHER' && !note) throw Errors.validation('Add a note saying why', { field: 'note' });
}
