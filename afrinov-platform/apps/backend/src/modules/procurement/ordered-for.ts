// Which projects each item has been ordered for. A Projects item has no project
// of its own: one item can serve several projects, and the purchase order says
// which (Project on the Order Roadmap). Materials reads this to show "Ordered
// for" on its Projects tab, worked out from the orders, so nothing new is kept.
import type { PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';

/**
 * Orders that count: raised and not cancelled. A draft hasn't been ordered yet,
 * and a cancelled order never will be. A closed order still was ordered.
 */
export const ORDERED_STATUSES: PurchaseOrderStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'];

export interface OrderedFor {
  materialId: string;
  /** Each project once, by project number. */
  projects: Array<{ projectNumber: string; name: string | null }>;
}

type Line = { materialId: string; purchaseOrder: { projectNumber: string | null; project: { name: string | null } | null } };

/** Groups order lines by item, each project once, in project number order. Lines on Stores orders are skipped. */
export function groupOrderedFor(lines: Line[]): OrderedFor[] {
  const byItem = new Map<string, Map<string, string | null>>();
  for (const { materialId, purchaseOrder: po } of lines) {
    if (!po.projectNumber) continue;
    const projects = byItem.get(materialId) ?? new Map<string, string | null>();
    projects.set(po.projectNumber, po.project?.name ?? null);
    byItem.set(materialId, projects);
  }
  return [...byItem].map(([materialId, projects]) => ({
    materialId,
    projects: [...projects]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([projectNumber, name]) => ({ projectNumber, name })),
  }));
}

/** Every item on a project order that counts, with the projects it was ordered for. */
export async function listOrderedFor(): Promise<OrderedFor[]> {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { purchaseOrder: { projectNumber: { not: null }, status: { in: ORDERED_STATUSES } } },
    select: { materialId: true, purchaseOrder: { select: { projectNumber: true, project: { select: { name: true } } } } },
  });
  return groupOrderedFor(lines);
}
