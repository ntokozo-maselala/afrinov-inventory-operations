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
import { recomputeBalance } from '../../shared/inventory/balances.js';
import { cleanPaymentTerms, cleanText, cleanVendorCode, cleanWebsite } from './supplier-fields.js';
import { defaultVatRate, orderTotals, withTotals } from './po-pricing.js';
import { approvalBlock, approversFor, listApprovers, whoToAsk } from './po-approval.js';
import { checkProjectMaterial, refuseUnassigned } from '../inventory/material-section.js';

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
  /** unitPrice excludes VAT, in the supplier's currency. deliveryDate defaults to the order's expected date. */
  lines: Array<{ materialId: string; orderedQty: number; unitPrice?: number; deliveryDate?: string }>;
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
async function assertProjectOpen(projectNumber: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
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

export const PurchaseOrderService = {
  async list(filter: { status?: PurchaseOrderStatus; projectNumber?: string } = {}) {
    const orders = await prisma.purchaseOrder.findMany({
      where: filter,
      include: { supplier: true, project: { select: { projectNumber: true, name: true } }, lines: { include: { material: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(withTotals);
  },

  /**
   * The orders pending approval this user may approve now, by the same rule as
   * Approve: every line priced and the total within their limit. Oldest first,
   * as they have waited longest. Empty for anyone who may not approve.
   */
  async awaitingApproval(actorId: string) {
    const me = (await listApprovers()).find((a) => a.id === actorId);
    if (!me) return [];
    const orders = await prisma.purchaseOrder.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: { supplier: true, project: { select: { projectNumber: true, name: true } }, lines: { include: { material: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return orders.filter((po) => !approvalBlock(po, me.approvalLimit)).map(withTotals);
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
        lines: { include: { material: true } },
        goodsReceipts: { include: { lines: true } },
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
   */
  async create(input: CreatePOInput, actorId: string) {
    if (input.lines.length === 0) throw Errors.validation('Purchase order must have at least one line');
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw Errors.notFound('Supplier');
    if (!supplier.active) throw Errors.validation(`${supplier.name} is inactive. Reactivate the supplier to order from them.`);
    const currency = supplier.currency ?? 'ZAR';
    const vatRate = input.vatRate ?? defaultVatRate(currency, await SettingsService.getValue<number>('purchaseOrders.vatRate'));
    if (input.projectNumber) await assertProjectOpen(input.projectNumber);
    // Project material with no project yet is not ordered until it has one,
    // and is ordered only for its own project.
    const lineMaterials = await lineMaterialsOf(input.lines.map((l) => l.materialId), prisma);
    for (const m of lineMaterials) refuseUnassigned(m, 'ordered');
    checkProjectMaterial(cleanText(input.projectNumber), lineMaterials, 'ordered');

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
      ]);
      for (const k of ['deliveryTo', 'deliveryAddress', 'deliveryCountry', 'deliveryContactName', 'deliveryContactPhone'] as const) {
        if (input[k] === undefined) {
          const v = defaults[`purchaseOrders.${k}`];
          details[k] = k === 'deliveryAddress' ? cleanLines(v as string) : cleanText(v as string);
        }
      }
    }
    if (input.afrinovContact === undefined) {
      const actor = await prisma.user.findUnique({ where: { id: actorId } });
      details.afrinovContact = actor?.name ?? null;
    }

    return prisma.$transaction(async (tx) => {
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
          after: { number, status: po.status } as Prisma.InputJsonValue,
        },
      });
      return po;
    });
  },

  async update(input: UpdatePOInput, actorId: string) {
    const allowEditAfterApproval = await SettingsService.getValue<boolean>('purchaseOrders.allowEditAfterApproval');
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: input.id }, include: { lines: true } });
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
        if (nextProject) await assertProjectOpen(nextProject, tx);
        checkProjectMaterial(nextProject, await lineMaterialsOf(po.lines.map((l) => l.materialId), tx), 'ordered');
      }
      Object.assign(data, detailsData(input));
      const priceChanges: Array<{ lineId: string; before: string | null; after: string | null }> = [];
      for (const p of input.linePrices ?? []) {
        const line = po.lines.find((l) => l.id === p.lineId);
        if (!line) throw Errors.validation(`Line ${p.lineId} is not on purchase order ${po.number}`);
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { unitPrice: p.unitPrice } });
        priceChanges.push({ lineId: line.id, before: line.unitPrice?.toString() ?? null, after: p.unitPrice === null ? null : String(p.unitPrice) });
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
      priceChanges.splice(0, priceChanges.length, ...realPrices);
      dateChanges.splice(0, dateChanges.length, ...realDates);
      const anyChange = Object.keys(data).length > 0 || priceChanges.length > 0 || dateChanges.length > 0;
      // Changing an approved order makes a new revision, as the template's
      // "Rev 01", so the supplier can tell the copies apart.
      if (po.status === 'APPROVED' && anyChange) data.revision = po.revision + 1;
      // An approved order whose new total is past its approver's limit (or has
      // lost a price) goes back for approval; the edit can't raise the amount
      // someone signed off.
      if (po.status === 'APPROVED' && po.approvedById && (priceChanges.length > 0 || 'vatRate' in data)) {
        const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        const approver = await tx.user.findUnique({ where: { id: po.approvedById }, select: { approvalLimit: true } });
        const vat = input.vatRate ?? po.vatRate;
        if (approvalBlock({ currency: po.currency, vatRate: vat, lines }, approver?.approvalLimit ?? null)) {
          Object.assign(data, { status: 'PENDING_APPROVAL', approvedAt: null, approvedById: null });
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
            ...(dateChanges.length ? { deliveryDates: dateChanges.map((c) => ({ lineId: c.lineId, deliveryDate: c.before })) } : {}),
          } as Prisma.InputJsonValue,
          after: {
            ...pick(after as unknown as Record<string, unknown>),
            ...(priceChanges.length ? { unitPrices: priceChanges.map((c) => ({ lineId: c.lineId, unitPrice: c.after })) } : {}),
            ...(dateChanges.length ? { deliveryDates: dateChanges.map((c) => ({ lineId: c.lineId, deliveryDate: c.after })) } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      return after;
    });
  },

  async submit(id: string, actorId: string) {
    const requireApproval = await SettingsService.getValue<boolean>('purchaseOrders.requireApprovalBeforeProcessing');
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      if (po.lines.length === 0) throw Errors.validation('Cannot submit an empty purchase order');
      const allowed: PurchaseOrderStatus[] = ['DRAFT'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Cannot submit a PO in status ${po.status}`, { status: po.status });
      }
      // A draft is checked again as it goes out: its project material may have
      // had no project when it was raised, and its project may have closed since.
      const lineMaterials = await lineMaterialsOf(po.lines.map((l) => l.materialId), tx);
      for (const m of lineMaterials) refuseUnassigned(m, 'ordered');
      checkProjectMaterial(po.projectNumber, lineMaterials, 'ordered');
      if (po.projectNumber) await assertProjectOpen(po.projectNumber, tx);
      const now = new Date();
      if (requireApproval) {
        const target: PurchaseOrderStatus = 'PENDING_APPROVAL';
        const result = await tx.purchaseOrder.updateMany({
          where: { id, status: { in: allowed } },
          data: { status: target },
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
        // Approval not required: submission auto-approves.
        const result = await tx.purchaseOrder.updateMany({
          where: { id, status: { in: allowed } },
          data: { status: 'APPROVED', approvedAt: now, approvedById: actorId },
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

  /** Who may approve this order, and whether the asking user can. */
  async approval(id: string, actorId: string) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!po) throw Errors.notFound('PurchaseOrder');
    const approvers = await listApprovers();
    const me = approvers.find((a) => a.id === actorId);
    const block = me ? approvalBlock(po, me.approvalLimit) : null;
    return {
      ...orderTotals(po.lines, po.vatRate ?? 0),
      currency: po.currency,
      canApprove: !!me && po.status === 'PENDING_APPROVAL' && !block,
      reason: me ? block?.message ?? null : null,
      myLimit: me?.approvalLimit ?? null,
      approvers: approversFor(po, approvers),
    };
  },

  async approve(id: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      const allowed: PurchaseOrderStatus[] = ['PENDING_APPROVAL'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Cannot approve a PO in status ${po.status}`, { status: po.status });
      }
      // The approver's limit must cover the order total (rand, including VAT).
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { approvalLimit: true } });
      const block = approvalBlock(po, actor?.approvalLimit ?? null);
      if (block?.code === 'UNPRICED') throw Errors.validation(block.message);
      if (block) {
        const names = approversFor(po, await listApprovers()).map((a) => a.name);
        throw Errors.forbidden(`${block.message} ${whoToAsk(names)}`);
      }
      const now = new Date();
      const result = await tx.purchaseOrder.updateMany({
        where: { id, status: { in: allowed } },
        data: { status: 'APPROVED', approvedAt: now, approvedById: actorId },
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
          after: { status: 'APPROVED', approvedAt: now.toISOString(), approvedById: actorId },
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
            },
          });
          await recomputeBalance(line.materialId, input.locationId, tx);
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