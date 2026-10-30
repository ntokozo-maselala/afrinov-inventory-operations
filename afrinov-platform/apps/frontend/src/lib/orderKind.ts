// The two kinds of purchase order (Stores ordering roadmap). Procurement buys
// for projects: an order with a project, raised from Procurement. The store
// orders stock for the shelf: an order without a project, raised from Stores →
// Order stock. The server holds each kind to its own permission; these keep
// the screens in step with it.
import type { Permission } from '../hooks/usePermissions';

export type OrderKind = 'stores' | 'projects';

/**
 * A Stores order has no project (null, or left out); any project number makes
 * it a project order. The same rule as the server's, which filters on null.
 */
export function orderKindOf(order: { projectNumber?: string | null }): OrderKind {
  return order.projectNumber == null ? 'stores' : 'projects';
}

/** The permission that raises, edits, submits, cancels and closes an order of this kind. */
export const ORDER_PERMISSION: Record<OrderKind, Permission> = {
  stores: 'stores:order',
  projects: 'procurement:manage',
};

/**
 * Where an order lives (Stores and Procurement Separation Roadmap): a Stores
 * order inside Store → Order stock, a project order inside Procurement. Every
 * link to an order goes through this, so neither side opens the other's.
 */
export function orderPath(order: { id: string; projectNumber?: string | null }): string {
  return `${ORDER_SECTION[orderKindOf(order)].to}/${order.id}`;
}

/** Where a delivery against a Stores order is booked: Receive stock, with the order chosen. */
export function receivePath(orderId: string): string {
  return `/stock/receive?order=${encodeURIComponent(orderId)}`;
}

/** The kind of order a page address is for: under Order stock or under Procurement. */
export function kindOfPath(pathname: string): OrderKind {
  return pathname.startsWith(`${ORDER_SECTION.stores.to}/`) ? 'stores' : 'projects';
}

/** Where an order of this kind is listed, for its breadcrumb. */
export const ORDER_SECTION: Record<OrderKind, { label: string; to: string }> = {
  stores: { label: 'Order stock', to: '/stock/orders' },
  projects: { label: 'Purchase orders', to: '/purchase-orders' },
};
