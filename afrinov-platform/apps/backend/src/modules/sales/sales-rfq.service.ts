// Sales requests for quotation: what the Sales team asks suppliers to price when
// costing a job, on the same AFRI-02A-xxxx-02-01 sheet as Procurement's RFQs.
//
// State machine: DRAFT → SENT, or CANCELLED from either. A draft is raised,
// edited and sent; once sent, only its closing date moves and suppliers who were
// missed are added, and each supplier's quote is recorded, with their PDF, or
// their decline. Nothing is awarded: the quotes are there to compare, here and
// against Procurement's on the savings report.
//
// Lines are typed as the sheet has them ("200NB pipes x 3m"), not picked from
// the catalogue, as Sales prices cut lengths nobody stocks. The rules shared with
// Procurement's RFQs (days, closing dates, suppliers, projects, quote totals)
// come from rfq.service.ts. Every change is written to the audit log (entity type
// SalesRfq) for its Activity.
import { Prisma, type SalesRfqStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { checkQuantityForUnit, checkUnitOfMeasure } from '../../shared/units.js';
import { SettingsService } from '../settings/settings.service.js';
import { cleanText } from '../procurement/supplier-fields.js';
import {
  DEFAULT_CLOSING_DAYS, addDays, asDate, askedInOrder, checkClosingDate, checkDay, checkSuppliers, cleanFileName, dayOf, generateRfqNumber, isClosed,
  openProjectName, person, quoteForLog, rfqActivity, todayInSouthAfrica, withQuoteTotals,
  type RecordQuoteInput,
} from '../procurement/rfq.service.js';

export interface SalesRfqLineInput { description: string; unitOfMeasure: string; quantity: number }

export interface CreateSalesRfqInput {
  projectNumber: string;
  /** Left out: the project's name, as the sheet takes it from the enquiry. */
  description?: string | null;
  notes?: string | null;
  penaltiesApply?: boolean;
  lines: SalesRfqLineInput[];
  /** The suppliers to ask; more can be added until it is sent. */
  supplierIds?: string[];
}

/** Fields left out are unchanged; lines and suppliers, when sent, replace the draft's. */
export interface UpdateSalesRfqInput {
  id: string;
  projectNumber?: string;
  description?: string | null;
  notes?: string | null;
  penaltiesApply?: boolean;
  lines?: SalesRfqLineInput[];
  supplierIds?: string[];
  /** YYYY-MM-DD. Only once it is sent, when it and adding suppliers are all that can change. */
  closingDate?: string;
}

const SENT_FIELDS = ['projectNumber', 'description', 'notes', 'penaltiesApply', 'lines'] as const;

/** The lines as they are kept: a description, a unit on the list, and a whole number of a counted unit. */
async function checkedLines(lines: SalesRfqLineInput[], tx: Prisma.TransactionClient) {
  if (lines.length === 0) throw Errors.validation('A request for quotation needs at least one line');
  const rows: Array<{ lineNo: number; description: string; unitOfMeasure: string; quantity: number }> = [];
  for (const [i, line] of lines.entries()) {
    const description = cleanText(line.description);
    if (!description) throw Errors.validation(`Line ${i + 1} needs a description`);
    const unit = await checkUnitOfMeasure(line.unitOfMeasure, tx);
    checkQuantityForUnit(description, unit, line.quantity, `lines.${i}.quantity`);
    rows.push({ lineNo: i + 1, description, unitOfMeasure: unit.code, quantity: line.quantity });
  }
  return rows;
}

const linesForLog = (lines: Array<{ description: string; unitOfMeasure: string; quantity: Prisma.Decimal | number }>) =>
  lines.map((l) => ({ description: l.description, unitOfMeasure: l.unitOfMeasure, quantity: String(l.quantity) }));

/**
 * The sent RFQ and the supplier asked, held for the change: quotes are recorded
 * only while it is out with suppliers.
 */
async function quotable(rfqId: string, supplierId: string, tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT id FROM sales_rfqs WHERE id = ${rfqId} FOR UPDATE`;
  const rfq = await tx.salesRfq.findUnique({ where: { id: rfqId }, include: { lines: { select: { id: true } } } });
  if (!rfq) throw Errors.notFound('Sales RFQ');
  if (rfq.status !== 'SENT') {
    throw Errors.invalidState(rfq.status === 'DRAFT'
      ? `${rfq.number} hasn't been sent yet, so there are no quotes to record`
      : `Sales RFQ ${rfq.number} is cancelled, so its quotes can no longer change`, { status: rfq.status });
  }
  const asked = await tx.salesRfqSupplier.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId } }, include: { prices: true } });
  if (!asked) throw Errors.notFound('Supplier on this Sales RFQ');
  return { rfq, asked };
}

/** Once sent, only the closing date moves and a supplier who was missed is added; nobody already asked is taken off. */
async function editSent(
  rfq: { id: string; number: string; issuedAt: Date | null; closingDate: Date | null; suppliers: Array<{ supplierId: string }> },
  input: UpdateSalesRfqInput,
  actorId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const fixed = SENT_FIELDS.find((k) => input[k] !== undefined);
  if (fixed) throw Errors.invalidState(`${rfq.number} has been sent, so only its closing date and the suppliers asked can change`, { field: fixed });
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (input.closingDate !== undefined && input.closingDate !== dayOf(rfq.closingDate)) {
    checkClosingDate(input.closingDate, dayOf(rfq.issuedAt) ?? todayInSouthAfrica());
    await tx.salesRfq.update({ where: { id: rfq.id }, data: { closingDate: asDate(input.closingDate) } });
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
    // since been deactivated stays on it.
    const added = await checkSuppliers(next.filter((s) => !had.includes(s)), tx);
    if (added.length > 0) {
      await tx.salesRfqSupplier.createMany({ data: askedInOrder(added).map((row) => ({ rfqId: rfq.id, ...row })) });
      before.supplierIds = had;
      after.supplierIds = [...had, ...added];
    }
  }
  if (Object.keys(after).length === 0) return;
  await tx.auditLogEntry.create({
    data: { actorId, action: 'UPDATE', entityType: 'SalesRfq', entityId: rfq.id, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue },
  });
}

const DETAIL = {
  project: { select: { projectNumber: true, name: true } },
  createdBy: person,
  sentBy: person,
  cancelledBy: person,
  lines: { orderBy: { lineNo: 'asc' } },
  suppliers: {
    // The quotation file's details, never its contents: those are downloaded on their own.
    include: { supplier: true, prices: true, quoteFile: { select: { fileName: true, size: true, uploadedAt: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SalesRfqInclude;

export const SalesRfqService = {
  async list(filter: { status?: SalesRfqStatus; projectNumber?: string } = {}) {
    const today = todayInSouthAfrica();
    const rfqs = await prisma.salesRfq.findMany({
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
    const rfq = await prisma.salesRfq.findUnique({ where: { id }, include: DETAIL });
    if (!rfq) throw Errors.notFound('Sales RFQ');
    const vatSetting = Number(await SettingsService.getValue<number>('purchaseOrders.vatRate')) || 0;
    return { ...rfq, closed: isClosed(rfq), suppliers: rfq.suppliers.map((s) => withQuoteTotals(s, rfq.lines, vatSetting)) };
  },

  /**
   * Creates a numbered draft with its lines and the suppliers to ask.
   *
   * @throws {ApiError} VALIDATION_ERROR for a missing or closed project, no
   * lines, a line without a description, a unit not on the list, part of a
   * counted unit, or a missing or inactive supplier.
   */
  async create(input: CreateSalesRfqInput, actorId: string) {
    const projectNumber = cleanText(input.projectNumber);
    if (!projectNumber) throw Errors.validation('A Sales RFQ is for one project: choose its project.');
    const id = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:rfq-number'))`;
      const projectName = await openProjectName(projectNumber, tx);
      const lines = await checkedLines(input.lines, tx);
      const supplierIds = await checkSuppliers(input.supplierIds ?? [], tx);
      const number = await generateRfqNumber(tx, projectNumber);
      const rfq = await tx.salesRfq.create({
        data: {
          number,
          status: 'DRAFT',
          projectNumber,
          description: input.description === undefined ? projectName : cleanText(input.description),
          notes: cleanText(input.notes),
          penaltiesApply: input.penaltiesApply ?? false,
          createdById: actorId,
          lines: { create: lines },
          suppliers: { create: askedInOrder(supplierIds) },
        },
      });
      // Everything it was raised with, so the Activity starts from the whole draft.
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'SalesRfq',
          entityId: rfq.id,
          after: {
            number, status: rfq.status, projectNumber, description: rfq.description, notes: rfq.notes,
            penaltiesApply: rfq.penaltiesApply, lines: linesForLog(lines), supplierIds,
          } as Prisma.InputJsonValue,
        },
      });
      return rfq.id;
    });
    return SalesRfqService.getById(id);
  },

  /**
   * Changes a draft. Moving it to another project gives it that project's next
   * number: nobody outside has seen a draft's number yet. Only what changed is
   * logged.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE once it is cancelled; VALIDATION_ERROR as for create.
   */
  async update(input: UpdateSalesRfqInput, actorId: string) {
    await prisma.$transaction(async (tx) => {
      // The number lock first, then the row, as create takes them.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:rfq-number'))`;
      await tx.$executeRaw`SELECT id FROM sales_rfqs WHERE id = ${input.id} FOR UPDATE`;
      const rfq = await tx.salesRfq.findUnique({ where: { id: input.id }, include: { lines: { orderBy: { lineNo: 'asc' } }, suppliers: true } });
      if (!rfq) throw Errors.notFound('Sales RFQ');
      if (rfq.status === 'SENT') {
        await editSent(rfq, input, actorId, tx);
        return;
      }
      if (rfq.status !== 'DRAFT') throw Errors.invalidState(`Sales RFQ ${rfq.number} is cancelled, so it can no longer be edited`, { status: rfq.status });
      if (input.closingDate !== undefined) throw Errors.validation('The closing date is set when the Sales RFQ is sent');

      const data: Record<string, string | boolean | null> = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const change = (key: 'description' | 'notes' | 'penaltiesApply' | 'projectNumber' | 'number', next: string | boolean | null) => {
        if (rfq[key] === next) return;
        data[key] = next;
        before[key] = rfq[key];
        after[key] = next;
      };
      if (input.projectNumber !== undefined) {
        const projectNumber = cleanText(input.projectNumber);
        if (!projectNumber) throw Errors.validation('A Sales RFQ is for one project: choose its project.');
        if (projectNumber !== rfq.projectNumber) {
          const projectName = await openProjectName(projectNumber, tx);
          change('projectNumber', projectNumber);
          change('number', await generateRfqNumber(tx, projectNumber));
          // A description that was the old project's name follows the project; one Sales wrote stays.
          if (input.description === undefined) {
            const oldName = cleanText((await tx.project.findUnique({ where: { projectNumber: rfq.projectNumber }, select: { name: true } }))?.name);
            if (oldName && rfq.description === oldName) change('description', projectName);
          }
        }
      }
      if (input.description !== undefined) change('description', cleanText(input.description));
      if (input.notes !== undefined) change('notes', cleanText(input.notes));
      if (input.penaltiesApply !== undefined) change('penaltiesApply', input.penaltiesApply);

      if (input.lines !== undefined) {
        const lines = await checkedLines(input.lines, tx);
        if (JSON.stringify(linesForLog(lines)) !== JSON.stringify(linesForLog(rfq.lines.map((l) => ({ ...l, quantity: l.quantity.toNumber() }))))) {
          await tx.salesRfqLine.deleteMany({ where: { rfqId: rfq.id } });
          await tx.salesRfqLine.createMany({ data: lines.map((l) => ({ ...l, rfqId: rfq.id })) });
          before.lines = linesForLog(rfq.lines);
          after.lines = linesForLog(lines);
        }
      }

      const had = rfq.suppliers.map((s) => s.supplierId);
      const nextSuppliers = input.supplierIds === undefined ? had : await checkSuppliers(input.supplierIds, tx);
      const removed = had.filter((s) => !nextSuppliers.includes(s));
      const added = nextSuppliers.filter((s) => !had.includes(s));
      if (removed.length > 0) await tx.salesRfqSupplier.deleteMany({ where: { rfqId: rfq.id, supplierId: { in: removed } } });
      if (added.length > 0) await tx.salesRfqSupplier.createMany({ data: askedInOrder(added).map((row) => ({ rfqId: rfq.id, ...row })) });
      if (removed.length > 0 || added.length > 0) {
        before.supplierIds = had;
        after.supplierIds = nextSuppliers;
      }

      if (Object.keys(after).length === 0) return;
      await tx.salesRfq.update({ where: { id: rfq.id }, data });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'UPDATE', entityType: 'SalesRfq', entityId: rfq.id, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue },
      });
    });
    return SalesRfqService.getById(input.id);
  },

  /**
   * Marks a draft sent: it is issued today and closes on the date given, or four
   * days later. Its project and suppliers are checked again as it goes out.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is a draft;
   * VALIDATION_ERROR with no supplier to ask or a closing date before today.
   */
  async send(id: string, input: { closingDate?: string }, actorId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM sales_rfqs WHERE id = ${id} FOR UPDATE`;
      const rfq = await tx.salesRfq.findUnique({ where: { id }, include: { suppliers: true } });
      if (!rfq) throw Errors.notFound('Sales RFQ');
      if (rfq.status !== 'DRAFT') throw Errors.invalidState(`Sales RFQ ${rfq.number} is ${rfq.status.toLowerCase()}, so it can't be sent`, { status: rfq.status });
      if (rfq.suppliers.length === 0) throw Errors.validation(`Add at least one supplier to ask before sending ${rfq.number}`);
      await openProjectName(rfq.projectNumber, tx);
      await checkSuppliers(rfq.suppliers.map((s) => s.supplierId), tx);
      const issued = todayInSouthAfrica();
      const closing = input.closingDate ?? addDays(issued, DEFAULT_CLOSING_DAYS);
      checkClosingDate(closing, issued);
      await tx.salesRfq.update({
        where: { id },
        data: { status: 'SENT', issuedAt: asDate(issued), closingDate: asDate(closing), sentAt: new Date(), sentById: actorId },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'RFQ_SEND', entityType: 'SalesRfq', entityId: id,
          before: { status: rfq.status },
          after: { status: 'SENT', issuedAt: issued, closingDate: closing, supplierIds: rfq.suppliers.map((s) => s.supplierId) },
        },
      });
    });
    return SalesRfqService.getById(id);
  },

  /** Cancels a draft or a sent RFQ, with the reason kept on it. @throws {ApiError} NOT_FOUND; INVALID_STATE once cancelled. */
  async cancel(id: string, reason: string, actorId: string) {
    const why = cleanText(reason);
    if (!why) throw Errors.validation('Give a reason for cancelling');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM sales_rfqs WHERE id = ${id} FOR UPDATE`;
      const rfq = await tx.salesRfq.findUnique({ where: { id } });
      if (!rfq) throw Errors.notFound('Sales RFQ');
      if (rfq.status === 'CANCELLED') throw Errors.invalidState(`Sales RFQ ${rfq.number} is already cancelled`, { status: rfq.status });
      await tx.salesRfq.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actorId, cancellationReason: why } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'RFQ_CANCEL', entityType: 'SalesRfq', entityId: id, before: { status: rfq.status }, after: { status: 'CANCELLED', reason: why } },
      });
    });
    return SalesRfqService.getById(id);
  },

  /**
   * Records a supplier's quote, or corrects one already recorded: a unit price
   * per line they priced (a line they don't offer is left out), their reference,
   * when it came in (today unless given), how long it holds and their lead time.
   *
   * @throws {ApiError} NOT_FOUND for the RFQ or a supplier it didn't ask;
   * INVALID_STATE unless it is sent; VALIDATION_ERROR for no price, a line not on
   * the RFQ, or a day that doesn't exist or is still to come.
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
      await tx.salesRfqQuotePrice.deleteMany({ where: { rfqSupplierId: asked.id } });
      await tx.salesRfqQuotePrice.createMany({ data: prices.map(([rfqLineId, unitPrice]) => ({ rfqSupplierId: asked.id, rfqLineId, unitPrice })) });
      const quotedIn = (await tx.supplier.findUnique({ where: { id: supplierId }, select: { currency: true } }))?.currency ?? 'ZAR';
      await tx.salesRfqSupplier.update({
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
          entityType: 'SalesRfq',
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
    return SalesRfqService.getById(rfqId);
  },

  /** Records that a supplier won't quote; a quote recorded before is set aside. @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is sent. */
  async decline(rfqId: string, supplierId: string, input: { notes?: string | null }, actorId: string) {
    await prisma.$transaction(async (tx) => {
      const { rfq, asked } = await quotable(rfqId, supplierId, tx);
      await tx.salesRfqQuotePrice.deleteMany({ where: { rfqSupplierId: asked.id } });
      await tx.salesRfqSupplier.update({
        where: { id: asked.id },
        data: { declined: true, quotedAt: null, quoteReference: null, validUntil: null, leadTime: null, currency: null, notes: cleanText(input.notes) },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'RFQ_DECLINED', entityType: 'SalesRfq', entityId: rfq.id,
          before: asked.quotedAt || asked.declined ? quoteForLog(asked) : Prisma.DbNull,
          after: { supplierId, declined: true, notes: cleanText(input.notes) } as Prisma.InputJsonValue,
        },
      });
    });
    return SalesRfqService.getById(rfqId);
  },

  /**
   * Keeps the supplier's returned sheet or quotation with their quote, replacing
   * one kept before.
   *
   * @throws {ApiError} NOT_FOUND; INVALID_STATE unless it is sent; VALIDATION_ERROR for an empty file or one that isn't a PDF.
   */
  async putQuoteFile(rfqId: string, supplierId: string, file: { fileName: string; data: Buffer }, actorId: string) {
    if (file.data.length === 0) throw Errors.validation('The file is empty');
    if (file.data.subarray(0, 5).toString('latin1') !== '%PDF-') throw Errors.validation('Attach the quotation as a PDF');
    const fileName = cleanFileName(file.fileName);
    await prisma.$transaction(async (tx) => {
      const { rfq, asked } = await quotable(rfqId, supplierId, tx);
      const data = { fileName, size: file.data.length, data: new Uint8Array(file.data), uploadedById: actorId, uploadedAt: new Date() };
      await tx.salesRfqQuoteFile.upsert({ where: { rfqSupplierId: asked.id }, create: { rfqSupplierId: asked.id, ...data }, update: data });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'RFQ_QUOTE_FILE', entityType: 'SalesRfq', entityId: rfq.id, after: { supplierId, fileName, size: file.data.length } },
      });
    });
    return SalesRfqService.getById(rfqId);
  },

  /** The quotation PDF as it was attached. @throws {ApiError} NOT_FOUND when there is none. */
  async getQuoteFile(rfqId: string, supplierId: string) {
    const asked = await prisma.salesRfqSupplier.findUnique({
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
      const removed = await tx.salesRfqQuoteFile.deleteMany({ where: { rfqSupplierId: asked.id } });
      if (removed.count === 0) throw Errors.notFound('Quotation file');
      await tx.auditLogEntry.create({
        data: { actorId, action: 'RFQ_QUOTE_FILE_REMOVED', entityType: 'SalesRfq', entityId: rfq.id, after: { supplierId } },
      });
    });
    return SalesRfqService.getById(rfqId);
  },

  /** Its Activity, newest first. */
  async history(id: string) {
    if (!(await prisma.salesRfq.findUnique({ where: { id }, select: { id: true } }))) throw Errors.notFound('Sales RFQ');
    return rfqActivity('SalesRfq', id);
  },
};
