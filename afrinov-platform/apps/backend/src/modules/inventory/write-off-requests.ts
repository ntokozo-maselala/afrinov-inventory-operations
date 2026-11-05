// Recording an adjustment for someone else to approve (ADR-028), and what is
// waiting. Used by a manual adjustment, a stock count and a tool checked in
// as lost; approving and rejecting are in write-off-approval.service.ts.
import { Prisma, AdjustmentRequestStatus } from '@prisma/client';
import type { AdjustmentInput } from './inventory.service.js';
import type { WriteOffCheck } from './write-off-limit.js';

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
  await tx.auditLogEntry.create({
    data: {
      actorId: input.actorId, action: 'WRITE_OFF_REQUEST', entityType: 'AdjustmentRequest', entityId: request.id,
      after: {
        quantity: quantity.toString(), reasonCode: input.reasonCode, value: check.value?.toString() ?? null, limit: check.limit.toString(),
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
    where: { status: AdjustmentRequestStatus.PENDING, referenceType: 'ToolLoan', referenceId: { in: loanIds } },
    select: { referenceId: true, quantity: true },
  });
  const out = new Map<string, Prisma.Decimal>();
  for (const r of rows) out.set(r.referenceId!, (out.get(r.referenceId!) ?? new Prisma.Decimal(0)).plus(r.quantity.negated()));
  return out;
}
