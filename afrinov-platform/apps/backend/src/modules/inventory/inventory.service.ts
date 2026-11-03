// InventoryService — the only place allowed to write to inventory_transactions
// and (indirectly via balance recompute) inventory_balances.
//
// All public methods run inside a transaction. ADR-002: balances are derived
// from transactions; we never mutate balances directly. After any transaction
// is committed we synchronously recompute the affected (material, location)
// balance row(s) to keep the read model in sync.
import { randomUUID } from 'node:crypto';
import { Prisma, InventoryTransactionType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { dayRange, pageCursor, parseCursor } from '../../shared/dates.js';
import { dispatchDomainEvents, type DomainEvent } from '../../shared/events.js';
import { toDecimal, gtZero, fitsQuantityColumn, QUANTITY_PRECISION_MESSAGE } from '../../shared/decimal.js';
import { recomputeBalance, getCurrentBalance, lockInventoryBalances } from '../../shared/inventory/balances.js';
import { classifyItem, getStatusBands, needsAttention } from '../../shared/inventory/stock-status.js';
import { SettingsService } from '../settings/settings.service.js';
import { checkProjectMaterial, refuseUnassigned } from './material-section.js';
import { MOVE_TO_STORES_REFERENCE } from './project-leftovers.service.js';
import { loanDatesFor, loanTerms } from './tool-loan-dates.js';
import { currentDueOn, dayOf, daysBetween, dueOnAt, dueOnBefore, type LoanDates } from './tool-loan-terms.js';
import { closedOffAgainst, closedTotal, writeOutcome, LIVE_OUTCOME } from './consumable-outcomes.js';

type Decimal = Prisma.Decimal;

export interface IssueLine {
  materialId: string;
  locationId: string;
  quantity: number | string | Decimal;
  /** The stock it takes: held for the issue's project, or Stores stock (null or left out). */
  heldForProject?: string | null;
}

// One entry at the store counter: one recipient, optionally one project, and
// any number of items. Booked all-or-nothing.
export interface IssueInput {
  recipientId: string;
  projectNumber?: string;
  lines: IssueLine[];
  actorId: string;
}

export interface TransferInput {
  materialId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number | string | Decimal;
  /** Whose stock moves: a project's, kept at both ends, or Stores stock (null or left out). */
  heldForProject?: string | null;
  actorId: string;
}

export interface AdjustmentInput {
  materialId: string;
  locationId: string;
  quantity: number | string | Decimal;
  reasonCode: 'COUNT_VARIANCE' | 'DAMAGE' | 'LOSS' | 'SCRAP' | 'OTHER';
  reasonNote?: string;
  /** Who was responsible (damage, loss or scrap only); naming someone needs a note saying what happened. */
  recipientId?: string | null;
  /** Whose stock is adjusted: a project's, or Stores stock (null or left out). */
  heldForProject?: string | null;
  actorId: string;
}

/** The write-off reasons that record who was responsible, when anyone is known. */
export const RESPONSIBLE_REASONS = ['DAMAGE', 'LOSS', 'SCRAP'] as const;
export const takesResponsible = (reason: string) => (RESPONSIBLE_REASONS as readonly string[]).includes(reason);

export interface ReturnInput {
  issueTransactionId: string;
  quantity: number | string | Decimal;
  /** Where the stock goes back to; defaults to the location it was issued from. */
  locationId?: string;
  reason?: string;
  actorId: string;
}

/**
 * What comes back at the counter, each line against its own issue, booked
 * together. A line can put stock back on the shelf (quantity) and, for an item
 * that tracks use, mark some used up or broken; at least one of the three.
 */
export interface ReturnManyInput {
  lines: Array<{
    issueTransactionId: string;
    quantity?: number | string | Decimal;
    usedUp?: number | string | Decimal;
    broken?: number | string | Decimal;
    locationId?: string;
  }>;
  /** One note for every line. */
  reason?: string;
  actorId: string;
}

/** An issue a recipient can still bring stock back from. Quantities are decimal strings. */
export interface ReturnableLine {
  issueTransactionId: string;
  /** The issue slip the line was on. */
  issueId: string | null;
  postedAt: string;
  materialId: string; sku: string; name: string; unitOfMeasure: string;
  locationId: string; locationName: string; locationActive: boolean;
  projectNumber: string | null;
  /** The item tracks use after issue, so the line also takes used up and broken. */
  trackUse: boolean;
  /** closedOff: marked used up or broken (tracked consumables); outstanding already leaves it out. */
  issued: string; returned: string; closedOff: string; outstanding: string;
}

/** The most issues the returnable list looks at, newest first. */
export const RETURNABLE_LIMIT = 500;

export interface GoodsReceiptPostInput {
  goodsReceiptId: string;
  actorId: string;
}

export async function checkMaterialActive(materialId: string, tx: Prisma.TransactionClient) {
  const m = await tx.material.findUnique({ where: { id: materialId } });
  if (!m) throw Errors.notFound('Material');
  if (!m.active) throw Errors.validation('Material is inactive');
  return m;
}

export async function checkProjectActive(projectNumber: string, tx: Prisma.TransactionClient): Promise<void> {
  const p = await tx.project.findUnique({ where: { projectNumber } });
  if (!p) throw Errors.notFound('Project');
  if (!p.active) throw Errors.validation('Project is inactive');
}

/**
 * Stock is issued only to an open project. A completed or cancelled project
 * takes no more: its leftovers go to Stores and are issued from there.
 * Returns are still accepted from it.
 */
async function checkProjectTakesIssues(projectNumber: string, tx: Prisma.TransactionClient): Promise<void> {
  const p = await tx.project.findUnique({ where: { projectNumber } });
  if (!p) throw Errors.notFound('Project');
  if (!p.active) throw Errors.validation('Project is inactive');
  if (p.status === 'COMPLETED' || p.status === 'CANCELLED') {
    throw Errors.validation(`Project ${projectNumber} is ${p.status === 'COMPLETED' ? 'completed' : 'cancelled'}, so no more stock is issued to it.`);
  }
}

/** Stock can be held only for a project that exists (the ledger's foreign key, said plainly). */
async function checkProjectExists(projectNumber: string, tx: Prisma.TransactionClient): Promise<void> {
  if (!(await tx.project.findUnique({ where: { projectNumber }, select: { projectNumber: true } }))) throw Errors.notFound('Project');
}


async function lockPurchaseOrderLines(lineIds: string[], tx: Prisma.TransactionClient): Promise<void> {
  for (const lineId of [...new Set(lineIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`afrinov:purchase-order-line:${lineId}`}))`;
  }
}

export async function returnedAgainst(issueId: string, tx: Pick<Prisma.TransactionClient, 'inventoryTransaction'>): Promise<Decimal> {
  const agg = await tx.inventoryTransaction.aggregate({
    where: { type: InventoryTransactionType.RETURN, referenceType: 'Return', referenceId: issueId },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? toDecimal(0);
}

/**
 * Book what came back against one issue, inside the caller's transaction:
 * `qty` back on the shelf and, for an item that tracks use, `usedUp` and
 * `broken` (ADR-026). Checks it is an unreversed issue with at least their
 * total still out (issued, less what came back and what was marked used up or
 * broken before), then posts the RETURN (keeping the issue's recipient and
 * project) and updates the balance, and writes each outcome; each is audited.
 * Used up and broken move no stock.
 */
async function bookReturn(tx: Prisma.TransactionClient, input: {
  issueTransactionId: string; qty: Decimal; usedUp?: Decimal; broken?: Decimal; locationId?: string; reason?: string; actorId: string; postedAt: Date;
}): Promise<{ transactionId: string | null; outcomeIds: string[]; materialId: string; locationId: string; issued: Decimal; alreadyReturned: Decimal; closedOff: Decimal }> {
  const usedUp = input.usedUp ?? toDecimal(0);
  const broken = input.broken ?? toDecimal(0);
  // Each is stored to four decimal places; a finer one would be stored rounded, even as zero.
  if (![input.qty, usedUp, broken].every(fitsQuantityColumn)) throw Errors.validation(QUANTITY_PRECISION_MESSAGE);
  const marking = gtZero(usedUp) || gtZero(broken);
  const restocking = gtZero(input.qty);
  const issue = await tx.inventoryTransaction.findUnique({
    where: { id: input.issueTransactionId },
    include: { reversedBy: { select: { id: true } }, material: { select: { sku: true, trackUse: true } } },
  });
  if (!issue) throw Errors.notFound('InventoryTransaction');
  if (issue.type !== InventoryTransactionType.ISSUE || issue.reversesId) {
    throw Errors.invalidState('Only an issue can have stock returned against it.');
  }
  if (issue.reversedBy) throw Errors.invalidState(`This issue of ${issue.material.sku} has been reversed, so there is nothing to return.`);
  if (marking && !issue.material.trackUse) {
    throw Errors.invalidState(`${issue.material.sku} does not track use after issue, so it cannot be marked used up or broken. Put it back on the shelf, or switch Track use on for the item first.`);
  }

  const issued = issue.quantity.negated();
  const locationId = input.locationId ?? issue.locationId;
  // It goes back to the stock it came out of: Stores, or the project it was held for.
  // Returns and outcomes against this issue share what is still out, so both take this lock.
  const back = { materialId: issue.materialId, locationId, heldForProject: issue.heldForProject };
  await lockInventoryBalances([{ ...back, locationId: issue.locationId }, back], tx);
  // A reversal may have committed while this waited for the lock.
  if (await tx.inventoryTransaction.findFirst({ where: { reversesId: issue.id }, select: { id: true } })) {
    throw Errors.invalidState(`This issue of ${issue.material.sku} has been reversed, so there is nothing to return.`);
  }
  const alreadyReturned = await returnedAgainst(issue.id, tx);
  const closedOff = closedTotal((await closedOffAgainst(tx, [issue.id])).get(issue.id));
  const returnable = issued.minus(alreadyReturned).minus(closedOff);
  const total = input.qty.plus(usedUp).plus(broken);
  if (total.gt(returnable)) {
    const what = marking ? `take back ${total.toString()} × ${issue.material.sku}` : `return ${input.qty.toString()} × ${issue.material.sku}`;
    throw Errors.validation(
      `Cannot ${what}: only ${returnable.toString()} of the ${issued.toString()} issued is still out.`,
      { issued: issued.toString(), returned: alreadyReturned.toString(), closedOff: closedOff.toString(), returnable: returnable.toString() },
    );
  }

  const note = input.reason?.trim() || null;
  // The marks of this visit, linked to its RETURN when some went back on the
  // shelf (that row shows them), else each a Movements row of its own.
  const writeMarks = async (returnTransactionId: string | null) => {
    const ids: string[] = [];
    for (const [outcome, quantity] of [['USED_UP', usedUp], ['BROKEN', broken]] as const) {
      if (gtZero(quantity)) {
        ids.push(await writeOutcome(tx, { issueTransactionId: issue.id, outcome, quantity, note, actorId: input.actorId, returnTransactionId, createdAt: input.postedAt }));
      }
    }
    return ids;
  };
  if (!restocking) {
    const outcomeIds = await writeMarks(null);
    return { transactionId: null, outcomeIds, materialId: issue.materialId, locationId, issued, alreadyReturned, closedOff };
  }

  await checkLocationActive(locationId, tx);

  const trx = await tx.inventoryTransaction.create({
    data: {
      postedAt: input.postedAt,
      materialId: issue.materialId,
      locationId,
      type: InventoryTransactionType.RETURN,
      quantity: input.qty,
      actorId: input.actorId,
      recipientId: issue.recipientId,
      projectNumber: issue.projectNumber,
      heldForProject: issue.heldForProject,
      reasonNote: note,
      referenceType: 'Return',
      referenceId: issue.id,
    },
  });
  await recomputeBalance(back, tx);

  await tx.auditLogEntry.create({
    data: {
      actorId: input.actorId,
      action: 'RETURN',
      entityType: 'InventoryTransaction',
      entityId: issue.id,
      after: { returnTransactionId: trx.id, quantity: input.qty.toString(), locationId } as Prisma.InputJsonValue,
    },
  });
  const outcomeIds = await writeMarks(trx.id);

  return { transactionId: trx.id, outcomeIds, materialId: issue.materialId, locationId, issued, alreadyReturned, closedOff };
}

export async function checkRecipientActive(recipientId: string, tx: Prisma.TransactionClient): Promise<void> {
  const r = await tx.recipient.findUnique({ where: { id: recipientId } });
  if (!r) throw Errors.notFound('Recipient');
  if (!r.active) throw Errors.validation('Recipient is inactive');
}

export async function checkLocationActive(locationId: string, tx: Prisma.TransactionClient): Promise<void> {
  const l = await tx.location.findUnique({ where: { id: locationId } });
  if (!l) throw Errors.notFound('Location');
  if (!l.active) throw Errors.validation('Location is inactive');
}

export interface ReverseInput {
  transactionId: string;
  reason: string;
  actorId: string;
}

export interface HistoryFilter {
  materialId?: string;
  type?: string;
  /** A day (YYYY-MM-DD, from its start) or an ISO time. */
  from?: string;
  /** A day (YYYY-MM-DD, included in full) or an ISO time. */
  to?: string;
  projectNumber?: string;
  locationId?: string;
  /** A room and the locations inside it, from locationId with inside=true; wins over locationId. */
  locationIds?: string[];
  actorId?: string;
  /**
   * Who it was issued to (on write-offs: who was responsible); '__none__' for
   * none recorded (on write-offs: damage, loss or scrap with nobody known).
   */
  recipientId?: string;
  /** Matches the item code or name, the location, the project or who it was issued to. */
  q?: string;
  /**
   * A report on the Movements page: issued stock, transfers (one row per
   * transfer, its out leg) or write-offs (adjustments other than count
   * differences, which belong to the stock-counts report) or tool loans (tools
   * checked out and back in) or returned stock (unused stock back from an
   * issue, dated when it came back). Overrides `type`.
   */
  report?: 'issued' | 'transfers' | 'writeoffs' | 'loans' | 'returned';
  /** Only the lines of these issue slips (used to fill in a page of slips). */
  issueIds?: string[];
  /** Paging cursor: the `cursor` of the last row already shown; returns older rows. */
  before?: string;
  limit?: number;
}

/**
 * The movements a history filter selects. Days are whole UTC days and the
 * `to` day is included, as on the stock-used report.
 */
export function historyWhere(filter: Omit<HistoryFilter, 'before' | 'limit'>): Prisma.InventoryTransactionWhereInput {
  const where: Prisma.InventoryTransactionWhereInput = {};
  const and: Prisma.InventoryTransactionWhereInput[] = [];
  if (filter.materialId) where.materialId = filter.materialId;
  if (filter.type) where.type = filter.type as Prisma.InventoryTransactionWhereInput['type'];
  if (filter.report === 'issued') where.type = InventoryTransactionType.ISSUE;
  if (filter.report === 'transfers') where.type = InventoryTransactionType.TRANSFER_OUT;
  if (filter.report === 'loans') where.type = { in: [InventoryTransactionType.LOAN, InventoryTransactionType.LOAN_RETURN] };
  if (filter.report === 'returned') where.type = InventoryTransactionType.RETURN;
  if (filter.report === 'writeoffs') {
    where.type = InventoryTransactionType.ADJUSTMENT;
    // NULL <> 'StockCount' is not true in SQL, so a plain `not` would drop unreferenced rows.
    and.push({ OR: [{ referenceType: null }, { referenceType: { not: 'StockCount' } }] });
  }
  // A project's movements: stock used for it, and its own stock received,
  // moved or adjusted (held for it), which names no project it was used for (Qodo, PR #145).
  if (filter.projectNumber) and.push({ OR: [{ projectNumber: filter.projectNumber }, { heldForProject: filter.projectNumber }] });
  // A room and its racks (inside=true), else the one location.
  if (filter.locationIds) where.locationId = { in: filter.locationIds };
  else if (filter.locationId) where.locationId = filter.locationId;
  if (filter.actorId) where.actorId = filter.actorId;
  if (filter.recipientId) where.recipientId = filter.recipientId === '__none__' ? null : filter.recipientId;
  // Other adjustments never name anyone, so "nobody known" means a write-off that could have.
  if (filter.report === 'writeoffs' && filter.recipientId === '__none__') where.reasonCode = { in: [...RESPONSIBLE_REASONS] };
  if (filter.issueIds) where.issueId = { in: filter.issueIds };
  const postedAt = dayRange(filter.from, filter.to);
  if (postedAt) where.postedAt = postedAt;
  const q = filter.q?.trim();
  if (q) {
    const contains = { contains: q, mode: 'insensitive' as const };
    and.push({
      OR: [
        { material: { sku: contains } },
        { material: { name: contains } },
        { location: { name: contains } },
        { projectNumber: contains },
        { heldForProject: contains },
        { recipient: { name: contains } },
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
}

/** A row's paging cursor: newest first, ties broken by id. */
export const historyCursor = (t: { postedAt: Date; id: string }) => pageCursor(t.postedAt, t.id);

function olderThan(cursor: string): Prisma.InventoryTransactionWhereInput {
  const { at, id } = parseCursor(cursor);
  return { OR: [{ postedAt: { lt: at } }, { postedAt: at, id: { lt: id } }] };
}

/**
 * A tool loan's due date changed (tool_loan_extensions). Not a movement: no
 * stock moves, so it never counts in a stock total. Movements lists it among
 * the ledger lines, so everything that happened to stock in the store is in
 * one place.
 */
export const DUE_DATE_CHANGE = 'DUE_DATE_CHANGE' as const;

/**
 * Whether a history filter also lists due date changes: all movements and
 * the tool loans report, unless it asks for one movement type or for the
 * lines of issue slips.
 */
export function listsDueDateChanges(filter: Omit<HistoryFilter, 'before' | 'limit'>): boolean {
  return !filter.type && !filter.issueIds && (filter.report === undefined || filter.report === 'loans');
}

/**
 * The due date changes a history filter selects: by when they were made and
 * who made them, and by their loan's item, location, person, project or the
 * search, as the loan itself would be.
 */
export function dueDateChangeWhere(filter: Omit<HistoryFilter, 'before' | 'limit'>): Prisma.ToolLoanExtensionWhereInput {
  const where: Prisma.ToolLoanExtensionWhereInput = {
    loan: historyWhere({ ...filter, from: undefined, to: undefined, actorId: undefined, type: undefined, report: undefined, issueIds: undefined }),
  };
  const createdAt = dayRange(filter.from, filter.to);
  if (createdAt) where.createdAt = createdAt;
  if (filter.actorId) where.actorId = filter.actorId;
  return where;
}

/**
 * Used up and broken marks that are rows of their own on Movements (ADR-026):
 * one booked with nothing going back on the shelf, so there is no RETURN row
 * to show it on, and every withdrawal of a mark. Not movements: no stock
 * moves, so the quantity is null and they never count in a stock total. Marks
 * booked with a return are shown on that return's row.
 */
export const USED_UP = 'USED_UP' as const;
export const BROKEN = 'BROKEN' as const;
export const OUTCOME_WITHDRAWN = 'OUTCOME_WITHDRAWN' as const;

/** The type of a Movements row: a ledger line, or a record that moved no stock. */
export type HistoryRowType = InventoryTransactionType | typeof DUE_DATE_CHANGE | typeof USED_UP | typeof BROKEN | typeof OUTCOME_WITHDRAWN;

/**
 * Whether a history filter also lists those marks: all movements and the
 * returned stock report, unless it asks for one movement type or for the
 * lines of issue slips.
 */
export function listsOutcomeEvents(filter: Omit<HistoryFilter, 'before' | 'limit'>): boolean {
  return !filter.type && !filter.issueIds && (filter.report === undefined || filter.report === 'returned');
}

/**
 * The marks a history filter selects: by when they were booked and who booked
 * them, and by their issue's item, location, person, project or the search.
 */
export function outcomeEventWhere(filter: Omit<HistoryFilter, 'before' | 'limit'>): Prisma.ConsumableOutcomeWhereInput {
  const where: Prisma.ConsumableOutcomeWhereInput = {
    OR: [{ withdrawsId: { not: null } }, { returnTransactionId: null }],
    issue: historyWhere({ ...filter, from: undefined, to: undefined, actorId: undefined, type: undefined, report: undefined, issueIds: undefined }),
  };
  const createdAt = dayRange(filter.from, filter.to);
  if (createdAt) where.createdAt = createdAt;
  if (filter.actorId) where.actorId = filter.actorId;
  return where;
}

function outcomesOlderThan(cursor: string): Prisma.ConsumableOutcomeWhereInput {
  const { at, id } = parseCursor(cursor);
  return { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
}

function changesOlderThan(cursor: string): Prisma.ToolLoanExtensionWhereInput {
  const { at, id } = parseCursor(cursor);
  return { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
}

/** What a Movements row says about its tool loan's due dates; all null on other rows. */
interface LoanRowFields {
  /** Check-out: the date agreed. Check-in: the date as it stood then. Change: the new date. */
  dueOn: string | null;
  /** Change: the date it replaced. */
  previousDueOn: string | null;
  /** Check-out: the date it is due now, after any changes. */
  currentDueOn: string | null;
  /** Check-in: days after the due date it came back; zero or less is on time. */
  daysLate: number | null;
  /** Check-out: why tools were lent to someone with an overdue one. */
  overdueOverrideReason: string | null;
}

const NO_LOAN_FIELDS: LoanRowFields = { dueOn: null, previousDueOn: null, currentDueOn: null, daysLate: null, overdueOverrideReason: null };

function loanFields(
  t: { id: string; type: InventoryTransactionType; referenceId: string | null; postedAt: Date; overdueOverrideReason: string | null },
  dates: Map<string, LoanDates>,
): LoanRowFields {
  if (t.type === InventoryTransactionType.LOAN) {
    const d = dates.get(t.id);
    return { ...NO_LOAN_FIELDS, dueOn: d?.agreed ?? null, currentDueOn: d ? currentDueOn(d) : null, overdueOverrideReason: t.overdueOverrideReason };
  }
  const d = t.type === InventoryTransactionType.LOAN_RETURN && t.referenceId ? dates.get(t.referenceId) : undefined;
  if (!d) return NO_LOAN_FIELDS;
  const due = dueOnAt(d, t.postedAt);
  return { ...NO_LOAN_FIELDS, dueOn: due, daysLate: daysBetween(due, dayOf(t.postedAt)) };
}

/** A due date change as a Movements row: its loan's item, place, person and project; no quantity. */
function dueDateChangeRow(
  c: Prisma.ToolLoanExtensionGetPayload<{
    include: { actor: { select: { name: true } }; loan: { include: { material: true; location: true; recipient: { select: { name: true; type: true } } } } };
  }>,
  dates: Map<string, LoanDates>,
) {
  const d = dates.get(c.loanId);
  return {
    id: c.id,
    cursor: pageCursor(c.createdAt, c.id),
    postedAt: c.createdAt.toISOString(),
    type: DUE_DATE_CHANGE as HistoryRowType,
    materialId: c.loan.materialId,
    materialSku: c.loan.material.sku,
    materialName: c.loan.material.name,
    unitOfMeasure: c.loan.material.unitOfMeasure,
    issueId: c.loan.issueId,
    locationId: c.loan.locationId,
    locationName: c.loan.location.name,
    quantity: null as string | null,
    actorId: c.actorId,
    actorName: c.actor.name,
    recipientId: c.loan.recipientId,
    recipientName: c.loan.recipient?.name ?? null,
    recipientType: c.loan.recipient?.type ?? null,
    reasonCode: null,
    reasonNote: c.reason,
    projectNumber: c.loan.projectNumber,
    referenceType: 'ToolLoan',
    referenceId: c.loanId,
    reversesId: null,
    reversedById: null,
    returnedQuantity: null,
    trackUse: c.loan.material.trackUse,
    usedUpQuantity: null as string | null,
    brokenQuantity: null as string | null,
    bookedMarksLive: null as boolean | null,
    otherLocationName: null,
    returnOf: null as { id: string; postedAt: string; issueId: string | null; locationName: string } | null,
    receiptNumber: null,
    supplierName: null,
    deliveryRef: null,
    fromPurchaseOrder: false,
    ...NO_LOAN_FIELDS,
    dueOn: dayOf(c.dueOn),
    previousDueOn: d ? dueOnBefore(d, c.id) : null,
  };
}

/**
 * A used up or broken mark, or its withdrawal, as a Movements row: its issue's
 * item, place, person and project, with returnOf naming the issue; no quantity.
 * usedUpQuantity or brokenQuantity says how many.
 */
function outcomeEventRow(
  o: Prisma.ConsumableOutcomeGetPayload<{
    include: { actor: { select: { name: true } }; issue: { include: { material: true; location: true; recipient: { select: { name: true; type: true } } } } };
  }>,
) {
  const quantity = o.quantity.toString();
  return {
    id: o.id,
    cursor: pageCursor(o.createdAt, o.id),
    postedAt: o.createdAt.toISOString(),
    type: (o.withdrawsId ? OUTCOME_WITHDRAWN : o.outcome) as HistoryRowType,
    materialId: o.issue.materialId,
    materialSku: o.issue.material.sku,
    materialName: o.issue.material.name,
    unitOfMeasure: o.issue.material.unitOfMeasure,
    issueId: o.issue.issueId,
    locationId: o.issue.locationId,
    locationName: o.issue.location.name,
    quantity: null as string | null,
    actorId: o.actorId,
    actorName: o.actor.name,
    recipientId: o.issue.recipientId,
    recipientName: o.issue.recipient?.name ?? null,
    recipientType: o.issue.recipient?.type ?? null,
    reasonCode: null,
    // A mark's note, or why it was withdrawn.
    reasonNote: o.note,
    projectNumber: o.issue.projectNumber,
    referenceType: 'ConsumableOutcome',
    referenceId: o.issueTransactionId,
    reversesId: null,
    reversedById: null,
    returnedQuantity: null,
    trackUse: o.issue.material.trackUse,
    usedUpQuantity: o.outcome === 'USED_UP' ? quantity : null,
    brokenQuantity: o.outcome === 'BROKEN' ? quantity : null,
    bookedMarksLive: null as boolean | null,
    otherLocationName: null,
    returnOf: { id: o.issue.id, postedAt: o.issue.postedAt.toISOString(), issueId: o.issue.issueId, locationName: o.issue.location.name },
    receiptNumber: null,
    supplierName: null,
    deliveryRef: null,
    fromPurchaseOrder: false,
    ...NO_LOAN_FIELDS,
  };
}

/**
 * Two lists already newest first, as one, newest first, cut to `take`. Each
 * list keeps its own order (the database's), so the cursor of the last row
 * shown continues both.
 */
export function mergeNewestFirst<A, B>(
  a: A[], timeOfA: (x: A) => Date, b: B[], timeOfB: (x: B) => Date, idOf: (x: A | B) => string, take: number,
): Array<{ a: A } | { b: B }> {
  const out: Array<{ a: A } | { b: B }> = [];
  let i = 0;
  let j = 0;
  while (out.length < take && (i < a.length || j < b.length)) {
    const x = a[i];
    const y = b[j];
    const takeB = x === undefined || (y !== undefined && (
      timeOfB(y).getTime() > timeOfA(x).getTime() || (timeOfB(y).getTime() === timeOfA(x).getTime() && idOf(y) > idOf(x))));
    if (takeB) out.push({ b: b[j++]! });
    else out.push({ a: a[i++]! });
  }
  return out;
}

export const InventoryService = {
  async queryHistory(filter: HistoryFilter, maxRows = 1000) {
    const base = historyWhere(filter);
    const where = filter.before ? { AND: [base, olderThan(filter.before)] } : base;
    // Cap the page size to prevent unbounded memory usage from a single request.
    const take = Math.min(filter.limit ?? 200, maxRows);
    const changeWhere = listsDueDateChanges(filter) ? dueDateChangeWhere(filter) : null;
    const eventWhere = listsOutcomeEvents(filter) ? outcomeEventWhere(filter) : null;
    const [fetched, changes, events] = await Promise.all([prisma.inventoryTransaction.findMany({
      where,
      include: {
        material: true,
        location: true,
        actor: { select: { id: true, name: true, email: true } },
        reversedBy: { select: { id: true } },
        recipient: { select: { name: true, type: true } },
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take,
    }), changeWhere === null ? [] : prisma.toolLoanExtension.findMany({
      where: filter.before ? { AND: [changeWhere, changesOlderThan(filter.before)] } : changeWhere,
      include: {
        actor: { select: { name: true } },
        loan: { include: { material: true, location: true, recipient: { select: { name: true, type: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    }), eventWhere === null ? [] : prisma.consumableOutcome.findMany({
      where: filter.before ? { AND: [eventWhere, outcomesOlderThan(filter.before)] } : eventWhere,
      include: {
        actor: { select: { name: true } },
        issue: { include: { material: true, location: true, recipient: { select: { name: true, type: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    })]);
    // One page, newest first, of movements, due date changes and marks of their own together.
    const others = mergeNewestFirst(changes, (c) => c.createdAt, events, (e) => e.createdAt, (x) => x.id, take);
    const page = mergeNewestFirst(
      fetched, (t) => t.postedAt,
      others, (o) => ('a' in o ? o.a.createdAt : o.b.createdAt),
      (x) => ('id' in x ? x.id : 'a' in x ? x.a.id : x.b.id), take,
    );
    const rows = page.flatMap((p) => ('a' in p ? [p.a] : []));
    const keptChanges = page.flatMap((p) => ('b' in p && 'a' in p.b ? [p.b.a] : []));
    // A tool loan's due dates: agreed on its check-out, as they stood at a
    // check-in, and before and after each change.
    const loanIds = [
      ...rows.filter((t) => t.type === InventoryTransactionType.LOAN).map((t) => t.id),
      ...rows.filter((t) => t.type === InventoryTransactionType.LOAN_RETURN && t.referenceId).map((t) => t.referenceId!),
      ...keptChanges.map((c) => c.loanId),
    ];
    const loanDates = loanIds.length === 0 ? new Map<string, LoanDates>() : await loanDatesFor(prisma, loanIds, await loanTerms());
    // Receipts point at their goods receipt; show its number, supplier and
    // delivery/invoice number alongside the movement.
    const receiptIds = [...new Set(rows.filter((t) => t.referenceType === 'GoodsReceipt' && t.referenceId).map((t) => t.referenceId!))];
    const receipts = receiptIds.length === 0 ? [] : await prisma.goodsReceipt.findMany({
      where: { id: { in: receiptIds } },
      select: { id: true, number: true, deliveryRef: true, purchaseOrderId: true, supplier: { select: { name: true } } },
    });
    const receiptById = new Map(receipts.map((r) => [r.id, r]));
    // A return points at the issue it came back from: say when and where that was.
    const returnedIssueIds = [...new Set(rows.filter((t) => t.type === InventoryTransactionType.RETURN && t.referenceType === 'Return' && t.referenceId).map((t) => t.referenceId!))];
    const returnedIssues = returnedIssueIds.length === 0 ? [] : await prisma.inventoryTransaction.findMany({
      where: { id: { in: returnedIssueIds } },
      select: { id: true, postedAt: true, issueId: true, location: { select: { name: true } } },
    });
    const issueById = new Map(returnedIssues.map((i) => [i.id, i]));
    const issueIds = rows.filter((t) => t.type === InventoryTransactionType.ISSUE).map((t) => t.id);
    const returnedRows = issueIds.length === 0 ? [] : await prisma.inventoryTransaction.groupBy({
      by: ['referenceId'],
      where: { type: InventoryTransactionType.RETURN, referenceType: 'Return', referenceId: { in: issueIds } },
      _sum: { quantity: true },
    });
    const returnedByIssue = new Map(returnedRows.map((r) => [r.referenceId, r._sum.quantity]));
    // Tracked consumables: how much of each issue was marked used up or broken.
    const closedByIssue = await closedOffAgainst(prisma, issueIds);
    // And how much each return's counter visit marked used up or broken, as booked then.
    const returnIds = rows.filter((t) => t.type === InventoryTransactionType.RETURN).map((t) => t.id);
    const bookedRows = returnIds.length === 0 ? [] : await prisma.consumableOutcome.groupBy({
      by: ['returnTransactionId', 'outcome'],
      where: { returnTransactionId: { in: returnIds }, withdrawsId: null },
      _sum: { quantity: true },
    });
    // Whether any of them still counts: then the return is reversed only once they are withdrawn.
    const liveBookedRows = returnIds.length === 0 ? [] : await prisma.consumableOutcome.groupBy({
      by: ['returnTransactionId'],
      where: { returnTransactionId: { in: returnIds }, ...LIVE_OUTCOME },
      _count: { _all: true },
    });
    const liveBooked = new Set(liveBookedRows.map((b) => b.returnTransactionId));
    const bookedWith = (returnId: string, outcome: 'USED_UP' | 'BROKEN') =>
      (bookedRows.find((b) => b.returnTransactionId === returnId && b.outcome === outcome)?._sum.quantity ?? toDecimal(0)).toString();
    // A transfer's other leg: where the stock went to (or came from).
    const partnerIds = rows.map((t) => t.pairedWithId).filter((id): id is string => !!id);
    const partners = partnerIds.length === 0 ? [] : await prisma.inventoryTransaction.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, location: { select: { name: true } } },
    });
    const partnerLocation = new Map(partners.map((p) => [p.id, p.location.name]));
    const movements = new Map(rows.map((t) => [t.id, {
      id: t.id,
      cursor: historyCursor(t),
      postedAt: t.postedAt.toISOString(),
      type: t.type as HistoryRowType,
      materialId: t.materialId,
      materialSku: t.material.sku,
      materialName: t.material.name,
      unitOfMeasure: t.material.unitOfMeasure,
      issueId: t.issueId,
      locationId: t.locationId,
      locationName: t.location.name,
      // Null on a due date change: no stock moved.
      quantity: t.quantity.toString() as string | null,
      actorId: t.actorId,
      actorName: t.actor.name,
      recipientId: t.recipientId,
      recipientName: t.recipient?.name ?? null,
      recipientType: t.recipient?.type ?? null,
      reasonCode: t.reasonCode,
      reasonNote: t.reasonNote,
      projectNumber: t.projectNumber,
      // Whose stock moved: the project it is held for, or null for Stores stock.
      // Not projectNumber, which says who the stock was used for.
      heldForProject: t.heldForProject,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
      reversesId: t.reversesId,
      reversedById: t.reversedBy?.id ?? null,
      returnedQuantity: t.type === InventoryTransactionType.ISSUE ? (returnedByIssue.get(t.id)?.toString() ?? '0') : null,
      // Issues: marked used up or broken so far. Returns: marked in the same
      // counter visit. trackUse says whether the item asks for it.
      trackUse: t.material.trackUse,
      usedUpQuantity: t.type === InventoryTransactionType.ISSUE ? (closedByIssue.get(t.id)?.usedUp.toString() ?? '0')
        : t.type === InventoryTransactionType.RETURN ? bookedWith(t.id, 'USED_UP') : null,
      brokenQuantity: t.type === InventoryTransactionType.ISSUE ? (closedByIssue.get(t.id)?.broken.toString() ?? '0')
        : t.type === InventoryTransactionType.RETURN ? bookedWith(t.id, 'BROKEN') : null,
      // Returns: whether a mark booked with it still counts (not withdrawn). The
      // quantities above stay as booked, for the record (Qodo, PR #144).
      bookedMarksLive: t.type === InventoryTransactionType.RETURN ? liveBooked.has(t.id) : null,
      otherLocationName: t.pairedWithId ? partnerLocation.get(t.pairedWithId) ?? null : null,
      returnOf: ((): { id: string; postedAt: string; issueId: string | null; locationName: string } | null => {
        const i = t.type === InventoryTransactionType.RETURN && t.referenceId ? issueById.get(t.referenceId) : undefined;
        return i ? { id: i.id, postedAt: i.postedAt.toISOString(), issueId: i.issueId, locationName: i.location.name } : null;
      })(),
      ...(() => {
        const r = t.referenceId ? receiptById.get(t.referenceId) : undefined;
        // fromPurchaseOrder: such a receipt also moved the order's received quantities, so it cannot be reversed here.
        return { receiptNumber: r?.number ?? null, supplierName: r?.supplier.name ?? null, deliveryRef: r?.deliveryRef ?? null, fromPurchaseOrder: !!r?.purchaseOrderId };
      })(),
      ...loanFields(t, loanDates),
    }]));
    return page.map((p) => ('a' in p ? movements.get(p.a.id)! : 'a' in p.b ? dueDateChangeRow(p.b.a, loanDates) : outcomeEventRow(p.b.b)));
  },

  /**
   * The Issued stock report: issue slips, newest first, each with all its
   * lines (and what came back). A slip is chosen when any of its lines matches
   * the filter. Reversals are not slips; a reversed line says so.
   */
  async issueSlips(filter: Omit<HistoryFilter, 'report' | 'issueIds'>) {
    const and: Prisma.InventoryTransactionWhereInput[] = [
      historyWhere({ ...filter, report: 'issued' }),
      { issueId: { not: null }, reversesId: null },
    ];
    if (filter.before) {
      const { at, id } = parseCursor(filter.before);
      and.push({ OR: [{ postedAt: { lt: at } }, { postedAt: at, issueId: { lt: id } }] });
    }
    const heads = await prisma.inventoryTransaction.findMany({
      where: { AND: and },
      distinct: ['issueId'],
      orderBy: [{ postedAt: 'desc' }, { issueId: 'desc' }],
      take: Math.min(filter.limit ?? 50, 200),
      select: { issueId: true, postedAt: true },
    });
    const ids = heads.map((h) => h.issueId!);
    if (ids.length === 0) return [];
    const lines = (await this.queryHistory({ issueIds: ids, report: 'issued', limit: 10_000 }, 10_000)).filter((l) => !l.reversesId);
    return heads.map((h) => {
      const own = lines.filter((l) => l.issueId === h.issueId).sort((a, b) => a.materialName.localeCompare(b.materialName));
      const first = own[0];
      return {
        id: h.issueId!,
        cursor: pageCursor(h.postedAt, h.issueId!),
        issuedAt: h.postedAt.toISOString(),
        recipientName: first?.recipientName ?? null,
        recipientType: first?.recipientType ?? null,
        projectNumber: first?.projectNumber ?? null,
        issuedByName: first?.actorName ?? 'Unknown user',
        lines: own,
      };
    });
  },

  /**
   * How many rows of each type the filter selects, for the totals above the
   * list: movements by type, due date changes as DUE_DATE_CHANGE, and marks
   * of their own as USED_UP, BROKEN and OUTCOME_WITHDRAWN.
   */
  async historySummary(filter: Omit<HistoryFilter, 'before' | 'limit'>): Promise<{ total: number; byType: Record<string, number> }> {
    const eventWhere = listsOutcomeEvents(filter) ? outcomeEventWhere(filter) : null;
    const [groups, changes, marks, withdrawals] = await Promise.all([
      prisma.inventoryTransaction.groupBy({ by: ['type'], where: historyWhere(filter), _count: { _all: true } }),
      listsDueDateChanges(filter) ? prisma.toolLoanExtension.count({ where: dueDateChangeWhere(filter) }) : 0,
      eventWhere ? prisma.consumableOutcome.groupBy({ by: ['outcome'], where: { AND: [eventWhere, { withdrawsId: null }] }, _count: { _all: true } }) : [],
      eventWhere ? prisma.consumableOutcome.count({ where: { AND: [eventWhere, { withdrawsId: { not: null } }] } }) : 0,
    ]);
    const byType: Record<string, number> = Object.fromEntries(groups.map((g) => [g.type, g._count._all]));
    if (changes > 0) byType[DUE_DATE_CHANGE] = changes;
    for (const m of marks) byType[m.outcome] = m._count._all;
    if (withdrawals > 0) byType[OUTCOME_WITHDRAWN] = withdrawals;
    const events = marks.reduce((n, m) => n + m._count._all, 0) + withdrawals;
    return { total: groups.reduce((n, g) => n + g._count._all, 0) + changes + events, byType };
  },

  /** How many rows the filter selects, due date changes and marks of their own included (the export checks this before building). */
  async historyCount(filter: Omit<HistoryFilter, 'before' | 'limit'>): Promise<number> {
    const [movements, changes, events] = await Promise.all([
      prisma.inventoryTransaction.count({ where: historyWhere(filter) }),
      listsDueDateChanges(filter) ? prisma.toolLoanExtension.count({ where: dueDateChangeWhere(filter) }) : 0,
      listsOutcomeEvents(filter) ? prisma.consumableOutcome.count({ where: outcomeEventWhere(filter) }) : 0,
    ]);
    return movements + changes + events;
  },

  /** Everyone who has posted a movement, changed a due date or marked used up or broken, for the "by" filter. Names only. */
  async historyActors(): Promise<Array<{ id: string; name: string }>> {
    const [posted, changed, marked] = await Promise.all([
      prisma.inventoryTransaction.findMany({ distinct: ['actorId'], select: { actorId: true } }),
      prisma.toolLoanExtension.findMany({ distinct: ['actorId'], select: { actorId: true } }),
      prisma.consumableOutcome.findMany({ distinct: ['actorId'], select: { actorId: true } }),
    ]);
    const ids = [...new Set([...posted, ...changed, ...marked].map((r) => r.actorId))];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return users.sort((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * The Write-offs report's totals by who was responsible: damage, loss and
   * scrap that took stock away, valued at the item's unit cost (an item with
   * none counts as 0). Reversed write-offs and their reversals are left out.
   * recipientId null is "not known". Largest value first, in the report
   * currency the other value reports use. Any other report in the filter is ignored.
   */
  async writeoffsByResponsible(filter: Omit<HistoryFilter, 'before' | 'limit'>): Promise<{
    currency: string;
    totals: Array<{ recipientId: string | null; recipientName: string | null; recipientType: string | null; count: number; value: string }>;
  }> {
    const groups = await prisma.inventoryTransaction.groupBy({
      by: ['recipientId', 'materialId'],
      where: {
        AND: [
          historyWhere({ ...filter, report: 'writeoffs' }),
          { reasonCode: { in: [...RESPONSIBLE_REASONS] }, quantity: { lt: 0 }, reversesId: null, reversedBy: { is: null } },
        ],
      },
      _sum: { quantity: true },
      _count: { _all: true },
    });
    const materialIds = [...new Set(groups.map((g) => g.materialId))];
    const recipientIds = [...new Set(groups.map((g) => g.recipientId).filter((id): id is string => !!id))];
    const [materials, people] = await Promise.all([
      materialIds.length ? prisma.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, unitCost: true } }) : [],
      recipientIds.length ? prisma.recipient.findMany({ where: { id: { in: recipientIds } }, select: { id: true, name: true, type: true } }) : [],
    ]);
    const unitCost = new Map(materials.map((m) => [m.id, m.unitCost]));
    const person = new Map(people.map((p) => [p.id, p]));
    const totals = new Map<string | null, { count: number; value: Decimal }>();
    for (const g of groups) {
      const t = totals.get(g.recipientId) ?? { count: 0, value: new Prisma.Decimal(0) };
      t.count += g._count._all;
      const cost = unitCost.get(g.materialId);
      if (cost && g._sum.quantity) t.value = t.value.add(g._sum.quantity.negated().mul(cost));
      totals.set(g.recipientId, t);
    }
    // Ties go by name, with nobody known last.
    const name = (id: string | null) => (id ? person.get(id)?.name ?? '' : null);
    const byName = (a: string | null, b: string | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a.localeCompare(b));
    return {
      currency: process.env.REPORT_CURRENCY ?? 'ZAR',
      totals: [...totals.entries()]
        .sort(([ia, a], [ib, b]) => b.value.comparedTo(a.value) || b.count - a.count || byName(name(ia), name(ib)))
        .map(([id, t]) => {
          const p = id ? person.get(id) : undefined;
          return { recipientId: id, recipientName: p?.name ?? null, recipientType: p?.type ?? null, count: t.count, value: t.value.toFixed(2) };
        }),
    };
  },

  /**
   * Reverse a movement by posting an opposite entry that points at it. The
   * ledger has no update path, so this is the only way to correct a mistake.
   * A reversal keeps the original's type with the opposite sign, so balances
   * and signed totals net to zero. Both legs of a transfer are reversed
   * together. A transaction can be reversed at most once (unique reverses_id).
   */
  async reverse(input: ReverseInput, within?: Prisma.TransactionClient): Promise<{ reversalIds: string[] }> {
    const reason = input.reason.trim();
    if (!reason) throw Errors.validation('A reason is required to reverse a movement');

    try {
      return await inTx(within, async (tx) => {
        const original = await tx.inventoryTransaction.findUnique({
          where: { id: input.transactionId },
          include: { reversedBy: { select: { id: true } } },
        });
        if (!original) throw Errors.notFound('InventoryTransaction');
        if (original.reversesId) {
          throw Errors.invalidState('A reversal cannot itself be reversed. Record the movement again instead.');
        }
        // Moving a closed project's stock to Stores changed its item too, so the
        // pair isn't reversed on its own (Qodo, PR #149).
        if (original.referenceType === MOVE_TO_STORES_REFERENCE) {
          throw Errors.invalidState('This moved a closed project\'s stock to Stores along with its item, so it isn\'t reversed. Issue or adjust the Stores stock instead.');
        }
        // Tool loans are put right by checking the tool in or out again, which keeps the loan's story whole.
        if (original.type === InventoryTransactionType.LOAN || original.type === InventoryTransactionType.LOAN_RETURN || original.referenceType === 'ToolLoan') {
          throw Errors.invalidState('Tool check-outs and check-ins are not reversed: check the tool in, or out, again instead.');
        }
        // Receipts against a purchase order also moved the order's received
        // quantities, so they cannot be reversed here. Counter receipts
        // (no purchase order) can.
        if (original.referenceType === 'GoodsReceipt' && original.referenceId) {
          const gr = await tx.goodsReceipt.findUnique({ where: { id: original.referenceId } });
          if (gr?.purchaseOrderId) {
            throw Errors.invalidState('Stock received against a purchase order cannot be reversed here.');
          }
        }

        const legs = [original];
        if (original.pairedWithId) {
          const partner = await tx.inventoryTransaction.findUnique({
            where: { id: original.pairedWithId },
            include: { reversedBy: { select: { id: true } } },
          });
          if (!partner) throw Errors.notFound('InventoryTransaction');
          // Keep the outgoing leg first so the reversal legs pair the same way.
          if (partner.type === InventoryTransactionType.TRANSFER_OUT) legs.unshift(partner);
          else legs.push(partner);
        }
        if (legs.some((leg) => leg.reversedBy)) {
          throw Errors.conflict('This movement has already been reversed.');
        }

        // A reversal must not take any balance below zero.
        await lockInventoryBalances(legs, tx);
        // Checked under the lock that returns and used up or broken marks take,
        // so one booked at the same moment cannot slip past.
        if (original.type === InventoryTransactionType.ISSUE && gtZero(await returnedAgainst(original.id, tx))) {
          throw Errors.invalidState('Part of this issue has been returned. Reverse the returns first.');
        }
        if (original.type === InventoryTransactionType.ISSUE && gtZero(closedTotal((await closedOffAgainst(tx, [original.id])).get(original.id)))) {
          throw Errors.invalidState('Part of this issue has been marked used up or broken. Withdraw those first.');
        }
        // Used up or broken booked in the same counter visit would keep counting
        // after the return is undone, shown only on a reversed row (Qodo, PR #144).
        if (original.type === InventoryTransactionType.RETURN
          && await tx.consumableOutcome.count({ where: { returnTransactionId: original.id, ...LIVE_OUTCOME } }) > 0) {
          throw Errors.invalidState('Used up or broken was booked with this return. Withdraw those first.');
        }
        for (const leg of legs) {
          if (!leg.quantity.isPositive()) continue;
          const balance = await getCurrentBalance(leg, tx);
          if (balance.lt(leg.quantity)) {
            throw Errors.insufficientBalance(
              `Cannot reverse: only ${balance.toString()} of the ${leg.quantity.toString()} units are still in stock.`,
              { materialId: leg.materialId, locationId: leg.locationId, requested: leg.quantity.toString(), available: balance.toString() },
            );
          }
        }

        const reversals = [];
        for (const leg of legs) {
          reversals.push(
            await tx.inventoryTransaction.create({
              data: {
                materialId: leg.materialId,
                locationId: leg.locationId,
                type: leg.type,
                quantity: leg.quantity.negated(),
                actorId: input.actorId,
                recipientId: leg.recipientId,
                projectNumber: leg.projectNumber,
                heldForProject: leg.heldForProject,
                reasonCode: leg.reasonCode,
                reasonNote: reason,
                referenceType: leg.referenceType,
                referenceId: leg.referenceId,
                reversesId: leg.id,
              },
            }),
          );
        }
        // Tie the two reversal legs of a transfer together, as transfer() does.
        if (reversals.length === 2) {
          const [out, inn] = reversals as [typeof reversals[number], typeof reversals[number]];
          await tx.inventoryTransaction.update({ where: { id: inn.id }, data: { pairedWithId: out.id } });
          await tx.inventoryTransaction.update({ where: { id: out.id }, data: { pairedWithId: inn.id } });
        }

        for (const leg of legs) {
          await recomputeBalance(leg, tx);
        }

        const reversalIds = reversals.map((r) => r.id);
        await tx.auditLogEntry.create({
          data: {
            actorId: input.actorId,
            action: 'REVERSE',
            entityType: 'InventoryTransaction',
            entityId: original.id,
            after: { reversalIds, reason } as Prisma.InputJsonValue,
          },
        });

        return { reversalIds };
      });
    } catch (err) {
      // Two requests reversing the same movement at once: the unique index wins.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('This movement has already been reversed.');
      }
      throw err;
    }
  },

  async issue(input: IssueInput, within?: Prisma.TransactionClient): Promise<{ transactionIds: string[] }> {
    if (!input.recipientId) throw Errors.validation('Choose who the stock is issued to');
    if (input.lines.length === 0) throw Errors.validation('Add at least one item to issue');
    const lines = input.lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, heldForProject: l.heldForProject ?? null, qty: toDecimal(l.quantity) }));
    if (lines.some((l) => !gtZero(l.qty))) throw Errors.validation('Issue quantity must be positive');

    // Each line takes the stock it names: Stores stock, or the stock held for
    // the issue's project (Project Material Through the Store Roadmap, Phase 3).
    // Leftovers are Stores stock with their project on the item. The same stock
    // on two lines is checked as one total.
    const totals = new Map<string, { materialId: string; locationId: string; heldForProject: string | null; qty: Decimal }>();
    for (const l of lines) {
      const key = `${l.materialId}|${l.locationId}|${l.heldForProject ?? ''}`;
      const t = totals.get(key);
      if (t) t.qty = t.qty.plus(l.qty);
      else totals.set(key, { materialId: l.materialId, locationId: l.locationId, heldForProject: l.heldForProject, qty: l.qty });
    }

    return inTx(within, async (tx) => {
      await lockInventoryBalances([...totals.values()], tx);
      await checkRecipientActive(input.recipientId, tx);
      if (input.projectNumber) await checkProjectTakesIssues(input.projectNumber, tx);

      const materials = new Map<string, Awaited<ReturnType<typeof checkMaterialActive>>>();
      for (const t of totals.values()) {
        if (materials.has(t.materialId)) continue;
        const material = await checkMaterialActive(t.materialId, tx);
        if (material.category === 'TOOLS') throw Errors.validation(`${material.sku} is a tool: check it out on the Tools page instead of issuing it`);
        materials.set(t.materialId, material);
      }
      // A project's own stock goes to that project only.
      for (const t of totals.values()) {
        if (t.heldForProject && t.heldForProject !== (input.projectNumber ?? null)) {
          const sku = materials.get(t.materialId)!.sku;
          throw Errors.validation(input.projectNumber
            ? `${sku} at this location is held for project ${t.heldForProject}, so it can't be issued to project ${input.projectNumber}.`
            : `${sku} at this location is held for project ${t.heldForProject}: issue it to that project.`);
        }
      }
      // Stores stock follows the item's rules: a leftover goes to its item's
      // project, and a Projects item with no project isn't issued. Stock held
      // for a project is that project's, whatever the item says.
      const fromStores = [...new Set([...totals.values()].filter((t) => !t.heldForProject).map((t) => t.materialId))].map((id) => materials.get(id)!);
      for (const material of fromStores) refuseUnassigned(material);
      checkProjectMaterial(input.projectNumber, fromStores);

      for (const t of totals.values()) {
        const material = materials.get(t.materialId)!;
        await checkLocationActive(t.locationId, tx);

        // Stock can never go below zero. This is a fixed rule, not a setting:
        // a negative balance means the ledger no longer matches the shelf.
        const balance = await getCurrentBalance(t, tx);
        if (balance.lt(t.qty)) {
          throw Errors.insufficientBalance(
            `Cannot issue ${t.qty.toString()} × ${material.sku}: only ${balance.toString()} available.`,
            { materialId: t.materialId, locationId: t.locationId, requested: t.qty.toString(), available: balance.toString() },
          );
        }
      }

      // One slip: every line shares the issue id and the time, so the slip pages as one.
      const issueId = randomUUID();
      const postedAt = new Date();
      const transactionIds: string[] = [];
      for (const l of lines) {
        const trx = await tx.inventoryTransaction.create({
          data: {
            issueId,
            postedAt,
            materialId: l.materialId,
            locationId: l.locationId,
            heldForProject: l.heldForProject,
            type: InventoryTransactionType.ISSUE,
            quantity: l.qty.negated(),
            actorId: input.actorId,
            recipientId: input.recipientId,
            projectNumber: input.projectNumber ?? null,
            referenceType: input.projectNumber ? 'Project' : null,
            referenceId: input.projectNumber ?? null,
          },
        });
        transactionIds.push(trx.id);
      }

      const events: DomainEvent[] = lines.map((l) => ({
        type: 'InventoryIssued', materialId: l.materialId, locationId: l.locationId, quantity: l.qty.toNumber(),
      }));
      const alertsOn = await SettingsService.getValue<boolean>('inventory.enableStockAlerts', tx);
      for (const t of totals.values()) await recomputeBalance(t, tx);
      if (alertsOn) {
        // The item's status from its Stores total across locations, as the stock status report shows it.
        const bands = await getStatusBands(tx);
        for (const materialId of new Set([...totals.values()].map((t) => t.materialId))) {
          const material = materials.get(materialId);
          if (!material) continue;
          const all = await tx.inventoryBalance.aggregate({ where: { materialId, heldForProject: '' }, _sum: { quantity: true } });
          if (needsAttention(classifyItem(Number(all._sum.quantity ?? 0), Number(material.requiredStock), bands).status)) {
            events.push({ type: 'StockThresholdReached', materialId });
          }
        }
      }

      await dispatchDomainEvents(events);
      return { transactionIds };
    });
  },

  /**
   * Return unused stock from an issue. Recorded as a RETURN that points at the
   * issue and keeps its recipient and project, so project consumption nets the
   * return out. At most the issued quantity, less what has already come back.
   */
  async returnToStock(input: ReturnInput, within?: Prisma.TransactionClient): Promise<{ transactionId: string; returnedQuantity: string; returnableQuantity: string }> {
    const qty = toDecimal(input.quantity);
    if (!gtZero(qty)) throw Errors.validation('Return quantity must be positive');

    return inTx(within, async (tx) => {
      const r = await bookReturn(tx, { ...input, qty, postedAt: new Date() });
      await dispatchDomainEvents([
        { type: 'InventoryIncreased', materialId: r.materialId, locationId: r.locationId, quantity: qty.toNumber() },
      ]);
      const returned = r.alreadyReturned.plus(qty);
      return { transactionId: r.transactionId!, returnedQuantity: returned.toString(), returnableQuantity: r.issued.minus(returned).minus(r.closedOff).toString() };
    });
  },

  /**
   * What comes back at the counter, several lines at once, each against its
   * own issue: stock back on the shelf and, for items that track use, used up
   * and broken (ADR-026). Booked all-or-nothing, as an issue is. The same issue
   * on two lines is checked as one total, because each line counts the ones
   * before it. transactionIds are the RETURN rows; outcomeIds the marks.
   */
  async returnMany(input: ReturnManyInput, within?: Prisma.TransactionClient): Promise<{ transactionIds: string[]; outcomeIds: string[] }> {
    if (input.lines.length === 0) throw Errors.validation('Add at least one item that is coming back');
    const lines = input.lines.map((l) => ({
      ...l, qty: toDecimal(l.quantity ?? 0), usedUp: toDecimal(l.usedUp ?? 0), broken: toDecimal(l.broken ?? 0),
    }));
    if (lines.some((l) => l.qty.isNegative() || l.usedUp.isNegative() || l.broken.isNegative())) {
      throw Errors.validation('Quantities cannot be negative');
    }
    if (lines.some((l) => !gtZero(l.qty.plus(l.usedUp).plus(l.broken)))) {
      throw Errors.validation('Each line needs something coming back: on the shelf, used up or broken');
    }

    return inTx(within, async (tx) => {
      const postedAt = new Date();
      const transactionIds: string[] = [];
      const outcomeIds: string[] = [];
      const events: DomainEvent[] = [];
      for (const l of lines) {
        const r = await bookReturn(tx, {
          issueTransactionId: l.issueTransactionId, qty: l.qty, usedUp: l.usedUp, broken: l.broken,
          locationId: l.locationId, reason: input.reason, actorId: input.actorId, postedAt,
        });
        if (r.transactionId) {
          transactionIds.push(r.transactionId);
          events.push({ type: 'InventoryIncreased', materialId: r.materialId, locationId: r.locationId, quantity: l.qty.toNumber() });
        }
        outcomeIds.push(...r.outcomeIds);
      }
      await dispatchDomainEvents(events);
      return { transactionIds, outcomeIds };
    });
  },

  /**
   * What a recipient can still bring back: their unreversed issues in the
   * period, newest first, with what has come back so far, leaving out those
   * fully returned or marked used up or broken. Consumables are mostly used up, so the period matters:
   * without one this would be every issue they were ever given.
   */
  async returnable(filter: { recipientId: string; from?: string; to?: string }): Promise<ReturnableLine[]> {
    const where: Prisma.InventoryTransactionWhereInput = {
      type: InventoryTransactionType.ISSUE, recipientId: filter.recipientId, reversesId: null, reversedBy: null,
    };
    const postedAt = dayRange(filter.from, filter.to);
    if (postedAt) where.postedAt = postedAt;
    const issues = await prisma.inventoryTransaction.findMany({
      where,
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: RETURNABLE_LIMIT,
      include: {
        material: { select: { sku: true, name: true, unitOfMeasure: true, trackUse: true } },
        location: { select: { name: true, active: true } },
      },
    });
    if (issues.length === 0) return [];

    const returns = await prisma.inventoryTransaction.findMany({
      where: { type: InventoryTransactionType.RETURN, referenceType: 'Return', referenceId: { in: issues.map((i) => i.id) } },
      select: { referenceId: true, quantity: true },
    });
    const returnedBy = new Map<string, Decimal>();
    for (const r of returns) returnedBy.set(r.referenceId!, (returnedBy.get(r.referenceId!) ?? toDecimal(0)).plus(r.quantity));
    const closed = await closedOffAgainst(prisma, issues.map((i) => i.id));

    return issues.flatMap((i) => {
      const issued = i.quantity.negated();
      const returned = returnedBy.get(i.id) ?? toDecimal(0);
      const closedOff = closedTotal(closed.get(i.id));
      const outstanding = issued.minus(returned).minus(closedOff);
      if (!gtZero(outstanding)) return [];
      return [{
        issueTransactionId: i.id,
        issueId: i.issueId,
        postedAt: i.postedAt.toISOString(),
        materialId: i.materialId,
        sku: i.material.sku,
        name: i.material.name,
        unitOfMeasure: i.material.unitOfMeasure,
        locationId: i.locationId,
        locationName: i.location.name,
        locationActive: i.location.active,
        projectNumber: i.projectNumber,
        trackUse: i.material.trackUse,
        issued: issued.toString(),
        returned: returned.toString(),
        closedOff: closedOff.toString(),
        outstanding: outstanding.toString(),
      }];
    });
  },

  async transfer(input: TransferInput, within?: Prisma.TransactionClient): Promise<{ outTransactionId: string; inTransactionId: string }> {
    const qty = toDecimal(input.quantity);
    if (!gtZero(qty)) throw Errors.validation('Transfer quantity must be positive');
    if (input.fromLocationId === input.toLocationId) {
      throw Errors.validation('Source and destination locations must differ');
    }

    // The stock keeps its project as it moves: Stores stock stays Stores stock,
    // a project's stays that project's (Project Material Through the Store Roadmap, Phase 3).
    const heldForProject = input.heldForProject ?? null;
    const from = { materialId: input.materialId, locationId: input.fromLocationId, heldForProject };
    const to = { materialId: input.materialId, locationId: input.toLocationId, heldForProject };
    return inTx(within, async (tx) => {
      await lockInventoryBalances([from, to], tx);
      await checkMaterialActive(input.materialId, tx);
      if (heldForProject) await checkProjectExists(heldForProject, tx);
      await checkLocationActive(input.fromLocationId, tx);
      await checkLocationActive(input.toLocationId, tx);

      const balance = await getCurrentBalance(from, tx);
      if (balance.lt(qty)) {
        throw Errors.insufficientBalance(
          `Cannot transfer ${qty.toString()} units: only ${balance.toString()} available at source.`,
          { materialId: input.materialId, fromLocationId: input.fromLocationId, requested: qty.toString(), available: balance.toString() },
        );
      }

      const out = await tx.inventoryTransaction.create({
        data: {
          materialId: input.materialId,
          locationId: input.fromLocationId,
          heldForProject,
          type: InventoryTransactionType.TRANSFER_OUT,
          quantity: qty.negated(),
          actorId: input.actorId,
        },
      });

      const inn = await tx.inventoryTransaction.create({
        data: {
          materialId: input.materialId,
          locationId: input.toLocationId,
          heldForProject,
          type: InventoryTransactionType.TRANSFER_IN,
          quantity: qty,
          actorId: input.actorId,
          pairedWithId: out.id,
        },
      });

      await tx.inventoryTransaction.update({
        where: { id: out.id },
        data: { pairedWithId: inn.id },
      });

      await recomputeBalance(from, tx);
      await recomputeBalance(to, tx);

      await dispatchDomainEvents([
        {
          type: 'InventoryTransferred',
          materialId: input.materialId,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          quantity: qty.toNumber(),
        },
      ]);

      return { outTransactionId: out.id, inTransactionId: inn.id };
    });
  },

  async adjust(input: AdjustmentInput, within?: Prisma.TransactionClient): Promise<{ transactionId: string }> {
    const qty = toDecimal(input.quantity);
    if (qty.isZero()) throw Errors.validation('Adjustment quantity must be non-zero');
    if (input.recipientId) {
      if (!takesResponsible(input.reasonCode)) throw Errors.validation('Only damage, loss or scrap records who was responsible.');
      if (!input.reasonNote?.trim()) throw Errors.validation('Say what happened when naming who was responsible.');
    }

    // Stores stock, or a project's own (Project Material Through the Store Roadmap, Phase 3).
    const heldForProject = input.heldForProject ?? null;
    const stock = { materialId: input.materialId, locationId: input.locationId, heldForProject };
    return inTx(within, async (tx) => {
      await lockInventoryBalances([stock], tx);
      await checkMaterialActive(input.materialId, tx);
      await checkLocationActive(input.locationId, tx);
      if (heldForProject) await checkProjectExists(heldForProject, tx);
      if (input.recipientId) await checkRecipientActive(input.recipientId, tx);

      // See issue(): stock can never go below zero.
      if (qty.isNegative()) {
        const balance = await getCurrentBalance(stock, tx);
        if (balance.lt(qty.negated())) {
          throw Errors.insufficientBalance(
            `Cannot adjust ${qty.toString()} units: only ${balance.toString()} available.`,
            { materialId: input.materialId, locationId: input.locationId, requested: qty.toString(), available: balance.toString() },
          );
        }
      }

      const trx = await tx.inventoryTransaction.create({
        data: {
          materialId: input.materialId,
          locationId: input.locationId,
          heldForProject,
          type: InventoryTransactionType.ADJUSTMENT,
          quantity: qty,
          reasonCode: input.reasonCode,
          reasonNote: input.reasonNote ?? null,
          recipientId: input.recipientId ?? null,
          actorId: input.actorId,
        },
      });

      await recomputeBalance(stock, tx);

      await dispatchDomainEvents([
        { type: 'InventoryAdjusted', materialId: input.materialId, locationId: input.locationId, quantity: qty.toNumber() },
      ]);

      return { transactionId: trx.id };
    });
  },

  /**
   * Post a GoodsReceipt: creates Receipt transactions for each line and updates
   * the linked PO's received quantities. Must be atomic: given a transaction
   * (the receipt being recorded in it), it posts within that one.
   */
  async postGoodsReceipt(input: GoodsReceiptPostInput, within?: Prisma.TransactionClient): Promise<void> {
    const post = async (tx: Prisma.TransactionClient) => {
      const gr = await tx.goodsReceipt.findUnique({
        where: { id: input.goodsReceiptId },
        include: { lines: true },
      });
      if (!gr) throw Errors.notFound('GoodsReceipt');
      // Every path that receives stock locks in one order: the receipt number
      // (taken by the caller), the order, its lines, then stock balances.
      // Postings against one order wait for each other, so each reads the
      // status the last one left and its Activity entry shows the real
      // transition.
      let po: { projectNumber: string | null; status: string } | null = null;
      if (gr.purchaseOrderId) {
        await tx.$executeRaw`SELECT id FROM purchase_orders WHERE id = ${gr.purchaseOrderId} FOR UPDATE`;
        po = await tx.purchaseOrder.findUnique({ where: { id: gr.purchaseOrderId }, select: { projectNumber: true, status: true } });
      }
      await lockPurchaseOrderLines(gr.lines.map((line) => line.purchaseOrderLineId).filter((id): id is string => Boolean(id)), tx);
      // A delivery against a project order is held for that project; any
      // other is Stores stock (Project Material Through the Store Roadmap).
      const heldForProject = po?.projectNumber ?? null;
      const stockOf = (line: { materialId: string; locationId: string }) => ({ materialId: line.materialId, locationId: line.locationId, heldForProject });
      await lockInventoryBalances(gr.lines.map(stockOf), tx);
      if (gr.status === 'POSTED') throw Errors.invalidState('Goods receipt already posted');
      if (gr.status === 'DRAFT') throw Errors.invalidState('Goods receipt must be SUBMITTED before posting');
      // The order may have been cancelled or closed since the receipt was recorded.
      if (gr.purchaseOrderId) {
        if (po && po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
          throw Errors.invalidState(`Cannot receive against a purchase order in status ${po.status}`, { status: po.status });
        }
      }

      // A receipt against an order must credit the order line each line is
      // for; otherwise the order keeps showing the goods as owed and they can
      // be received again. Checked before anything is written (it is also
      // checked when the receipt is recorded).
      for (const line of gr.lines) {
        if (gr.purchaseOrderId && !line.purchaseOrderLineId) {
          throw Errors.validation('Every line of a receipt against a purchase order must name the order line it is for.');
        }
        if (line.purchaseOrderLineId) {
          const poLine = await tx.purchaseOrderLine.findUnique({ where: { id: line.purchaseOrderLineId } });
          if (!poLine || poLine.purchaseOrderId !== gr.purchaseOrderId) {
            throw Errors.validation('A receipt line names an order line that is not on its purchase order.');
          }
        }
      }

      const claimed = await tx.goodsReceipt.updateMany({
        where: { id: gr.id, status: 'SUBMITTED' },
        data: { status: 'POSTED' },
      });
      if (claimed.count === 0) throw Errors.invalidState('Goods receipt already posted');

      for (const line of gr.lines) {
        const qty = toDecimal(line.quantity);
        await tx.inventoryTransaction.create({
          data: {
            materialId: line.materialId,
            locationId: line.locationId,
            type: InventoryTransactionType.RECEIPT,
            quantity: qty,
            referenceType: 'GoodsReceipt',
            referenceId: gr.id,
            actorId: input.actorId,
            heldForProject,
          },
        });

        if (line.purchaseOrderLineId) {
          // Prevent receiving more than the ordered quantity on a PO line.
          const poLine = await tx.purchaseOrderLine.findUnique({
            where: { id: line.purchaseOrderLineId },
          });
          if (poLine) {
            const orderedQty = toDecimal(poLine.orderedQty);
            const alreadyReceived = toDecimal(poLine.receivedQty);
            const projected = alreadyReceived.plus(qty);
            if (projected.gt(orderedQty)) {
              throw Errors.validation(
                `Receiving ${qty.toString()} would exceed the ordered quantity of ${orderedQty.toString()} for this line.`,
                { orderedQty: orderedQty.toString(), alreadyReceived: alreadyReceived.toString(), receiving: qty.toString() },
              );
            }
            await tx.purchaseOrderLine.update({
              where: { id: line.purchaseOrderLineId },
              data: { receivedQty: { increment: qty } },
            });
          }
        }

        await recomputeBalance(stockOf(line), tx);
      }

      await tx.goodsReceipt.update({
        where: { id: gr.id },
        data: { status: 'POSTED' },
      });

      // Update PO status based on lines.
      if (gr.purchaseOrderId) {
        const lines = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId: gr.purchaseOrderId },
        });
        const allFully = lines.every((l) => toDecimal(l.receivedQty).gte(toDecimal(l.orderedQty)));
        const anyReceived = lines.some((l) => gtZero(toDecimal(l.receivedQty)));
        const order = await tx.purchaseOrder.findUnique({ where: { id: gr.purchaseOrderId }, select: { status: true } });
        const statusBefore = order?.status ?? null;
        let status = statusBefore;
        if (allFully || anyReceived) {
          const updated = await tx.purchaseOrder.update({
            where: { id: gr.purchaseOrderId },
            data: allFully
              ? { status: 'RECEIVED', deliveredAt: new Date(), deliveredById: input.actorId }
              : { status: 'PARTIALLY_RECEIVED' },
          });
          status = updated.status;
        }
        // On the order's Activity: which receipt it was received on, and the
        // status it moved to (it stays Partly received until the last line).
        await tx.auditLogEntry.create({
          data: {
            actorId: input.actorId,
            action: 'PO_GOODS_RECEIVED',
            entityType: 'PurchaseOrder',
            entityId: gr.purchaseOrderId,
            before: { status: statusBefore } as Prisma.InputJsonValue,
            after: { status, goodsReceiptId: gr.id, goodsReceiptNumber: gr.number } as Prisma.InputJsonValue,
          },
        });
      }

      await dispatchDomainEvents([
        { type: 'GoodsReceived', goodsReceiptId: gr.id, purchaseOrderId: gr.purchaseOrderId },
      ]);
    };
    if (within) return post(within);
    await prisma.$transaction(post);
  },
};
