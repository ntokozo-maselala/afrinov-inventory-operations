// Requests for quotation (RFQ roadmap, Phase 1), as the RFQ sheet of the
// AFRI-02A-xxxx-02-01 Manhours and Material workbook: the lines to price (item,
// units, quantity), the suppliers asked to quote, and each supplier's quote
// once it comes back.
//
// State machine: DRAFT → SENT → AWARDED, or CANCELLED from DRAFT or SENT.
// This phase raises and edits drafts; sending, quotes and the award follow.
//
// An RFQ is for a project or for Stores, as an order is, and holds a project's
// material only for that project. Every change is written to the audit log
// (entity type Rfq) for the RFQ's Activity.
import { Prisma, type RfqStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { SettingsService } from '../settings/settings.service.js';
import { checkProjectMaterial, refuseUnassigned } from '../inventory/material-section.js';
import { cleanText } from './supplier-fields.js';
import { defaultVatRate, orderTotals } from './po-pricing.js';
import { assertProjectOpen } from './procurement.service.js';

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
}

type Db = Prisma.TransactionClient | typeof prisma;

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

/** Refuses missing or inactive items, project material with no project, and another project's material. */
async function checkLines(lines: RfqLineInput[], projectNumber: string | null, db: Db): Promise<void> {
  if (lines.length === 0) throw Errors.validation('A request for quotation needs at least one line');
  const ids = [...new Set(lines.map((l) => l.materialId))];
  const materials = await db.material.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, active: true, category: true, projectNumber: true },
  });
  const missing = ids.find((id) => !materials.some((m) => m.id === id));
  if (missing) throw Errors.validation(`Material ${missing} does not exist`);
  const inactive = materials.find((m) => !m.active);
  if (inactive) throw Errors.validation(`${inactive.sku} is inactive, so it can't be quoted for`);
  for (const m of materials) refuseUnassigned(m, 'ordered');
  checkProjectMaterial(projectNumber, materials, 'ordered');
}

/** The suppliers to ask, each once; missing or inactive ones are refused. */
async function checkSuppliers(supplierIds: string[], db: Db): Promise<string[]> {
  const ids = [...new Set(supplierIds.map((s) => s.trim()))];
  if (ids.length === 0) return [];
  const suppliers = await db.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, active: true } });
  const missing = ids.find((id) => !suppliers.some((s) => s.id === id));
  if (missing) throw Errors.validation(`Supplier ${missing} does not exist`);
  const inactive = suppliers.find((s) => !s.active);
  if (inactive) throw Errors.validation(`${inactive.name} is inactive. Reactivate the supplier to ask them for a quote.`);
  return ids;
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
  purchaseOrder: { select: { id: true, number: true, status: true } },
  lines: { include: { material: true }, orderBy: { lineNo: 'asc' } },
  suppliers: { include: { supplier: true, prices: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.RfqInclude;

type RfqDetail = Prisma.RfqGetPayload<{ include: typeof DETAIL }>;

/**
 * Each supplier's quote priced as an order would be: per line subtotal, VAT
 * and net from po-pricing, VAT at the setting for rand suppliers and 0% for
 * other currencies. Totals are null until the quote is recorded.
 */
function withQuotes(rfq: RfqDetail, vatSetting: number) {
  return {
    ...rfq,
    suppliers: rfq.suppliers.map((s) => {
      const vatRate = defaultVatRate(s.supplier.currency ?? 'ZAR', vatSetting);
      const priced = rfq.lines.map((l) => ({ orderedQty: l.quantity, unitPrice: s.prices.find((p) => p.rfqLineId === l.id)?.unitPrice ?? null }));
      return { ...s, vatRate, totals: s.quotedAt ? orderTotals(priced, vatRate) : null };
    }),
  };
}

export const RfqService = {
  async list(filter: { status?: RfqStatus; projectNumber?: string } = {}) {
    return prisma.rfq.findMany({
      where: filter,
      include: {
        project: { select: { projectNumber: true, name: true } },
        lines: { select: { id: true } },
        suppliers: { select: { supplierId: true, quotedAt: true, declined: true, supplier: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(id: string) {
    const rfq = await prisma.rfq.findUnique({ where: { id }, include: DETAIL });
    if (!rfq) throw Errors.notFound('Rfq');
    return withQuotes(rfq, Number(await SettingsService.getValue<number>('purchaseOrders.vatRate')) || 0);
  },

  /**
   * Creates a numbered draft with its lines and the suppliers to ask.
   *
   * @throws {ApiError} VALIDATION_ERROR for no lines, a missing or inactive
   * item or supplier, a missing or closed project, unassigned project material,
   * or another project's material.
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
          suppliers: { create: supplierIds.map((supplierId) => ({ supplierId })) },
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
      if (rfq.status !== 'DRAFT') {
        throw Errors.invalidState(`Request for quotation ${rfq.number} is ${rfq.status.toLowerCase()}, so it can no longer be edited`, { status: rfq.status });
      }

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
      if (added.length > 0) await tx.rfqSupplier.createMany({ data: added.map((supplierId) => ({ rfqId: rfq.id, supplierId })) });
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
