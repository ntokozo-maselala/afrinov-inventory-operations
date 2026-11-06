import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { dayRange } from '../../shared/dates.js';
import { SettingsService } from '../settings/settings.service.js';
import { classifyItem, getStatusBands, needsAttention, type StatusBands, type StockStatus } from '../../shared/inventory/stock-status.js';
import { onLoanByMaterial } from '../../shared/inventory/tool-loans.js';
import { heldForOf } from '../../shared/inventory/balances.js';
import { categoryWhere, sectionOf, type MaterialSection } from '../inventory/material-section.js';
import { stockStateOf, type StockState } from '../inventory/catalogue.service.js';

export interface StockStatusRow {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  requiredStock: string;
  /** Total across every location. */
  onHand: string;
  /** Tools only: out on loan, still owned; the status counts it with what is on hand. */
  onLoan: string;
  /** Held for projects, across every location: not part of `onHand`. */
  heldForProjects: string;
  /** Where the item stands, from all its stock lines (catalogue.service.ts). */
  stockState: StockState;
  /** False only when inactive items were asked for. */
  active: boolean;
  /** Still to come on approved Stores orders (ordered less received). */
  onOrder: string;
  /** The Stores orders it is on, soonest due first. */
  orders: OnOrderLine[];
  percentOfRequired: number | null;
  status: StockStatus;
  /** Required Stock less what is owned (on hand and on loan) and what is on order; 0 when none is short. */
  reorderQuantity: string;
  unitCost: string | null;
  locations: Array<{ locationId: string; locationName: string; quantity: string }>;
  /** Who it last came from: the most recent posted goods receipt with this item. */
  lastSupplier: { id: string; name: string; receivedAt: string } | null;
  /** Projects material: the project it belongs to (null until assigned). */
  projectNumber: string | null;
  project: { name: string | null; status: string } | null;
}

/** Projects material per project, for the stock value (materials sections roadmap, Phase 4). */
export interface ProjectStockValue {
  /** Null for Projects material with no project yet. */
  projectNumber: string | null;
  name: string | null;
  status: string | null;
  items: number;
  itemsInStock: number;
  value: number;
  unpriced: number;
  /**
   * Items Move to Stores takes once the project is closed: its leftovers
   * (Stores stock left from before project material came through the store,
   * Qodo, PR #143) and items with stock held for it (Project Material Through
   * the Store Roadmap, Phase 5).
   */
  leftovers: number;
}

export interface StockValueReport {
  currency: string;
  /** In the workbook's order: Consumables, Fasteners, Tooling, Project Material, then Tools. */
  categories: Array<{
    category: string;
    items: number;
    itemsInStock: number;
    /** On hand × unit price, items with a price. */
    value: number;
    /** Items with stock but no unit price, so not in the value. */
    unpriced: number;
    share: number;
  }>;
  total: { items: number; itemsInStock: number; value: number; unpriced: number };
  /** The same, for each section. */
  sections: Record<MaterialSection, { items: number; itemsInStock: number; value: number; unpriced: number }>;
  /** Projects material per project, completed and cancelled projects included. */
  projects: ProjectStockValue[];
  /** Stores only: Projects material is bought per job, so never urgent, low or "out". */
  status: Record<StockStatus, number> & { outOfStock: number };
}

const CATEGORY_ORDER = ['CONSUMABLES', 'FASTENERS_SLUGS_INSULATION', 'TOOLING_PPE_ELECTRICAL', 'PROJECT_MATERIAL', 'TOOLS'];

const STATUS_ORDER: Record<StockStatus, number> = { URGENT: 0, WARNING: 1, OK: 2, NOT_SET: 3 };

/**
 * Stores stock on hand per material, from the balances (the ledger's running
 * totals). A stock status is a Stores measure, so stock held for a project,
 * which Stores can't issue, doesn't count towards it (Qodo, PR #142).
 */
async function storesTotalsByMaterial(materialIds?: string[]): Promise<Map<string, Prisma.Decimal>> {
  const rows = await prisma.inventoryBalance.groupBy({
    by: ['materialId'],
    where: { heldForProject: '', ...(materialIds ? { materialId: { in: materialIds } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.materialId, r._sum.quantity ?? new Prisma.Decimal(0)]));
}

/** The supplier of each item's most recent posted goods receipt (counter or purchase order). */
async function lastSuppliers(materialIds: string[]): Promise<Map<string, { id: string; name: string; receivedAt: string }>> {
  const out = new Map<string, { id: string; name: string; receivedAt: string }>();
  if (materialIds.length === 0) return out;
  const lines = await prisma.goodsReceiptLine.findMany({
    where: { materialId: { in: materialIds }, goodsReceipt: { status: 'POSTED' } },
    select: { materialId: true, goodsReceipt: { select: { receivedAt: true, supplier: { select: { id: true, name: true } } } } },
    orderBy: { goodsReceipt: { receivedAt: 'desc' } },
  });
  for (const l of lines) {
    if (!out.has(l.materialId)) out.set(l.materialId, { id: l.goodsReceipt.supplier.id, name: l.goodsReceipt.supplier.name, receivedAt: l.goodsReceipt.receivedAt.toISOString() });
  }
  return out;
}

/**
 * One Stores order line still to come in: what is left to receive, and when it
 * is due. The order's id and number are null for someone who can't open Stores
 * orders (Qodo, PR #134).
 */
export interface OnOrderLine { purchaseOrderId: string | null; number: string | null; outstanding: string; dueDate: string | null }

// Order statuses with stock still to come: approved (with the supplier) or partly received.
const OPEN_ORDER_STATUSES = ['APPROVED', 'PARTIALLY_RECEIVED'] as const;

/**
 * Per item, the Stores order lines still to come in. A project order is left
 * out: its material goes from the supplier straight to site and is never stock
 * (ADR-023). A line's due date is its own, or the order's expected delivery.
 */
async function onOrderByMaterial(materialIds: string[]): Promise<Map<string, OnOrderLine[]>> {
  const out = new Map<string, OnOrderLine[]>();
  if (materialIds.length === 0) return out;
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { materialId: { in: materialIds }, purchaseOrder: { status: { in: [...OPEN_ORDER_STATUSES] }, projectNumber: null } },
    select: {
      materialId: true, orderedQty: true, receivedQty: true, deliveryDate: true,
      purchaseOrder: { select: { id: true, number: true, expectedDeliveryDate: true } },
    },
  });
  for (const l of lines) {
    const outstanding = l.orderedQty.minus(l.receivedQty);
    if (outstanding.lte(0)) continue;
    const due = l.deliveryDate ?? l.purchaseOrder.expectedDeliveryDate;
    out.set(l.materialId, [...(out.get(l.materialId) ?? []), {
      purchaseOrderId: l.purchaseOrder.id,
      number: l.purchaseOrder.number,
      outstanding: outstanding.toString(),
      dueDate: due ? due.toISOString().slice(0, 10) : null,
    }]);
  }
  // Soonest due first; an order with no date last.
  for (const list of out.values()) list.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.number ?? '').localeCompare(b.number ?? ''));
  return out;
}

function statusFor(required: Prisma.Decimal, onHand: Prisma.Decimal | undefined, bands: StatusBands) {
  return classifyItem(Number(onHand ?? 0), Number(required), bands);
}

// Reporting reads only. No mutations. Computed from the ledger (ADR-002).
export const ReportingService = {
  async currentStock(filter: { category?: string; locationId?: string; materialId?: string } = {}) {
    const where: Prisma.InventoryBalanceWhereInput = {};
    if (filter.locationId) where.locationId = filter.locationId;
    if (filter.materialId) where.materialId = filter.materialId;
    const balances = await prisma.inventoryBalance.findMany({
      where,
      orderBy: [{ materialId: 'asc' }, { locationId: 'asc' }, { heldForProject: 'asc' }],
    });

    const materialIds = Array.from(new Set(balances.map((b) => b.materialId)));
    const locationIds = Array.from(new Set(balances.map((b) => b.locationId)));

    const [materials, locations, bands, alertsOn, totals] = await Promise.all([
      materialIds.length
        ? prisma.material.findMany({
            where: {
              id: { in: materialIds },
              ...(filter.category ? { category: filter.category as Prisma.MaterialWhereInput['category'] } : {}),
            },
            include: { project: { select: { name: true, status: true } } },
          })
        : Promise.resolve([]),
      locationIds.length ? prisma.location.findMany({ where: { id: { in: locationIds } } }) : Promise.resolve([]),
      getStatusBands(),
      SettingsService.getValue<boolean>('inventory.enableStockAlerts'),
      storesTotalsByMaterial(materialIds),
    ]);
    // A tool out on loan is still owned, so it counts towards Required Stock.
    const onLoan = await onLoanByMaterial(prisma, materialIds);

    const matMap = new Map(materials.map((m) => [m.id, m]));
    const locMap = new Map(locations.map((l) => [l.id, l]));

    return balances
      .filter((b) => matMap.has(b.materialId))
      .map((b) => {
        const m = matMap.get(b.materialId)!;
        const l = locMap.get(b.locationId)!;
        const requiredStock = m.requiredStock;
        // The item's status, from its total across locations; the same on each of its rows.
        const item = statusFor(m.requiredStock, (totals.get(m.id) ?? new Prisma.Decimal(0)).plus(onLoan.get(m.id) ?? 0), bands);
        const belowThreshold = alertsOn && needsAttention(item.status);
        return {
          materialId: b.materialId,
          materialSku: m.sku,
          materialName: m.name,
          category: m.category,
          // Projects material: the project it belongs to (null until assigned).
          projectNumber: m.projectNumber,
          project: m.project ? { name: m.project.name, status: m.project.status } : null,
          // Whose stock this row is: the project it is held for, or null for Stores stock.
          heldForProject: heldForOf(b),
          unitOfMeasure: m.unitOfMeasure,
          requiredStock: requiredStock.toString(),
          locationId: b.locationId,
          locationName: l.name,
          locationType: l.type,
          // So Issue stock offers only what the server will issue from (Qodo, PR #132).
          materialActive: m.active,
          locationActive: l.active,
          quantity: b.quantity.toString(),
          belowThreshold,
          stockStatus: alertsOn ? item.status : null,
          percentOfRequired: item.percentOfRequired,
        };
      });
  },

  async movementHistory(filter: { materialId?: string; type?: string; from?: string; to?: string; projectNumber?: string; limit?: number } = {}) {
    const where: Prisma.InventoryTransactionWhereInput = {};
    if (filter.materialId) where.materialId = filter.materialId;
    if (filter.type) where.type = filter.type as Prisma.InventoryTransactionWhereInput['type'];
    // As the movement history: stock used for the project, and its own stock (Qodo, PR #145).
    if (filter.projectNumber) where.OR = [{ projectNumber: filter.projectNumber }, { heldForProject: filter.projectNumber }];
    // A day's `to` is the whole day, as on the other reports.
    const postedAt = dayRange(filter.from, filter.to);
    if (postedAt) where.postedAt = postedAt;
    // A limit that isn't a positive number (limit=abc) falls back to the default.
    const limit = filter.limit !== undefined && Number.isFinite(filter.limit) && filter.limit >= 1 ? Math.floor(filter.limit) : 200;

    const trx = await prisma.inventoryTransaction.findMany({
      where,
      include: {
        material: true,
        location: true,
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { postedAt: 'desc' },
      take: Math.min(limit, 1000),
    });
    return trx.map((t) => ({
      id: t.id,
      postedAt: t.postedAt.toISOString(),
      type: t.type,
      materialId: t.materialId,
      materialSku: t.material.sku,
      materialName: t.material.name,
      locationId: t.locationId,
      locationName: t.location.name,
      quantity: t.quantity.toString(),
      actorId: t.actorId,
      actorName: t.actor.name,
      recipientId: t.recipientId,
      reasonCode: t.reasonCode,
      reasonNote: t.reasonNote,
      projectNumber: t.projectNumber,
      // Whose stock moved: the project it is held for, or null for Stores stock.
      // Not projectNumber, which says who the stock was used for.
      heldForProject: t.heldForProject,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
    }));
  },

  /**
   * Stock status of every active item (every item with `includeInactive`, for
   * the catalogue, which lists them): on hand across all locations against
   * Required Stock, URGENT / WARNING / OK by the setting bands, or NOT_SET.
   * Most urgent first, then lowest percentage.
   */
  /**
   * `orders` counts what is on approved Stores orders: only when procurement is
   * on, as with it off those orders can't be received or cancelled (Qodo, PR #134).
   */
  async stockStatus(filter: { status?: StockStatus[]; category?: string; section?: MaterialSection | 'ALL'; orders?: boolean; includeInactive?: boolean } = {}): Promise<StockStatusRow[]> {
    // Re-ordering is for Stores: Projects material is bought per job, so it is
    // left out unless asked for (materials sections roadmap, Phase 4).
    const section = filter.section ?? 'STORES';
    // A category and a section apply together: Project Material asked for in Stores is nothing.
    if (filter.category && section !== 'ALL' && sectionOf(filter.category) !== section) return [];
    const category = filter.category
      ? filter.category as Prisma.MaterialWhereInput['category']
      : section === 'ALL' ? undefined : categoryWhere(section);
    const materials = await prisma.material.findMany({
      where: { ...(filter.includeInactive ? {} : { active: true }), ...(category ? { category } : {}) },
      include: { project: { select: { name: true, status: true } } },
      orderBy: { name: 'asc' },
    });
    const ids = materials.map((m) => m.id);
    const [balances, bands, lastSupplier, loans, onOrder] = await Promise.all([
      ids.length ? prisma.inventoryBalance.findMany({ where: { materialId: { in: ids } }, include: { location: { select: { name: true } } } }) : Promise.resolve([]),
      getStatusBands(),
      lastSuppliers(ids),
      onLoanByMaterial(prisma, ids),
      filter.orders ? onOrderByMaterial(ids) : Promise.resolve(new Map<string, OnOrderLine[]>()),
    ]);
    const byMaterial = new Map<string, typeof balances>();
    for (const b of balances) byMaterial.set(b.materialId, [...(byMaterial.get(b.materialId) ?? []), b]);

    const rows = materials.map((m): StockStatusRow => {
      // Status, reorder and value count Stores stock, which is what Stores can
      // issue (Qodo, PR #142), and Projects leftovers, which are Stores stock
      // with the item's project. Stock held for a project is that project's:
      // it gets its own views (Project Material Through the Store Roadmap, Phase 4).
      const lines = byMaterial.get(m.id) ?? [];
      const mine = lines.filter((b) => b.heldForProject === '');
      const onHand = mine.reduce((a, b) => a.add(b.quantity), new Prisma.Decimal(0));
      const heldForProjects = lines.filter((b) => b.heldForProject !== '').reduce((a, b) => a.add(b.quantity), new Prisma.Decimal(0));
      // A tool out on loan is still owned, so it counts towards Required Stock.
      const onLoan = loans.get(m.id) ?? new Prisma.Decimal(0);
      const item = statusFor(m.requiredStock, onHand.plus(onLoan), bands);
      // The status is what is owned now; what is on order only lowers what is left to order.
      const orders = onOrder.get(m.id) ?? [];
      const ordered = orders.reduce((a, o) => a.add(o.outstanding), new Prisma.Decimal(0));
      const reorderQuantity = Prisma.Decimal.max(0, new Prisma.Decimal(item.reorderQuantity).minus(ordered));
      return {
        materialId: m.id,
        sku: m.sku,
        name: m.name,
        category: m.category,
        unitOfMeasure: m.unitOfMeasure,
        requiredStock: m.requiredStock.toString(),
        onHand: onHand.toString(),
        onLoan: onLoan.toString(),
        heldForProjects: heldForProjects.toString(),
        stockState: stockStateOf(lines),
        active: m.active,
        onOrder: ordered.toString(),
        orders,
        percentOfRequired: item.percentOfRequired,
        status: item.status,
        reorderQuantity: reorderQuantity.toString(),
        unitCost: m.unitCost === null ? null : m.unitCost.toString(),
        locations: mine
          .filter((b) => !b.quantity.isZero())
          .map((b) => ({ locationId: b.locationId, locationName: b.location.name, quantity: b.quantity.toString() }))
          .sort((a, b) => a.locationName.localeCompare(b.locationName)),
        lastSupplier: lastSupplier.get(m.id) ?? null,
        projectNumber: m.projectNumber,
        project: m.project ? { name: m.project.name, status: m.project.status } : null,
      };
    });
    return rows
      .filter((r) => !filter.status || filter.status.length === 0 || filter.status.includes(r.status))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || (a.percentOfRequired ?? Infinity) - (b.percentOfRequired ?? Infinity)
        || a.name.localeCompare(b.name));
  },

  /**
   * The value of the stock on hand now, per category, as the workbook's
   * Summary sheets add it up row by row (Current Stock × Unit Price), with the
   * item counts by stock status for the dashboard cards.
   */
  async stockValue(): Promise<StockValueReport> {
    const [rows, currency] = await Promise.all([this.stockStatus({ section: 'ALL' }), SettingsService.getValue<string>('general.defaultCurrency')]);
    // Stock held for a project is that project's, not the store's, so the
    // status rows leave it out; its value still counts, under that project
    // (Qodo, PR #143), as the Inventory report and month-end count it.
    const ids = rows.map((r) => r.materialId);
    const held = ids.length
      ? (await prisma.inventoryBalance.findMany({ where: { materialId: { in: ids } }, select: { materialId: true, heldForProject: true, quantity: true } }))
        .filter((b) => b.heldForProject !== '' && !b.quantity.isZero())
      : [];

    // Each total is the items in it, with what each has on hand.
    type Bucket = Map<string, number>;
    const add = (bucket: Bucket, materialId: string, quantity: number) => bucket.set(materialId, (bucket.get(materialId) ?? 0) + quantity);
    const cats = new Map<string, Bucket>();
    const sections: Record<MaterialSection, Bucket> = { STORES: new Map(), PROJECTS: new Map() };
    const projects = new Map<string, Bucket>();
    const leftovers = new Map<string, Set<string>>();
    // Projects holding each item, as Move to Stores refuses an item held for another (Qodo, PR #149).
    const holdersOf = new Map<string, Set<string>>();
    for (const b of held) if (Number(b.quantity) > 0) holdersOf.set(b.materialId, (holdersOf.get(b.materialId) ?? new Set()).add(b.heldForProject));
    const movableFor = (project: string, materialId: string) => [...(holdersOf.get(materialId) ?? [])].every((h) => h === project);
    const projectInfo = new Map<string, { name: string | null; status: string }>();
    const bucketOf = <K>(map: Map<K, Bucket>, key: K) => map.get(key) ?? map.set(key, new Map()).get(key)!;
    const status = { URGENT: 0, WARNING: 0, OK: 0, NOT_SET: 0, outOfStock: 0 };
    const byId = new Map(rows.map((r) => [r.materialId, r]));
    for (const r of rows) {
      const onHand = Number(r.onHand);
      const section = sectionOf(r.category);
      // Each item counts in its category and its section and, for Projects material, its project.
      add(bucketOf(cats, r.category), r.materialId, onHand);
      add(sections[section], r.materialId, onHand);
      if (section === 'PROJECTS') {
        add(bucketOf(projects, r.projectNumber ?? ''), r.materialId, onHand);
        if (onHand > 0 && movableFor(r.projectNumber ?? '', r.materialId)) leftovers.set(r.projectNumber ?? '', (leftovers.get(r.projectNumber ?? '') ?? new Set()).add(r.materialId));
      }
      if (r.projectNumber && r.project) projectInfo.set(r.projectNumber, r.project);
      if (section === 'STORES') {
        // The counts the Dashboard cards show: Stores only.
        if (onHand <= 0) status.outOfStock++;
        status[r.status]++;
      }
    }
    for (const b of held) {
      const r = byId.get(b.materialId)!;
      const quantity = Number(b.quantity);
      add(bucketOf(cats, r.category), r.materialId, quantity);
      add(sections[sectionOf(r.category)], r.materialId, quantity);
      add(bucketOf(projects, b.heldForProject), r.materialId, quantity);
      if (quantity > 0 && movableFor(b.heldForProject, r.materialId)) leftovers.set(b.heldForProject, (leftovers.get(b.heldForProject) ?? new Set()).add(r.materialId));
    }
    const unnamed = [...projects.keys()].filter((k) => k !== '' && !projectInfo.has(k));
    if (unnamed.length > 0) {
      for (const p of await prisma.project.findMany({ where: { projectNumber: { in: unnamed } }, select: { projectNumber: true, name: true, status: true } })) {
        projectInfo.set(p.projectNumber, p);
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    // Value is on hand × unit price, for items with stock; an item in stock with no price is unpriced.
    const sum = (bucket: Bucket) => {
      const t = { items: bucket.size, itemsInStock: 0, value: 0, unpriced: 0 };
      for (const [materialId, onHand] of bucket) {
        if (onHand <= 0) continue;
        t.itemsInStock++;
        const unitCost = byId.get(materialId)!.unitCost;
        if (unitCost === null) t.unpriced++;
        else t.value += onHand * Number(unitCost);
      }
      return t;
    };
    const catTotals = [...cats].map(([category, bucket]) => [category, sum(bucket)] as const);
    const total = catTotals.reduce(
      (a, [, c]) => ({ items: a.items + c.items, itemsInStock: a.itemsInStock + c.itemsInStock, value: a.value + c.value, unpriced: a.unpriced + c.unpriced }),
      { items: 0, itemsInStock: 0, value: 0, unpriced: 0 },
    );
    const rounded = (t: ReturnType<typeof sum>) => ({ ...t, value: round2(t.value) });
    return {
      currency,
      categories: catTotals
        .sort(([a], [b]) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99))
        .map(([category, c]) => ({ category, ...c, value: round2(c.value), share: total.value > 0 ? Math.round((c.value / total.value) * 1000) / 1000 : 0 })),
      total: rounded(total),
      sections: { STORES: rounded(sum(sections.STORES)), PROJECTS: rounded(sum(sections.PROJECTS)) },
      projects: [...projects]
        .map(([key, bucket]): ProjectStockValue => ({
          projectNumber: key || null, name: projectInfo.get(key)?.name ?? null, status: projectInfo.get(key)?.status ?? null, ...rounded(sum(bucket)),
          leftovers: leftovers.get(key)?.size ?? 0,
        }))
        .sort((a, b) => (a.projectNumber === null ? 1 : b.projectNumber === null ? -1 : a.projectNumber.localeCompare(b.projectNumber))),
      status,
    };
  },

  /** Items that need re-ordering (URGENT or WARNING); empty when stock alerts are off. */
  async lowStock(opts: { orders?: boolean } = {}): Promise<StockStatusRow[]> {
    if (!(await SettingsService.getValue<boolean>('inventory.enableStockAlerts'))) return [];
    return this.stockStatus({ status: ['URGENT', 'WARNING'], orders: opts.orders });
  },

  async projectConsumption(projectNumber: string) {
    const trx = await prisma.inventoryTransaction.findMany({
      // Returns carry the issue's project; signed totals net them out.
      where: { projectNumber, type: { in: ['ISSUE', 'RETURN'] } },
      include: { material: true },
      orderBy: { postedAt: 'desc' },
    });

    const totals = new Map<string, { materialSku: string; materialName: string; unitOfMeasure: string; total: number }>();
    for (const t of trx) {
      const existing = totals.get(t.materialId);
      // Signed, so a reversed issue (same type, opposite sign) nets to zero.
      const qty = -t.quantity.toNumber();
      if (existing) existing.total += qty;
      else
        totals.set(t.materialId, {
          materialSku: t.material.sku,
          materialName: t.material.name,
          unitOfMeasure: t.material.unitOfMeasure,
          total: qty,
        });
    }
    return Array.from(totals.entries())
      .filter(([, v]) => v.total !== 0)
      .map(([materialId, v]) => ({ materialId, ...v }));
  },
};