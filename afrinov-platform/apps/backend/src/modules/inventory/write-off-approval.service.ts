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
import { Prisma, AdjustmentRequestStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { InventoryService, checkAdjustment, type AdjustmentInput } from './inventory.service.js';
import { checkWriteOff } from './write-off-limit.js';
import { requestAdjustment } from './write-off-requests.js';
import { ToolLoanService, TOOL_LOAN_REFERENCE } from './tool-loan.service.js';

export type AdjustOutcome =
  | { status: 'POSTED'; transactionId: string }
  | { status: 'PENDING_APPROVAL'; requestId: string; value: string | null; limit: string };

const OWN_REQUEST = 'You asked for this adjustment, so someone else must approve it.';

async function lockRequest(id: string, tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT id FROM adjustment_requests WHERE id = ${id} FOR UPDATE`;
  const request = await tx.adjustmentRequest.findUnique({ where: { id } });
  if (!request) throw Errors.notFound('AdjustmentRequest');
  if (request.status !== AdjustmentRequestStatus.PENDING) {
    throw Errors.invalidState(`This adjustment was already ${request.status === 'APPROVED' ? 'approved' : 'rejected'}.`, { status: request.status });
  }
  return request;
}

const listed = {
  material: { select: { id: true, sku: true, name: true, unitOfMeasure: true } },
  location: { select: { id: true, name: true } },
  recipient: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.AdjustmentRequestInclude;

export const WriteOffApprovalService = {
  /**
   * Posts the adjustment, or, worth more than the limit, records it for
   * someone else to approve. Checked either way, so a request that could not
   * be posted (too little stock, an inactive item) is refused at once.
   */
  async adjustOrRequest(input: AdjustmentInput, within?: Prisma.TransactionClient): Promise<AdjustOutcome> {
    return inTx(within, async (tx) => {
      const material = await tx.material.findUnique({ where: { id: input.materialId }, select: { unitCost: true } });
      if (!material) throw Errors.notFound('Material');
      const qty = await checkAdjustment(input, tx);
      const check = await checkWriteOff(qty, material.unitCost, tx);
      if (!check.needsApproval) {
        const { transactionId } = await InventoryService.adjust(input, tx);
        return { status: 'POSTED', transactionId };
      }
      const { requestId } = await requestAdjustment({ ...input, quantity: qty }, check, tx);
      return { status: 'PENDING_APPROVAL', requestId, value: check.value?.toFixed(2) ?? null, limit: check.limit.toFixed(2) };
    });
  },

  /** Requests, newest first: those waiting by default. */
  async list(filter: { status?: AdjustmentRequestStatus } = {}) {
    const rows = await prisma.adjustmentRequest.findMany({
      where: { status: filter.status ?? AdjustmentRequestStatus.PENDING },
      include: listed,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((r) => ({
      ...r,
      quantity: r.quantity.toString(),
      value: r.value?.toFixed(2) ?? null,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
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
      const now = new Date();
      await tx.adjustmentRequest.update({
        where: { id },
        data: { status: AdjustmentRequestStatus.APPROVED, decidedById: actorId, decidedAt: now, transactionId },
      });
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
   * own; anyone else needs the right to approve (mayDecide).
   */
  async reject(id: string, reason: string, actorId: string, mayDecide: boolean, within?: Prisma.TransactionClient): Promise<{ id: string }> {
    const note = reason.trim();
    if (!note) throw Errors.validation('Say why it is rejected.');
    return inTx(within, async (tx) => {
      const request = await lockRequest(id, tx);
      const own = request.requestedById === actorId;
      if (!own && !mayDecide) throw Errors.forbidden('Only someone who approves write-offs can reject another person\'s.');
      await tx.adjustmentRequest.update({
        where: { id },
        data: { status: AdjustmentRequestStatus.REJECTED, decidedById: actorId, decidedAt: new Date(), decisionNote: note },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId, action: own ? 'WRITE_OFF_WITHDRAW' : 'WRITE_OFF_REJECT', entityType: 'AdjustmentRequest', entityId: id,
          before: { status: 'PENDING' }, after: { status: 'REJECTED', reason: note },
        },
      });
      return { id };
    });
  },
};
