// Tool check-out and check-in. A tool is lent, not used up: a check-out is a
// LOAN movement that takes it off its location to a named recipient (and
// project), and a check-in is a LOAN_RETURN that brings it back to the same
// location, saying whether it came back in good order or damaged. A tool lost
// on loan comes back on paper and is written off at once (ADJUSTMENT, LOSS),
// so it is neither out nor owned any more. Several tools lent to one person at
// once share a slip (issueId), as an issue does.
//
// Every loan has a due date, agreed at check-out and kept on the LOAN row. A
// later date is an extension with a reason (tool_loan_extensions); the loan
// row is never changed. Whether a loan is due soon, overdue or needs a
// decision is worked out from the due date each time (tool-loan-terms.ts).
//
// Loans are corrected by checking the tool in or out again, not by reversing
// the movement (see InventoryService.reverse).
import { randomUUID } from 'node:crypto';
import { AdjustmentReasonCode, InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { recomputeBalance, getCurrentBalance, lockInventoryBalances } from '../../shared/inventory/balances.js';
import { checkLocationActive, checkMaterialActive, checkProjectActive, checkRecipientActive } from './inventory.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  TERM_SETTINGS, dayOf, defaultDueOn, dueOnProblem, effectiveDueOn, loanState, overdueBlocksCheckout, termsFrom,
  type LoanState, type LoanTerms,
} from './tool-loan-terms.js';

type Decimal = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export const TOOL_LOAN_REFERENCE = 'ToolLoan';

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

export interface ExtendInput {
  loanId: string;
  /** YYYY-MM-DD, after the current due date. */
  dueOn: string;
  reason: string;
  /** The caller may set a due date past the longest loan (an administrator). */
  canExceedMaxLoan?: boolean;
  actorId: string;
}

export interface LoanExtension {
  dueOn: string;
  reason: string;
  extendedBy: string;
  extendedAt: string;
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

async function loanTerms(): Promise<LoanTerms> {
  return termsFrom(await SettingsService.getValues(Object.values(TERM_SETTINGS)));
}

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** When a loan row is due, from its own date and its extensions (any order). */
function dueOf(loan: { postedAt: Date; dueOn: Date | null; loanExtensions: Array<{ dueOn: Date }> }, terms: LoanTerms): string {
  const extendedTo = loan.loanExtensions.reduce<string | null>((latest, e) => {
    const day = dayOf(e.dueOn);
    return latest === null || day > latest ? day : latest;
  }, null);
  return effectiveDueOn({ outDay: dayOf(loan.postedAt), dueOn: loan.dueOn ? dayOf(loan.dueOn) : null, extendedTo }, terms);
}

/** The recipient's loans still out and past their due date, most overdue first. */
async function overdueLoansOf(tx: Tx, recipientId: string, today: string, terms: LoanTerms): Promise<OverdueLoan[]> {
  const loans = await tx.inventoryTransaction.findMany({
    where: { type: InventoryTransactionType.LOAN, recipientId },
    include: { material: { select: { sku: true, name: true } }, loanExtensions: { select: { dueOn: true } } },
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
      prisma.inventoryBalance.findMany({ where: { materialId: { in: ids } }, include: { location: { select: { name: true } } } }),
      prisma.inventoryTransaction.findMany({
        where: { type: InventoryTransactionType.LOAN, materialId: { in: ids } },
        include: {
          recipient: { select: { name: true } },
          location: { select: { name: true } },
          actor: { select: { name: true } },
          loanExtensions: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } },
        },
        orderBy: { postedAt: 'asc' },
      }),
    ]);
    const [returned, terms] = await Promise.all([returnedByLoan(prisma, loans.map((l) => l.id)), loanTerms()]);
    const today = dayOf(now);

    const open = new Map<string, OpenLoan[]>();
    for (const l of loans) {
      const lent = l.quantity.negated();
      const out = lent.minus(returned.get(l.id) ?? 0);
      if (!out.gt(0)) continue;
      const dueOn = dueOf(l, terms);
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
        checkedOutAt: l.postedAt.toISOString(),
        checkedOutBy: l.actor.name,
        note: l.reasonNote,
        daysOut: Math.floor((now.getTime() - l.postedAt.getTime()) / 86_400_000),
        dueOn,
        daysLate,
        state,
        overdue: daysLate > 0,
        extensions: l.loanExtensions.map((e) => ({
          dueOn: dayOf(e.dueOn), reason: e.reason, extendedBy: e.actor.name, extendedAt: e.createdAt.toISOString(),
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
      await lockInventoryBalances([...totals.values()], tx);
      await checkRecipientActive(input.recipientId, tx);
      if (input.projectNumber) await checkProjectActive(input.projectNumber, tx);
      for (const t of totals.values()) {
        const material = await checkMaterialActive(t.materialId, tx);
        if (material.category !== 'TOOLS') throw Errors.validation(`${material.sku} is not a tool; issue it on Issue stock instead`);
        await checkLocationActive(t.locationId, tx);
        const inStore = await getCurrentBalance(t.materialId, t.locationId, tx);
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
          },
        });
        loanIds.push(loan.id);
      }
      for (const t of totals.values()) await recomputeBalance(t.materialId, t.locationId, tx);

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

  /** Take tools back, each against its loan: in good order, damaged, or lost (written off). */
  async checkIn(input: CheckInInput): Promise<{ returnIds: string[]; writeOffIds: string[] }> {
    if (input.lines.length === 0) throw Errors.validation('Add at least one tool to check in');
    const lines = input.lines.map((l) => ({ ...l, qty: toDecimal(l.quantity), note: l.note?.trim() || null }));
    if (lines.some((l) => !gtZero(l.qty))) throw Errors.validation('Check-in quantity must be positive');
    if (lines.some((l) => l.condition === 'LOST' && !l.note)) throw Errors.validation('Say what happened to a lost tool');

    return prisma.$transaction(async (tx) => {
      const loanIds = [...new Set(lines.map((l) => l.loanId))];
      const loans = await tx.inventoryTransaction.findMany({
        where: { id: { in: loanIds } },
        include: { recipient: { select: { name: true } }, material: { select: { sku: true } } },
      });
      const byId = new Map(loans.map((l) => [l.id, l]));
      for (const id of loanIds) {
        const loan = byId.get(id);
        if (!loan) throw Errors.notFound('Tool check-out');
        if (loan.type !== InventoryTransactionType.LOAN) throw Errors.invalidState('Only a tool check-out can be checked in');
      }
      await lock(tx, loans.map((l) => `${l.materialId}:${l.locationId}`));
      await lockInventoryBalances(loans, tx);

      // Read after the lock, so two check-ins of one loan cannot both pass.
      const returned = await returnedByLoan(tx, loanIds);
      const asked = new Map<string, Decimal>();
      for (const l of lines) asked.set(l.loanId, (asked.get(l.loanId) ?? toDecimal(0)).plus(l.qty));
      for (const [id, qty] of asked) {
        const loan = byId.get(id)!;
        const out = loan.quantity.negated().minus(returned.get(id) ?? 0);
        if (qty.gt(out)) {
          throw Errors.validation(`Cannot check in ${qty.toString()} × ${loan.material.sku}: only ${out.toString()} still checked out.`, { loanId: id, out: out.toString() });
        }
        await checkLocationActive(loan.locationId, tx);
      }

      const postedAt = new Date();
      const returnIds: string[] = [];
      const writeOffIds: string[] = [];
      for (const l of lines) {
        const loan = byId.get(l.loanId)!;
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
            reasonCode: l.condition === 'DAMAGED' ? AdjustmentReasonCode.DAMAGE : l.condition === 'LOST' ? AdjustmentReasonCode.LOSS : null,
            reasonNote: l.note,
            referenceType: TOOL_LOAN_REFERENCE,
            referenceId: loan.id,
          },
        });
        returnIds.push(back.id);
        if (l.condition === 'LOST') {
          const writeOff = await tx.inventoryTransaction.create({
            data: {
              postedAt,
              materialId: loan.materialId,
              locationId: loan.locationId,
              type: InventoryTransactionType.ADJUSTMENT,
              quantity: l.qty.negated(),
              actorId: input.actorId,
              recipientId: loan.recipientId,
              projectNumber: loan.projectNumber,
              reasonCode: AdjustmentReasonCode.LOSS,
              reasonNote: `Lost while checked out to ${loan.recipient?.name ?? 'an unknown recipient'}: ${l.note}`,
              referenceType: TOOL_LOAN_REFERENCE,
              referenceId: loan.id,
            },
          });
          writeOffIds.push(writeOff.id);
        }
      }
      for (const key of new Set(loans.map((l) => `${l.materialId}|${l.locationId}`))) {
        const [materialId, locationId] = key.split('|') as [string, string];
        await recomputeBalance(materialId, locationId, tx);
      }

      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId,
          action: 'TOOL_CHECK_IN',
          entityType: 'ToolLoan',
          entityId: loanIds[0]!,
          after: { lines: lines.map((l) => ({ loanId: l.loanId, quantity: l.qty.toString(), condition: l.condition })), returnIds, writeOffIds } as Prisma.InputJsonValue,
        },
      });
      return { returnIds, writeOffIds };
    });
  },

  /**
   * Give a loan still out a later due date, with a reason. Recorded as an
   * extension; the loan and its earlier dates are kept. Same limits as at
   * check-out: not before today, not after the project ends, and no more than
   * the longest loan from check-out unless the caller may exceed it.
   */
  async extend(input: ExtendInput, within?: Tx): Promise<{ loanId: string; dueOn: string; extensionId: string }> {
    const reason = input.reason.trim();
    if (!reason) throw Errors.validation('Say why the loan is extended');

    return inTx(within, async (tx) => {
      // One extension of a loan at a time, so two cannot both pass the "after the current date" check.
      await lock(tx, [`loan:${input.loanId}`]);
      const loan = await tx.inventoryTransaction.findUnique({
        where: { id: input.loanId },
        include: { project: { select: { endDate: true } }, loanExtensions: { select: { dueOn: true } } },
      });
      if (!loan) throw Errors.notFound('Tool check-out');
      if (loan.type !== InventoryTransactionType.LOAN) throw Errors.invalidState('Only a tool check-out can be extended');
      const returned = await returnedByLoan(tx, [loan.id]);
      if (!loan.quantity.negated().minus(returned.get(loan.id) ?? 0).gt(0)) {
        throw Errors.invalidState('This check-out is all back already, so there is nothing to extend');
      }

      const terms = await loanTerms();
      const today = dayOf(new Date());
      const current = dueOf(loan, terms);
      if (input.dueOn <= current) throw Errors.validation(`The new due date must be after the current one, ${current}.`);
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
      return { loanId: loan.id, dueOn: input.dueOn, extensionId: extension.id };
    });
  },
};
