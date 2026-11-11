// Sales requests for quotation: how Sales prices one piece of equipment for the
// client, and the quotation that goes out once the Director approves the price.
//
// It is the "Costing: Sales Rep." step of the RFQ Process Flow
// (AFRI-03A-06-SOP-001), after Material Quotes (Procurement) and Labour
// (Production). The cost is the production labour (each role's hours at its
// selling rate, labour-rate.service.ts) plus the material: on each of the
// project's Procurement RFQs Sales picks, one supplier's whole quote, the one
// Procurement recommends unless Sales picks another. The job's markup goes on
// the whole; delivery is priced on its own. sales-costing.ts does the sums.
//
// State machine: DRAFT → PENDING_APPROVAL → APPROVED, with CANCELLED from any of
// them. Only a draft is edited. Submitting fixes the figures: each quote's
// amount and the VAT rate are taken then, so the Director approves what Sales
// saw, and a quote corrected afterwards doesn't move an approved price. The
// Director approves it, which gives it its quotation reference and date, or
// sends it back to draft with a reason. Nobody approves one they raised or
// submitted. Every change is written to the audit log (entity type SalesRfq).
import { Prisma, type SalesRfqStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { SettingsService } from '../settings/settings.service.js';
import { cleanText } from '../procurement/supplier-fields.js';
import { loadApprovalSettings } from '../procurement/po-approval.js';
import { asDate, checkDay, dayOf, generateRfqNumber, openProjectName, person, rfqActivity, todayInSouthAfrica } from '../procurement/rfq.service.js';
import { COSTED_RFQ_STATUSES, DEFAULT_CONDITIONS, costingTotals, labourLineTotal, nextQuoteReference, quoteValue } from './sales-costing.js';

export interface SalesLabourInput { labourRateId: string; hours: number }
/** One supplier's whole quote on a Procurement RFQ, counted as material. */
export interface SalesMaterialInput { rfqId: string; supplierId: string }

/** The fields Sales types. Left out: unchanged on an edit, the default on a new one. */
export interface SalesRfqFields {
  equipment?: string | null;
  description?: string | null;
  notes?: string | null;
  penaltiesApply?: boolean;
  markupPercent?: number | null;
  deliveryPrice?: number;
  /** YYYY-MM-DD, or null for none. */
  closingDate?: string | null;
  clientName?: string | null;
  clientAddress?: string | null;
  contactName?: string | null;
  clientReference?: string | null;
  paymentTerms?: string | null;
  validity?: string | null;
  deliveryDuration?: string | null;
  deliveryTerms?: string | null;
  signerPhone?: string | null;
  signerEmail?: string | null;
  /** Replaces the labour lines, in order. */
  labour?: SalesLabourInput[];
  /** Replaces the quotes the material comes from: one per Procurement RFQ. */
  materials?: SalesMaterialInput[];
}

export interface CreateSalesRfqInput extends SalesRfqFields { projectNumber: string }
export interface UpdateSalesRfqInput extends SalesRfqFields { id: string; projectNumber?: string }

const TEXT_FIELDS = [
  'equipment', 'description', 'notes', 'clientName', 'clientAddress', 'contactName', 'clientReference',
  'paymentTerms', 'validity', 'deliveryDuration', 'deliveryTerms', 'signerPhone', 'signerEmail',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

/** What a Sales RFQ reads of a Procurement RFQ: its quotes' totals, never a buyer's working. */
const QUOTE_RFQ = {
  id: true, number: true, status: true, projectNumber: true, description: true, recommendedSupplierId: true, recommendedAt: true,
  recommendedSupplier: { select: { id: true, name: true } },
  lines: { select: { id: true, quantity: true } },
  suppliers: {
    select: {
      supplierId: true, quotedAt: true, declined: true, currency: true,
      supplier: { select: { name: true, currency: true } },
      prices: { select: { rfqLineId: true, unitPrice: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.RfqSelect;

type QuoteRfq = Prisma.RfqGetPayload<{ select: typeof QUOTE_RFQ }>;

const DETAIL = {
  project: { select: { projectNumber: true, name: true, client: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  submittedBy: { select: { id: true, name: true, email: true } },
  approvedBy: person,
  returnedBy: person,
  cancelledBy: person,
  labour: { orderBy: { lineNo: 'asc' } },
  materials: { include: { rfq: { select: QUOTE_RFQ }, supplier: { select: { name: true } } }, orderBy: { addedAt: 'asc' } },
} satisfies Prisma.SalesRfqInclude;

type Detail = Prisma.SalesRfqGetPayload<{ include: typeof DETAIL }>;

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const notCostable = (projectNumber: string) => `That isn't a request for quotation sent for ${projectNumber}`;
const costable = (status: string) => (COSTED_RFQ_STATUSES as readonly string[]).includes(status);

function checkedMarkup(markup: number | null): number | null {
  if (markup === null) return null;
  if (!Number.isFinite(markup) || markup < 0 || markup > 1000) throw Errors.validation('The markup is a percentage from 0 to 1000');
  if (Math.abs(markup * 100 - Math.round(markup * 100)) > 1e-6) throw Errors.validation('The markup has at most 2 decimal places');
  return markup;
}

function checkedDelivery(price: number): number {
  if (!Number.isFinite(price) || price < 0) throw Errors.validation('The delivery price can be R0 but not less');
  if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) throw Errors.validation('The delivery price is in rand and cents: at most 2 decimal places');
  return price;
}

/**
 * The labour lines as they are kept: each role on the rates list at its rate
 * today. A role made inactive since it was put on this draft keeps the name and
 * rate it had; one that is inactive can't be added.
 */
async function checkedLabour(lines: SalesLabourInput[], had: Detail['labour'], tx: Prisma.TransactionClient) {
  const ids = [...new Set(lines.map((l) => l.labourRateId))];
  const rates = ids.length ? await tx.labourRate.findMany({ where: { id: { in: ids } } }) : [];
  return lines.map((line, i) => {
    const n = i + 1;
    if (!Number.isFinite(line.hours) || line.hours <= 0 || line.hours > 100000) throw Errors.validation(`Labour line ${n} needs its hours, more than 0`);
    if (Math.abs(line.hours * 100 - Math.round(line.hours * 100)) > 1e-6) throw Errors.validation(`Labour line ${n}: hours have at most 2 decimal places`);
    const rate = rates.find((r) => r.id === line.labourRateId);
    if (!rate) throw Errors.validation(`Labour line ${n}: that role isn't on the rates list`);
    const kept = had.find((h) => h.labourRateId === rate.id);
    if (!rate.active && !kept) throw Errors.validation(`Labour line ${n}: ${rate.role} is no longer used. Choose another role, or ask the Workshop Manager to make it active again.`);
    return {
      lineNo: n,
      labourRateId: rate.id,
      role: rate.active ? rate.role : kept!.role,
      hours: line.hours,
      hourlyRate: rate.active ? rate.hourlyRate : kept!.hourlyRate,
    };
  });
}

/** One supplier's quote on a Procurement RFQ, valued today; null when they haven't quoted or declined. */
function valueOf(rfq: QuoteRfq, supplierId: string, rates: Record<string, number>) {
  return quoteValue(rfq, rfq.suppliers.find((q) => q.supplierId === supplierId), rates);
}

/**
 * The quotes the material comes from, each valued in rand today: one supplier's
 * recorded quote on each of the project's sent Procurement RFQs. The RFQs are
 * held until the Sales RFQ is written, so none is cancelled in between.
 */
async function checkedMaterials(materials: SalesMaterialInput[], projectNumber: string, tx: Prisma.TransactionClient) {
  if (materials.length === 0) return [];
  const ids = materials.map((m) => m.rfqId);
  if (new Set(ids).size !== ids.length) throw Errors.validation('Pick one quote on each request for quotation');
  await tx.$executeRaw`SELECT 1 FROM rfqs WHERE id IN (${Prisma.join(ids)}) FOR SHARE`;
  const rfqs = await tx.rfq.findMany({ where: { id: { in: ids } }, select: QUOTE_RFQ });
  const { rates } = await loadApprovalSettings();
  return materials.map((m) => {
    const rfq = rfqs.find((r) => r.id === m.rfqId);
    // The same answer for all of these, so nobody can probe for RFQs they don't see.
    if (!rfq || rfq.projectNumber !== projectNumber || !costable(rfq.status)) throw Errors.validation(notCostable(projectNumber));
    const quote = valueOf(rfq, m.supplierId, rates);
    const name = rfq.suppliers.find((q) => q.supplierId === m.supplierId)?.supplier.name ?? 'That supplier';
    if (!quote) throw Errors.validation(`${name} hasn't quoted on ${rfq.number}`);
    if (quote.amount === null) {
      throw Errors.validation(`${name}'s quote on ${rfq.number} is in ${quote.currency}, and there is no exchange rate for ${quote.currency} yet. An admin can add one under Settings → Purchase orders.`);
    }
    return { rfqId: rfq.id, supplierId: m.supplierId, quoteTotal: quote.total, currency: quote.currency, amount: quote.amount, number: rfq.number, supplier: name };
  });
}

const labourForLog = (lines: Array<{ role: string; hours: Prisma.Decimal | number; hourlyRate: Prisma.Decimal | number }>) =>
  lines.map((l) => ({ role: l.role, hours: D(l.hours).toFixed(2), hourlyRate: D(l.hourlyRate).toFixed(2) }));

const materialsForLog = (materials: Array<{ number: string; supplier: string; amount: Prisma.Decimal | string }>) =>
  materials.map((m) => ({ rfq: m.number, supplier: m.supplier, amount: D(m.amount).toFixed(2) }));

const keptMaterialsForLog = (rfq: Detail) =>
  materialsForLog(rfq.materials.map((m) => ({ number: m.rfq.number, supplier: m.supplier.name, amount: m.amount })));

/** The VAT rate a draft is shown at, and fixed at when it is submitted. */
async function currentVatRate(): Promise<number> {
  return Number(await SettingsService.getValue<number>('purchaseOrders.vatRate')) || 0;
}

/**
 * The Sales RFQ with its money. A draft's quotes are valued as they stand today,
 * and any that can no longer be counted is flagged; once submitted, each keeps
 * the amount it had then. Each says whether it is the one Procurement recommends.
 */
function withCosting(rfq: Detail, vatSetting: number, rates: Record<string, number>) {
  const draft = rfq.status === 'DRAFT';
  const materials = rfq.materials.map((m) => {
    const live = valueOf(m.rfq, m.supplierId, rates);
    const usable = costable(m.rfq.status) && !!live && live.amount !== null;
    const now = draft && live && live.amount !== null ? live : null;
    return {
      rfqId: m.rfqId, rfqNumber: m.rfq.number, rfqStatus: m.rfq.status, description: m.rfq.description,
      supplierId: m.supplierId, supplier: m.supplier.name,
      currency: now?.currency ?? m.currency,
      quoteTotal: now?.total ?? m.quoteTotal.toFixed(2),
      amount: now?.amount ?? m.amount.toFixed(2),
      unpricedLines: live?.unpricedLines ?? 0,
      recommendedSupplier: m.rfq.recommendedSupplier,
      /** Procurement recommends this quote, or recommends none. */
      recommended: m.rfq.recommendedSupplierId === null || m.rfq.recommendedSupplierId === m.supplierId,
      /** On a draft: the RFQ was cancelled, the quote withdrawn, or it can't be valued in rand, so it can't be submitted. */
      unusable: draft && !usable,
    };
  });
  const vatRate = rfq.vatRate ?? vatSetting;
  return {
    ...rfq,
    labour: rfq.labour.map((l) => ({ ...l, total: labourLineTotal(l) })),
    materials,
    totals: costingTotals({
      labour: rfq.labour, materials: materials.map((m) => m.amount), markupPercent: rfq.markupPercent,
      deliveryPrice: rfq.deliveryPrice, vatRate,
    }),
  };
}

/** The draft or submission held for the change, refused if it isn't in a state the change allows. */
async function held(id: string, tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT id FROM sales_rfqs WHERE id = ${id} FOR UPDATE`;
  const rfq = await tx.salesRfq.findUnique({ where: { id }, include: DETAIL });
  if (!rfq) throw Errors.notFound('Sales RFQ');
  return rfq;
}

const STATUS_WORDS: Record<SalesRfqStatus, string> = {
  DRAFT: 'a draft', PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', CANCELLED: 'cancelled',
};

export const SalesRfqService = {
  async list(filter: { status?: SalesRfqStatus; projectNumber?: string } = {}) {
    const [vatSetting, { rates }] = await Promise.all([currentVatRate(), loadApprovalSettings()]);
    const rfqs = await prisma.salesRfq.findMany({ where: filter, include: DETAIL, orderBy: { createdAt: 'desc' } });
    return rfqs.map((r) => withCosting(r, vatSetting, rates));
  },

  async getById(id: string) {
    const rfq = await prisma.salesRfq.findUnique({ where: { id }, include: DETAIL });
    if (!rfq) throw Errors.notFound('Sales RFQ');
    const [vatSetting, { rates }] = await Promise.all([currentVatRate(), loadApprovalSettings()]);
    return withCosting(rfq, vatSetting, rates);
  },

  /**
   * The project's Procurement RFQs a Sales RFQ can take its material from, sent
   * or since awarded, each with every supplier who quoted: their total excl. VAT
   * in their currency and in rand, which one Procurement recommends, and any
   * other Sales RFQ already counting the RFQ. Totals only, never line prices.
   */
  async quoteOptions(projectNumber: string) {
    const [rfqs, { rates }] = await Promise.all([
      prisma.rfq.findMany({
        where: { projectNumber, status: { in: [...COSTED_RFQ_STATUSES] } },
        select: { ...QUOTE_RFQ, issuedAt: true, salesMaterials: { where: { salesRfq: { status: { not: 'CANCELLED' } } }, select: { salesRfq: { select: { id: true, number: true } } } } },
        orderBy: { number: 'asc' },
      }),
      loadApprovalSettings(),
    ]);
    return rfqs.map((r) => ({
      id: r.id, number: r.number, status: r.status, description: r.description, issuedAt: r.issuedAt,
      recommendedSupplierId: r.recommendedSupplierId,
      quotes: r.suppliers.flatMap((q) => {
        const value = quoteValue(r, q, rates);
        return value ? [{ supplierId: q.supplierId, supplier: q.supplier.name, ...value, recommended: r.recommendedSupplierId === q.supplierId }] : [];
      }),
      salesRfqs: r.salesMaterials.map((m) => m.salesRfq),
    }));
  },

  /**
   * Creates a numbered draft. The client is the project's and the conditions
   * the quotation's usual ones unless given; the signer's email is the
   * creator's.
   *
   * @throws {ApiError} VALIDATION_ERROR for a missing or closed project, a role
   * not on the list, hours or money out of range, or a quote that isn't one
   * recorded on the project's sent Procurement RFQs, or can't be valued in rand.
   */
  async create(input: CreateSalesRfqInput, actorId: string) {
    const projectNumber = cleanText(input.projectNumber);
    if (!projectNumber) throw Errors.validation('A Sales RFQ is for one project: choose its project.');
    if (input.closingDate) checkDay(input.closingDate);
    const markupPercent = checkedMarkup(input.markupPercent ?? null);
    const deliveryPrice = checkedDelivery(input.deliveryPrice ?? 0);
    const id = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:rfq-number'))`;
      const projectName = await openProjectName(projectNumber, tx);
      const client = cleanText((await tx.project.findUnique({ where: { projectNumber }, select: { client: true } }))?.client);
      const creator = await tx.user.findUnique({ where: { id: actorId }, select: { email: true } });
      const labour = await checkedLabour(input.labour ?? [], [], tx);
      const materials = await checkedMaterials(input.materials ?? [], projectNumber, tx);
      const number = await generateRfqNumber(tx, projectNumber);
      const text = (k: TextField, fallback: string | null = null) => (input[k] === undefined ? fallback : cleanText(input[k]));
      const clientName = text('clientName', client);
      const rfq = await tx.salesRfq.create({
        data: {
          number,
          status: 'DRAFT',
          projectNumber,
          equipment: text('equipment'),
          description: text('description', projectName),
          notes: text('notes'),
          penaltiesApply: input.penaltiesApply ?? false,
          markupPercent,
          deliveryPrice,
          closingDate: input.closingDate ? asDate(input.closingDate) : null,
          clientName,
          clientAddress: text('clientAddress'),
          contactName: text('contactName'),
          clientReference: text('clientReference'),
          paymentTerms: text('paymentTerms', DEFAULT_CONDITIONS.paymentTerms),
          validity: text('validity', DEFAULT_CONDITIONS.validity),
          deliveryDuration: text('deliveryDuration', DEFAULT_CONDITIONS.deliveryDuration),
          deliveryTerms: text('deliveryTerms', clientName ? `DAP, ${clientName}` : null),
          signerPhone: text('signerPhone'),
          signerEmail: text('signerEmail', creator?.email ?? null),
          createdById: actorId,
          labour: { create: labour },
          materials: { create: materials.map((m, i) => ({ rfqId: m.rfqId, supplierId: m.supplierId, quoteTotal: m.quoteTotal, currency: m.currency, amount: m.amount, addedAt: new Date(Date.now() + i) })) },
        },
      });
      // Everything it was raised with, so the Activity starts from the whole draft.
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'CREATE', entityType: 'SalesRfq', entityId: rfq.id,
          after: {
            number, status: rfq.status, projectNumber, equipment: rfq.equipment, markupPercent: rfq.markupPercent?.toString() ?? null,
            deliveryPrice: rfq.deliveryPrice.toFixed(2), clientName: rfq.clientName, labour: labourForLog(labour), materials: materialsForLog(materials),
          } as Prisma.InputJsonValue,
        },
      });
      return rfq.id;
    });
    return SalesRfqService.getById(id);
  },

  /**
   * Changes a draft. Moving it to another project gives it that project's next
   * number and takes its quotes off, as they were the old project's. Saving the
   * labour prices it at today's rates; saving the quotes values them today.
   * Only what changed is logged.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is a draft; VALIDATION_ERROR as for create.
   */
  async update(input: UpdateSalesRfqInput, actorId: string) {
    if (input.closingDate) checkDay(input.closingDate);
    await prisma.$transaction(async (tx) => {
      // The number lock first, then the row, as create takes them.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:rfq-number'))`;
      const rfq = await held(input.id, tx);
      if (rfq.status !== 'DRAFT') {
        throw Errors.invalidState(`${rfq.number} is ${STATUS_WORDS[rfq.status]}, so it can't be edited${rfq.status === 'PENDING_APPROVAL' ? '. The Director can send it back to you.' : ''}`, { status: rfq.status });
      }
      const data: Prisma.SalesRfqUncheckedUpdateInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const change = (key: string, was: unknown, next: unknown, stored: unknown = next) => {
        const same = (was ?? null) === (next ?? null) || (was != null && next != null && String(was) === String(next));
        if (same) return;
        (data as Record<string, unknown>)[key] = stored;
        before[key] = was;
        after[key] = next;
      };

      let projectNumber = rfq.projectNumber;
      if (input.projectNumber !== undefined) {
        const next = cleanText(input.projectNumber);
        if (!next) throw Errors.validation('A Sales RFQ is for one project: choose its project.');
        if (next !== rfq.projectNumber) {
          const projectName = await openProjectName(next, tx);
          change('projectNumber', rfq.projectNumber, next);
          change('number', rfq.number, await generateRfqNumber(tx, next));
          // A description that was the old project's name follows the project; one Sales wrote stays.
          if (input.description === undefined && rfq.description && rfq.description === cleanText(rfq.project.name)) change('description', rfq.description, projectName);
          projectNumber = next;
        }
      }
      for (const k of TEXT_FIELDS) if (input[k] !== undefined) change(k, rfq[k], cleanText(input[k]));
      if (input.penaltiesApply !== undefined) change('penaltiesApply', rfq.penaltiesApply, input.penaltiesApply);
      if (input.markupPercent !== undefined) {
        const next = checkedMarkup(input.markupPercent);
        change('markupPercent', rfq.markupPercent?.toString() ?? null, next === null ? null : D(next).toString(), next);
      }
      if (input.deliveryPrice !== undefined) change('deliveryPrice', rfq.deliveryPrice.toFixed(2), D(checkedDelivery(input.deliveryPrice)).toFixed(2), input.deliveryPrice);
      if (input.closingDate !== undefined) change('closingDate', dayOf(rfq.closingDate), input.closingDate, input.closingDate ? asDate(input.closingDate) : null);

      if (input.labour !== undefined) {
        const labour = await checkedLabour(input.labour, rfq.labour, tx);
        if (JSON.stringify(labourForLog(labour)) !== JSON.stringify(labourForLog(rfq.labour))) {
          await tx.salesRfqLabourLine.deleteMany({ where: { rfqId: rfq.id } });
          await tx.salesRfqLabourLine.createMany({ data: labour.map((l) => ({ ...l, rfqId: rfq.id })) });
          before.labour = labourForLog(rfq.labour);
          after.labour = labourForLog(labour);
        }
      }

      // Another project's quotes can't stay on it.
      const wanted = input.materials ?? (projectNumber === rfq.projectNumber ? rfq.materials.map((m) => ({ rfqId: m.rfqId, supplierId: m.supplierId })) : []);
      if (input.materials !== undefined || projectNumber !== rfq.projectNumber) {
        const materials = await checkedMaterials(wanted, projectNumber, tx);
        const had = keptMaterialsForLog(rfq);
        await tx.salesRfqMaterial.deleteMany({ where: { salesRfqId: rfq.id } });
        await tx.salesRfqMaterial.createMany({
          data: materials.map((m, i) => ({ salesRfqId: rfq.id, rfqId: m.rfqId, supplierId: m.supplierId, quoteTotal: m.quoteTotal, currency: m.currency, amount: m.amount, addedAt: new Date(Date.now() + i) })),
        });
        if (JSON.stringify(had) !== JSON.stringify(materialsForLog(materials))) {
          before.materials = had;
          after.materials = materialsForLog(materials);
        }
      }

      if (Object.keys(after).length === 0) return;
      await tx.salesRfq.update({ where: { id: rfq.id }, data: { ...data, updatedAt: new Date() } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'UPDATE', entityType: 'SalesRfq', entityId: rfq.id, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue },
      });
    });
    return SalesRfqService.getById(input.id);
  },

  /**
   * Sends a draft to the Director. It needs the equipment, the client, a markup
   * and something to cost; each quote is valued again and that amount kept, and
   * the VAT rate of the day is fixed on it.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is a draft;
   * VALIDATION_ERROR for what it still needs, or a quote that can no longer be counted.
   */
  async submit(id: string, actorId: string) {
    await prisma.$transaction(async (tx) => {
      const rfq = await held(id, tx);
      if (rfq.status !== 'DRAFT') throw Errors.invalidState(`${rfq.number} is ${STATUS_WORDS[rfq.status]}, so it can't be submitted`, { status: rfq.status });
      const missing = [
        !rfq.equipment && 'the equipment being quoted',
        !rfq.clientName && "the client's name",
        rfq.markupPercent === null && 'the markup',
        rfq.labour.length === 0 && rfq.materials.length === 0 && 'labour or a quote to cost',
      ].filter((m): m is string => !!m);
      if (missing.length) throw Errors.validation(`Before submitting ${rfq.number}, add ${missing.join(', ')}.`);
      await openProjectName(rfq.projectNumber, tx);
      const materials = await checkedMaterials(rfq.materials.map((m) => ({ rfqId: m.rfqId, supplierId: m.supplierId })), rfq.projectNumber, tx);
      for (const m of materials) {
        await tx.salesRfqMaterial.update({
          where: { salesRfqId_rfqId: { salesRfqId: id, rfqId: m.rfqId } },
          data: { quoteTotal: m.quoteTotal, currency: m.currency, amount: m.amount },
        });
      }
      const vatRate = await currentVatRate();
      const now = new Date();
      await tx.salesRfq.update({
        where: { id },
        data: { status: 'PENDING_APPROVAL', vatRate, submittedAt: now, submittedById: actorId, returnedAt: null, returnedById: null, returnReason: null },
      });
      const totals = costingTotals({ labour: rfq.labour, materials: materials.map((m) => m.amount), markupPercent: rfq.markupPercent, deliveryPrice: rfq.deliveryPrice, vatRate });
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'SALES_RFQ_SUBMIT', entityType: 'SalesRfq', entityId: id,
          before: { status: rfq.status },
          after: { status: 'PENDING_APPROVAL', vatRate, materials: materialsForLog(materials), totalExVat: totals.totalExVat, markup: totals.markup } as Prisma.InputJsonValue,
        },
      });
    });
    return SalesRfqService.getById(id);
  },

  /**
   * The Director approves the price: it is issued today with the project's next
   * quotation reference.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is waiting for
   * approval; FORBIDDEN for one the approver raised or submitted.
   */
  async approve(id: string, actorId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:sales-quote-reference'))`;
      const rfq = await held(id, tx);
      if (rfq.status !== 'PENDING_APPROVAL') throw Errors.invalidState(`${rfq.number} is ${STATUS_WORDS[rfq.status]}, so there is nothing to approve`, { status: rfq.status });
      if (rfq.createdById === actorId || rfq.submittedById === actorId) throw Errors.forbidden(`You raised or submitted ${rfq.number}, so someone else approves it.`);
      const given = await tx.salesRfq.findMany({ where: { projectNumber: rfq.projectNumber, quoteReference: { not: null } }, select: { quoteReference: true } });
      const quoteReference = nextQuoteReference(rfq.projectNumber, given.map((g) => g.quoteReference!));
      const issued = todayInSouthAfrica();
      const now = new Date();
      await tx.salesRfq.update({ where: { id }, data: { status: 'APPROVED', quoteReference, issuedAt: asDate(issued), approvedAt: now, approvedById: actorId } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'SALES_RFQ_APPROVE', entityType: 'SalesRfq', entityId: id, before: { status: rfq.status }, after: { status: 'APPROVED', quoteReference, issuedAt: issued } },
      });
    });
    return SalesRfqService.getById(id);
  },

  /** The Director sends it back to Sales as a draft, saying why. @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is waiting for approval. */
  async sendBack(id: string, reason: string, actorId: string) {
    const why = cleanText(reason);
    if (!why) throw Errors.validation('Say what Sales should change');
    await prisma.$transaction(async (tx) => {
      const rfq = await held(id, tx);
      if (rfq.status !== 'PENDING_APPROVAL') throw Errors.invalidState(`${rfq.number} is ${STATUS_WORDS[rfq.status]}, so it can't be sent back`, { status: rfq.status });
      await tx.salesRfq.update({ where: { id }, data: { status: 'DRAFT', vatRate: null, returnedAt: new Date(), returnedById: actorId, returnReason: why } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'SALES_RFQ_RETURN', entityType: 'SalesRfq', entityId: id, before: { status: rfq.status }, after: { status: 'DRAFT', reason: why } },
      });
    });
    return SalesRfqService.getById(id);
  },

  /** Cancels it at any point, with the reason kept on it. @throws {ApiError} NOT_FOUND; INVALID_STATE once cancelled. */
  async cancel(id: string, reason: string, actorId: string) {
    const why = cleanText(reason);
    if (!why) throw Errors.validation('Give a reason for cancelling');
    await prisma.$transaction(async (tx) => {
      const rfq = await held(id, tx);
      if (rfq.status === 'CANCELLED') throw Errors.invalidState(`Sales RFQ ${rfq.number} is already cancelled`, { status: rfq.status });
      await tx.salesRfq.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actorId, cancellationReason: why } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'RFQ_CANCEL', entityType: 'SalesRfq', entityId: id, before: { status: rfq.status }, after: { status: 'CANCELLED', reason: why } },
      });
    });
    return SalesRfqService.getById(id);
  },

  /** Its Activity, newest first. */
  async history(id: string) {
    if (!(await prisma.salesRfq.findUnique({ where: { id }, select: { id: true } }))) throw Errors.notFound('Sales RFQ');
    return rfqActivity('SalesRfq', id);
  },
};
