// Write-offs and other adjustments over a value limit wait for someone else's
// approval (segregation of duties): one person posting a large loss, or stock
// out of nowhere, unchecked is how stock losses are hidden. When one needs
// approval is decided in write-off-limit.ts. Below the limit an adjustment
// posts at once, as before.
//
// Nothing moves while a request waits. Approving posts the ADJUSTMENT, booked
// to whoever asked for it, with the approver on the request and in the audit
// log; rejecting posts nothing. Nobody approves their own. A tool lost on loan
// stays on loan while it waits: approving posts its return and its write-off
// together, as checking it in as lost within the limit does.
//
// An approver may also send one back for changes (ADR-044, FR-INV-WF-001):
// it stays open, holding its stock, until whoever asked amends it and sends it
// again, or withdraws it. Every step is a row of adjustment_request_events,
// with the request as it stood, so each revision and decision can be read back.
import { Prisma, AdjustmentRequestStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { InventoryService, checkAdjustment, checkRequestedAdjustment, type AdjustmentInput } from './inventory.service.js';
import { checkWriteOff, recentWriteOffQuantity } from './write-off-limit.js';
import { requestAdjustment, recordRequestEvent, OPEN_ADJUSTMENT_STATUSES } from './write-off-requests.js';
import { lockInventoryBalances } from '../../shared/inventory/balances.js';
import { ToolLoanService, TOOL_LOAN_REFERENCE } from './tool-loan.service.js';
import { resolveRepair, TOOL_REPAIR_REFERENCE } from '../../shared/inventory/tool-repairs.js';
import { pageCursor, parseCursor, saDayOf } from '../../shared/dates.js';

/** Whole South African days from one moment to another: 0 on the same day. */
const daysBetweenDays = (from: Date, to: Date) => Math.max(0, Math.round((Date.parse(`${saDayOf(to)}T00:00:00Z`) - Date.parse(`${saDayOf(from)}T00:00:00Z`)) / 86_400_000));

export type AdjustOutcome =
  | { status: 'POSTED'; transactionId: string }
  | { status: 'PENDING_APPROVAL'; requestId: string; value: string | null; limit: string; recentValue: string | null };

/** How long a rejection is pointed out to whoever asked, on the Dashboard and Write-offs. */
export const REJECTED_NOTICE_DAYS = 7;

const OWN_REQUEST = 'You asked for this adjustment, so someone else must approve it.';
const SENT_BACK = 'This adjustment was sent back for changes. It can be decided once it is sent again.';
const NOT_SENT_BACK = 'This adjustment is waiting for approval: it was not sent back for changes.';

/** The request, held FOR UPDATE, in one of the states the step takes: waiting, unless said otherwise. */
async function lockRequest(id: string, tx: Prisma.TransactionClient, allowed: AdjustmentRequestStatus[] = [AdjustmentRequestStatus.PENDING]) {
  await tx.$executeRaw`SELECT id FROM adjustment_requests WHERE id = ${id} FOR UPDATE`;
  const request = await tx.adjustmentRequest.findUnique({ where: { id } });
  if (!request) throw Errors.notFound('AdjustmentRequest');
  if (!allowed.includes(request.status)) {
    const message = request.status === 'CHANGES_REQUESTED' ? SENT_BACK
      : request.status === 'PENDING' ? NOT_SENT_BACK
        : `This adjustment was already ${request.status === 'APPROVED' ? 'approved' : request.status === 'WITHDRAWN' ? 'withdrawn' : 'rejected'}.`;
    throw Errors.invalidState(message, { status: request.status });
  }
  return request;
}

/** What whoever asked may change before sending it again; a field left out stays as it is. */
export interface ResubmitInput {
  quantity?: number | string | Prisma.Decimal;
  reasonCode?: AdjustmentInput['reasonCode'];
  reasonNote?: string | null;
  /** null: nobody is named any more. */
  recipientId?: string | null;
  /** What was changed, for the approver. */
  comment?: string;
}

const REFERENCE_SOURCE: Record<string, string> = {
  StockCount: 'a stock count: to change it, withdraw it and count again',
  [TOOL_LOAN_REFERENCE]: 'a tool checked in as lost: to change it, withdraw it and check the tool in again',
  [TOOL_REPAIR_REFERENCE]: 'a tool held for repair: to change it, withdraw it and write the tool off again',
};

const listed = {
  material: { select: { id: true, sku: true, name: true, unitOfMeasure: true } },
  location: { select: { id: true, name: true } },
  recipient: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  events: { orderBy: [{ at: 'asc' }, { id: 'asc' }], include: { actor: { select: { id: true, name: true } } } },
} satisfies Prisma.AdjustmentRequestInclude;

export const WriteOffApprovalService = {
  /**
   * Posts the adjustment, or, worth more than the limit, records it for
   * someone else to approve. Checked either way, so a request that could not
   * be posted (too little stock, an inactive item) is refused at once.
   */
  async adjustOrRequest(input: AdjustmentInput, within?: Prisma.TransactionClient): Promise<AdjustOutcome> {
    return inTx(within, async (tx) => {
      const material = await tx.material.findUnique({ where: { id: input.materialId }, select: { sku: true, unitCost: true } });
      if (!material) throw Errors.notFound('Material');
      await checkRequestedAdjustment(input, tx);
      // The lock a stock count takes before it looks for waiting requests, so
      // the two can't both see none. With one already waiting for this stock
      // (a count's difference, a lost tool, another adjustment), approving both
      // would correct the same shortfall twice: that one is decided first.
      const stock = { materialId: input.materialId, locationId: input.locationId, heldForProject: input.heldForProject ?? null };
      await lockInventoryBalances([stock], tx);
      const waiting = await tx.adjustmentRequest.findFirst({ where: { status: { in: OPEN_ADJUSTMENT_STATUSES }, ...stock }, select: { id: true } });
      if (waiting) {
        throw Errors.invalidState(`${material.sku} here already has an adjustment waiting for approval. Approve or reject it under Write-offs to approve, then adjust again.`, { requestId: waiting.id });
      }
      const qty = await checkAdjustment(input, tx);
      // Judged with this person's other write-offs of the item this week (system audit C2).
      const recent = qty.isNegative() ? await recentWriteOffQuantity({ actorId: input.actorId, materialId: input.materialId }, tx) : undefined;
      const check = await checkWriteOff(qty, material.unitCost, tx, recent);
      if (!check.needsApproval) {
        const { transactionId } = await InventoryService.adjust(input, tx);
        return { status: 'POSTED', transactionId };
      }
      const { requestId } = await requestAdjustment({ ...input, quantity: qty }, check, tx);
      return { status: 'PENDING_APPROVAL', requestId, value: check.value?.toFixed(2) ?? null, limit: check.limit.toFixed(2), recentValue: check.recentValue?.toFixed(2) ?? null };
    });
  },

  /**
   * Requests, newest first, a page at a time (`before`, a cursor from the last
   * row): those waiting by default. Each says how many days it has waited, or
   * waited before it was decided (system audit C8), and carries its history:
   * every time it was sent, sent back or decided, with the request as it
   * stood then (ADR-044). `requestedById` keeps one person's own.
   */
  async list(filter: { status?: AdjustmentRequestStatus; requestedById?: string; before?: string; limit?: number } = {}, now = new Date()) {
    const where: Prisma.AdjustmentRequestWhereInput = { status: filter.status ?? AdjustmentRequestStatus.PENDING };
    if (filter.requestedById) where.requestedById = filter.requestedById;
    if (filter.before) {
      const { at, id } = parseCursor(filter.before);
      where.OR = [{ requestedAt: { lt: at } }, { requestedAt: at, id: { lt: id } }];
    }
    const rows = await prisma.adjustmentRequest.findMany({
      where,
      include: listed,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(filter.limit ?? 100, 1), 200),
    });
    return rows.map((r) => ({
      ...r,
      cursor: pageCursor(r.requestedAt, r.id),
      daysWaiting: daysBetweenDays(r.requestedAt, r.decidedAt ?? now),
      quantity: r.quantity.toString(),
      value: r.value?.toFixed(2) ?? null,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      // Its quantity comes from a count or a tool: only the note can be amended.
      amendable: r.referenceType ? 'NOTE' as const : 'ALL' as const,
      events: r.events.map((e) => ({
        id: e.id, kind: e.kind, at: e.at.toISOString(), actor: e.actor, note: e.note,
        quantity: e.quantity.toString(), reasonCode: e.reasonCode, reasonNote: e.reasonNote, value: e.value?.toFixed(2) ?? null,
      })),
    }));
  },

  /**
   * How many wait for approval, and since when the oldest has (system audit
   * C8), for the Dashboard. For whoever is asking (ADR-044): how many of their
   * own were sent back to them for changes, and how many someone else rejected
   * in the last 7 days.
   */
  async summary(actorId?: string, now = new Date()): Promise<{ waiting: number; oldestRequestedAt: string | null; oldestDays: number | null; sentBackToMe: number; rejectedForMe: number }> {
    const since = new Date(now.getTime() - REJECTED_NOTICE_DAYS * 86_400_000);
    const [waiting, oldest, sentBackToMe, rejectedForMe] = await Promise.all([
      prisma.adjustmentRequest.count({ where: { status: AdjustmentRequestStatus.PENDING } }),
      prisma.adjustmentRequest.findFirst({ where: { status: AdjustmentRequestStatus.PENDING }, orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }], select: { requestedAt: true } }),
      actorId ? prisma.adjustmentRequest.count({ where: { status: AdjustmentRequestStatus.CHANGES_REQUESTED, requestedById: actorId } }) : 0,
      actorId ? prisma.adjustmentRequest.count({ where: { status: AdjustmentRequestStatus.REJECTED, requestedById: actorId, decidedById: { not: actorId }, decidedAt: { gte: since } } }) : 0,
    ]);
    return { waiting, oldestRequestedAt: oldest?.requestedAt.toISOString() ?? null, oldestDays: oldest ? daysBetweenDays(oldest.requestedAt, now) : null, sentBackToMe, rejectedForMe };
  },

  /** Posts the adjustment someone else asked for, if it still can be. */
  async approve(id: string, actorId: string, within?: Prisma.TransactionClient): Promise<{ id: string; transactionId: string }> {
    return inTx(within, async (tx) => {
      const request = await lockRequest(id, tx);
      if (request.requestedById === actorId) throw Errors.forbidden(OWN_REQUEST);
      // Checked again: stock may have moved, the tool come back, or the item
      // been retired, since it was asked for.
      const { transactionId } = request.referenceType === TOOL_LOAN_REFERENCE
        ? await ToolLoanService.writeOffLost({
          loanId: request.referenceId!, quantity: request.quantity.negated(), reasonNote: request.reasonNote ?? '', actorId: request.requestedById,
        }, tx)
        : await InventoryService.adjust({
          materialId: request.materialId,
          locationId: request.locationId,
          heldForProject: request.heldForProject,
          quantity: request.quantity,
          reasonCode: request.reasonCode,
          reasonNote: request.reasonNote ?? undefined,
          recipientId: request.recipientId,
          projectNumber: request.projectNumber,
          referenceType: request.referenceType,
          referenceId: request.referenceId,
          actorId: request.requestedById,
        }, tx);
      // A tool held for repair, written off: its repair closes (system audit B2).
      if (request.referenceType === TOOL_REPAIR_REFERENCE && request.referenceId) {
        await resolveRepair(tx, request.referenceId, 'WRITTEN_OFF', { actorId: request.requestedById, note: request.reasonNote, transactionId });
      }
      const now = new Date();
      await tx.adjustmentRequest.update({
        where: { id },
        data: { status: AdjustmentRequestStatus.APPROVED, decidedById: actorId, decidedAt: now, transactionId },
      });
      await recordRequestEvent(request, 'APPROVED', actorId, null, tx);
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'WRITE_OFF_APPROVE', entityType: 'AdjustmentRequest', entityId: id,
          before: { status: 'PENDING' }, after: { status: 'APPROVED', transactionId, requestedById: request.requestedById },
        },
      });
      return { id, transactionId };
    });
  },

  /**
   * Turns it down: nothing is posted. Whoever asked for it may withdraw their
   * own (WITHDRAWN); anyone else needs the right to approve (mayDecide) and
   * rejects it (REJECTED). One sent back for
   * changes can be withdrawn or rejected too.
   */
  async reject(id: string, reason: string, actorId: string, mayDecide: boolean, within?: Prisma.TransactionClient): Promise<{ id: string }> {
    const note = reason.trim();
    if (!note) throw Errors.validation('Say why it is rejected.');
    return inTx(within, async (tx) => {
      const request = await lockRequest(id, tx, OPEN_ADJUSTMENT_STATUSES);
      const own = request.requestedById === actorId;
      if (!own && !mayDecide) throw Errors.forbidden('Only someone who approves write-offs can reject another person\'s.');
      // Taking back one's own is a withdrawal, never a rejection: its own
      // status, audit action and history step (ADR-044).
      const status = own ? AdjustmentRequestStatus.WITHDRAWN : AdjustmentRequestStatus.REJECTED;
      await tx.adjustmentRequest.update({
        where: { id },
        data: { status, decidedById: actorId, decidedAt: new Date(), decisionNote: note },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId, action: own ? 'WRITE_OFF_WITHDRAW' : 'WRITE_OFF_REJECT', entityType: 'AdjustmentRequest', entityId: id,
          before: { status: request.status }, after: { status, reason: note, requestedById: request.requestedById },
        },
      });
      await recordRequestEvent(request, own ? 'WITHDRAWN' : 'REJECTED', actorId, note, tx);
      return { id };
    });
  },

  /**
   * Sends it back to whoever asked, saying what to change (ADR-044): nothing
   * is posted and it stays open. Only someone who approves, never whoever
   * asked for it.
   */
  async requestChanges(id: string, comment: string, actorId: string, within?: Prisma.TransactionClient): Promise<{ id: string }> {
    const note = comment.trim();
    if (!note) throw Errors.validation('Say what needs to change.');
    return inTx(within, async (tx) => {
      const request = await lockRequest(id, tx);
      if (request.requestedById === actorId) throw Errors.forbidden('You asked for this adjustment, so someone else must review it.');
      await tx.adjustmentRequest.update({
        where: { id },
        data: { status: AdjustmentRequestStatus.CHANGES_REQUESTED, decidedById: actorId, decidedAt: new Date(), decisionNote: note },
      });
      await recordRequestEvent(request, 'CHANGES_REQUESTED', actorId, note, tx);
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'WRITE_OFF_CHANGES_REQUESTED', entityType: 'AdjustmentRequest', entityId: id,
          before: { status: 'PENDING' }, after: { status: 'CHANGES_REQUESTED', comment: note, requestedById: request.requestedById },
        },
      });
      return { id };
    });
  },

  /**
   * Whoever asked amends the adjustment sent back to them and sends it again
   * (ADR-044). It always waits for approval again, whatever it is worth now:
   * an approver asked about it. One made by hand is checked as a new one is;
   * one from a stock count or a tool keeps its quantity and reason, which come
   * from the count or the tool, and takes a new note only.
   */
  async resubmit(id: string, input: ResubmitInput, actorId: string, within?: Prisma.TransactionClient): Promise<{ id: string; status: 'PENDING_APPROVAL'; value: string | null }> {
    return inTx(within, async (tx) => {
      const request = await lockRequest(id, tx, [AdjustmentRequestStatus.CHANGES_REQUESTED]);
      if (request.requestedById !== actorId) throw Errors.forbidden('Only whoever asked for this adjustment can change it and send it again.');

      const quantity = input.quantity === undefined ? request.quantity : new Prisma.Decimal(input.quantity);
      const reasonCode = input.reasonCode ?? request.reasonCode;
      const recipientId = input.recipientId === undefined ? request.recipientId : input.recipientId;
      const reasonNote = input.reasonNote === undefined ? request.reasonNote : input.reasonNote?.trim() || null;

      let value = request.value;
      if (request.referenceType) {
        if (!quantity.equals(request.quantity) || reasonCode !== request.reasonCode || recipientId !== request.recipientId) {
          throw Errors.validation(`This adjustment comes from ${REFERENCE_SOURCE[request.referenceType] ?? 'another record: to change it, withdraw it and start again'}. Only its note can be changed here.`);
        }
      } else {
        const amended: AdjustmentInput = {
          materialId: request.materialId, locationId: request.locationId, heldForProject: request.heldForProject,
          quantity, reasonCode, reasonNote: reasonNote ?? undefined, recipientId, actorId,
        };
        const material = await tx.material.findUnique({ where: { id: request.materialId }, select: { unitCost: true } });
        if (!material) throw Errors.notFound('Material');
        await checkRequestedAdjustment(amended, tx);
        await lockInventoryBalances([{ materialId: request.materialId, locationId: request.locationId, heldForProject: request.heldForProject }], tx);
        await checkAdjustment(amended, tx);
        value = (await checkWriteOff(quantity, material.unitCost, tx)).value;
      }

      const updated = await tx.adjustmentRequest.update({
        where: { id },
        data: { status: AdjustmentRequestStatus.PENDING, quantity, reasonCode, reasonNote, recipientId, value, decidedById: null, decidedAt: null, decisionNote: null },
      });
      await recordRequestEvent(updated, 'RESUBMITTED', actorId, input.comment?.trim() || null, tx);
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'WRITE_OFF_RESUBMIT', entityType: 'AdjustmentRequest', entityId: id,
          before: { status: 'CHANGES_REQUESTED', quantity: request.quantity.toString(), reasonCode: request.reasonCode, reasonNote: request.reasonNote, recipientId: request.recipientId, value: request.value?.toString() ?? null },
          after: { status: 'PENDING', quantity: quantity.toString(), reasonCode, reasonNote, recipientId, value: value?.toString() ?? null },
        },
      });
      return { id, status: 'PENDING_APPROVAL', value: value?.toFixed(2) ?? null };
    });
  },
};
