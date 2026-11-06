// Why an item is deactivated or reactivated (ADR-032), as the server takes it
// (backend material-status.ts). A status change moves no stock: it is a row of
// its own on Movements, with no quantity.
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

/** Rows that record an item's status change rather than move stock: no quantity. */
export const STATUS_TYPES = new Set(['ITEM_DEACTIVATED', 'ITEM_REACTIVATED']);
