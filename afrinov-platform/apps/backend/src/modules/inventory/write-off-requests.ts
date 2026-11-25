// Recording an adjustment for someone else to approve (ADR-028), and what is
// waiting. Used by a manual adjustment, a stock count and a tool checked in
// as lost; approving and rejecting are in write-off-approval.service.ts.
import { Prisma, AdjustmentRequestStatus, type AdjustmentRequest, type AdjustmentRequestEventKind } from '@prisma/client';
import type { AdjustmentInput } from './inventory.service.js';
import type { WriteOffCheck } from './write-off-limit.js';

/**
 * A request not yet decided: waiting for an approver, or sent back to whoever
 * asked (ADR-044). Either holds its stock: nothing else adjusts or counts it,
 * and its item, location and project stay open, until it is decided.
 */
export const OPEN_ADJUSTMENT_STATUSES: AdjustmentRequestStatus[] = [AdjustmentRequestStatus.PENDING, AdjustmentRequestStatus.CHANGES_REQUESTED];

/** One step in a request's history, keeping the request as it stands now (ADR-044). */
export async function recordRequestEvent(
  request: Pick<AdjustmentRequest, 'id' | 'quantity' | 'reasonCode' | 'reasonNote' | 'recipientId' | 'value'>,
  kind: AdjustmentRequestEventKind, actorId: string, note: string | null, tx: Prisma.TransactionClient,
  transactionId: string | null = null,
): Promise<void> {
  await tx.adjustmentRequestEvent.create({
    data: {
      requestId: request.id, kind, actorId, note, transactionId,
      quantity: request.quantity, reasonCode: request.reasonCode, reasonNote: request.reasonNote, recipientId: request.recipientId, value: request.value,
    },
  });
}

/** Records an adjustment for someone else to approve, posting nothing. */
export async function requestAdjustment(input: AdjustmentInput, check: WriteOffCheck, tx: Prisma.TransactionClient): Promise<{ requestId: string }> {
  const quantity = new Prisma.Decimal(input.quantity);
  const request = await tx.adjustmentRequest.create({
    data: {
      materialId: input.materialId,
      locationId: input.locationId,
      heldForProject: input.heldForProject ?? null,
      quantity,
      reasonCode: input.reasonCode,
      reasonNote: input.reasonNote?.trim() || null,
      recipientId: input.recipientId ?? null,
      projectNumber: input.projectNumber ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      value: check.value,
      requestedById: input.actorId,
    },
  });
  await recordRequestEvent(request, 'SUBMITTED', input.actorId, null, tx);
  await tx.auditLogEntry.create({
    data: {
      actorId: input.actorId, action: 'WRITE_OFF_REQUEST', entityType: 'AdjustmentRequest', entityId: request.id,
      after: {
        quantity: quantity.toString(), reasonCode: input.reasonCode, value: check.value?.toString() ?? null, limit: check.limit.toString(),
        ...(check.recentValue ? { recentValue: check.recentValue.toString() } : {}),
        referenceType: input.referenceType ?? null, referenceId: input.referenceId ?? null,
      },
    },
  });
  return { requestId: request.id };
}

/**
 * The quantity of each lent tool waiting to be written off as lost, by loan:
 * it is still on loan, so it is neither checked in again nor written off twice.
 */
export async function pendingLostByLoan(loanIds: string[], tx: Pick<Prisma.TransactionClient, 'adjustmentRequest'>): Promise<Map<string, Prisma.Decimal>> {
  const rows = await tx.adjustmentRequest.findMany({
    where: { status: { in: OPEN_ADJUSTMENT_STATUSES }, referenceType: 'ToolLoan', referenceId: { in: loanIds } },
    select: { referenceId: true, quantity: true },
  });
  const out = new Map<string, Prisma.Decimal>();
  for (const r of rows) out.set(r.referenceId!, (out.get(r.referenceId!) ?? new Prisma.Decimal(0)).plus(r.quantity.negated()));
  return out;
}
