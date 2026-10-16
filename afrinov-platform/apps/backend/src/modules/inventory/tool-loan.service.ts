// Tool check-out and check-in. A tool is lent, not used up: a check-out is a
// LOAN movement that takes it off its location to a named recipient (and
// project), and a check-in is a LOAN_RETURN that brings it back to the same
// location, saying whether it came back in good order or damaged. A tool lost
// on loan comes back on paper and is written off at once (ADJUSTMENT, LOSS),
// so it is neither out nor owned any more. Several tools lent to one person at
// once share a slip (issueId), as an issue does.
//
// Loans are corrected by checking the tool in or out again, not by reversing
// the movement (see InventoryService.reverse).
import { randomUUID } from 'node:crypto';
import { AdjustmentReasonCode, InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { recomputeBalance, getCurrentBalance } from '../../shared/inventory/balances.js';
import { checkLocationActive, checkMaterialActive, checkProjectActive, checkRecipientActive } from './inventory.service.js';
import { SettingsService } from '../settings/settings.service.js';

type Decimal = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export const TOOL_LOAN_REFERENCE = 'ToolLoan';

export type ToolCondition = 'GOOD' | 'DAMAGED' | 'LOST';

export interface CheckOutInput {
  recipientId: string;
  projectNumber?: string;
  note?: string;
  lines: Array<{ materialId: string; locationId: string; quantity: number | string | Decimal }>;
  actorId: string;
}

export interface CheckInInput {
  lines: Array<{ loanId: string; quantity: number | string | Decimal; condition: ToolCondition; note?: string }>;
  actorId: string;
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
  /** Out longer than inventory.toolOverdueDays. */
  overdue: boolean;
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

export const ToolLoanService = {
  /** Every active tool with what is in store where, what is out, with whom, and since when. */
  async list(now = new Date()): Promise<ToolRow[]> {
    const tools = await prisma.material.findMany({ where: { category: 'TOOLS', active: true }, orderBy: { name: 'asc' } });
    const ids = tools.map((t) => t.id);
    if (ids.length === 0) return [];
    const [balances, loans] = await Promise.all([
      prisma.inventoryBalance.findMany({ where: { materialId: { in: ids } }, include: { location: { select: { name: true } } } }),
      prisma.inventoryTransaction.findMany({
        where: { type: InventoryTransactionType.LOAN, materialId: { in: ids } },
        include: { recipient: { select: { name: true } }, location: { select: { name: true } }, actor: { select: { name: true } } },
        orderBy: { postedAt: 'asc' },
      }),
    ]);
    const [returned, overdueDays] = await Promise.all([
      returnedByLoan(prisma, loans.map((l) => l.id)),
      SettingsService.getValue<number>('inventory.toolOverdueDays'),
    ]);

    const open = new Map<string, OpenLoan[]>();
    for (const l of loans) {
      const lent = l.quantity.negated();
      const out = lent.minus(returned.get(l.id) ?? 0);
      if (!out.gt(0)) continue;
      const daysOut = Math.floor((now.getTime() - l.postedAt.getTime()) / 86_400_000);
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
        daysOut,
        overdue: daysOut > Number(overdueDays ?? 7),
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

  /** Lend tools to one recipient (and project) at once, as one slip. */
  async checkOut(input: CheckOutInput): Promise<{ slipId: string; loanIds: string[] }> {
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

      const slipId = randomUUID();
      const postedAt = new Date();
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
          after: { recipientId: input.recipientId, projectNumber: input.projectNumber ?? null, loanIds } as Prisma.InputJsonValue,
        },
      });
      return { slipId, loanIds };
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
        if (!loan) throw Errors.notFound('Tool loan');
        if (loan.type !== InventoryTransactionType.LOAN) throw Errors.invalidState('Only a tool check-out can be checked in');
      }
      await lock(tx, loans.map((l) => `${l.materialId}:${l.locationId}`));

      // Read after the lock, so two check-ins of one loan cannot both pass.
      const returned = await returnedByLoan(tx, loanIds);
      const asked = new Map<string, Decimal>();
      for (const l of lines) asked.set(l.loanId, (asked.get(l.loanId) ?? toDecimal(0)).plus(l.qty));
      for (const [id, qty] of asked) {
        const loan = byId.get(id)!;
        const out = loan.quantity.negated().minus(returned.get(id) ?? 0);
        if (qty.gt(out)) {
          throw Errors.validation(`Cannot check in ${qty.toString()} × ${loan.material.sku}: only ${out.toString()} still out on this loan.`, { loanId: id, out: out.toString() });
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
              reasonNote: `Lost on loan to ${loan.recipient?.name ?? 'an unknown recipient'}: ${l.note}`,
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
};
