// The two kinds of purchase order (Stores ordering roadmap). Procurement buys
// for projects: an order with a project, raised from Procurement. The store
// orders stock for the shelf: an order without a project, raised from Stores →
// Order stock. The server holds each kind to its own permission; these keep
// the screens in step with it.
import type { Permission } from '../hooks/usePermissions';

export type OrderKind = 'stores' | 'projects';

export function orderKindOf(order: { projectNumber?: string | null }): OrderKind {
  return order.projectNumber ? 'projects' : 'stores';
}

/** The permission that raises, edits, submits, cancels and closes an order of this kind. */
export const ORDER_PERMISSION: Record<OrderKind, Permission> = {
  stores: 'stores:order',
  projects: 'procurement:manage',
};

/** Where an order of this kind is listed, for its breadcrumb. */
export const ORDER_SECTION: Record<OrderKind, { label: string; to: string }> = {
  stores: { label: 'Order stock', to: '/stock/orders' },
  projects: { label: 'Purchase orders', to: '/purchase-orders' },
};
