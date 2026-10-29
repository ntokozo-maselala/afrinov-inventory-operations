// Requests for quotation (RFQ roadmap, Phase 1), as the RFQ sheet of the
// AFRI-02A-xxxx-02-01 Manhours and Material workbook: the lines to price (item,
// units, quantity), the suppliers asked to quote, and each supplier's quote
// once it comes back.
//
// State machine: DRAFT → SENT → AWARDED, or CANCELLED from DRAFT or SENT.
// A draft is raised, edited and sent (Phases 1 and 2); once sent, only its
// closing date moves and suppliers who were missed are added, and each
// supplier's quote is recorded, with their own PDF, or their decline (Phase 4).
// Phase 5 compares the quotes and awards the RFQ to one supplier: a draft
// purchase order at their prices, saved with the award or not at all.
//
// An RFQ is for a project or for Stores, as an order is, and holds a project's
// material only for that project. Every change is written to the audit log
// (entity type Rfq) for the RFQ's Activity.
import { Prisma, type RfqStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { SettingsService } from '../settings/settings.service.js';
import { checkProjectMaterial, refuseStoresOnProjectOrder, refuseUnassigned } from '../inventory/material-section.js';
import { cleanText } from './supplier-fields.js';
import { defaultVatRate, lineMoney, orderTotals } from './po-pricing.js';
import { PurchaseOrderService, assertProjectOpen } from './procurement.service.js';

export interface RfqLineInput { materialId: string; quantity: number }

export interface CreateRfqInput {
  projectNumber?: string | null;
  /** Left out on an RFQ for a project: the project's name, as the sheet takes it from the enquiry. */
  description?: string | null;
  notes?: string | null;
  penaltiesApply?: boolean;
  lines: RfqLineInput[];
  /** The suppliers to ask; more can be added until it is sent. */
  supplierIds?: string[];
}

/** Fields left out are unchanged; lines and suppliers, when sent, replace the draft's. */
export interface UpdateRfqInput {
  id: string;
  projectNumber?: string | null;
  description?: string | null;
  notes?: string | null;
  penaltiesApply?: boolean;
  lines?: RfqLineInput[];
  supplierIds?: string[];
  /** YYYY-MM-DD. Only once it is sent, when it and adding suppliers are all that can change. */
  closingDate?: string;
}

/** Days from sending to closing when none is given, as the RFQ sheet's Closing = Issued + 4. */
export const DEFAULT_CLOSING_DAYS = 4;

/**
 * Today in South Africa, as YYYY-MM-DD: the RFQ sheet's =TODAY() on a buyer's
 * machine. The server's own clock runs in UTC, two hours behind.
 */
export function todayInSouthAfrica(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

/** A YYYY-MM-DD day `days` later. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Refuses a day that doesn't exist (2026-02-30), which would otherwise be saved as another one. */
function checkDay(day: string): void {
  const d = asDate(day);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) throw Errors.validation(`${day} is not a date`);
}

/** A closing date on or after the day it is sent; an RFQ can't close before it goes out. */
function checkClosingDate(closing: string, issued: string): void {
  checkDay(closing);
  if (closing < issued) throw Errors.validation(`The closing date can't be before ${issued}, the day it was sent`);
}

const SENT_FIELDS = ['projectNumber', 'description', 'notes', 'penaltiesApply', 'lines'] as const;

/** One supplier's quote as the award weighs it. */
export interface QuoteForAward {
  supplierId: string;
  name: string;
  currency: string;
  /** Recorded and not declined. */
  quoted: boolean;
  /** Net value including VAT, as the exact decimal it is kept as; null until quoted. */
  net: string | null;
  unpricedLines: number;
  /** YYYY-MM-DD, or null when the quote gave none. */
  validUntil: string | null;
}

/**
 * What a buyer should say why about before awarding to `chosen`: lines it
 * didn't price (the order has them without a price), a quote that has run
 * out, and a cheaper complete quote in the same currency. Quotes in another
 * currency aren't weighed against it. Empty: the clear choice, no reason
 * needed.
 */
export function awardConcerns(quotes: QuoteForAward[], chosenId: string, today: string): string[] {
  const chosen = quotes.find((q) => q.supplierId === chosenId);
  if (!chosen?.quoted) return [];
  const concerns: string[] = [];
  if (chosen.unpricedLines > 0) {
    concerns.push(`${chosen.name} didn't price ${chosen.unpricedLines === 1 ? '1 line' : `${chosen.unpricedLines} lines`}: the order has ${chosen.unpricedLines === 1 ? 'it' : 'them'} without a price`);
  }
  if (chosen.validUntil && chosen.validUntil < today) concerns.push(`${chosen.name}'s quote ran out on ${chosen.validUntil}`);
  if (chosen.unpricedLines === 0 && chosen.net !== null) {
    // Compared as decimals: large totals lose their cents as doubles, and two different ones could look equal.
    const net = new Prisma.Decimal(chosen.net);
    const cheaper = quotes
      .filter((q) => q.supplierId !== chosenId && q.quoted && q.currency === chosen.currency && q.unpricedLines === 0 && q.net !== null && new Prisma.Decimal(q.net).lessThan(net))
      .sort((a, b) => new Prisma.Decimal(a.net!).comparedTo(b.net!));
    if (cheaper[0]) concerns.push(`${cheaper[0].name} quoted less for every line: ${cheaper[0].currency} ${new Prisma.Decimal(cheaper[0].net!).toFixed(2)} against ${net.toFixed(2)}`);
  }
  return concerns;
}

export interface RecordQuoteInput {
  /** YYYY-MM-DD; today unless given. */
  quotedAt?: string;
  quoteReference?: string | null;
  /** YYYY-MM-DD. */
  validUntil?: string | null;
  leadTime?: string | null;
  notes?: string | null;
  /** Excluding VAT, in the supplier's currency; lines the supplier doesn't offer are left out. */
  prices: Array<{ rfqLineId: string; unitPrice: number }>;
}

/**
 * The sent RFQ and the supplier asked, held for the change: quotes are
 * recorded only while it is out with suppliers, so not on a draft, nor once
 * it is awarded or cancelled.
 */
async function quotable(rfqId: string, supplierId: string, tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT id FROM rfqs WHERE id = ${rfqId} FOR UPDATE`;
  const rfq = await tx.rfq.findUnique({ where: { id: rfqId }, include: { lines: { select: { id: true } } } });
  if (!rfq) throw Errors.notFound('Rfq');
  if (rfq.status !== 'SENT') {
    throw Errors.invalidState(rfq.status === 'DRAFT'
      ? `${rfq.number} hasn't been sent yet, so there are no quotes to record`
      : `Request for quotation ${rfq.number} is ${rfq.status.toLowerCase()}, so its quotes can no longer change`, { status: rfq.status });
  }
  const asked = await tx.rfqSupplier.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId } }, include: { prices: true } });
  if (!asked) throw Errors.notFound('Supplier on this request for quotation');
  return { rfq, asked };
}

/** A file name safe to keep and to send back in a download: no folders, no control characters. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = [...base].filter((c) => c.charCodeAt(0) >= 0x20 && c !== '\u007f' && c !== '"').join('').trim().slice(0, 196);
  // Always a .pdf, so a download opens as the PDF it was checked to be, never as a page a browser runs.
  if (!clean) return 'quotation.pdf';
  return /\.pdf$/i.test(clean) ? clean : `${clean.replace(/\.[^.]*$/, '')}.pdf`;
}

/** A recorded quote, or decline, as the audit log keeps it before it changes. */
function quoteForLog(asked: {
  supplierId: string; declined: boolean; quotedAt: Date | null; quoteReference: string | null; validUntil: Date | null;
  leadTime: string | null; notes: string | null; prices: Array<{ rfqLineId: string; unitPrice: Prisma.Decimal }>;
}) {
  return {
    supplierId: asked.supplierId, declined: asked.declined, quotedAt: dayOf(asked.quotedAt), quoteReference: asked.quoteReference,
    validUntil: dayOf(asked.validUntil), leadTime: asked.leadTime, notes: asked.notes,
    prices: asked.prices.map((p) => ({ rfqLineId: p.rfqLineId, unitPrice: p.unitPrice.toString() })),
  };
}

/**
 * A sent RFQ has gone to its suppliers as it stands, so only its closing date
 * can move and a supplier who was missed can be added. Nobody already asked
 * is taken off.
 */
async function editSent(
  rfq: { id: string; number: string; issuedAt: Date | null; closingDate: Date | null; suppliers: Array<{ supplierId: string }> },
  input: UpdateRfqInput,
  actorId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const fixed = SENT_FIELDS.find((k) => input[k] !== undefined);
  if (fixed) {
    throw Errors.invalidState(`${rfq.number} has been sent, so only its closing date and the suppliers asked can change`, { field: fixed });
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const data: Prisma.RfqUpdateInput = {};
  if (input.closingDate !== undefined && input.closingDate !== dayOf(rfq.closingDate)) {
    checkClosingDate(input.closingDate, dayOf(rfq.issuedAt) ?? todayInSouthAfrica());
    data.closingDate = asDate(input.closingDate);
    before.closingDate = dayOf(rfq.closingDate);
    after.closingDate = input.closingDate;
  }
  if (input.supplierIds !== undefined) {
    const had = rfq.suppliers.map((s) => s.supplierId);
    const next = [...new Set(input.supplierIds.map((s) => s.trim()))];
    if (had.some((s) => !next.includes(s))) {
      throw Errors.invalidState(`${rfq.number} has already gone to its suppliers, so none of them can be taken off. Cancel it to stop asking.`);
    }
    // Only the ones being added are checked: a supplier already asked who has
    // since been deactivated stays on it, and doesn't stop anyone else being asked.
    const added = await checkSuppliers(next.filter((s) => !had.includes(s)), tx);
    if (added.length > 0) {
      await tx.rfqSupplier.createMany({ data: askedInOrder(added).map((row) => ({ rfqId: rfq.id, ...row })) });
      before.supplierIds = had;
      after.supplierIds = [...had, ...added];
    }
  }
  if (Object.keys(after).length === 0) return;
  if (Object.keys(data).length > 0) await tx.rfq.update({ where: { id: rfq.id }, data });
  await tx.auditLogEntry.create({
    data: { actorId, action: 'UPDATE', entityType: 'Rfq', entityId: rfq.id, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue },
  });
}

/**
 * The number before the sequence: the workbook's document number for a
 * project numbered as Afrinov's are (AFRI-02A-1325-02- for AFRI-1325), RFQ-
 * and the project's own number for any other (RFQ-P77- for P77), else RFQ-.
 * Each project has a prefix no other project shares: only the exact
 * AFRI-<digits> form drops its AFRI-, so 1325 and AFRI-1325 stay apart.
 */
export function rfqNumberPrefix(projectNumber: string | null | undefined): string {
  if (!projectNumber) return 'RFQ-';
  const afrinov = /^AFRI-(\d+)$/.exec(projectNumber);
  return afrinov ? `AFRI-02A-${afrinov[1]}-02-` : `RFQ-${projectNumber}-`;
}

/**
 * One past the highest number issued with the same prefix: AFRI-02A-1325-02-01,
 * -02, … for a project (two digits, as the workbook's), RFQ-0001, … without one.
 * RFQ-0001-01 (project 0001) is not counted as an RFQ without a project: only
 * digits may follow a prefix.
 */
export function nextRfqNumber(projectNumber: string | null | undefined, issued: string[]): string {
  const prefix = rfqNumberPrefix(projectNumber);
  const highest = issued.reduce((max, number) => {
    const rest = number.startsWith(prefix) ? number.slice(prefix.length) : '';
    return /^\d+$/.test(rest) ? Math.max(max, Number(rest)) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(projectNumber ? 2 : 4, '0')}`;
}

/** Callers hold the afrinov:rfq-number advisory lock, so two RFQs never get the same number. */
async function generateRfqNumber(tx: Prisma.TransactionClient, projectNumber: string | null): Promise<string> {
  const issued = await tx.rfq.findMany({ where: { number: { startsWith: rfqNumberPrefix(projectNumber) } }, select: { number: true } });
  return nextRfqNumber(projectNumber, issued.map((r) => r.number));
}

/**
 * Refuses a missing or closed project, holding its row until the transaction
 * ends so it can't be archived between the check and the RFQ being written.
 * Returns its name, the RFQ's description by default.
 */
async function openProjectName(projectNumber: string, tx: Prisma.TransactionClient): Promise<string | null> {
  await tx.$executeRaw`SELECT 1 FROM projects WHERE project_number = ${projectNumber} FOR SHARE`;
  await assertProjectOpen(projectNumber, tx);
  return cleanText((await tx.project.findUnique({ where: { projectNumber }, select: { name: true } }))?.name);
}

/**
 * Refuses an RFQ without a project, missing or inactive items, Stores items,
 * project material with no project, and another project's material. RFQs are
 * Procurement's, for one project (Stores ordering roadmap); Stores stock is
 * ordered by the store at known prices.
 */
async function checkLines(lines: RfqLineInput[], projectNumber: string | null, tx: Prisma.TransactionClient): Promise<void> {
  if (!projectNumber) throw Errors.validation('A request for quotation is for one project: choose its project. Stores stock is ordered from Stores → Order stock.');
  if (lines.length === 0) throw Errors.validation('A request for quotation needs at least one line');
  const ids = [...new Set(lines.map((l) => l.materialId))];
  // Held until the RFQ is written, so an item can't be deactivated between the check and the save.
  await tx.$executeRaw`SELECT 1 FROM materials WHERE id IN (${Prisma.join(ids)}) FOR SHARE`;
  const materials = await tx.material.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, active: true, category: true, projectNumber: true },
  });
  const missing = ids.find((id) => !materials.some((m) => m.id === id));
  if (missing) throw Errors.validation(`Material ${missing} does not exist`);
  const inactive = materials.find((m) => !m.active);
  if (inactive) throw Errors.validation(`${inactive.sku} is inactive, so it can't be quoted for`);
  for (const m of materials) refuseUnassigned(m, 'ordered');
  checkProjectMaterial(projectNumber, materials, 'ordered');
  refuseStoresOnProjectOrder(projectNumber, materials);
}

/** The suppliers to ask, each once; missing or inactive ones are refused. */
async function checkSuppliers(supplierIds: string[], tx: Prisma.TransactionClient): Promise<string[]> {
  const ids = [...new Set(supplierIds.map((s) => s.trim()))];
  if (ids.length === 0) return [];
  // Held until the RFQ is written, as for its items.
  await tx.$executeRaw`SELECT 1 FROM suppliers WHERE id IN (${Prisma.join(ids)}) FOR SHARE`;
  const suppliers = await tx.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, active: true } });
  const missing = ids.find((id) => !suppliers.some((s) => s.id === id));
  if (missing) throw Errors.validation(`Supplier ${missing} does not exist`);
  const inactive = suppliers.find((s) => !s.active);
  if (inactive) throw Errors.validation(`${inactive.name} is inactive. Reactivate the supplier to ask them for a quote.`);
  return ids;
}

/**
 * The suppliers to ask, each a millisecond after the one before: they are
 * listed by when they were asked, and rows saved together would otherwise
 * share a time and come back in any order.
 */
function askedInOrder(supplierIds: string[], from = Date.now()) {
  return supplierIds.map((supplierId, i) => ({ supplierId, createdAt: new Date(from + i) }));
}

const lineRows = (lines: RfqLineInput[]) => lines.map((l, i) => ({ lineNo: i + 1, materialId: l.materialId, quantity: l.quantity }));

/** Lines and suppliers as the audit log keeps them. */
const linesForLog = (lines: Array<{ materialId: string; quantity: Prisma.Decimal | number }>) =>
  lines.map((l) => ({ materialId: l.materialId, quantity: String(l.quantity) }));

const person = { select: { id: true, name: true } } as const;

const DETAIL = {
  project: { select: { projectNumber: true, name: true } },
  createdBy: person,
  sentBy: person,
  awardedBy: person,
  cancelledBy: person,
  purchaseOrder: { select: { id: true, number: true, status: true, supplierId: true } },
  lines: { include: { material: true }, orderBy: { lineNo: 'asc' } },
  suppliers: {
    // The quotation file's details, never its contents: those are downloaded on their own.
    include: { supplier: true, prices: true, quoteFile: { select: { fileName: true, size: true, uploadedAt: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.RfqInclude;

type RfqDetail = Prisma.RfqGetPayload<{ include: typeof DETAIL }>;

/** Sent and past its closing date: quotes may still be recorded, but none are expected. */
function isClosed(rfq: { status: RfqStatus; closingDate: Date | null }, today = todayInSouthAfrica()): boolean {
  return rfq.status === 'SENT' && !!rfq.closingDate && dayOf(rfq.closingDate)! < today;
}

/**
 * Each supplier's quote priced as an order would be: per line subtotal, VAT
 * and net from po-pricing, VAT at the setting for rand suppliers and 0% for
 * other currencies. Totals are null until the quote is recorded.
 */
function withQuotes(rfq: RfqDetail, vatSetting: number) {
  return {
    ...rfq,
    closed: isClosed(rfq),
    suppliers: rfq.suppliers.map((s) => {
      const vatRate = defaultVatRate(s.currency ?? s.supplier.currency ?? 'ZAR', vatSetting);
      const priced = rfq.lines.map((l) => ({ rfqLineId: l.id, orderedQty: l.quantity, unitPrice: s.prices.find((p) => p.rfqLineId === l.id)?.unitPrice ?? null }));
      return {
        ...s,
        vatRate,
        totals: s.quotedAt ? orderTotals(priced, vatRate) : null,
        // Each priced line's subtotal, rounded as the order will round it, for the comparison.
        lineSubtotals: s.quotedAt ? priced.flatMap((p) => { const m = lineMoney(p, vatRate); return m ? [{ rfqLineId: p.rfqLineId, subtotal: m.subtotal }] : []; }) : [],
      };
    }),
  };
}

export const RfqService = {
  async list(filter: { status?: RfqStatus; projectNumber?: string } = {}) {
    const today = todayInSouthAfrica();
    const rfqs = await prisma.rfq.findMany({
      where: filter,
      include: {
        project: { select: { projectNumber: true, name: true } },
        lines: { select: { id: true } },
        suppliers: { select: { supplierId: true, quotedAt: true, declined: true, supplier: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rfqs.map((r) => ({ ...r, closed: isClosed(r, today) }));
  },

  async getById(id: string) {
    const rfq = await prisma.rfq.findUnique({ where: { id }, include: DETAIL });
    if (!rfq) throw Errors.notFound('Rfq');
    return withQuotes(rfq, Number(await SettingsService.getValue<number>('purchaseOrders.vatRate')) || 0);
  },

  /**
   * Creates a numbered draft with its lines and the suppliers to ask.
   *
   * @throws {ApiError} VALIDATION_ERROR for no project or no lines, a missing
   * or inactive item or supplier, a missing or closed project, a Stores item,
   * unassigned project material, or another project's material.
   */
  async create(input: CreateRfqInput, actorId: string) {
    const projectNumber = cleanText(input.projectNumber);
    const id = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:rfq-number'))`;
      const projectName = projectNumber ? await openProjectName(projectNumber, tx) : null;
      await checkLines(input.lines, projectNumber, tx);
      const supplierIds = await checkSuppliers(input.supplierIds ?? [], tx);
      const number = await generateRfqNumber(tx, projectNumber);
      const rfq = await tx.rfq.create({
        data: {
          number,
          status: 'DRAFT',
          projectNumber,
          description: input.description === undefined ? projectName : cleanText(input.description),
          notes: cleanText(input.notes),
          penaltiesApply: input.penaltiesApply ?? false,
          createdById: actorId,
          lines: { create: lineRows(input.lines) },
          suppliers: { create: askedInOrder(supplierIds) },
        },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      // Everything it was raised with, so the Activity starts from the whole draft.
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'Rfq',
          entityId: rfq.id,
          after: {
            number, status: rfq.status, projectNumber, description: rfq.description, notes: rfq.notes,
            penaltiesApply: rfq.penaltiesApply, lines: linesForLog(rfq.lines), supplierIds,
          } as Prisma.InputJsonValue,
        },
      });
      return rfq.id;
    });
    // The same shape as GET /rfqs/:id.
    return RfqService.getById(id);
  },

  /**
   * Changes a draft. Moving it to another project, or off one, gives it that
   * project's next number: nobody outside has seen a draft's number yet.
   * Only what changed is logged.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE once it is no longer a draft;
   * VALIDATION_ERROR as for create.
   */
  async update(input: UpdateRfqInput, actorId: string) {
    await prisma.$transaction(async (tx) => {
      // The number lock first, then the row, as create takes them.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:rfq-number'))`;
      await tx.$executeRaw`SELECT id FROM rfqs WHERE id = ${input.id} FOR UPDATE`;
      const rfq = await tx.rfq.findUnique({ where: { id: input.id }, include: { lines: { orderBy: { lineNo: 'asc' } }, suppliers: true } });
      if (!rfq) throw Errors.notFound('Rfq');
      if (rfq.status === 'SENT') {
        await editSent(rfq, input, actorId, tx);
        return;
      }
      if (rfq.status !== 'DRAFT') {
        throw Errors.invalidState(`Request for quotation ${rfq.number} is ${rfq.status.toLowerCase()}, so it can no longer be edited`, { status: rfq.status });
      }
      if (input.closingDate !== undefined) throw Errors.validation('The closing date is set when the request for quotation is sent');

      const data: Record<string, string | boolean | null> = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const change = (key: 'description' | 'notes' | 'penaltiesApply' | 'projectNumber' | 'number', next: string | boolean | null) => {
        if (rfq[key] === next) return;
        data[key] = next;
        before[key] = rfq[key];
        after[key] = next;
      };
      const projectNumber = input.projectNumber === undefined ? rfq.projectNumber : cleanText(input.projectNumber);
      if (projectNumber !== rfq.projectNumber) {
        const projectName = projectNumber ? await openProjectName(projectNumber, tx) : null;
        change('projectNumber', projectNumber);
        change('number', await generateRfqNumber(tx, projectNumber));
        // A description that was the old project's name follows the project;
        // one the buyer wrote stays.
        if (input.description === undefined && rfq.projectNumber) {
          const oldName = cleanText((await tx.project.findUnique({ where: { projectNumber: rfq.projectNumber }, select: { name: true } }))?.name);
          if (oldName && rfq.description === oldName) change('description', projectName);
        }
      }
      if (input.description !== undefined) change('description', cleanText(input.description));
      if (input.notes !== undefined) change('notes', cleanText(input.notes));
      if (input.penaltiesApply !== undefined) change('penaltiesApply', input.penaltiesApply);

      // The lines are checked against the project they will have, kept or new.
      const nextLines = input.lines ?? rfq.lines.map((l) => ({ materialId: l.materialId, quantity: Number(l.quantity) }));
      if (input.lines !== undefined || 'projectNumber' in data) await checkLines(nextLines, projectNumber, tx);
      const linesChanged = input.lines !== undefined
        && JSON.stringify(linesForLog(input.lines)) !== JSON.stringify(linesForLog(rfq.lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity.toNumber() }))));
      if (linesChanged) {
        await tx.rfqLine.deleteMany({ where: { rfqId: rfq.id } });
        await tx.rfqLine.createMany({ data: lineRows(input.lines!).map((l) => ({ ...l, rfqId: rfq.id })) });
        before.lines = linesForLog(rfq.lines);
        after.lines = linesForLog(input.lines!);
      }

      const had = rfq.suppliers.map((s) => s.supplierId);
      const nextSuppliers = input.supplierIds === undefined ? had : await checkSuppliers(input.supplierIds, tx);
      const removed = had.filter((s) => !nextSuppliers.includes(s));
      const added = nextSuppliers.filter((s) => !had.includes(s));
      if (removed.length > 0) await tx.rfqSupplier.deleteMany({ where: { rfqId: rfq.id, supplierId: { in: removed } } });
      if (added.length > 0) await tx.rfqSupplier.createMany({ data: askedInOrder(added).map((row) => ({ rfqId: rfq.id, ...row })) });
      if (removed.length > 0 || added.length > 0) {
        before.supplierIds = had;
        after.supplierIds = nextSuppliers;
      }

      if (Object.keys(after).length === 0) return;
      await tx.rfq.update({ where: { id: rfq.id }, data });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'UPDATE',
          entityType: 'Rfq',
          entityId: rfq.id,
          before: before as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
        },
      });
    });
    // The same shape as GET /rfqs/:id.
    return RfqService.getById(input.id);
  },

  /**
   * Sends a draft: it is issued today and closes on the date given, or four
   * days later. Its lines and suppliers are checked again as it goes out, as
   * an order's are when submitted: an item or supplier may have been made
   * inactive, or its project closed, since it was raised.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is a draft;
   * VALIDATION_ERROR with no supplier to ask, a closing date before today,
   * or as for create.
   */
  async send(id: string, input: { closingDate?: string }, actorId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM rfqs WHERE id = ${id} FOR UPDATE`;
      const rfq = await tx.rfq.findUnique({ where: { id }, include: { lines: true, suppliers: true } });
      if (!rfq) throw Errors.notFound('Rfq');
      if (rfq.status !== 'DRAFT') {
        throw Errors.invalidState(`Request for quotation ${rfq.number} is ${rfq.status.toLowerCase()}, so it can't be sent`, { status: rfq.status });
      }
      if (rfq.suppliers.length === 0) throw Errors.validation(`Add at least one supplier to ask before sending ${rfq.number}`);
      if (rfq.projectNumber) await openProjectName(rfq.projectNumber, tx);
      await checkLines(rfq.lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity.toNumber() })), rfq.projectNumber, tx);
      await checkSuppliers(rfq.suppliers.map((s) => s.supplierId), tx);
      const issued = todayInSouthAfrica();
      const closing = input.closingDate ?? addDays(issued, DEFAULT_CLOSING_DAYS);
      checkClosingDate(closing, issued);
      const now = new Date();
      await tx.rfq.update({
        where: { id },
        data: { status: 'SENT', issuedAt: asDate(issued), closingDate: asDate(closing), sentAt: now, sentById: actorId },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'RFQ_SEND',
          entityType: 'Rfq',
          entityId: id,
          before: { status: rfq.status },
          after: { status: 'SENT', issuedAt: issued, closingDate: closing, supplierIds: rfq.suppliers.map((s) => s.supplierId) },
        },
      });
    });
    return RfqService.getById(id);
  },

  /**
   * Cancels a draft or a sent RFQ, with the reason kept on it.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE once it is awarded or cancelled.
   */
  async cancel(id: string, reason: string, actorId: string) {
    const why = cleanText(reason);
    if (!why) throw Errors.validation('Give a reason for cancelling');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM rfqs WHERE id = ${id} FOR UPDATE`;
      const rfq = await tx.rfq.findUnique({ where: { id } });
      if (!rfq) throw Errors.notFound('Rfq');
      if (rfq.status !== 'DRAFT' && rfq.status !== 'SENT') {
        throw Errors.invalidState(`Request for quotation ${rfq.number} is ${rfq.status.toLowerCase()}, so it can't be cancelled`, { status: rfq.status });
      }
      await tx.rfq.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actorId, cancellationReason: why },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'RFQ_CANCEL',
          entityType: 'Rfq',
          entityId: id,
          before: { status: rfq.status },
          after: { status: 'CANCELLED', reason: why },
        },
      });
    });
    return RfqService.getById(id);
  },

  /**
   * Records a supplier's quote, or corrects one already recorded: a unit
   * price per line they priced (a line they don't offer is left out), their
   * reference, when it came in (today unless given), how long it holds and
   * their lead time. A supplier who had declined has now quoted.
   *
   * @throws {ApiError} NOT_FOUND for the RFQ or a supplier it didn't ask;
   * INVALID_STATE unless it is sent; VALIDATION_ERROR for no price, a line
   * not on the RFQ, or a day that doesn't exist or is still to come.
   */
  async recordQuote(rfqId: string, supplierId: string, input: RecordQuoteInput, actorId: string) {
    const today = todayInSouthAfrica();
    const quotedAt = input.quotedAt ?? today;
    checkDay(quotedAt);
    if (quotedAt > today) throw Errors.validation(`${quotedAt} is still to come: record the day the quote came in`);
    if (input.validUntil) {
      checkDay(input.validUntil);
      if (input.validUntil < quotedAt) throw Errors.validation(`A quote received on ${quotedAt} can't be valid only until ${input.validUntil}: check the date`);
    }
    if (input.prices.length === 0) throw Errors.validation('Price at least one line, or mark the supplier as declined');
    await prisma.$transaction(async (tx) => {
      const { rfq, asked } = await quotable(rfqId, supplierId, tx);
      const lineIds = new Set(rfq.lines.map((l) => l.id));
      const strange = input.prices.find((p) => !lineIds.has(p.rfqLineId));
      if (strange) throw Errors.validation(`Line ${strange.rfqLineId} is not on ${rfq.number}`);
      // One price per line: a line sent twice keeps the last.
      const prices = [...new Map(input.prices.map((p) => [p.rfqLineId, p.unitPrice])).entries()];
      await tx.rfqQuotePrice.deleteMany({ where: { rfqSupplierId: asked.id } });
      await tx.rfqQuotePrice.createMany({ data: prices.map(([rfqLineId, unitPrice]) => ({ rfqSupplierId: asked.id, rfqLineId, unitPrice })) });
      const quotedIn = (await tx.supplier.findUnique({ where: { id: supplierId }, select: { currency: true } }))?.currency ?? 'ZAR';
      await tx.rfqSupplier.update({
        where: { id: asked.id },
        data: {
          declined: false,
          currency: quotedIn,
          quotedAt: asDate(quotedAt),
          quoteReference: cleanText(input.quoteReference),
          validUntil: input.validUntil ? asDate(input.validUntil) : null,
          leadTime: cleanText(input.leadTime),
          notes: cleanText(input.notes),
        },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: asked.quotedAt ? 'RFQ_QUOTE_CORRECTED' : 'RFQ_QUOTE',
          entityType: 'Rfq',
          entityId: rfq.id,
          // The whole quote it replaces, so the Activity can say what changed.
          before: asked.quotedAt || asked.declined ? quoteForLog(asked) : Prisma.DbNull,
          after: {
            supplierId, declined: false, quoteReference: cleanText(input.quoteReference), quotedAt, validUntil: input.validUntil ?? null,
            leadTime: cleanText(input.leadTime), notes: cleanText(input.notes),
            prices: prices.map(([rfqLineId, unitPrice]) => ({ rfqLineId, unitPrice: String(unitPrice) })),
          } as Prisma.InputJsonValue,
        },
      });
    });
    return RfqService.getById(rfqId);
  },

  /**
   * Records that a supplier won't quote. A quote recorded for them before is
   * set aside: its prices go; a quotation file attached stays.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is sent.
   */
  async decline(rfqId: string, supplierId: string, input: { notes?: string | null }, actorId: string) {
    await prisma.$transaction(async (tx) => {
      const { rfq, asked } = await quotable(rfqId, supplierId, tx);
      await tx.rfqQuotePrice.deleteMany({ where: { rfqSupplierId: asked.id } });
      await tx.rfqSupplier.update({
        where: { id: asked.id },
        data: { declined: true, quotedAt: null, quoteReference: null, validUntil: null, leadTime: null, currency: null, notes: cleanText(input.notes) },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'RFQ_DECLINED', entityType: 'Rfq', entityId: rfq.id,
          // A quote it sets aside is kept here, as it was.
          before: asked.quotedAt || asked.declined ? quoteForLog(asked) : Prisma.DbNull,
          after: { supplierId, declined: true, notes: cleanText(input.notes) } as Prisma.InputJsonValue,
        },
      });
    });
    return RfqService.getById(rfqId);
  },

  /**
   * Keeps the supplier's own quotation PDF with their quote, replacing one
   * kept before. The RFQ sheet asks for quotes back as PDF.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is sent;
   * VALIDATION_ERROR for an empty file or one that isn't a PDF.
   */
  async putQuoteFile(rfqId: string, supplierId: string, file: { fileName: string; data: Buffer }, actorId: string) {
    if (file.data.length === 0) throw Errors.validation('The file is empty');
    if (file.data.subarray(0, 5).toString('latin1') !== '%PDF-') throw Errors.validation('Attach the quotation as a PDF');
    const fileName = cleanFileName(file.fileName);
    await prisma.$transaction(async (tx) => {
      const { rfq, asked } = await quotable(rfqId, supplierId, tx);
      const data = { fileName, size: file.data.length, data: new Uint8Array(file.data), uploadedById: actorId, uploadedAt: new Date() };
      await tx.rfqQuoteFile.upsert({ where: { rfqSupplierId: asked.id }, create: { rfqSupplierId: asked.id, ...data }, update: data });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'RFQ_QUOTE_FILE', entityType: 'Rfq', entityId: rfq.id, after: { supplierId, fileName, size: file.data.length } },
      });
    });
    return RfqService.getById(rfqId);
  },

  /** The supplier's quotation PDF as it was attached. @throws {ApiError} NOT_FOUND when there is none. */
  async getQuoteFile(rfqId: string, supplierId: string) {
    const asked = await prisma.rfqSupplier.findUnique({
      where: { rfqId_supplierId: { rfqId, supplierId } },
      select: { quoteFile: { select: { fileName: true, data: true } } },
    });
    if (!asked?.quoteFile) throw Errors.notFound('Quotation file');
    return { fileName: asked.quoteFile.fileName, data: Buffer.from(asked.quoteFile.data) };
  },

  /** Takes the quotation PDF off, as when the wrong file was attached. */
  async removeQuoteFile(rfqId: string, supplierId: string, actorId: string) {
    await prisma.$transaction(async (tx) => {
      const { rfq, asked } = await quotable(rfqId, supplierId, tx);
      const removed = await tx.rfqQuoteFile.deleteMany({ where: { rfqSupplierId: asked.id } });
      if (removed.count === 0) throw Errors.notFound('Quotation file');
      await tx.auditLogEntry.create({
        data: { actorId, action: 'RFQ_QUOTE_FILE_REMOVED', entityType: 'Rfq', entityId: rfq.id, after: { supplierId } },
      });
    });
    return RfqService.getById(rfqId);
  },

  /**
   * Awards the RFQ to one supplier who quoted: a draft purchase order for
   * them, with the RFQ's project, penalties and lines at their quoted prices,
   * saved together with the award or not at all. It then goes through
   * approval as any order does. A reason is needed when the award isn't the
   * clear choice (see awardConcerns), and is kept on the Activity.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is sent;
   * VALIDATION_ERROR for a supplier who hasn't quoted, a missing reason, or
   * what the order itself refuses (an inactive supplier or item, a closed project).
   */
  async award(rfqId: string, input: { supplierId: string; reason?: string | null }, actorId: string) {
    const vatSetting = Number(await SettingsService.getValue<number>('purchaseOrders.vatRate')) || 0;
    const today = todayInSouthAfrica();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM rfqs WHERE id = ${rfqId} FOR UPDATE`;
      const rfq = await tx.rfq.findUnique({
        where: { id: rfqId },
        include: { lines: { orderBy: { lineNo: 'asc' } }, suppliers: { include: { supplier: true, prices: true } } },
      });
      if (!rfq) throw Errors.notFound('Rfq');
      if (rfq.status !== 'SENT') {
        throw Errors.invalidState(`Request for quotation ${rfq.number} is ${rfq.status.toLowerCase()}, so it can't be awarded`, { status: rfq.status });
      }
      const asked = rfq.suppliers.find((s) => s.supplierId === input.supplierId);
      if (!asked) throw Errors.notFound('Supplier on this request for quotation');
      if (!asked.quotedAt || asked.declined) throw Errors.validation(`${asked.supplier.name} hasn't quoted, so the RFQ can't be awarded to them`);
      // The order is priced in the supplier's currency now; their quote must have been given in it.
      const supplierCurrency = asked.supplier.currency ?? 'ZAR';
      if (asked.currency && asked.currency !== supplierCurrency) {
        throw Errors.validation(`${asked.supplier.name} quoted in ${asked.currency} but now trades in ${supplierCurrency}. Record their quote again in ${supplierCurrency} before awarding.`);
      }

      const quotes: QuoteForAward[] = rfq.suppliers.map((s) => {
        const currency = s.currency ?? s.supplier.currency ?? 'ZAR';
        const priced = rfq.lines.map((l) => ({ orderedQty: l.quantity, unitPrice: s.prices.find((p) => p.rfqLineId === l.id)?.unitPrice ?? null }));
        const totals = orderTotals(priced, defaultVatRate(currency, vatSetting));
        const quoted = !!s.quotedAt && !s.declined;
        return {
          supplierId: s.supplierId, name: s.supplier.name, currency, quoted,
          net: quoted ? totals.net : null, unpricedLines: totals.unpricedLines, validUntil: dayOf(s.validUntil),
        };
      });
      const concerns = awardConcerns(quotes, asked.supplierId, today);
      const reason = cleanText(input.reason);
      if (concerns.length > 0 && !reason) {
        throw Errors.validation(`Say why you are awarding to ${asked.supplier.name}: ${concerns.join('; ')}.`, { concerns });
      }

      // The supplier's quotation is what the order is placed against.
      const notes = [
        `As per your quotation${asked.quoteReference ? ` ${asked.quoteReference}` : ''} for ${rfq.number}.`,
        rfq.notes,
      ].filter(Boolean).join('\n');
      const po = await PurchaseOrderService.create({
        supplierId: asked.supplierId,
        projectNumber: rfq.projectNumber,
        penaltiesApply: rfq.penaltiesApply,
        notes,
        lines: rfq.lines.map((l) => {
          const price = asked.prices.find((p) => p.rfqLineId === l.id)?.unitPrice;
          return { materialId: l.materialId, orderedQty: l.quantity.toNumber(), ...(price ? { unitPrice: price.toNumber() } : {}) };
        }),
      }, actorId, { within: tx, fromRfq: { id: rfq.id, number: rfq.number } });

      await tx.rfq.update({
        where: { id: rfq.id },
        data: { status: 'AWARDED', awardedAt: new Date(), awardedById: actorId, purchaseOrderId: po.id },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'RFQ_AWARD',
          entityType: 'Rfq',
          entityId: rfq.id,
          before: { status: 'SENT' },
          after: {
            status: 'AWARDED', supplierId: asked.supplierId, purchaseOrderId: po.id, purchaseOrderNumber: po.number,
            reason, concerns,
          } as Prisma.InputJsonValue,
        },
      });
    });
    return RfqService.getById(rfqId);
  },

  /** The RFQ's Activity, newest first, each entry with the name of who did it. */
  async history(id: string) {
    if (!(await prisma.rfq.findUnique({ where: { id }, select: { id: true } }))) throw Errors.notFound('Rfq');
    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Rfq', entityId: id },
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
