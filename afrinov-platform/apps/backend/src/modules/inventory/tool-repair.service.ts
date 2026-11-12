// Dealing with a tool held for repair (system audit B2, ADR-040): it is marked
// repaired, and can be lent again, or written off as damaged. A write-off goes
// through the write-off rules (ADR-028): over the limit, it waits for someone
// else's approval, and the tool stays held until then.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { resolveRepair, TOOL_REPAIR_REFERENCE } from '../../shared/inventory/tool-repairs.js';
import { WriteOffApprovalService, type AdjustOutcome } from './write-off-approval.service.js';

type Tx = Prisma.TransactionClient;

function inTransaction<T>(outer: Tx | undefined, work: (tx: Tx) => Promise<T>): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

/** The repair, held FOR UPDATE, still open, with no write-off of it waiting. */
async function lockOpen(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT 1 FROM "tool_repairs" WHERE "id" = ${id} FOR UPDATE`;
  const repair = await tx.toolRepair.findUnique({ where: { id }, include: { material: { select: { sku: true } } } });
  if (!repair) throw Errors.notFound('Tool repair');
  if (repair.resolvedAt) throw Errors.invalidState('This repair was dealt with already. Refresh the page.');
  const waiting = await tx.adjustmentRequest.findFirst({ where: { status: 'PENDING', referenceType: TOOL_REPAIR_REFERENCE, referenceId: id }, select: { id: true } });
  if (waiting) throw Errors.invalidState(`Writing off ${repair.material.sku} waits for approval under Write-offs to approve. Approve or reject it there first.`, { requestId: waiting.id });
  return repair;
}

export const ToolRepairService = {
  /** Repaired: it can be lent again. */
  async markRepaired(id: string, note: string | undefined, actorId: string, outer?: Tx): Promise<{ id: string; resolution: 'REPAIRED' }> {
    return inTransaction(outer, async (tx) => {
      const repair = await lockOpen(tx, id);
      await resolveRepair(tx, id, 'REPAIRED', { actorId, note });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'TOOL_REPAIRED', entityType: 'ToolRepair', entityId: id, after: { materialId: repair.materialId, locationId: repair.locationId, quantity: repair.quantity.toString(), note: note?.trim() || null } },
      });
      return { id, resolution: 'REPAIRED' as const };
    });
  },

  /**
   * Written off as damaged: posted now, or, over the write-off limit, waiting
   * for someone else's approval, which closes the repair when it posts.
   */
  async writeOff(id: string, note: string, actorId: string, outer?: Tx): Promise<{ id: string } & AdjustOutcome> {
    const reason = note.trim();
    if (!reason) throw Errors.validation('Say why it can\'t be repaired.');
    return inTransaction(outer, async (tx) => {
      const repair = await lockOpen(tx, id);
      const outcome = await WriteOffApprovalService.adjustOrRequest({
        materialId: repair.materialId, locationId: repair.locationId, quantity: repair.quantity.negated(),
        reasonCode: 'DAMAGE', reasonNote: reason, referenceType: TOOL_REPAIR_REFERENCE, referenceId: id, actorId,
      }, tx);
      if (outcome.status === 'POSTED') await resolveRepair(tx, id, 'WRITTEN_OFF', { actorId, note: reason, transactionId: outcome.transactionId });
      return { id, ...outcome };
    });
  },
};
