// Sales requests for quotation: how Sales prices a job for the client, and the
// quotation that goes out once the Director approves the price.
//
// It is the "Costing: Sales Rep." step of the RFQ Process Flow
// (AFRI-03A-06-SOP-001), after Material Quotes (Procurement) and Labour
// (Production). The quotation has one or more equipment lines, each priced the
// same way, for one unit: the production labour (each role's hours at its
// selling rate, labour-rate.service.ts), the material (on each of the project's
// Procurement RFQs Sales picks, one supplier's whole quote, the one Procurement
// recommends unless Sales picks another; each RFQ counted on one line only), and
// other costs Sales types (accommodation, LOA). The job's markup goes on each
// line, and the line's price is times its quantity; delivery is priced on its
// own. sales-costing.ts does the sums.
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
import { COSTED_RFQ_STATUSES, DEFAULT_CONDITIONS, costingTotals, labourLineTotal, nextQuoteReference, otherCostTotal, quoteValue } from './sales-costing.js';

export interface SalesLabourInput { labourRateId: string; hours: number }
/** One supplier's whole quote on a Procurement RFQ, counted as material. */
export interface SalesMaterialInput { rfqId: string; supplierId: string }
/** A cost that is neither labour nor a quote, for one unit of the line. */
export interface SalesOtherCostInput { description: string; quantity: number; unitCost: number }

/** One line of the quotation, with what it costs for one unit. */
export interface SalesEquipmentLineInput {
  equipment?: string | null;
  /** Printed under it, one per line. */
  details?: string | null;
  /** 1 when left out. 0 prints it with its unit price and "R -", charging nothing. */
  quantity?: number;
  labour?: SalesLabourInput[];
  /** One per Procurement RFQ; an RFQ is counted on one line only. */
  materials?: SalesMaterialInput[];
  otherCosts?: SalesOtherCostInput[];
}

/** The fields Sales types. Left out: unchanged on an edit, the default on a new one. */
export interface SalesRfqFields {
  description?: string | null;
  notes?: string | null;
  /** Printed on the quotation under the company's Notes, one per line. */
  quoteNotes?: string | null;
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
  /** Replaces the equipment lines, in order, with what each costs. A new one starts with one empty line. */
  equipmentLines?: SalesEquipmentLineInput[];
}

export interface CreateSalesRfqInput extends SalesRfqFields { projectNumber: string }
export interface UpdateSalesRfqInput extends SalesRfqFields { id: string; projectNumber?: string }

const TEXT_FIELDS = [
  'description', 'notes', 'quoteNotes', 'clientName', 'clientAddress', 'contactName', 'clientReference',
  'paymentTerms', 'validity', 'deliveryDuration', 'deliveryTerms', 'signerPhone', 'signerEmail',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

/** Each line trimmed and its spaces squashed, blank lines dropped; null when nothing is left. */
export function cleanLines(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const lines = s.split(/\r?\n/).map((l) => cleanText(l)).filter((l): l is string => !!l);
  return lines.length ? lines.join('\n') : null;
}

/** The address, remarks and quotation notes keep their lines, as typed; the rest is one line. */
const KEEPS_LINES: ReadonlySet<TextField> = new Set(['clientAddress', 'notes', 'quoteNotes']);
const cleanField = (k: TextField, v: string | null | undefined) => (KEEPS_LINES.has(k) ? cleanLines(v) : cleanText(v));

/** At most this many equipment lines on one quotation. */
export const MAX_EQUIPMENT_LINES = 20;

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
  equipmentLines: {
    orderBy: { lineNo: 'asc' },
    include: {
      labour: { orderBy: { lineNo: 'asc' } },
      materials: { include: { rfq: { select: QUOTE_RFQ }, supplier: { select: { name: true } } }, orderBy: { addedAt: 'asc' } },
      otherCosts: { orderBy: { lineNo: 'asc' } },
    },
  },
} satisfies Prisma.SalesRfqInclude;

type Detail = Prisma.SalesRfqGetPayload<{ include: typeof DETAIL }>;
type KeptLabour = Detail['equipmentLines'][number]['labour'][number];

const allLabour = (rfq: Detail) => rfq.equipmentLines.flatMap((l) => l.labour);
const allMaterials = (rfq: Detail) => rfq.equipmentLines.flatMap((l) => l.materials);

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const notCostable = (projectNumber: string) => `That isn't a request for quotation sent for ${projectNumber}`;
const costable = (status: string) => (COSTED_RFQ_STATUSES as readonly string[]).includes(status);
const twoPlaces = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) <= 1e-6;

function checkedMarkup(markup: number | null): number | null {
  if (markup === null) return null;
  if (!Number.isFinite(markup) || markup < 0 || markup > 1000) throw Errors.validation('The markup is a percentage from 0 to 1000');
  if (!twoPlaces(markup)) throw Errors.validation('The markup has at most 2 decimal places');
  return markup;
}

function checkedDelivery(price: number): number {
  if (!Number.isFinite(price) || price < 0) throw Errors.validation('The delivery price can be R0 but not less');
  if (!twoPlaces(price)) throw Errors.validation('The delivery price is in rand and cents: at most 2 decimal places');
  return price;
}

/**
 * The labour lines as they are kept: each role on the rates list at its rate
 * today. A role made inactive since it was put on this draft keeps the name and
 * rate it had; one that is inactive can't be added.
 */
async function checkedLabour(lines: SalesLabourInput[], had: KeptLabour[], tx: Prisma.TransactionClient, on: string) {
  const ids = [...new Set(lines.map((l) => l.labourRateId))];
  const rates = ids.length ? await tx.labourRate.findMany({ where: { id: { in: ids } } }) : [];
  return lines.map((line, i) => {
    const n = `${on}Labour line ${i + 1}`;
    if (!Number.isFinite(line.hours) || line.hours <= 0 || line.hours > 100000) throw Errors.validation(`${n} needs its hours, more than 0`);
    if (!twoPlaces(line.hours)) throw Errors.validation(`${n}: hours have at most 2 decimal places`);
    const rate = rates.find((r) => r.id === line.labourRateId);
    if (!rate) throw Errors.validation(`${n}: that role isn't on the rates list`);
    const kept = had.find((h) => h.labourRateId === rate.id);
    if (!rate.active && !kept) throw Errors.validation(`${n}: ${rate.role} is no longer used. Choose another role, or ask the Workshop Manager to make it active again.`);
    return {
      labourRateId: rate.id,
      role: rate.active ? rate.role : kept!.role,
      hours: line.hours,
      hourlyRate: rate.active ? rate.hourlyRate : kept!.hourlyRate,
    };
  });
}

/** Other costs as typed: a description, more than 0 of them, at more than R0 each. */
function checkedOtherCosts(costs: SalesOtherCostInput[], on: string) {
  return costs.map((c, i) => {
    const n = `${on}Other cost ${i + 1}`;
    const description = cleanText(c.description);
    if (!description) throw Errors.validation(`${n} needs a description, e.g. Accommodation`);
    if (!Number.isFinite(c.quantity) || c.quantity <= 0 || c.quantity > 1e6 || !twoPlaces(c.quantity)) throw Errors.validation(`${n}: the quantity is more than 0, to at most 2 decimal places`);
    if (!Number.isFinite(c.unitCost) || c.unitCost <= 0 || c.unitCost > 1e10 || !twoPlaces(c.unitCost)) throw Errors.validation(`${n}: the unit cost is in rand and cents, more than R0`);
    return { description, quantity: c.quantity, unitCost: c.unitCost };
  });
}

/** One supplier's quote on a Procurement RFQ, valued today; null when they haven't quoted or declined. */
function valueOf(rfq: QuoteRfq, supplierId: string, rates: Record<string, number>) {
  return quoteValue(rfq, rfq.suppliers.find((q) => q.supplierId === supplierId), rates);
}

/**
 * The quotes the material comes from, each valued in rand today: one supplier's
 * recorded quote on each of the project's sent Procurement RFQs, each RFQ once
 * across the whole Sales RFQ. The RFQs are held until the Sales RFQ is written,
 * so none is cancelled in between.
 */
async function checkedMaterials(materials: SalesMaterialInput[], projectNumber: string, tx: Prisma.TransactionClient) {
  if (materials.length === 0) return [];
  const ids = materials.map((m) => m.rfqId);
  if (new Set(ids).size !== ids.length) throw Errors.validation('Pick one quote on each request for quotation, on one equipment line');
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

type CheckedMaterial = Awaited<ReturnType<typeof checkedMaterials>>[number];

/**
 * The equipment lines as they will be kept, each with its labour priced today,
 * its quotes valued today and its other costs. Messages name the equipment line
 * only when there is more than one.
 */
async function checkedLines(lines: SalesEquipmentLineInput[], had: KeptLabour[], projectNumber: string, tx: Prisma.TransactionClient) {
  if (lines.length === 0) throw Errors.validation('A Sales RFQ has at least one equipment line');
  if (lines.length > MAX_EQUIPMENT_LINES) throw Errors.validation(`A Sales RFQ has at most ${MAX_EQUIPMENT_LINES} equipment lines`);
  const materials = await checkedMaterials(lines.flatMap((l) => l.materials ?? []), projectNumber, tx);
  let taken = 0;
  const out = [];
  for (const [i, line] of lines.entries()) {
    const on = lines.length > 1 ? `Equipment line ${i + 1}: ` : '';
    const quantity = line.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) {
      throw Errors.validation(`${on}the quantity is a whole number, 0 or more (0 prices it without charging it)`);
    }
    const count = (line.materials ?? []).length;
    out.push({
      equipment: cleanText(line.equipment),
      details: cleanLines(line.details),
      quantity,
      labour: await checkedLabour(line.labour ?? [], had, tx, on),
      materials: materials.slice(taken, taken + count),
      otherCosts: checkedOtherCosts(line.otherCosts ?? [], on),
    });
    taken += count;
  }
  return out;
}

type CheckedLine = Awaited<ReturnType<typeof checkedLines>>[number];

/** Writes the lines afresh, the labour and other costs numbered through the whole Sales RFQ. */
async function writeLines(salesRfqId: string, lines: CheckedLine[], tx: Prisma.TransactionClient) {
  let labourNo = 0;
  let otherNo = 0;
  let added = Date.now();
  for (const [i, line] of lines.entries()) {
    const kept = await tx.salesRfqEquipmentLine.create({
      data: { salesRfqId, lineNo: i + 1, equipment: line.equipment, details: line.details, quantity: line.quantity },
    });
    if (line.labour.length) {
      await tx.salesRfqLabourLine.createMany({ data: line.labour.map((l) => ({ ...l, rfqId: salesRfqId, equipmentLineId: kept.id, lineNo: ++labourNo })) });
    }
    if (line.materials.length) {
      await tx.salesRfqMaterial.createMany({
        data: line.materials.map((m) => ({
          salesRfqId, equipmentLineId: kept.id, rfqId: m.rfqId, supplierId: m.supplierId, quoteTotal: m.quoteTotal, currency: m.currency, amount: m.amount, addedAt: new Date(added++),
        })),
      });
    }
    if (line.otherCosts.length) {
      await tx.salesRfqOtherCost.createMany({ data: line.otherCosts.map((c) => ({ ...c, salesRfqId, equipmentLineId: kept.id, lineNo: ++otherNo })) });
    }
  }
}

const labourForLog = (lines: Array<{ role: string; hours: Prisma.Decimal | number; hourlyRate: Prisma.Decimal | number }>) =>
  lines.map((l) => ({ role: l.role, hours: D(l.hours).toFixed(2), hourlyRate: D(l.hourlyRate).toFixed(2) }));

const materialsForLog = (materials: Array<{ number: string; supplier: string; amount: Prisma.Decimal | string }>) =>
  materials.map((m) => ({ rfq: m.number, supplier: m.supplier, amount: D(m.amount).toFixed(2) }));

const otherCostsForLog = (costs: Array<{ description: string; quantity: Prisma.Decimal | number; unitCost: Prisma.Decimal | number }>) =>
  costs.map((c) => ({ description: c.description, quantity: D(c.quantity).toFixed(2), unitCost: D(c.unitCost).toFixed(2) }));

/** The lines as the Activity keeps them: what each is, how many, and what it costs. */
const linesForLog = (lines: Array<{
  equipment: string | null; details: string | null; quantity: number;
  labour: Parameters<typeof labourForLog>[0]; materials: Parameters<typeof materialsForLog>[0]; otherCosts: Parameters<typeof otherCostsForLog>[0];
}>) => lines.map((l) => ({
  equipment: l.equipment, details: l.details, quantity: l.quantity,
  labour: labourForLog(l.labour), materials: materialsForLog(l.materials), otherCosts: otherCostsForLog(l.otherCosts),
}));

const keptLinesForLog = (rfq: Detail) => linesForLog(rfq.equipmentLines.map((l) => ({
  ...l, materials: l.materials.map((m) => ({ number: m.rfq.number, supplier: m.supplier.name, amount: m.amount })),
})));

/** The VAT rate a draft is shown at, and fixed at when it is submitted. */
async function currentVatRate(): Promise<number> {
  return Number(await SettingsService.getValue<number>('purchaseOrders.vatRate')) || 0;
}

/**
 * The Sales RFQ with its money, line by line. A draft's quotes are valued as
 * they stand today, and any that can no longer be counted is flagged; once
 * submitted, each keeps the amount it had then. Each says whether it is the one
 * Procurement recommends. `equipment` is the first line's, for lists and the
 * quotation's file name.
 */
function withCosting(rfq: Detail, vatSetting: number, rates: Record<string, number>) {
  const draft = rfq.status === 'DRAFT';
  const lines = rfq.equipmentLines.map((line) => ({
    id: line.id, lineNo: line.lineNo, equipment: line.equipment, details: line.details, quantity: line.quantity,
    labour: line.labour.map((l) => ({ ...l, total: labourLineTotal(l) })),
    materials: line.materials.map((m) => {
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
    }),
    otherCosts: line.otherCosts.map((c) => ({ id: c.id, lineNo: c.lineNo, description: c.description, quantity: c.quantity, unitCost: c.unitCost, total: otherCostTotal(c) })),
  }));
  const vatRate = rfq.vatRate ?? vatSetting;
  const totals = costingTotals({
    lines: lines.map((l) => ({ quantity: l.quantity, labour: l.labour, materials: l.materials.map((m) => m.amount), otherCosts: l.otherCosts })),
    markupPercent: rfq.markupPercent, deliveryPrice: rfq.deliveryPrice, vatRate,
  });
  const { lines: lineTotals, ...overall } = totals;
  return {
    ...rfq,
    equipment: rfq.equipmentLines[0]?.equipment ?? null,
    equipmentLines: lines.map((l, i) => ({ ...l, totals: lineTotals[i]! })),
    totals: overall,
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

/** What a draft still needs before it goes to the Director, in plain words. */
function stillNeeded(rfq: Detail): string[] {
  const lines = rfq.equipmentLines;
  const one = lines.length === 1;
  return [
    ...lines.flatMap((l) => [
      !l.equipment && (one ? 'the equipment being quoted' : `the equipment on line ${l.lineNo}`),
      l.labour.length === 0 && l.materials.length === 0 && l.otherCosts.length === 0
        && (one ? 'labour, a quote or another cost to price' : `labour, a quote or another cost on line ${l.lineNo}`),
    ]),
    // Lines at quantity 0 are priced but not charged; the quotation charges for something.
    lines.length > 0 && lines.every((l) => l.quantity === 0) && (one ? 'a quantity of 1 or more' : 'a quantity of 1 or more on at least one line'),
    !rfq.clientName && "the client's name",
    rfq.markupPercent === null && 'the markup',
  ].filter((m): m is string => !!m);
}

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
   * Creates a numbered draft, with one empty equipment line unless lines are
   * given. The client is the project's and the conditions the quotation's usual
   * ones unless given; the signer's email is the creator's.
   *
   * @throws {ApiError} VALIDATION_ERROR for a missing or closed project, a role
   * not on the list, hours, quantities or money out of range, or a quote that
   * isn't one recorded on the project's sent Procurement RFQs, or can't be valued in rand.
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
      const lines = await checkedLines(input.equipmentLines ?? [{}], [], projectNumber, tx);
      const number = await generateRfqNumber(tx, projectNumber);
      const text = (k: TextField, fallback: string | null = null) => (input[k] === undefined ? fallback : cleanField(k, input[k]));
      const clientName = text('clientName', client);
      const rfq = await tx.salesRfq.create({
        data: {
          number,
          status: 'DRAFT',
          projectNumber,
          description: text('description', projectName),
          notes: text('notes'),
          quoteNotes: text('quoteNotes'),
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
        },
      });
      await writeLines(rfq.id, lines, tx);
      // Everything it was raised with, so the Activity starts from the whole draft.
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'CREATE', entityType: 'SalesRfq', entityId: rfq.id,
          after: {
            number, status: rfq.status, projectNumber, markupPercent: rfq.markupPercent?.toString() ?? null,
            deliveryPrice: rfq.deliveryPrice.toFixed(2), clientName: rfq.clientName, equipmentLines: linesForLog(lines),
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
   * equipment lines prices their labour at today's rates and values their quotes
   * today. Only what changed is logged.
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
      for (const k of TEXT_FIELDS) if (input[k] !== undefined) change(k, rfq[k], cleanField(k, input[k]));
      if (input.penaltiesApply !== undefined) change('penaltiesApply', rfq.penaltiesApply, input.penaltiesApply);
      if (input.markupPercent !== undefined) {
        const next = checkedMarkup(input.markupPercent);
        change('markupPercent', rfq.markupPercent?.toString() ?? null, next === null ? null : D(next).toString(), next);
      }
      if (input.deliveryPrice !== undefined) change('deliveryPrice', rfq.deliveryPrice.toFixed(2), D(checkedDelivery(input.deliveryPrice)).toFixed(2), input.deliveryPrice);
      if (input.closingDate !== undefined) change('closingDate', dayOf(rfq.closingDate), input.closingDate, input.closingDate ? asDate(input.closingDate) : null);

      const had = keptLinesForLog(rfq);
      if (input.equipmentLines !== undefined) {
        // Written afresh every time, so each quote is valued today.
        const lines = await checkedLines(input.equipmentLines, allLabour(rfq), projectNumber, tx);
        await tx.salesRfqEquipmentLine.deleteMany({ where: { salesRfqId: rfq.id } });
        await writeLines(rfq.id, lines, tx);
        const now = linesForLog(lines);
        if (JSON.stringify(had) !== JSON.stringify(now)) {
          before.equipmentLines = had;
          after.equipmentLines = now;
        }
      } else if (projectNumber !== rfq.projectNumber && allMaterials(rfq).length > 0) {
        // Another project's quotes can't stay on it; the lines and their labour do.
        await tx.salesRfqMaterial.deleteMany({ where: { salesRfqId: rfq.id } });
        before.equipmentLines = had;
        after.equipmentLines = had.map((l) => ({ ...l, materials: [] }));
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
   * Sends a draft to the Director. Each equipment line needs its name and
   * something to price it; the Sales RFQ needs the client and a markup. Each
   * quote is valued again and that amount kept, and the VAT rate of the day is
   * fixed on it.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is a draft;
   * VALIDATION_ERROR for what it still needs, or a quote that can no longer be counted.
   */
  async submit(id: string, actorId: string) {
    await prisma.$transaction(async (tx) => {
      const rfq = await held(id, tx);
      if (rfq.status !== 'DRAFT') throw Errors.invalidState(`${rfq.number} is ${STATUS_WORDS[rfq.status]}, so it can't be submitted`, { status: rfq.status });
      const missing = stillNeeded(rfq);
      if (missing.length) throw Errors.validation(`Before submitting ${rfq.number}, add ${missing.join(', ')}.`);
      await openProjectName(rfq.projectNumber, tx);
      const materials = await checkedMaterials(allMaterials(rfq).map((m) => ({ rfqId: m.rfqId, supplierId: m.supplierId })), rfq.projectNumber, tx);
      for (const m of materials) {
        await tx.salesRfqMaterial.update({
          where: { salesRfqId_rfqId: { salesRfqId: id, rfqId: m.rfqId } },
          data: { quoteTotal: m.quoteTotal, currency: m.currency, amount: m.amount },
        });
      }
      const amountOf = new Map<string, CheckedMaterial>(materials.map((m) => [m.rfqId, m]));
      const vatRate = await currentVatRate();
      const now = new Date();
      await tx.salesRfq.update({
        where: { id },
        data: { status: 'PENDING_APPROVAL', vatRate, submittedAt: now, submittedById: actorId, returnedAt: null, returnedById: null, returnReason: null },
      });
      const totals = costingTotals({
        lines: rfq.equipmentLines.map((l) => ({ quantity: l.quantity, labour: l.labour, materials: l.materials.map((m) => amountOf.get(m.rfqId)!.amount), otherCosts: l.otherCosts })),
        markupPercent: rfq.markupPercent, deliveryPrice: rfq.deliveryPrice, vatRate,
      });
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
