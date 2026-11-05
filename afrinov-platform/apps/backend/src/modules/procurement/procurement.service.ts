// Purchase order service — full lifecycle.
//
// State machine:
//   DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → RECEIVED → CLOSED
// - submit: DRAFT → PENDING_APPROVAL, or straight to APPROVED when approval
//   is turned off in settings.
// - Receiving (goods receipts, or receive() for everything outstanding) moves
//   APPROVED / PARTIALLY_RECEIVED on to PARTIALLY_RECEIVED or RECEIVED.
// - close: PARTIALLY_RECEIVED or RECEIVED → CLOSED. Closing short (lines not
//   fully received) needs a reason.
// - cancel: DRAFT / PENDING_APPROVAL / APPROVED → CANCELLED, before anything
//   is received.
// There is no shipping stage: local suppliers deliver with an invoice.
//
// Concurrency: every transition uses an optimistic WHERE status = expected
// guard inside the Prisma transaction. Two concurrent transitions on the
// same PO cannot both succeed.
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { SettingsService } from '../settings/settings.service.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { recomputeBalance, lockInventoryBalances } from '../../shared/inventory/balances.js';
import { cleanPaymentTerms, cleanText, cleanVendorCode, cleanWebsite } from './supplier-fields.js';
import { defaultVatRate, orderTotals, withTotals } from './po-pricing.js';
import { STEP_LABEL, approvalState, exchangeRateOf, isStandIn, listSigners, loadApprovalSettings, noRateMessage, signRefusal, signsOrdersOfKind, whoToAsk } from './po-approval.js';
import { currentPrintedTerms } from './po-terms.js';
import { refuseProjectMaterialOnStoresOrder, refuseStoresOnProjectOrder } from '../inventory/material-section.js';

export interface CreateSupplierInput {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  vendorCode?: string;
  address?: string;
  currency?: string;
  paymentTerms?: string;
  website?: string;
  services?: string;
}

/** Fields left out are unchanged; null clears an optional one. */
export interface UpdateSupplierInput {
  id: string;
  name?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  vendorCode?: string | null;
  address?: string | null;
  currency?: string;
  paymentTerms?: string | null;
  website?: string | null;
  services?: string | null;
  active?: boolean;
}

async function assertSupplierNameFree(name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw Errors.conflict(`Supplier "${clash.name}" already exists`);
}

async function assertVendorCodeFree(code: string, exceptId?: string): Promise<void> {
  const clash = await prisma.supplier.findFirst({
    where: { vendorCode: code, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw Errors.conflict(`Vendor code ${code} is already used by ${clash.name}`);
}

// Two requests saving the same name or vendor code at once: the unique index wins.
function rethrowSupplierClash(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw Errors.conflict('Another supplier already has this name or vendor code');
  }
  throw err;
}

export const SupplierService = {
  async list(q?: string) {
    return prisma.supplier.findMany({
      where: q
        ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { contactName: { contains: q, mode: 'insensitive' } },
            { vendorCode: { contains: q, mode: 'insensitive' } },
            { services: { contains: q, mode: 'insensitive' } },
          ],
        }
        : {},
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  },

  async getById(id: string) {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw Errors.notFound('Supplier');
    return supplier;
  },

  async create(input: CreateSupplierInput, actorId: string) {
    const name = cleanText(input.name);
    if (!name) throw Errors.validation('Name is required');
    await assertSupplierNameFree(name);
    const vendorCode = cleanVendorCode(input.vendorCode);
    if (vendorCode) await assertVendorCodeFree(vendorCode);

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.supplier.create({
          data: {
            name,
            contactName: cleanText(input.contactName),
            contactEmail: cleanText(input.contactEmail),
            contactPhone: cleanText(input.contactPhone),
            notes: cleanText(input.notes),
            vendorCode,
            address: cleanText(input.address),
            currency: input.currency ?? 'ZAR',
            paymentTerms: cleanPaymentTerms(input.paymentTerms),
            website: cleanWebsite(input.website),
            services: cleanText(input.services),
          },
        });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'CREATE',
            entityType: 'Supplier',
            entityId: created.id,
            after: created as unknown as Prisma.InputJsonValue,
          },
        });
        return created;
      });
    } catch (err) {
      rethrowSupplierClash(err);
    }
  },

  async update(input: UpdateSupplierInput, actorId: string) {
    const before = await prisma.supplier.findUnique({ where: { id: input.id } });
    if (!before) throw Errors.notFound('Supplier');
    const data: Prisma.SupplierUpdateInput = {};
    if (input.name !== undefined) {
      const name = cleanText(input.name);
      if (!name) throw Errors.validation('Name is required');
      await assertSupplierNameFree(name, input.id);
      data.name = name;
    }
    if (input.vendorCode !== undefined) {
      const code = cleanVendorCode(input.vendorCode);
      if (code) await assertVendorCodeFree(code, input.id);
      data.vendorCode = code;
    }
    if (input.contactName !== undefined) data.contactName = cleanText(input.contactName);
    if (input.contactEmail !== undefined) data.contactEmail = cleanText(input.contactEmail);
    if (input.contactPhone !== undefined) data.contactPhone = cleanText(input.contactPhone);
    if (input.notes !== undefined) data.notes = cleanText(input.notes);
    if (input.address !== undefined) data.address = cleanText(input.address);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.paymentTerms !== undefined) data.paymentTerms = cleanPaymentTerms(input.paymentTerms);
    if (input.website !== undefined) data.website = cleanWebsite(input.website);
    if (input.services !== undefined) data.services = cleanText(input.services);
    if (input.active !== undefined) data.active = input.active;

    try {
      return await prisma.$transaction(async (tx) => {
        const after = await tx.supplier.update({ where: { id: input.id }, data });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'UPDATE',
            entityType: 'Supplier',
            entityId: input.id,
            before: before as unknown as Prisma.InputJsonValue,
            after: after as unknown as Prisma.InputJsonValue,
          },
        });
        return after;
      });
    } catch (err) {
      rethrowSupplierClash(err);
    }
  },
};

export const DELIVERY_METHODS = ['DELIVERY', 'COLLECTION'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** The order details on the template's Inputs sheet. On update, null clears a text field. */
export interface OrderDetailsInput {
  projectNumber?: string | null;
  /** The supplier's contact and address on this order. Left out on a new order: the supplier's own. */
  supplierContactName?: string | null;
  supplierContactPhone?: string | null;
  supplierContactEmail?: string | null;
  supplierAddress?: string | null;
  paymentTerms?: string | null;
  paymentMilestone?: string | null;
  /** Percent. */
  settlementDiscount?: number;
  shippingTerms?: string | null;
  penaltiesApply?: boolean;
  deliveryMethod?: DeliveryMethod;
  deliveryTo?: string | null;
  deliveryAddress?: string | null;
  deliveryCountry?: string | null;
  deliveryContactName?: string | null;
  deliveryContactPhone?: string | null;
  afrinovContact?: string | null;
}

export interface CreatePOInput extends OrderDetailsInput {
  supplierId: string;
  /**
   * unitPrice excludes VAT, in the supplier's currency: the list price, which
   * discountPercent (0 when left out) comes off. deliveryDate defaults to the
   * order's expected date.
   */
  lines: Array<{ materialId: string; orderedQty: number; unitPrice?: number; discountPercent?: number; deliveryDate?: string }>;
  notes?: string;
  expectedDeliveryDate?: string;
  /** Percent. Left out: the VAT setting for rand suppliers, 0 for other currencies. */
  vatRate?: number;
}

export interface UpdatePOInput extends OrderDetailsInput {
  id: string;
  notes?: string;
  expectedDeliveryDate?: string | null;
  vatRate?: number;
  /** New unit prices by line id; null clears one. */
  linePrices?: Array<{ lineId: string; unitPrice: number | null }>;
  /** New discounts by line id, in percent. */
  lineDiscounts?: Array<{ lineId: string; discountPercent: number }>;
  /** New delivery dates by line id; null falls back to the order's expected date. */
  lineDeliveryDates?: Array<{ lineId: string; deliveryDate: string | null }>;
}

const DETAIL_TEXT_FIELDS = [
  'supplierContactName', 'supplierContactPhone', 'supplierContactEmail', 'supplierAddress',
  'paymentTerms', 'paymentMilestone', 'shippingTerms', 'deliveryTo', 'deliveryAddress',
  'deliveryCountry', 'deliveryContactName', 'deliveryContactPhone', 'afrinovContact',
] as const;

/** Trims multi-line text (an address) line by line, keeping the line breaks. */
function cleanLines(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const lines = s.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

/** Orders are raised only for an open project: a completed or cancelled one's leftovers go to Stores. */
export async function assertProjectOpen(projectNumber: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  const project = await client.project.findUnique({ where: { projectNumber } });
  if (!project) throw Errors.validation(`No project ${projectNumber}`);
  if (!project.active) throw Errors.validation(`Project ${projectNumber} is inactive`);
  if (project.status === 'COMPLETED' || project.status === 'CANCELLED') {
    throw Errors.validation(`Project ${projectNumber} is ${project.status === 'COMPLETED' ? 'completed' : 'cancelled'}, so nothing more is ordered for it.`);
  }
}

/** The order's lines' materials, for the project rules. */
function lineMaterialsOf(materialIds: string[], client: Prisma.TransactionClient | typeof prisma) {
  return client.material.findMany({
    where: { id: { in: [...new Set(materialIds)] } },
    select: { sku: true, category: true, projectNumber: true },
  });
}

const dayOf = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Decimals and dates as plain JSON for the audit log. */
function jsonValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return v.toString();
  return v ?? null;
}

/** Whether a stored value and a new one are the same: decimals by value, dates by instant. */
function sameValue(stored: unknown, next: unknown): boolean {
  const norm = (v: unknown) => {
    if (v === undefined || v === null) return null;
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Prisma.Decimal || typeof v === 'number') return new Prisma.Decimal(v as Prisma.Decimal.Value).toString();
    return v;
  };
  return norm(stored) === norm(next);
}

/** The details sent, tidied, as columns. Fields left out are left out. */
function detailsData(input: OrderDetailsInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const k of DETAIL_TEXT_FIELDS) {
    if (input[k] === undefined) continue;
    data[k] = k === 'deliveryAddress' || k === 'supplierAddress' ? cleanLines(input[k]) : k === 'paymentTerms' ? cleanPaymentTerms(input[k]) : cleanText(input[k]);
  }
  if (input.projectNumber !== undefined) data.projectNumber = cleanText(input.projectNumber);
  if (input.settlementDiscount !== undefined) data.settlementDiscount = input.settlementDiscount;
  if (input.penaltiesApply !== undefined) data.penaltiesApply = input.penaltiesApply;
  if (input.deliveryMethod !== undefined) data.deliveryMethod = input.deliveryMethod;
  return data;
}

export interface ReceiveInput {
  id: string;
  locationId: string;
  deliveryNotes?: string;
}

export interface CloseInput {
  id: string;
  reason?: string;
}

/** Statuses a purchase order can be received against. */
export const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = ['APPROVED', 'PARTIALLY_RECEIVED'];

/**
 * Project material comes through the store (Project Material Through the
 * Store Roadmap, Phase 2): a project order's delivery is received on Receive
 * stock, so it is no longer confirmed on the order.
 */
export const DELIVERY_IS_RECEIVED =
  "Project orders are received into stock now: the store books each delivery on Receive stock.";

export interface ConfirmDeliveryInput {
  id: string;
  /** What arrived on site, line by line; each at most what is still outstanding. */
  lines: Array<{ lineId: string; quantity: number }>;
  /** The supplier's delivery note or the site's confirmation. */
  deliveryRef?: string;
  /** YYYY-MM-DD the material arrived on site; today when left out. */
  deliveredOn?: string;
}

export interface CancelInput {
  id: string;
  reason: string;
}

function toDateOnly(iso: string): Date {
  // Accepts both YYYY-MM-DD and full ISO; truncates to start-of-day UTC.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw Errors.validation('Invalid expectedDeliveryDate');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The two kinds of order (Stores ordering roadmap): a Stores order has no
 * project and is raised by the store; a project order is Procurement's.
 */
export const ORDER_KINDS = ['stores', 'projects'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** A Stores order has no project (null), as the order lists filter; any project number makes it a project order. */
export const kindOfOrder = (po: { projectNumber?: string | null }): OrderKind => (po.projectNumber == null ? 'stores' : 'projects');

/** The roles that decide what this user may sign. */
async function signerOf(actorId: string): Promise<{ id: string; roles: string[] }> {
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { roles: { select: { role: { select: { name: true } } } } } });
  return { id: actorId, roles: (user?.roles ?? []).map((r) => r.role.name) };
}

export const PurchaseOrderService = {
  async list(filter: { status?: PurchaseOrderStatus; projectNumber?: string; kind?: OrderKind } = {}) {
    const { kind, ...where } = filter;
    const orders = await prisma.purchaseOrder.findMany({
      where: { ...where, ...(kind ? { AND: [{ projectNumber: kind === 'stores' ? null : { not: null } }] } : {}) },
      include: { supplier: true, project: { select: { projectNumber: true, name: true } }, lines: { include: { material: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(withTotals);
  },

  /**
   * Orders still waiting for delivery (Approved or Partly received) of the
   * kinds asked for, as Receive stock needs them: who supplies them, the
   * project, and each line's item with what is ordered and received so far.
   * No prices, approvals or RFQ: the store receives project orders without
   * seeing them (Project Material Through the Store Roadmap, Phase 2).
   */
  async receivable(kinds: { stores: boolean; projects: boolean }) {
    if (!kinds.stores && !kinds.projects) return [];
    const projectNumber = kinds.stores && kinds.projects ? undefined : kinds.stores ? null : { not: null };
    return prisma.purchaseOrder.findMany({
      where: { status: { in: RECEIVABLE_STATUSES }, ...(projectNumber === undefined ? {} : { projectNumber }) },
      select: {
        id: true, number: true, status: true, supplierId: true, projectNumber: true, expectedDeliveryDate: true,
        supplier: { select: { name: true } },
        project: { select: { name: true } },
        lines: { select: { id: true, materialId: true, orderedQty: true, receivedQty: true, material: { select: { sku: true, name: true, unitOfMeasure: true } } } },
      },
      orderBy: { number: 'asc' },
    });
  },

  /**
   * The orders pending approval this user may approve now, by the same rule as
   * Approve: every line priced and the total within their limit. Oldest first,
   * as they have waited longest. Empty for anyone who may not approve.
   */
  async awaitingApproval(actorId: string, kind?: OrderKind) {
    const settings = await loadApprovalSettings();
    const me = await signerOf(actorId);
    const waiting = [];
    for (const k of kind ? [kind] : ORDER_KINDS) {
      if (!signsOrdersOfKind(k, me.roles)) continue;
      const orders = await prisma.purchaseOrder.findMany({
        where: { status: 'PENDING_APPROVAL', projectNumber: k === 'stores' ? null : { not: null } },
        include: { supplier: true, project: { select: { projectNumber: true, name: true } }, lines: { include: { material: true } }, signatures: true },
      });
      waiting.push(...orders.filter((po) => !signRefusal(k, approvalState(po, settings), po, me)));
    }
    return waiting.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(withTotals);
  },

  async getById(id: string) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        project: { select: { projectNumber: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        deliveredBy: { select: { id: true, name: true, email: true } },
        cancelledBy: { select: { id: true, name: true, email: true } },
        closedBy: { select: { id: true, name: true, email: true } },
        signatures: { include: { signedBy: { select: { id: true, name: true } } }, orderBy: { signedAt: 'asc' } },
        lines: { include: { material: true } },
        goodsReceipts: { include: { lines: true } },
        // The request for quotation it was awarded from, if any.
        rfq: { select: { id: true, number: true } },
      },
    });
    if (!po) throw Errors.notFound('PurchaseOrder');
    return withTotals(po);
  },

  /**
   * Creates a numbered draft with its lines and records actorId as its creator.
   * Omitted supplier contact details, address and payment terms come from the
   * supplier; null or blank text clears them. Delivery is the default method,
   * with omitted delivery details filled from Settings only for delivery.
   * The Afrinov contact defaults to the creator's name when omitted.
   *
   * @returns The saved order, including its supplier and lines.
   * @throws {ApiError} NOT_FOUND if the supplier is missing; VALIDATION_ERROR
   * for no lines, an inactive supplier, a missing, inactive, closed or mismatched
   * project, unassigned project material, or an invalid order or line delivery date.
   * @throws {Error} Propagates database errors, including delivery settings
   * lookup and transaction failures.
   *
   * @param opts.within The caller's transaction, so the order is saved with
   * the rest of its change or not at all (an RFQ's award).
   * @param opts.fromRfq The request for quotation it was awarded from, named
   * on its first Activity entry.
   */
  async create(input: CreatePOInput, actorId: string, opts: { within?: Prisma.TransactionClient; fromRfq?: { id: string; number: string } } = {}) {
    if (input.lines.length === 0) throw Errors.validation('Purchase order must have at least one line');
    // Inside a caller's transaction every check reads through it, with the
    // supplier, project and items held until it ends, so none of them can be
    // deactivated or closed between the check and the order being written.
    const db = opts.within ?? prisma;
    if (opts.within) {
      await opts.within.$executeRaw`SELECT 1 FROM suppliers WHERE id = ${input.supplierId} FOR SHARE`;
      if (input.projectNumber) await opts.within.$executeRaw`SELECT 1 FROM projects WHERE project_number = ${input.projectNumber} FOR SHARE`;
      await opts.within.$executeRaw`SELECT 1 FROM materials WHERE id IN (${Prisma.join([...new Set(input.lines.map((l) => l.materialId))])}) FOR SHARE`;
    }
    const supplier = await db.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw Errors.notFound('Supplier');
    if (!supplier.active) throw Errors.validation(`${supplier.name} is inactive. Reactivate the supplier to order from them.`);
    const currency = supplier.currency ?? 'ZAR';
    const vatRate = input.vatRate ?? defaultVatRate(currency, await SettingsService.getValue<number>('purchaseOrders.vatRate', opts.within));
    if (input.projectNumber) await assertProjectOpen(input.projectNumber, db);
    // The order says which project its material is for, not the catalogue
    // item: any Projects item goes on any project order (Project on the Order
    // Roadmap, Phase 1).
    const lineMaterials = await lineMaterialsOf(input.lines.map((l) => l.materialId), db);
    // A project order holds its project's material only. An RFQ sent before
    // that rule may still hold Stores items, and its award keeps them.
    if (!opts.fromRfq) refuseStoresOnProjectOrder(cleanText(input.projectNumber), lineMaterials);
    refuseProjectMaterialOnStoresOrder(cleanText(input.projectNumber), lineMaterials);

    // Details left out are filled as the template fills them: payment terms
    // from the supplier, the delivery block from Settings (unless the goods
    // are collected), the Afrinov contact from whoever raises the order.
    const details = detailsData(input);
    if (input.paymentTerms === undefined) details.paymentTerms = supplier.paymentTerms ?? null;
    // The supplier block starts from the supplier, as the template looks it up.
    if (input.supplierContactName === undefined) details.supplierContactName = cleanText(supplier.contactName);
    if (input.supplierContactPhone === undefined) details.supplierContactPhone = cleanText(supplier.contactPhone);
    if (input.supplierContactEmail === undefined) details.supplierContactEmail = cleanText(supplier.contactEmail);
    if (input.supplierAddress === undefined) details.supplierAddress = cleanLines(supplier.address);
    const method = input.deliveryMethod ?? 'DELIVERY';
    if (method === 'DELIVERY') {
      const defaults = await SettingsService.getValues([
        'purchaseOrders.deliveryTo', 'purchaseOrders.deliveryAddress', 'purchaseOrders.deliveryCountry',
        'purchaseOrders.deliveryContactName', 'purchaseOrders.deliveryContactPhone',
      ], opts.within);
      for (const k of ['deliveryTo', 'deliveryAddress', 'deliveryCountry', 'deliveryContactName', 'deliveryContactPhone'] as const) {
        if (input[k] === undefined) {
          const v = defaults[`purchaseOrders.${k}`];
          details[k] = k === 'deliveryAddress' ? cleanLines(v as string) : cleanText(v as string);
        }
      }
    }
    if (input.afrinovContact === undefined) {
      const actor = await db.user.findUnique({ where: { id: actorId } });
      details.afrinovContact = actor?.name ?? null;
    }

    const write = async (tx: Prisma.TransactionClient) => {
      // The items are held, and their sections read again, in the transaction
      // that writes the order: an item moved to Stores at the same moment then
      // either waits for this order (and is refused, being on it) or is seen as
      // moved here (Qodo, PR #129).
      const ids = [...new Set(input.lines.map((l) => l.materialId))];
      await tx.$executeRaw`SELECT 1 FROM materials WHERE id IN (${Prisma.join(ids)}) FOR SHARE`;
      const held = await lineMaterialsOf(ids, tx);
      if (!opts.fromRfq) refuseStoresOnProjectOrder(cleanText(input.projectNumber), held);
      refuseProjectMaterialOnStoresOrder(cleanText(input.projectNumber), held);
      // Serialize PO-number generation so two concurrent creates cannot
      // collide on the same sequential number. The advisory lock is scoped
      // to this transaction and auto-released on commit/rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:po-number'))`;
      const number = await generatePONumber(tx);
      const po = await tx.purchaseOrder.create({
        data: {
          number,
          supplierId: input.supplierId,
          notes: input.notes ?? null,
          expectedDeliveryDate: input.expectedDeliveryDate ? toDateOnly(input.expectedDeliveryDate) : null,
          createdById: actorId,
          status: 'DRAFT',
          currency,
          vatRate,
          ...details,
          deliveryMethod: method,
          lines: {
            create: input.lines.map((l) => ({
              materialId: l.materialId,
              orderedQty: l.orderedQty,
              receivedQty: 0,
              unitPrice: l.unitPrice ?? null,
              discountPercent: l.discountPercent ?? 0,
              deliveryDate: l.deliveryDate ? toDateOnly(l.deliveryDate) : null,
            })),
          },
        },
        include: { lines: true, supplier: true },
      });
      // The first entry on the order's Activity.
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'PurchaseOrder',
          entityId: po.id,
          after: {
            number, status: po.status,
            ...(opts.fromRfq ? { rfqId: opts.fromRfq.id, rfqNumber: opts.fromRfq.number } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      return po;
    };
    return opts.within ? write(opts.within) : prisma.$transaction(write);
  },

  async update(input: UpdatePOInput, actorId: string) {
    const allowEditAfterApproval = await SettingsService.getValue<boolean>('purchaseOrders.allowEditAfterApproval');
    const requireApproval = await SettingsService.getValue<boolean>('purchaseOrders.requireApprovalBeforeProcessing');
    const approvalSettings = await loadApprovalSettings();
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: input.id }, include: { lines: true, signatures: true } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      if (!isEditable(po.status, allowEditAfterApproval)) {
        throw Errors.invalidState(`Purchase order in status ${po.status} is no longer editable`, { status: po.status });
      }
      const data: Prisma.PurchaseOrderUpdateInput = {};
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.expectedDeliveryDate !== undefined) {
        data.expectedDeliveryDate = input.expectedDeliveryDate === null
          ? null
          : toDateOnly(input.expectedDeliveryDate);
      }
      if (input.vatRate !== undefined) data.vatRate = input.vatRate;
      // A new project is checked: open, and the one its project material is for.
      // An order left on its project can still be edited after the project closes.
      const nextProject = input.projectNumber === undefined ? undefined : cleanText(input.projectNumber);
      if (nextProject !== undefined && nextProject !== po.projectNumber) {
        // A Stores order and a project order are raised by different teams,
        // so neither becomes the other; a project order can change project.
        if ((nextProject === null) !== (kindOfOrder(po) === 'stores')) {
          throw Errors.validation(po.projectNumber
            ? 'A project order stays on a project. Stores stock is ordered from Stores → Order stock.'
            : 'A Stores order has no project. Raise a purchase order for the project instead.');
        }
        if (nextProject) await assertProjectOpen(nextProject, tx);
      }
      Object.assign(data, detailsData(input));
      const priceChanges: Array<{ lineId: string; before: string | null; after: string | null }> = [];
      for (const p of input.linePrices ?? []) {
        const line = po.lines.find((l) => l.id === p.lineId);
        if (!line) throw Errors.validation(`Line ${p.lineId} is not on purchase order ${po.number}`);
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { unitPrice: p.unitPrice } });
        priceChanges.push({ lineId: line.id, before: line.unitPrice?.toString() ?? null, after: p.unitPrice === null ? null : String(p.unitPrice) });
      }
      // A discount changes what is paid, as a price does (Procurement KPIs count it).
      const discountChanges: Array<{ lineId: string; before: string; after: string }> = [];
      for (const d of input.lineDiscounts ?? []) {
        const line = po.lines.find((l) => l.id === d.lineId);
        if (!line) throw Errors.validation(`Line ${d.lineId} is not on purchase order ${po.number}`);
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { discountPercent: d.discountPercent } });
        discountChanges.push({ lineId: line.id, before: new Prisma.Decimal(line.discountPercent ?? 0).toString(), after: String(d.discountPercent) });
      }
      const dateChanges: Array<{ lineId: string; before: string | null; after: string | null }> = [];
      for (const d of input.lineDeliveryDates ?? []) {
        const line = po.lines.find((l) => l.id === d.lineId);
        if (!line) throw Errors.validation(`Line ${d.lineId} is not on purchase order ${po.number}`);
        const next = d.deliveryDate === null ? null : toDateOnly(d.deliveryDate);
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { deliveryDate: next } });
        dateChanges.push({ lineId: line.id, before: dayOf(line.deliveryDate), after: dayOf(next) });
      }
      // The form sends every field; keep only what actually changes, so the
      // log reads as the change made and an unchanged save raises no revision.
      for (const k of Object.keys(data) as Array<keyof typeof data>) {
        if (sameValue((po as unknown as Record<string, unknown>)[k], data[k])) delete data[k];
      }
      const realPrices = priceChanges.filter((c) => c.before === null ? c.after !== null : c.after === null || !new Prisma.Decimal(c.before).equals(c.after));
      const realDates = dateChanges.filter((c) => c.before !== c.after);
      const realDiscounts = discountChanges.filter((c) => !new Prisma.Decimal(c.before).equals(c.after));
      priceChanges.splice(0, priceChanges.length, ...realPrices);
      dateChanges.splice(0, dateChanges.length, ...realDates);
      discountChanges.splice(0, discountChanges.length, ...realDiscounts);
      const anyChange = Object.keys(data).length > 0 || priceChanges.length > 0 || dateChanges.length > 0 || discountChanges.length > 0;
      // Changing an approved order makes a new revision, as the template's
      // "Rev 01", so the supplier can tell the copies apart.
      if (po.status === 'APPROVED' && anyChange) data.revision = po.revision + 1;
      const moneyChanged = priceChanges.length > 0 || discountChanges.length > 0 || 'vatRate' in data;
      let signaturesCleared = false;
      // A signature is for the money as it stood: changing it on an order still
      // being signed starts the signing again.
      if (moneyChanged && po.status === 'PENDING_APPROVAL' && po.signatures.length > 0) {
        await tx.purchaseOrderSignature.deleteMany({ where: { purchaseOrderId: po.id } });
        signaturesCleared = true;
      }
      // An approved order that is now worth more than was signed for, needs a
      // signature it doesn't have, or has lost a price goes back for approval.
      // Lowering its value keeps the signatures: nobody is held to more.
      if (moneyChanged && requireApproval && po.status === 'APPROVED' && po.approvedById) {
        const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        const state = approvalState({ ...po, vatRate: input.vatRate ?? po.vatRate, lines }, approvalSettings);
        const signedFor = approvalState(po, approvalSettings).randValue;
        const raised = signedFor !== null && state.randValue !== null && new Prisma.Decimal(state.randValue).gt(signedFor);
        if (state.block || state.next || raised) {
          await tx.purchaseOrderSignature.deleteMany({ where: { purchaseOrderId: po.id } });
          signaturesCleared = po.signatures.length > 0;
          // Back for approval, it has no approved wording until approved again:
          // its draft prints today's small print, and approval takes that.
          Object.assign(data, { status: 'PENDING_APPROVAL', approvedAt: null, approvedById: null, printedTerms: Prisma.DbNull });
        }
      }
      const after = await tx.purchaseOrder.update({ where: { id: input.id }, data });
      if (!anyChange) return after;
      // Only what changed goes in the log, so each entry reads as the change made.
      const changed = Object.keys(data) as Array<keyof typeof po & keyof typeof after>;
      const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, jsonValue(o[k])]));
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'UPDATE',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: {
            ...pick(po as unknown as Record<string, unknown>),
            ...(priceChanges.length ? { unitPrices: priceChanges.map((c) => ({ lineId: c.lineId, unitPrice: c.before })) } : {}),
            ...(discountChanges.length ? { discounts: discountChanges.map((c) => ({ lineId: c.lineId, discountPercent: c.before })) } : {}),
            ...(dateChanges.length ? { deliveryDates: dateChanges.map((c) => ({ lineId: c.lineId, deliveryDate: c.before })) } : {}),
          } as Prisma.InputJsonValue,
          after: {
            ...pick(after as unknown as Record<string, unknown>),
            ...(priceChanges.length ? { unitPrices: priceChanges.map((c) => ({ lineId: c.lineId, unitPrice: c.after })) } : {}),
            ...(discountChanges.length ? { discounts: discountChanges.map((c) => ({ lineId: c.lineId, discountPercent: c.after })) } : {}),
            ...(dateChanges.length ? { deliveryDates: dateChanges.map((c) => ({ lineId: c.lineId, deliveryDate: c.after })) } : {}),
            ...(signaturesCleared ? { signaturesCleared: true } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      return after;
    });
  },

  async submit(id: string, actorId: string) {
    const requireApproval = await SettingsService.getValue<boolean>('purchaseOrders.requireApprovalBeforeProcessing');
    const approvalSettings = await loadApprovalSettings();
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      if (po.lines.length === 0) throw Errors.validation('Cannot submit an empty purchase order');
      const allowed: PurchaseOrderStatus[] = ['DRAFT'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Cannot submit a PO in status ${po.status}`, { status: po.status });
      }
      // A draft is checked again as it goes out: its project may have closed
      // since, and a Stores draft from before may hold project material.
      refuseProjectMaterialOnStoresOrder(po.projectNumber, await lineMaterialsOf(po.lines.map((l) => l.materialId), tx));
      if (po.projectNumber) await assertProjectOpen(po.projectNumber, tx);
      const now = new Date();
      if (requireApproval) {
        const target: PurchaseOrderStatus = 'PENDING_APPROVAL';
        // The rate locks here, so who has to sign can't move with today's rate.
        const exchangeRate = exchangeRateOf({ currency: po.currency, exchangeRate: null }, approvalSettings);
        if (po.currency !== 'ZAR' && !exchangeRate) throw Errors.validation(noRateMessage(po.currency));
        const result = await tx.purchaseOrder.updateMany({
          where: { id, status: { in: allowed } },
          data: { status: target, exchangeRate },
        });
        if (result.count === 0) {
          throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
        }
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'PO_SUBMIT',
            entityType: 'PurchaseOrder',
            entityId: id,
            before: { status: po.status },
            after: { status: target },
          },
        });
      } else {
        // Approval not required: submission auto-approves, and the order keeps
        // the small print it was approved with.
        const result = await tx.purchaseOrder.updateMany({
          where: { id, status: { in: allowed } },
          data: { status: 'APPROVED', approvedAt: now, approvedById: actorId, printedTerms: await currentPrintedTerms(tx) },
        });
        if (result.count === 0) {
          throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
        }
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'PO_SUBMIT_AUTO_APPROVE',
            entityType: 'PurchaseOrder',
            entityId: id,
            before: { status: po.status },
            after: { status: 'APPROVED', approvedAt: now.toISOString(), approvedById: actorId, autoApprove: true },
          },
        });
      }
      return tx.purchaseOrder.findUnique({ where: { id } });
    });
  },

  /** The signatures this order needs, who may give the next, and whether the asking user can. */
  async approval(id: string, actorId: string) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true, signatures: { include: { signedBy: { select: { name: true } } } } },
    });
    if (!po) throw Errors.notFound('PurchaseOrder');
    const kind = kindOfOrder(po);
    const settings = await loadApprovalSettings();
    const state = approvalState(po, settings);
    const me = await signerOf(actorId);
    const refusal = signRefusal(kind, state, po, me);
    const signed = new Set(po.signatures.map((s) => s.signedById));
    return {
      ...orderTotals(po.lines, po.vatRate ?? 0),
      currency: po.currency,
      exchangeRate: exchangeRateOf(po, settings)?.toString() ?? null,
      randValue: state.randValue,
      noRate: state.block?.code === 'NO_RATE',
      steps: state.steps.map((step) => {
        const s = po.signatures.find((x) => x.step === step);
        return { step, label: STEP_LABEL[step], signature: s ? { name: s.signedBy.name, signedAt: s.signedAt, standIn: s.standIn } : null };
      }),
      next: state.next ? { step: state.next, label: STEP_LABEL[state.next] } : null,
      canApprove: po.status === 'PENDING_APPROVAL' && !refusal,
      // Only for those who sign this kind of order: to anyone else it isn't theirs to be told.
      reason: po.status === 'PENDING_APPROVAL' && signsOrdersOfKind(kind, me.roles) ? refusal : null,
      approvers: state.next ? (await listSigners(kind, state.next)).filter((a) => !signed.has(a.id)) : [],
    };
  },

  /** Signs the next step the order needs; the last signature approves it. */
  async approve(id: string, actorId: string) {
    const settings = await loadApprovalSettings();
    const me = await signerOf(actorId);
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true, signatures: true } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      const allowed: PurchaseOrderStatus[] = ['PENDING_APPROVAL'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Cannot approve a PO in status ${po.status}`, { status: po.status });
      }
      const kind = kindOfOrder(po);
      const state = approvalState(po, settings);
      if (state.block) throw Errors.validation(state.block.message);
      const refusal = signRefusal(kind, state, po, me);
      if (refusal) {
        const signed = new Set(po.signatures.map((s) => s.signedById));
        const names = state.next ? (await listSigners(kind, state.next)).filter((a) => !signed.has(a.id)).map((a) => a.name) : [];
        throw Errors.forbidden(`${refusal} ${whoToAsk(names)}`);
      }
      const step = state.next;
      const standIn = step ? isStandIn(kind, step, me.roles) : false;
      const now = new Date();
      if (step) {
        // Two signing the same step at once: the unique key lets one through.
        const added = await tx.purchaseOrderSignature.createMany({
          data: [{ purchaseOrderId: id, step, signedById: actorId, signedAt: now, standIn }],
          skipDuplicates: true,
        });
        if (added.count === 0) {
          throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
        }
      }
      // An order submitted before rates were locked takes today's at its first signature.
      const exchangeRate = exchangeRateOf(po, settings);
      if (step && step !== state.steps[state.steps.length - 1]) {
        await tx.purchaseOrder.update({ where: { id }, data: { exchangeRate } });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'PO_SIGN',
            entityType: 'PurchaseOrder',
            entityId: id,
            before: { status: po.status },
            after: { status: po.status, step, standIn },
          },
        });
        return tx.purchaseOrder.findUnique({ where: { id } });
      }
      // The order keeps the small print it was approved with; approving a
      // revision again takes the wording of the day.
      const result = await tx.purchaseOrder.updateMany({
        where: { id, status: { in: allowed } },
        data: { status: 'APPROVED', approvedAt: now, approvedById: actorId, exchangeRate, printedTerms: await currentPrintedTerms(tx) },
      });
      if (result.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_APPROVE',
          entityType: 'PurchaseOrder',
          entityId: id,
          before: { status: po.status },
          after: { status: 'APPROVED', approvedAt: now.toISOString(), approvedById: actorId, step, standIn },
        },
      });
      return tx.purchaseOrder.findUnique({ where: { id } });
    });
  },

  // Receive everything still outstanding: every line's shortfall becomes a
  // RECEIPT inventory transaction at the chosen location, and the order is
  // RECEIVED. Partial deliveries go through goods receipts instead. Calling
  // it twice is rejected by the status guard (ADR-002: the ledger stays the
  // source of truth).
  async receive(input: ReceiveInput, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: input.id },
        include: { lines: true },
      });
      if (!po) throw Errors.notFound('PurchaseOrder');
      // A project order's delivery is held for its project; a Stores order's is
      // Stores stock (Project Material Through the Store Roadmap, Phase 2).
      const stockOf = (materialId: string) => ({ materialId, locationId: input.locationId, heldForProject: po.projectNumber });
      // The order before its stock, as posting a goods receipt locks them, so
      // the two cannot deadlock.
      await tx.$executeRaw`SELECT id FROM purchase_orders WHERE id = ${po.id} FOR UPDATE`;
      await lockInventoryBalances(po.lines.map((line) => stockOf(line.materialId)), tx);
      if (!RECEIVABLE_STATUSES.includes(po.status)) {
        throw Errors.invalidState(`Only an approved or partly received purchase order can be received`, { status: po.status });
      }
      const location = await tx.location.findUnique({ where: { id: input.locationId } });
      if (!location) throw Errors.notFound('Location');
      if (!location.active) throw Errors.validation('Location is inactive');

      const now = new Date();
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: input.id, status: po.status },
        data: {
          status: 'RECEIVED',
          deliveredAt: now,
          deliveredById: actorId,
          deliveryNotes: input.deliveryNotes ?? null,
        },
      });
      if (claimed.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }

      for (const line of po.lines) {
        const orderedQty = toDecimal(line.orderedQty);
        const alreadyReceived = toDecimal(line.receivedQty);
        // Only create receipt transactions for the shortfall so that partial
        // receipts (e.g. via GoodsReceipt posting) are not double-counted.
        const toReceive = orderedQty.minus(alreadyReceived);
        if (gtZero(toReceive)) {
          await tx.inventoryTransaction.create({
            data: {
              materialId: line.materialId,
              locationId: input.locationId,
              type: 'RECEIPT',
              quantity: toReceive,
              referenceType: 'PurchaseOrder',
              referenceId: po.id,
              actorId,
              heldForProject: po.projectNumber,
            },
          });
          await recomputeBalance(stockOf(line.materialId), tx);
        }

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQty: orderedQty },
        });
      }

      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_RECEIVE',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { status: po.status },
          after: { status: 'RECEIVED', deliveredAt: now.toISOString(), deliveredById: actorId, locationId: input.locationId, notes: input.deliveryNotes ?? null },
        },
      });
      return tx.purchaseOrder.findUnique({ where: { id: input.id } });
    });
  },

  /**
   * Retired (Project Material Through the Store Roadmap, Phase 2): project
   * material comes through the store, so the store receives each delivery on
   * Receive stock, into stock held for the project. Confirming one here, with
   * no stock, would let the same delivery be booked twice. Confirmations made
   * before stay on the order's Activity.
   *
   * @throws {ApiError} NOT_FOUND; VALIDATION_ERROR otherwise.
   */
  async confirmDelivery(input: Pick<ConfirmDeliveryInput, 'id'>, _actorId: string): Promise<never> {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: input.id }, select: { id: true } });
    if (!po) throw Errors.notFound('PurchaseOrder');
    throw Errors.validation(DELIVERY_IS_RECEIVED);
  },

  async cancel(input: CancelInput, actorId: string) {
    const allowCancellation = await SettingsService.getValue<boolean>('purchaseOrders.allowCancellation');
    if (!allowCancellation) {
      throw Errors.forbidden('Cancelling purchase orders is disabled in system settings');
    }
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: input.id } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      const allowed: PurchaseOrderStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Purchase order in status ${po.status} cannot be cancelled`, { status: po.status });
      }
      const reason = input.reason?.trim();
      if (!reason) throw Errors.validation('A cancellation reason is required');
      const now = new Date();
      const result = await tx.purchaseOrder.updateMany({
        where: { id: input.id, status: { in: allowed } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledById: actorId, cancellationReason: reason },
      });
      if (result.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_CANCEL',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { status: po.status },
          after: { status: 'CANCELLED', cancelledAt: now.toISOString(), cancelledById: actorId, reason },
        },
      });
      return tx.purchaseOrder.findUnique({ where: { id: input.id } });
    });
  },

  // Close an order that will receive nothing more. Closing short — some lines
  // not fully received — needs a reason, so the shortfall is explained.
  async close(input: CloseInput, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: input.id }, include: { lines: true } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      const allowed: PurchaseOrderStatus[] = ['PARTIALLY_RECEIVED', 'RECEIVED'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Purchase order in status ${po.status} cannot be closed`, { status: po.status });
      }
      const reason = input.reason?.trim() || null;
      const short = po.lines.some((l) => toDecimal(l.receivedQty).lt(toDecimal(l.orderedQty)));
      if (short && !reason) {
        throw Errors.validation('A reason is required to close an order that has not been fully received');
      }
      const now = new Date();
      const result = await tx.purchaseOrder.updateMany({
        where: { id: input.id, status: po.status },
        data: { status: 'CLOSED', closedAt: now, closedById: actorId, closeReason: reason },
      });
      if (result.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_CLOSE',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { status: po.status },
          after: { status: 'CLOSED', closedAt: now.toISOString(), closedById: actorId, reason, closedShort: short },
        },
      });
      return tx.purchaseOrder.findUnique({ where: { id: input.id } });
    });
  },

  // Returns the audit log entries relevant to a PO so the UI can render
  // an activity feed. Ordered most-recent first.
  /** The order's Activity, newest first, each entry with the name of who did it. */
  async history(id: string) {
    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'PurchaseOrder', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const actorIds = [...new Set(entries.map((e) => e.actorId).filter((a): a is string => a !== null))];
    const actors = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(actors.map((a) => [a.id, a.name]));
    return entries.map((e) => ({ ...e, actorName: e.actorId ? names.get(e.actorId) ?? null : null }));
  },
};

function isEditable(status: PurchaseOrderStatus, allowEditAfterApproval = true): boolean {
  if (allowEditAfterApproval) {
    return status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'APPROVED';
  }
  return status === 'DRAFT' || status === 'PENDING_APPROVAL';
}

/**
 * The next number in the template's style, AFRI-0001, AFRI-0002, …: one past
 * the highest AFRI number issued, and never below the purchaseOrders.firstNumber
 * setting, which is set past the last number issued from the workbook. Older
 * PO-YYYY-NNNN numbers are left as they are. Callers hold the
 * afrinov:po-number advisory lock, so two orders never get the same number.
 */
async function generatePONumber(tx: Prisma.TransactionClient): Promise<string> {
  const issued = await tx.purchaseOrder.findMany({ where: { number: { startsWith: 'AFRI-' } }, select: { number: true } });
  const highest = issued.reduce((max, { number }) => {
    const n = /^AFRI-(\d+)$/.exec(number);
    return n ? Math.max(max, Number(n[1])) : max;
  }, 0);
  const first = Number(await SettingsService.getValue<number>('purchaseOrders.firstNumber', tx)) || 1;
  return formatPONumber(Math.max(highest + 1, first));
}

export function formatPONumber(n: number): string {
  return `AFRI-${String(n).padStart(4, '0')}`;
}