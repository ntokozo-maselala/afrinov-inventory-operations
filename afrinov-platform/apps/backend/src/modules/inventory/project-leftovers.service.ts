// A closed project's leftovers move to Stores (materials sections roadmap,
// Phase 7). When a project is completed or cancelled, the project material
// still in stock is flagged until someone moves it: each item becomes a Stores
// item in the category chosen for it, keeping its SKU, stock, locations, cost
// and history. Closing a project moves nothing by itself.
//
// Projects items with no project still in stock move the same way (Project on
// the Order Roadmap, Phase 1): no one gives items a project any more, so they
// aren't issued, and Stores is where they go.
//
// Stock held for a closed project moves with its item (Project Material
// Through the Store Roadmap, Phase 5): a pair of movements takes it off the
// project onto Stores stock at the same location, then the item becomes a
// Stores item as above.
import { InventoryTransactionType, Prisma, type MaterialCategory, type PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { PROJECTS_CATEGORY } from './material-section.js';
import { lockInventoryBalances, recomputeBalance } from '../../shared/inventory/balances.js';

/**
 * The reference on the pair of movements that takes a closed project's held
 * stock onto Stores stock. They aren't reversed: the item's category changed
 * with them (Qodo, PR #149).
 */
export const MOVE_TO_STORES_REFERENCE = 'MoveToStores';

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
  /** False for a deactivated item: still listed, but not issued (Qodo, PR #131). */
  active: boolean;
  /** Whether some of it is in an active location, the only kind issued from (Qodo, PR #132). */
  hasActiveLocation: boolean;
  /** Its category now: a Stores item held for the project keeps its own when moved. */
  category: string;
  /** Decimal string: how much of onHand is held for the project ('0' for leftovers only). */
  held: string;
  /** The item's own project: another project's item keeps it when its held stock moves. */
  itemProject: string | null;
}

export interface ProjectLeftovers {
  project: { projectNumber: string; name: string | null; status: string; closed: boolean; active: boolean };
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
  const project = await db.project.findUnique({ where: { projectNumber }, select: { projectNumber: true, name: true, status: true, active: true } });
  if (!project) throw Errors.notFound('Project');
  return project;
}

/**
 * A project's material still in stock, or Projects items with no project
 * (null), by SKU. Leftovers are stock from before the stock carried its
 * project: the Stores balance (''), whose project is the item's. A project's
 * list also takes in stock held for it, whatever the item (Project Material
 * Through the Store Roadmap, Phase 5): that moves with the item when the
 * project closes.
 */
async function leftoverItems(projectNumber: string | null): Promise<LeftoverItem[]> {
  const holders = projectNumber === null ? [''] : ['', projectNumber];
  const materials = await prisma.material.findMany({
    where: projectNumber === null
      ? { category: PROJECTS_CATEGORY, projectNumber: null }
      : { OR: [{ category: PROJECTS_CATEGORY, projectNumber }, { inventoryBalances: { some: { heldForProject: projectNumber, quantity: { gt: 0 } } } }] },
    include: { inventoryBalances: { where: { quantity: { gt: 0 }, heldForProject: { in: holders } }, include: { location: { select: { name: true, active: true } } } } },
    orderBy: { sku: 'asc' },
  });
  return materials.flatMap((m) => {
      // Stores stock counts only for the item's own project: another item's is the store's.
      const mine = m.inventoryBalances.filter((b) => b.heldForProject !== '' || (m.category === PROJECTS_CATEGORY && m.projectNumber === projectNumber));
      if (mine.length === 0) return [];
      const onHand = mine.reduce((sum, b) => sum.plus(b.quantity), new Prisma.Decimal(0));
      const held = mine.filter((b) => b.heldForProject !== '').reduce((sum, b) => sum.plus(b.quantity), new Prisma.Decimal(0));
      return [{
        materialId: m.id,
        sku: m.sku,
        name: m.name,
        unitOfMeasure: m.unitOfMeasure,
        onHand: onHand.toString(),
        value: m.unitCost === null ? null : Number(onHand.times(m.unitCost).toFixed(2)),
        locations: mine.map((b) => `${b.location.name} (${b.quantity.toString()}${b.heldForProject ? ', held for the project' : ''})`).join(', '),
        active: m.active,
        hasActiveLocation: mine.some((b) => b.location.active),
        category: m.category,
        held: held.toString(),
        itemProject: m.projectNumber,
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
   * someone sets it. A closed project's held stock goes first: a pair of
   * movements at each location takes it off the project onto Stores stock. A
   * Stores item held for the project keeps its category; only its stock moves.
   */
  async moveToStores(projectNumber: string | null, items: Array<{ materialId: string; category?: LeftoverCategory }>, actorId: string): Promise<{ moved: number }> {
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
      // Stock held for another project would be stranded under it, out of reach
      // of Stores issues (Qodo, PR #142): the item stays project material until
      // that is used. The closed project's own held stock moves below.
      const heldElsewhere = await tx.inventoryBalance.findFirst({
        where: { materialId: { in: ids }, heldForProject: projectNumber === null ? { not: '' } : { notIn: ['', projectNumber] }, quantity: { not: 0 } },
        select: { heldForProject: true, material: { select: { sku: true } } },
      });
      if (heldElsewhere) {
        throw Errors.validation(`${heldElsewhere.material.sku} has stock in the store held for project ${heldElsewhere.heldForProject}, so it stays project material until that stock is used or moved.`);
      }
      const ownHeld = projectNumber === null ? [] : await tx.inventoryBalance.findMany({
        where: { materialId: { in: ids }, heldForProject: projectNumber, quantity: { not: 0 } },
        select: { materialId: true, locationId: true, quantity: true },
      });
      for (const item of items) {
        const before = await tx.material.findUnique({ where: { id: item.materialId } });
        if (!before) throw Errors.notFound('Material');
        const heldHere = ownHeld.filter((b) => b.materialId === item.materialId);
        // The project's leftover item, or any item with stock held for it.
        const ownItem = before.category === PROJECTS_CATEGORY && before.projectNumber === projectNumber;
        if (!ownItem && heldHere.length === 0) {
          throw Errors.validation(projectNumber === null
            ? `${before.sku} is not a Projects item with no project, so it isn't moved from here.`
            : `${before.sku} is not material of project ${projectNumber}, so it isn't moved from it.`);
        }
        if (heldHere.some((b) => b.quantity.isNegative())) {
          throw Errors.validation(`${before.sku} shows less than nothing held for project ${projectNumber}. Correct its stock before moving it.`);
        }
        // The item becomes a Stores item only if it is this project's, or has no
        // project. A Stores item, or another project's item, keeps what it is:
        // only the stock held for this project moves, so the other project's
        // becomes a leftover of its own (Qodo, PR #149).
        const changesItem = before.category === PROJECTS_CATEGORY && (before.projectNumber === null || before.projectNumber === projectNumber);
        if (changesItem && !item.category) throw Errors.validation(`Choose a Stores category for ${before.sku}.`);
        if (!changesItem && item.category && item.category !== before.category) {
          throw Errors.validation(before.category === PROJECTS_CATEGORY
            ? `${before.sku} is project ${before.projectNumber}'s material, so it stays project material: only the stock held for project ${projectNumber} moves.`
            : `${before.sku} is already a Stores item, so it stays in its category.`);
        }

        // The project's held stock to Stores stock, at each location, as a linked pair.
        await lockInventoryBalances(heldHere.flatMap((b) => [
          { materialId: b.materialId, locationId: b.locationId, heldForProject: projectNumber },
          { materialId: b.materialId, locationId: b.locationId, heldForProject: null },
        ]), tx);
        let movedQty = new Prisma.Decimal(0);
        for (const b of heldHere) {
          // Read again under the lock: an issue may have taken some since.
          const now = await tx.inventoryBalance.findUnique({
            where: { materialId_locationId_heldForProject: { materialId: b.materialId, locationId: b.locationId, heldForProject: projectNumber! } },
            select: { quantity: true },
          });
          const qty = now?.quantity ?? new Prisma.Decimal(0);
          if (!qty.gt(0)) continue;
          const note = `Moved to Stores: project ${projectNumber} is closed`;
          const out = await tx.inventoryTransaction.create({
            data: {
              materialId: b.materialId, locationId: b.locationId, heldForProject: projectNumber, type: InventoryTransactionType.TRANSFER_OUT,
              quantity: qty.negated(), actorId, reasonNote: note, referenceType: MOVE_TO_STORES_REFERENCE, referenceId: projectNumber,
            },
          });
          const inn = await tx.inventoryTransaction.create({
            data: {
              materialId: b.materialId, locationId: b.locationId, heldForProject: null, type: InventoryTransactionType.TRANSFER_IN,
              quantity: qty, actorId, reasonNote: note, referenceType: MOVE_TO_STORES_REFERENCE, referenceId: projectNumber, pairedWithId: out.id,
            },
          });
          await tx.inventoryTransaction.update({ where: { id: out.id }, data: { pairedWithId: inn.id } });
          await recomputeBalance({ materialId: b.materialId, locationId: b.locationId, heldForProject: projectNumber }, tx);
          await recomputeBalance({ materialId: b.materialId, locationId: b.locationId, heldForProject: null }, tx);
          movedQty = movedQty.plus(qty);
        }

        if (changesItem) {
          // Only if it is unchanged: two people moving it at once can't both succeed.
          const done = await tx.material.updateMany({
            where: { id: item.materialId, category: PROJECTS_CATEGORY, projectNumber: before.projectNumber },
            data: { category: item.category as MaterialCategory, projectNumber: null, requiredStock: 0 },
          });
          if (done.count === 0) throw Errors.conflict(`${before.sku} has just been moved by someone else. Refresh the page.`);
        }
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'MOVE_TO_STORES',
            entityType: 'Material',
            entityId: item.materialId,
            before: { category: before.category, projectNumber: before.projectNumber },
            after: { category: changesItem ? item.category : before.category, projectNumber: changesItem ? null : before.projectNumber, ...(movedQty.gt(0) ? { heldMoved: movedQty.toString(), fromProject: projectNumber } : {}) },
          },
        });
      }
      return { moved: items.length };
    });
  },
};
