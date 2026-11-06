// Why an item is deactivated or reactivated (ADR-032), as the server takes it
// (backend material-status.ts). A status change moves no stock: it is a row of
// its own on Movements, with no quantity.
import { orderPath } from './orderKind';

export interface StatusReason { code: string; label: string }

export const DEACTIVATE_REASONS: StatusReason[] = [
  { code: 'OBSOLETE', label: 'Obsolete' },
  { code: 'SUPERSEDED', label: 'Superseded' },
  { code: 'SUPPLIER_DISCONTINUED', label: 'Supplier discontinued' },
  { code: 'CREATED_IN_ERROR', label: 'Created in error' },
  { code: 'OTHER', label: 'Other' },
];

export const REACTIVATE_REASONS: StatusReason[] = [
  { code: 'BACK_IN_USE', label: 'Back in use' },
  { code: 'STOCK_CAME_BACK', label: 'Stock came back' },
  { code: 'DEACTIVATED_IN_ERROR', label: 'Deactivated in error' },
  { code: 'OTHER', label: 'Other' },
];

/** Something to deal with before an item can be deactivated, as the server lists it. */
export interface DeactivationBlocker {
  kind: 'STOCK' | 'LOAN' | 'APPROVAL' | 'ORDER';
  text: string;
  orderId?: string;
  projectNumber?: string | null;
}

/** Where a blocker is dealt with. */
export function blockerAction(b: DeactivationBlocker, sku: string): { to: string; label: string } {
  const item = encodeURIComponent(sku);
  if (b.kind === 'LOAN') return { to: `/tools?q=${item}`, label: 'Check in' };
  if (b.kind === 'APPROVAL') return { to: '/stock/write-offs', label: 'Decide' };
  if (b.kind === 'ORDER' && b.orderId) return { to: orderPath({ id: b.orderId, projectNumber: b.projectNumber }), label: 'Open order' };
  return { to: `/stock?q=${item}`, label: 'See stock' };
}

/** Rows that record an item's status change rather than move stock: no quantity. */
export const STATUS_TYPES = new Set(['ITEM_DEACTIVATED', 'ITEM_REACTIVATED']);
