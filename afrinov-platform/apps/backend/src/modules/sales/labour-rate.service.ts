// The hourly selling rates Sales prices labour at, as the "Manhours and
// Material" sheet's Manpower Rate list. The Workshop Manager keeps them: adds a
// role, changes its name or rate, or makes it inactive when it is no longer
// used. Nothing is deleted, as Sales RFQ lines name the role. A change moves
// only Sales RFQ lines saved after it: each line keeps the rate it was priced at.
// Every change is written to the audit log (entity type LabourRate).
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { cleanText } from '../procurement/supplier-fields.js';

export interface LabourRateInput { role: string; hourlyRate: number }
export interface LabourRateUpdate { role?: string; hourlyRate?: number; active?: boolean }

const asLog = (r: { role: string; hourlyRate: Prisma.Decimal | number; active: boolean }) =>
  ({ role: r.role, hourlyRate: new Prisma.Decimal(r.hourlyRate).toFixed(2), active: r.active });

function checkedRole(role: string): string {
  const cleaned = cleanText(role);
  if (!cleaned) throw Errors.validation('Give the role a name');
  return cleaned;
}

function checkedRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw Errors.validation('The hourly rate must be more than R0');
  if (Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6) {
    throw Errors.validation('The hourly rate is in rand and cents: at most 2 decimal places');
  }
  return rate;
}

/** Another role already called this, whatever its case. */
async function refuseTaken(role: string, exceptId: string | null, tx: Prisma.TransactionClient) {
  const taken = await tx.labourRate.findFirst({ where: { role: { equals: role, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (taken) throw Errors.conflict(`There is already a rate for ${taken.role}${taken.active ? '' : ' (inactive: make it active again instead)'}`);
}

export const LabourRateService = {
  /** By role name; inactive ones too unless asked for active only. */
  async list(filter: { active?: boolean } = {}) {
    return prisma.labourRate.findMany({ where: filter.active === undefined ? {} : { active: filter.active }, orderBy: { role: 'asc' } });
  },

  /** @throws {ApiError} VALIDATION_ERROR for no name or a rate of R0 or less; CONFLICT for a name already listed. */
  async create(input: LabourRateInput, actorId: string) {
    const role = checkedRole(input.role);
    const hourlyRate = checkedRate(input.hourlyRate);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:labour-rate'))`;
      await refuseTaken(role, null, tx);
      const created = await tx.labourRate.create({ data: { role, hourlyRate } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'CREATE', entityType: 'LabourRate', entityId: created.id, after: asLog(created) },
      });
      return created;
    });
  },

  /** Only what changed is logged. @throws {ApiError} NOT_FOUND; as for create. */
  async update(id: string, input: LabourRateUpdate, actorId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:labour-rate'))`;
      const rate = await tx.labourRate.findUnique({ where: { id } });
      if (!rate) throw Errors.notFound('Labour rate');
      const data: Prisma.LabourRateUpdateInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (input.role !== undefined) {
        const role = checkedRole(input.role);
        if (role !== rate.role) {
          await refuseTaken(role, id, tx);
          data.role = role;
          before.role = rate.role;
          after.role = role;
        }
      }
      if (input.hourlyRate !== undefined) {
        const next = checkedRate(input.hourlyRate);
        if (!rate.hourlyRate.equals(next)) {
          data.hourlyRate = next;
          before.hourlyRate = rate.hourlyRate.toFixed(2);
          after.hourlyRate = new Prisma.Decimal(next).toFixed(2);
        }
      }
      if (input.active !== undefined && input.active !== rate.active) {
        data.active = input.active;
        before.active = rate.active;
        after.active = input.active;
      }
      if (Object.keys(after).length === 0) return rate;
      const updated = await tx.labourRate.update({ where: { id }, data });
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'UPDATE', entityType: 'LabourRate', entityId: id,
          before: { role: rate.role, ...before } as Prisma.InputJsonValue, after: { role: updated.role, ...after } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  },
};
