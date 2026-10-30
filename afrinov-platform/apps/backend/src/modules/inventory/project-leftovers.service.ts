// A closed project's leftovers move to Stores (materials sections roadmap,
// Phase 7). When a project is completed or cancelled, the project material
// still in stock is flagged until someone moves it: each item becomes a Stores
// item in the category chosen for it, keeping its SKU, stock, locations, cost
// and history. Closing a project moves nothing by itself.
//
// Projects items with no project still in stock move the same way (Project on
// the Order Roadmap, Phase 1): no one gives items a project any more, so they
// aren't issued, and Stores is where they go.
import { Prisma, type MaterialCategory, type PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { PROJECTS_CATEGORY } from './material-section.js';

/** The Stores categories leftovers can move to. Not Tools: a tool is lent one by one, not issued. */
export const LEFTOVER_CATEGORIES = ['CONSUMABLES', 'FASTENERS_SLUGS_INSULATION', 'TOOLING_PPE_ELECTRICAL'] as const;
export type LeftoverCategory = (typeof LEFTOVER_CATEGORIES)[number];

export interface LeftoverItem {
  materialId: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  /** Decimal string, across locations. */
  onHand: string;
  /** onHand × unit cost; null when the item has no unit cost. */
  value: number | null;
  /** Where it is, as "A-1 (4), B-2 (2)". */
  locations: string;
}

export interface ProjectLeftovers {
  project: { projectNumber: string; name: string | null; status: string; closed: boolean };
  items: LeftoverItem[];
}

/** Projects items with no project still in stock: always movable to Stores. */
export interface UnassignedLeftovers {
  project: null;
  items: LeftoverItem[];
}

const isClosed = (status: string) => status === 'COMPLETED' || status === 'CANCELLED';

/** An order not yet finished: its lines may still be bought, received or confirmed. */
const OPEN_ORDER_STATUSES: PurchaseOrderStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'];

async function findProject(projectNumber: string, db: Prisma.TransactionClient | typeof prisma) {
  const project = await db.project.findUnique({ where: { projectNumber }, select: { projectNumber: true, name: true, status: true } });
  if (!project) throw Errors.notFound('Project');
  return project;
}

/** Projects material still in stock for a project, or with no project (null), by SKU. */
async function leftoverItems(projectNumber: string | null): Promise<LeftoverItem[]> {
  const materials = await prisma.material.findMany({
    where: { category: PROJECTS_CATEGORY, projectNumber },
    include: { inventoryBalances: { where: { quantity: { gt: 0 } }, include: { location: { select: { name: true } } } } },
    orderBy: { sku: 'asc' },
  });
  return materials.flatMap((m) => {
      if (m.inventoryBalances.length === 0) return [];
      const onHand = m.inventoryBalances.reduce((sum, b) => sum.plus(b.quantity), new Prisma.Decimal(0));
      return [{
        materialId: m.id,
        sku: m.sku,
        name: m.name,
        unitOfMeasure: m.unitOfMeasure,
        onHand: onHand.toString(),
        value: m.unitCost === null ? null : Number(onHand.times(m.unitCost).toFixed(2)),
        locations: m.inventoryBalances.map((b) => `${b.location.name} (${b.quantity.toString()})`).join(', '),
      }];
  });
}

export const ProjectLeftoversService = {
  /** The project's material still in stock, by SKU. Listed for any project; only a closed one's can move. */
  async list(projectNumber: string): Promise<ProjectLeftovers> {
    const project = await findProject(projectNumber, prisma);
    return { project: { ...project, closed: isClosed(project.status) }, items: await leftoverItems(projectNumber) };
  },

  /** Projects items with no project still in stock, by SKU. */
  async listUnassigned(): Promise<UnassignedLeftovers> {
    return { project: null, items: await leftoverItems(null) };
  },

  /**
   * Moves leftovers of a completed or cancelled project, or Projects items with
   * no project (null), to Stores, all or none: each item becomes a Stores item
   * in its chosen category, with no project and no Required Stock until
   * someone sets it.
   */
  async moveToStores(projectNumber: string | null, items: Array<{ materialId: string; category: LeftoverCategory }>, actorId: string): Promise<{ moved: number }> {
    if (items.length === 0) throw Errors.validation('Choose at least one item to move to Stores');
    if (new Set(items.map((i) => i.materialId)).size !== items.length) throw Errors.validation('An item is listed twice');
    return prisma.$transaction(async (tx) => {
      if (projectNumber !== null) {
        const project = await findProject(projectNumber, tx);
        if (!isClosed(project.status)) {
          throw Errors.validation(`Project ${projectNumber} is still open, so its material stays with it. Leftovers move to Stores once it is completed or cancelled.`);
        }
      }
      // Project material on an open project order or RFQ stays project material
      // until that is finished: as a Stores item it would reach a project order,
      // and be confirmed delivered to site, as Stores stock (Qodo, PR #129).
      // The items are locked first, so an order or RFQ being written for them at
      // the same moment (which holds them too) either commits before these
      // checks, and is found, or reads them after the move, and is refused.
      const ids = items.map((i) => i.materialId);
      await tx.$executeRaw`SELECT 1 FROM materials WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
      const onOrder = await tx.purchaseOrderLine.findFirst({
        where: { materialId: { in: ids }, purchaseOrder: { projectNumber: { not: null }, status: { in: OPEN_ORDER_STATUSES } } },
        select: { material: { select: { sku: true } }, purchaseOrder: { select: { number: true } } },
      });
      if (onOrder) {
        throw Errors.validation(`${onOrder.material.sku} is on ${onOrder.purchaseOrder.number}, which is still open, so it stays project material. Move it once that order is finished or cancelled.`);
      }
      const onRfq = await tx.rfqLine.findFirst({
        where: { materialId: { in: ids }, rfq: { status: { in: ['DRAFT', 'SENT'] } } },
        select: { material: { select: { sku: true } }, rfq: { select: { number: true } } },
      });
      if (onRfq) {
        throw Errors.validation(`${onRfq.material.sku} is on ${onRfq.rfq.number}, which is still open, so it stays project material. Move it once that request is cancelled, or the order it is awarded as is finished.`);
      }
      for (const item of items) {
        const before = await tx.material.findUnique({ where: { id: item.materialId } });
        if (!before) throw Errors.notFound('Material');
        if (before.category !== PROJECTS_CATEGORY || before.projectNumber !== projectNumber) {
          throw Errors.validation(projectNumber === null
            ? `${before.sku} is not a Projects item with no project, so it isn't moved from here.`
            : `${before.sku} is not material of project ${projectNumber}, so it isn't moved from it.`);
        }
        // Only if it is still the project's: two people moving it at once can't both succeed.
        const done = await tx.material.updateMany({
          where: { id: item.materialId, category: PROJECTS_CATEGORY, projectNumber },
          data: { category: item.category as MaterialCategory, projectNumber: null, requiredStock: 0 },
        });
        if (done.count === 0) throw Errors.conflict(`${before.sku} has just been moved by someone else. Refresh the page.`);
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'MOVE_TO_STORES',
            entityType: 'Material',
            entityId: item.materialId,
            before: { category: before.category, projectNumber },
            after: { category: item.category, projectNumber: null },
          },
        });
      }
      return { moved: items.length };
    });
  },
};
