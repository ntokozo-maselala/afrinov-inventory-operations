// Tool check-out and check-in. A tool is lent, not used up: a check-out is a
// LOAN movement that takes it off its location to a named recipient (and
// project), and a check-in is a LOAN_RETURN that brings it back to the same
// location, saying whether it came back in good order or damaged. A tool lost
// on loan comes back on paper and is written off at once (ADJUSTMENT, LOSS),
// so it is neither out nor owned any more. Several tools lent to one person at
// once share a slip (issueId), as an issue does.
//
// Every loan has a due date, agreed at check-out and kept on the LOAN row. A
// different date, later or earlier, is a change with a reason
// (tool_loan_extensions); the loan row is never changed. Whether a loan is due
// soon, overdue or needs a decision is worked out from the due date each time
// (tool-loan-terms.ts). Movements lists the changes beside the loan's
// check-out and check-in (InventoryService.queryHistory).
//
// Loans are corrected by checking the tool in or out again, not by reversing
// the movement (see InventoryService.reverse).
import { randomUUID } from 'node:crypto';
import { AdjustmentReasonCode, InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { recomputeBalance, getCurrentBalance, lockInventoryBalances, storesStock } from '../../shared/inventory/balances.js';
import { checkLocationActive, checkMaterialActive, checkProjectActive, checkRecipientActive } from './inventory.service.js';
import { loanTerms } from './tool-loan-dates.js';
import { checkWriteOff } from './write-off-limit.js';
import { checkWholeUnits } from '../../shared/units.js';
import { pendingLostByLoan, requestAdjustment } from './write-off-requests.js';
import {
  addDays, currentDueOn, dayOf, daysBetween, defaultDueOn, dueOnAt, dueOnBefore, dueOnProblem, loanDatesOf, loanState, overdueBlocksCheckout,
  type LoanState, type LoanTerms,
} from './tool-loan-terms.js';

type Decimal = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export const TOOL_LOAN_REFERENCE = 'ToolLoan';

/** A lost tool's return and its LOSS write-off, at one time, against its loan; the caller recomputes the balance. */
async function postLost(
  tx: Prisma.TransactionClient,
  loan: { id: string; materialId: string; locationId: string; recipientId: string | null; projectNumber: string | null },
  qty: Decimal, notes: { returnNote: string | null; writeOffNote: string }, actorId: string, postedAt: Date,
): Promise<{ returnId: string; writeOffId: string }> {
  const common = {
    postedAt, materialId: loan.materialId, locationId: loan.locationId, actorId,
    recipientId: loan.recipientId, projectNumber: loan.projectNumber, reasonCode: AdjustmentReasonCode.LOSS,
    referenceType: TOOL_LOAN_REFERENCE, referenceId: loan.id,
  };
  const back = await tx.inventoryTransaction.create({ data: { ...common, type: InventoryTransactionType.LOAN_RETURN, quantity: qty, reasonNote: notes.returnNote } });
  const writeOff = await tx.inventoryTransaction.create({ data: { ...common, type: InventoryTransactionType.ADJUSTMENT, quantity: qty.negated(), reasonNote: notes.writeOffNote } });
  return { returnId: back.id, writeOffId: writeOff.id };
}

export type ToolCondition = 'GOOD' | 'DAMAGED' | 'LOST';

export interface CheckOutInput {
  recipientId: string;
  projectNumber?: string;
  note?: string;
  /** YYYY-MM-DD. Omitted: the default loan period, capped at the project's end date. */
  dueOn?: string;
  /** Why tools are lent to someone who already has an overdue one. Required then, unless the policy blocks it. */
  overrideReason?: string;
  /** The caller may set a due date past the longest loan (an administrator). */
  canExceedMaxLoan?: boolean;
  lines: Array<{ materialId: string; locationId: string; quantity: number | string | Decimal }>;
  actorId: string;
}

export interface CheckInInput {
  lines: Array<{ loanId: string; quantity: number | string | Decimal; condition: ToolCondition; note?: string }>;
  actorId: string;
}

export interface DueDateChangeInput {
  loanId: string;
  /** YYYY-MM-DD, later or earlier than the current due date, but not before today. */
  dueOn: string;
  reason: string;
  /** The caller may set a due date past the longest loan (an administrator). */
  canExceedMaxLoan?: boolean;
  actorId: string;
}

/** A change of a loan's due date. */
export interface LoanExtension {
  dueOn: string;
  /** The date it replaced. */
  previousDueOn: string;
  reason: string;
  extendedBy: string;
  extendedAt: string;
}

/**
 * One step in a loan's life, oldest first (GET /tools/loans/:id/history).
 * BECAME_OVERDUE is worked out from the dates and never stored.
 */
export type LoanEvent =
  | { kind: 'CHECKED_OUT'; at: string; by: string; quantity: string; dueOn: string; note: string | null; overdueOverrideReason: string | null }
  | { kind: 'DUE_DATE_CHANGED'; at: string; by: string; dueOn: string; previousDueOn: string; reason: string }
  | { kind: 'BECAME_OVERDUE'; at: string; dueOn: string }
  | { kind: 'CHECKED_IN'; at: string; by: string; quantity: string; condition: ToolCondition; note: string | null; dueOn: string; daysLate: number };

export interface LoanHistory {
  loanId: string;
  materialId: string;
  sku: string;
  name: string;
  recipientName: string | null;
  projectNumber: string | null;
  locationName: string;
  quantity: string;
  /** Still out. */
  out: string;
  dueOn: string;
  /** Null once it is all back. */
  state: LoanState | null;
  daysLate: number;
  events: LoanEvent[];
}

export interface OpenLoan {
  loanId: string;
  slipId: string | null;
  recipientId: string | null;
  recipientName: string | null;
  projectNumber: string | null;
  locationId: string;
  locationName: string;
  /** How many were lent on this loan. */
  quantity: string;
  /** How many of them are still out. */
  out: string;
  /** Of those out, how many are waiting to be written off as lost (ADR-028): not to be checked in again. */
  lostWaiting: string;
  checkedOutAt: string;
  checkedOutBy: string;
  note: string | null;
  /** Whole days since it went out. */
  daysOut: number;
  /** YYYY-MM-DD it is due back: the latest extension's, else the one agreed at check-out. */
  dueOn: string;
  /** Days past the due date; zero on the day, negative while there are days to go. */
  daysLate: number;
  state: LoanState;
  /** Past its due date (OVERDUE or NEEDS_DECISION). */
  overdue: boolean;
  /** Later due dates given, oldest first. */
  extensions: LoanExtension[];
}

export interface ToolRow {
  materialId: string;
  sku: string;
  name: string;
  serialNumber: string | null;
  unitOfMeasure: string;
  /** On the shelf, across every location. */
  inStore: string;
  onLoan: string;
  /** In store + on loan. */
  owned: string;
  locations: Array<{ locationId: string; locationName: string; quantity: string }>;
  loans: OpenLoan[];
}

/** An overdue loan named when lending more to the same recipient. */
export interface OverdueLoan { loanId: string; sku: string; name: string; out: string; dueOn: string; daysLate: number }

/** One check-out or check-in at a time per tool and location, so two people cannot lend the last one. */
async function lock(tx: Tx, keys: Iterable<string>) {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`afrinov:tool:${key}`}))`;
  }
}

/** What has come back against each loan, lost ones included. */
async function returnedByLoan(tx: Pick<Tx, 'inventoryTransaction'>, loanIds: string[]): Promise<Map<string, Decimal>> {
  if (loanIds.length === 0) return new Map();
  const groups = await tx.inventoryTransaction.groupBy({
    by: ['referenceId'],
    where: { type: InventoryTransactionType.LOAN_RETURN, referenceType: TOOL_LOAN_REFERENCE, referenceId: { in: loanIds } },
    _sum: { quantity: true },
  });
  return new Map(groups.map((g) => [g.referenceId!, g._sum.quantity ?? toDecimal(0)]));
}

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The due date changes a loan row is read with. */
const CHANGES = { select: { id: true, createdAt: true, dueOn: true } } as const;

/** When a loan row is due now: its most recent change, else its own date. */
function dueOf(loan: { postedAt: Date; dueOn: Date | null; loanExtensions: Array<{ id: string; createdAt: Date; dueOn: Date }> }, terms: LoanTerms): string {
  return currentDueOn(loanDatesOf(loan, loan.loanExtensions, terms));
}

/** The recipient's loans still out and past their due date, most overdue first. */
async function overdueLoansOf(tx: Tx, recipientId: string, today: string, terms: LoanTerms): Promise<OverdueLoan[]> {
  const loans = await tx.inventoryTransaction.findMany({
    where: { type: InventoryTransactionType.LOAN, recipientId },
    include: { material: { select: { sku: true, name: true } }, loanExtensions: CHANGES },
  });
  const returned = await returnedByLoan(tx, loans.map((l) => l.id));
  const overdue: OverdueLoan[] = [];
  for (const l of loans) {
    const out = l.quantity.negated().minus(returned.get(l.id) ?? 0);
    if (!out.gt(0)) continue;
    const dueOn = dueOf(l, terms);
    const { daysLate } = loanState(dueOn, today, terms);
    if (daysLate > 0) overdue.push({ loanId: l.id, sku: l.material.sku, name: l.material.name, out: out.toString(), dueOn, daysLate });
  }
  return overdue.sort((a, b) => b.daysLate - a.daysLate);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const ToolLoanService = {
  /** Every active tool with what is in store where, what is out, with whom, since when and until when. */
  async list(now = new Date()): Promise<ToolRow[]> {
    const tools = await prisma.material.findMany({ where: { category: 'TOOLS', active: true }, orderBy: { name: 'asc' } });
    const ids = tools.map((t) => t.id);
    if (ids.length === 0) return [];
    const [balances, loans] = await Promise.all([
      // In store means Stores stock, the only stock checked out (Qodo, PR #142).
      prisma.inventoryBalance.findMany({ where: { materialId: { in: ids }, heldForProject: '' }, include: { location: { select: { name: true } } } }),
      prisma.inventoryTransaction.findMany({
        where: { type: InventoryTransactionType.LOAN, materialId: { in: ids } },
        include: {
          recipient: { select: { name: true } },
          location: { select: { name: true } },
          actor: { select: { name: true } },
          loanExtensions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { actor: { select: { name: true } } } },
        },
        orderBy: { postedAt: 'asc' },
      }),
    ]);
    const [returned, terms, lostWaiting] = await Promise.all([
      returnedByLoan(prisma, loans.map((l) => l.id)), loanTerms(), pendingLostByLoan(loans.map((l) => l.id), prisma),
    ]);
    const today = dayOf(now);

    const open = new Map<string, OpenLoan[]>();
    for (const l of loans) {
      const lent = l.quantity.negated();
      const out = lent.minus(returned.get(l.id) ?? 0);
      if (!out.gt(0)) continue;
      const dates = loanDatesOf(l, l.loanExtensions, terms);
      const dueOn = currentDueOn(dates);
      const { state, daysLate } = loanState(dueOn, today, terms);
      open.set(l.materialId, [...(open.get(l.materialId) ?? []), {
        loanId: l.id,
        slipId: l.issueId,
        recipientId: l.recipientId,
        recipientName: l.recipient?.name ?? null,
        projectNumber: l.projectNumber,
        locationId: l.locationId,
        locationName: l.location.name,
        quantity: lent.toString(),
        out: out.toString(),
        lostWaiting: (lostWaiting.get(l.id) ?? toDecimal(0)).toString(),
        checkedOutAt: l.postedAt.toISOString(),
        checkedOutBy: l.actor.name,
        note: l.reasonNote,
        daysOut: Math.floor((now.getTime() - l.postedAt.getTime()) / 86_400_000),
        dueOn,
        daysLate,
        state,
        overdue: daysLate > 0,
        extensions: l.loanExtensions.map((e) => ({
          dueOn: dayOf(e.dueOn), previousDueOn: dueOnBefore(dates, e.id), reason: e.reason, extendedBy: e.actor.name, extendedAt: e.createdAt.toISOString(),
        })),
      }]);
    }

    return tools.map((t) => {
      const mine = balances.filter((b) => b.materialId === t.id && b.quantity.gt(0));
      const inStore = mine.reduce((a, b) => a.plus(b.quantity), toDecimal(0));
      const loansOut = open.get(t.id) ?? [];
      const onLoan = loansOut.reduce((a, l) => a.plus(l.out), toDecimal(0));
      return {
        materialId: t.id,
        sku: t.sku,
        name: t.name,
        serialNumber: t.serialNumber,
        unitOfMeasure: t.unitOfMeasure,
        inStore: inStore.toString(),
        onLoan: onLoan.toString(),
        owned: inStore.plus(onLoan).toString(),
        locations: mine
          .map((b) => ({ locationId: b.locationId, locationName: b.location.name, quantity: b.quantity.toString() }))
          .sort((a, b) => a.locationName.localeCompare(b.locationName)),
        loans: loansOut,
      };
    });
  },

  /**
   * Lend tools to one recipient (and project) at once, as one slip, due back
   * on one date. Someone who already has an overdue tool is lent more only
   * with a reason, or not at all when inventory.toolOverdueCheckout blocks it.
   */
  async checkOut(input: CheckOutInput): Promise<{ slipId: string; loanIds: string[]; dueOn: string }> {
    if (!input.recipientId) throw Errors.validation('Choose who the tools are checked out to');
    if (input.lines.length === 0) throw Errors.validation('Add at least one tool');
    const lines = input.lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, qty: toDecimal(l.quantity) }));
    if (lines.some((l) => !gtZero(l.qty))) throw Errors.validation('Check-out quantity must be positive');

    const totals = new Map<string, { materialId: string; locationId: string; qty: Decimal }>();
    for (const l of lines) {
      const key = `${l.materialId}:${l.locationId}`;
      const t = totals.get(key);
      if (t) t.qty = t.qty.plus(l.qty);
      else totals.set(key, { ...l });
    }

    return prisma.$transaction(async (tx) => {
      await lock(tx, totals.keys());
      // Tools are Stores items, so their stock is the store's own.
      await lockInventoryBalances([...totals.values()].map((t) => storesStock(t.materialId, t.locationId)), tx);
      await checkRecipientActive(input.recipientId, tx);
      if (input.projectNumber) await checkProjectActive(input.projectNumber, tx);
      // Each line becomes a loan of its own, so each is whole, not just their total.
      await checkWholeUnits(lines.map((l) => ({ materialId: l.materialId, quantity: l.qty })), tx);
      for (const t of totals.values()) {
        const material = await checkMaterialActive(t.materialId, tx);
        if (material.category !== 'TOOLS') throw Errors.validation(`${material.sku} is not a tool; issue it on Issue stock instead`);
        await checkLocationActive(t.locationId, tx);
        const inStore = await getCurrentBalance(storesStock(t.materialId, t.locationId), tx);
        if (inStore.lt(t.qty)) {
          throw Errors.insufficientBalance(
            `Cannot check out ${t.qty.toString()} × ${material.sku}: only ${inStore.toString()} in store there.`,
            { materialId: t.materialId, locationId: t.locationId, requested: t.qty.toString(), available: inStore.toString() },
          );
        }
      }

      const postedAt = new Date();
      const today = dayOf(postedAt);
      const terms = await loanTerms();
      const project = input.projectNumber
        ? await tx.project.findUnique({ where: { projectNumber: input.projectNumber }, select: { endDate: true } })
        : null;
      const projectEnd = project?.endDate ? dayOf(project.endDate) : null;
      const dueOn = input.dueOn ?? defaultDueOn(today, terms, projectEnd);
      if (input.dueOn) {
        const problem = dueOnProblem(input.dueOn, {
          outDay: today, today, terms, projectNumber: input.projectNumber, projectEnd, canExceedMax: input.canExceedMaxLoan === true,
        });
        if (problem) throw Errors.validation(problem);
      }

      const overrideReason = input.overrideReason?.trim() || null;
      const overdue = await overdueLoansOf(tx, input.recipientId, today, terms);
      if (overdue.length > 0) {
        const recipient = (await tx.recipient.findUnique({ where: { id: input.recipientId }, select: { name: true, type: true } }))!;
        const listed = overdue.map((o) => `${o.sku} ${o.name}, ${plural(o.daysLate, 'day')} late`).join('; ');
        const has = `${recipient.name} has ${plural(overdue.length, 'overdue tool')}: ${listed}.`;
        if (overdueBlocksCheckout(terms, recipient.type)) {
          throw Errors.invalidState(`${has} Check ${overdue.length === 1 ? 'it' : 'them'} in or extend the loan before lending more.`, { overdueLoans: overdue });
        }
        if (!overrideReason) {
          throw Errors.validation(`${has} Give a reason to lend more anyway.`, { overdueLoans: overdue, overrideReasonRequired: true });
        }
      }

      const slipId = randomUUID();
      const note = input.note?.trim() || null;
      const loanIds: string[] = [];
      for (const l of lines) {
        const loan = await tx.inventoryTransaction.create({
          data: {
            issueId: slipId,
            postedAt,
            materialId: l.materialId,
            locationId: l.locationId,
            type: InventoryTransactionType.LOAN,
            quantity: l.qty.negated(),
            actorId: input.actorId,
            recipientId: input.recipientId,
            projectNumber: input.projectNumber ?? null,
            reasonNote: note,
            dueOn: asDate(dueOn),
            // Kept on the check-out itself so Movements shows it beside the loan.
            overdueOverrideReason: overdue.length > 0 ? overrideReason : null,
          },
        });
        loanIds.push(loan.id);
      }
      for (const t of totals.values()) await recomputeBalance(storesStock(t.materialId, t.locationId), tx);

      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId,
          action: 'TOOL_CHECK_OUT',
          entityType: 'ToolLoan',
          entityId: slipId,
          after: {
            recipientId: input.recipientId, projectNumber: input.projectNumber ?? null, loanIds, dueOn,
            ...(overdue.length > 0 ? { overdueOverride: { reason: overrideReason, loanIds: overdue.map((o) => o.loanId) } } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      return { slipId, loanIds, dueOn };
    });
  },

  /**
   * Take tools back, each against its loan: in good order, damaged, or lost
   * (written off). A lost tool worth more than the write-off limit, or with no
   * unit cost, is written off only once someone else approves it (ADR-028):
   * it stays on loan, so it can't be lent again, and approval posts its return
   * and its write-off together (writeOffLost). Its request is in
   * writeOffRequestIds, and its loan in heldLoanIds; one rejected leaves the tool on loan.
   */
  async checkIn(input: CheckInInput): Promise<{ returnIds: string[]; writeOffIds: string[]; writeOffRequestIds: string[]; heldLoanIds: string[] }> {
    if (input.lines.length === 0) throw Errors.validation('Add at least one tool to check in');
    const lines = input.lines.map((l) => ({ ...l, qty: toDecimal(l.quantity), note: l.note?.trim() || null }));
    if (lines.some((l) => !gtZero(l.qty))) throw Errors.validation('Check-in quantity must be positive');
    if (lines.some((l) => l.condition === 'LOST' && !l.note)) throw Errors.validation('Say what happened to a lost tool');

    return prisma.$transaction(async (tx) => {
      const loanIds = [...new Set(lines.map((l) => l.loanId))];
      const loans = await tx.inventoryTransaction.findMany({
        where: { id: { in: loanIds } },
        include: { recipient: { select: { name: true } }, material: { select: { sku: true, unitCost: true } } },
      });
      const byId = new Map(loans.map((l) => [l.id, l]));
      for (const id of loanIds) {
        const loan = byId.get(id);
        if (!loan) throw Errors.notFound('Tool check-out');
        if (loan.type !== InventoryTransactionType.LOAN) throw Errors.invalidState('Only a tool check-out can be checked in');
      }
      await lock(tx, loans.map((l) => `${l.materialId}:${l.locationId}`));
      await lockInventoryBalances(loans.map((l) => storesStock(l.materialId, l.locationId)), tx);

      // Read after the lock, so two check-ins of one loan cannot both pass. A
      // lost tool waiting for its write-off to be approved is still out, but
      // not to be checked in again.
      const returned = await returnedByLoan(tx, loanIds);
      const waiting = await pendingLostByLoan(loanIds, tx);
      const asked = new Map<string, Decimal>();
      const outOf = new Map<string, Decimal>();
      for (const l of lines) asked.set(l.loanId, (asked.get(l.loanId) ?? toDecimal(0)).plus(l.qty));
      for (const [id, qty] of asked) {
        const loan = byId.get(id)!;
        const pending = waiting.get(id) ?? toDecimal(0);
        const out = loan.quantity.negated().minus(returned.get(id) ?? 0).minus(pending);
        if (qty.gt(out)) {
          const held = gtZero(pending) ? ` (${pending.toString()} more is waiting to be written off as lost)` : '';
          throw Errors.validation(`Cannot check in ${qty.toString()} × ${loan.material.sku}: only ${out.toString()} still checked out${held}.`, { loanId: id, out: out.toString() });
        }
        outOf.set(id, out);
        await checkMaterialActive(loan.materialId, tx);
        await checkLocationActive(loan.locationId, tx);
      }
      // Whole units, but for one line of a loan that carries the part-unit still
      // out on a loan made before the rule, so what is left becomes whole.
      await checkWholeUnits(lines.map((l) => ({ materialId: byId.get(l.loanId)!.materialId, quantity: l.qty, group: l.loanId, remainder: outOf.get(l.loanId)! })), tx);

      // Whether the lost tools wait for approval is decided on everything lost
      // of a tool from one location on this check-in, as one write-off would
      // be: two lines (or two loans) of R 600 under a R 1 000 limit are R 1 200.
      const lostTotal = new Map<string, Decimal>();
      for (const l of lines) {
        if (l.condition !== 'LOST') continue;
        const loan = byId.get(l.loanId)!;
        const key = `${loan.materialId}|${loan.locationId}`;
        lostTotal.set(key, (lostTotal.get(key) ?? toDecimal(0)).plus(l.qty));
      }
      const needsApproval = new Map<string, boolean>();
      for (const [key, qty] of lostTotal) {
        const loan = loans.find((x) => `${x.materialId}|${x.locationId}` === key)!;
        needsApproval.set(key, (await checkWriteOff(qty, loan.material.unitCost, tx)).needsApproval);
      }

      const postedAt = new Date();
      const returnIds: string[] = [];
      const writeOffIds: string[] = [];
      const writeOffRequestIds: string[] = [];
      const heldLoanIds: string[] = [];
      for (const l of lines) {
        const loan = byId.get(l.loanId)!;
        if (l.condition === 'LOST') {
          const reasonNote = `Lost while checked out to ${loan.recipient?.name ?? 'an unknown recipient'}: ${l.note}`;
          // This line's own value is what its request records.
          const check = await checkWriteOff(l.qty, loan.material.unitCost, tx);
          if (needsApproval.get(`${loan.materialId}|${loan.locationId}`)) {
            // Nothing is posted: the tool stays on loan until the write-off is approved.
            const { requestId } = await requestAdjustment({
              materialId: loan.materialId, locationId: loan.locationId, quantity: l.qty.negated(), reasonCode: 'LOSS',
              reasonNote, recipientId: loan.recipientId, projectNumber: loan.projectNumber,
              referenceType: TOOL_LOAN_REFERENCE, referenceId: loan.id, actorId: input.actorId,
            }, check, tx);
            writeOffRequestIds.push(requestId);
            heldLoanIds.push(loan.id);
            continue;
          }
          const posted = await postLost(tx, loan, l.qty, { returnNote: l.note, writeOffNote: reasonNote }, input.actorId, postedAt);
          returnIds.push(posted.returnId);
          writeOffIds.push(posted.writeOffId);
          continue;
        }
        const back = await tx.inventoryTransaction.create({
          data: {
            postedAt,
            materialId: loan.materialId,
            locationId: loan.locationId,
            type: InventoryTransactionType.LOAN_RETURN,
            quantity: l.qty,
            actorId: input.actorId,
            recipientId: loan.recipientId,
            projectNumber: loan.projectNumber,
            reasonCode: l.condition === 'DAMAGED' ? AdjustmentReasonCode.DAMAGE : null,
            reasonNote: l.note,
            referenceType: TOOL_LOAN_REFERENCE,
            referenceId: loan.id,
          },
        });
        returnIds.push(back.id);
      }
      for (const key of new Set(loans.map((l) => `${l.materialId}|${l.locationId}`))) {
        const [materialId, locationId] = key.split('|') as [string, string];
        await recomputeBalance(storesStock(materialId, locationId), tx);
      }

      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId,
          action: 'TOOL_CHECK_IN',
          entityType: 'ToolLoan',
          entityId: loanIds[0]!,
          after: { lines: lines.map((l) => ({ loanId: l.loanId, quantity: l.qty.toString(), condition: l.condition })), returnIds, writeOffIds, writeOffRequestIds } as Prisma.InputJsonValue,
        },
      });
      return { returnIds, writeOffIds, writeOffRequestIds, heldLoanIds };
    });
  },

  /**
   * Write off a tool lost on loan once its write-off is approved: its return
   * and its LOSS, posted together and booked to whoever checked it in, as a
   * lost tool within the limit is. Refused if it is no longer that far out
   * (checked in since), so the request is rejected instead.
   */
  async writeOffLost(input: { loanId: string; quantity: Decimal; reasonNote: string; actorId: string }, within?: Tx): Promise<{ transactionId: string }> {
    return inTx(within, async (tx) => {
      const loan = await tx.inventoryTransaction.findUnique({ where: { id: input.loanId } });
      if (!loan || loan.type !== InventoryTransactionType.LOAN) throw Errors.notFound('Tool check-out');
      await lock(tx, [`${loan.materialId}:${loan.locationId}`]);
      await lockInventoryBalances([storesStock(loan.materialId, loan.locationId)], tx);
      const out = loan.quantity.negated().minus((await returnedByLoan(tx, [loan.id])).get(loan.id) ?? 0);
      if (input.quantity.gt(out)) {
        throw Errors.invalidState(`Only ${out.toString()} of this tool is still out on that loan: it has been checked in since. Reject this write-off instead.`);
      }
      // As approving any adjustment: a tool retired while this waited is not written off.
      await checkMaterialActive(loan.materialId, tx);
      await checkLocationActive(loan.locationId, tx);
      const posted = await postLost(tx, loan, input.quantity, { returnNote: input.reasonNote, writeOffNote: input.reasonNote }, input.actorId, new Date());
      await recomputeBalance(storesStock(loan.materialId, loan.locationId), tx);
      return { transactionId: posted.writeOffId };
    });
  },

  /**
   * Give a loan still out a different due date, later or earlier, with a
   * reason. Recorded as a change; the loan and its earlier dates are kept, so
   * a mistaken date is put right by another change. Same limits as at
   * check-out: not before today, not after the project ends, and no more than
   * the longest loan from check-out unless the caller may exceed it.
   */
  async changeDueDate(input: DueDateChangeInput, within?: Tx): Promise<{ loanId: string; dueOn: string; previousDueOn: string; extensionId: string }> {
    const reason = input.reason.trim();
    if (!reason) throw Errors.validation('Say why the due date is changing');

    return inTx(within, async (tx) => {
      // One change of a loan at a time, so two cannot both read the same current date.
      await lock(tx, [`loan:${input.loanId}`]);
      const loan = await tx.inventoryTransaction.findUnique({
        where: { id: input.loanId },
        include: { project: { select: { endDate: true } }, loanExtensions: CHANGES },
      });
      if (!loan) throw Errors.notFound('Tool check-out');
      if (loan.type !== InventoryTransactionType.LOAN) throw Errors.invalidState('Only a tool check-out has a due date');
      const returned = await returnedByLoan(tx, [loan.id]);
      if (!loan.quantity.negated().minus(returned.get(loan.id) ?? 0).gt(0)) {
        throw Errors.invalidState('This check-out is all back already, so its due date cannot change');
      }

      const terms = await loanTerms();
      const today = dayOf(new Date());
      const current = dueOf(loan, terms);
      if (input.dueOn === current) throw Errors.validation(`The tool is already due back on ${current}.`);
      const problem = dueOnProblem(input.dueOn, {
        outDay: dayOf(loan.postedAt), today, terms, projectNumber: loan.projectNumber,
        projectEnd: loan.project?.endDate ? dayOf(loan.project.endDate) : null, canExceedMax: input.canExceedMaxLoan === true,
      });
      if (problem) throw Errors.validation(problem);

      const extension = await tx.toolLoanExtension.create({
        data: { loanId: loan.id, dueOn: asDate(input.dueOn), reason, actorId: input.actorId },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId,
          action: 'TOOL_LOAN_EXTEND',
          entityType: 'ToolLoan',
          entityId: loan.id,
          before: { dueOn: current } as Prisma.InputJsonValue,
          after: { dueOn: input.dueOn, reason, extensionId: extension.id } as Prisma.InputJsonValue,
        },
      });
      return { loanId: loan.id, dueOn: input.dueOn, previousDueOn: current, extensionId: extension.id };
    });
  },

  /**
   * One loan from check-out to now: every check-out, due date change and
   * check-in in order, with the days it went overdue worked out between them.
   * Any of the loan's rows leads here: the check-out, a check-in or a change
   * all name the loan.
   */
  async history(loanId: string, now = new Date()): Promise<LoanHistory> {
    const loan = await prisma.inventoryTransaction.findUnique({
      where: { id: loanId },
      include: {
        material: { select: { sku: true, name: true } },
        location: { select: { name: true } },
        recipient: { select: { name: true } },
        actor: { select: { name: true } },
        loanExtensions: { include: { actor: { select: { name: true } } } },
      },
    });
    if (!loan || loan.type !== InventoryTransactionType.LOAN) throw Errors.notFound('Tool check-out');
    const [returns, terms] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where: { type: InventoryTransactionType.LOAN_RETURN, referenceType: TOOL_LOAN_REFERENCE, referenceId: loan.id },
        include: { actor: { select: { name: true } } },
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
      }),
      loanTerms(),
    ]);
    const dates = loanDatesOf(loan, loan.loanExtensions, terms);
    const byId = new Map(loan.loanExtensions.map((e) => [e.id, e]));
    const lent = loan.quantity.negated();

    // What was recorded, oldest first; a check-in made in the same moment as a change comes after it.
    const recorded: Array<{ at: Date; out: Decimal; event: LoanEvent }> = [
      {
        at: loan.postedAt, out: lent,
        event: {
          kind: 'CHECKED_OUT' as const, at: loan.postedAt.toISOString(), by: loan.actor.name, quantity: lent.toString(),
          dueOn: dates.agreed, note: loan.reasonNote, overdueOverrideReason: loan.overdueOverrideReason,
        },
      },
      ...dates.changes.map((c) => ({
        at: c.at, out: toDecimal(0),
        event: {
          kind: 'DUE_DATE_CHANGED' as const, at: c.at.toISOString(), by: byId.get(c.id)!.actor.name,
          dueOn: c.dueOn, previousDueOn: dueOnBefore(dates, c.id), reason: byId.get(c.id)!.reason,
        },
      })),
      ...returns.map((r) => {
        const dueOn = dueOnAt(dates, r.postedAt);
        return {
          at: r.postedAt, out: r.quantity.negated(),
          event: {
            kind: 'CHECKED_IN' as const, at: r.postedAt.toISOString(), by: r.actor.name, quantity: r.quantity.toString(),
            condition: (r.reasonCode === AdjustmentReasonCode.DAMAGE ? 'DAMAGED' : r.reasonCode === AdjustmentReasonCode.LOSS ? 'LOST' : 'GOOD') as ToolCondition,
            note: r.reasonNote, dueOn, daysLate: daysBetween(dueOn, dayOf(r.postedAt)),
          },
        };
      }),
    ].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.event.kind === 'CHECKED_IN' ? 1 : 0) - (b.event.kind === 'CHECKED_IN' ? 1 : 0));

    // Between one record and the next, a loan still out goes overdue the day after it is due.
    const events: LoanEvent[] = [];
    let out = toDecimal(0);
    recorded.forEach((r, i) => {
      events.push(r.event);
      out = out.plus(r.out);
      const until = recorded[i + 1]?.at ?? now;
      const due = dueOnAt(dates, r.at);
      const overdueFrom = asDate(addDays(due, 1));
      if (out.gt(0) && overdueFrom > r.at && overdueFrom <= until) {
        events.push({ kind: 'BECAME_OVERDUE', at: overdueFrom.toISOString(), dueOn: due });
      }
    });

    const dueOn = currentDueOn(dates);
    const { state, daysLate } = loanState(dueOn, dayOf(now), terms);
    return {
      loanId: loan.id,
      materialId: loan.materialId,
      sku: loan.material.sku,
      name: loan.material.name,
      recipientName: loan.recipient?.name ?? null,
      projectNumber: loan.projectNumber,
      locationName: loan.location.name,
      quantity: lent.toString(),
      out: out.toString(),
      dueOn,
      state: out.gt(0) ? state : null,
      daysLate,
      events,
    };
  },
};
