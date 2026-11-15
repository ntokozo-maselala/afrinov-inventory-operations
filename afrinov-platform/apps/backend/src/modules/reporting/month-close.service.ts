// Closing a month (system audit G1, ADR-041). The ledger never changes a past
// month: a correction is posted when it is made. But a value is quantity x
// unit cost, and a cost edit moved every past month's figures. Closing a month
// keeps its month-end report as it stood, which the report for that month then
// reads, and every item's unit cost then, which values that month's stock used.
// A month is closed once it is over, by an Admin; reopening one needs a reason.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { saMonth } from '../../shared/dates.js';
import type { MonthEndReport } from './month-end.service.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ClosedMonth { month: string; closedAt: string; closedBy: string }

export const MonthCloseService = {
  /** Closed months, newest first. */
  async list(): Promise<ClosedMonth[]> {
    const rows = await prisma.monthClose.findMany({ orderBy: { month: 'desc' }, select: { month: true, closedAt: true, closedBy: { select: { name: true } } } });
    return rows.map((r) => ({ month: r.month, closedAt: r.closedAt.toISOString(), closedBy: r.closedBy.name }));
  },

  /** The kept report of a closed month, or null when the month is open. */
  async kept(month: string): Promise<{ report: MonthEndReport; closed: ClosedMonth } | null> {
    const row = await prisma.monthClose.findUnique({ where: { month }, include: { closedBy: { select: { name: true } } } });
    if (!row) return null;
    return { report: row.report as unknown as MonthEndReport, closed: { month, closedAt: row.closedAt.toISOString(), closedBy: row.closedBy.name } };
  },

  /**
   * Each closed month's unit costs, for valuing stock used in it: by month,
   * then item; a month not closed is left out, so its stock used takes today's cost.
   */
  async pricesFor(months: readonly string[]): Promise<Map<string, Map<string, number | null>>> {
    if (months.length === 0) return new Map();
    const rows = await prisma.monthClosePrice.findMany({ where: { month: { in: [...months] } }, select: { month: true, materialId: true, unitCost: true } });
    const out = new Map<string, Map<string, number | null>>();
    for (const r of rows) {
      const m = out.get(r.month) ?? new Map<string, number | null>();
      m.set(r.materialId, r.unitCost === null ? null : r.unitCost.toNumber());
      out.set(r.month, m);
    }
    return out;
  },

  /**
   * Closes a month that is over, keeping its report and prices. The report is
   * worked out live first (`report`), so it is what the month showed until now.
   */
  async close(month: string, actorId: string, report: (month: string) => Promise<MonthEndReport>, now = new Date()): Promise<ClosedMonth> {
    if (!MONTH.test(month)) throw Errors.validation('Month must be YYYY-MM');
    if (month >= saMonth(now)) throw Errors.validation('A month is closed once it is over.');
    if (await prisma.monthClose.findUnique({ where: { month }, select: { month: true } })) throw Errors.conflict(`${month} is closed already.`);
    const kept = await report(month);
    const materials = await prisma.material.findMany({ select: { id: true, unitCost: true } });
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.monthClose.create({
          data: { month, closedById: actorId, report: kept as unknown as Prisma.InputJsonValue },
          include: { closedBy: { select: { name: true } } },
        });
        await tx.monthClosePrice.createMany({ data: materials.map((m) => ({ month, materialId: m.id, unitCost: m.unitCost })) });
        await tx.auditLogEntry.create({
          data: { actorId, action: 'MONTH_CLOSE', entityType: 'MonthClose', entityId: month, after: { month, value: kept.total.value, usedValue: kept.total.usedValue, items: materials.length } },
        });
        return created;
      });
      return { month, closedAt: row.closedAt.toISOString(), closedBy: row.closedBy.name };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.conflict(`${month} is closed already.`);
      throw err;
    }
  },

  /** Opens a closed month again, with a reason: its reports go back to today's prices. */
  async reopen(month: string, reason: string, actorId: string): Promise<{ month: string }> {
    const why = reason.trim();
    if (!why) throw Errors.validation('Say why the month is opened again.');
    return prisma.$transaction(async (tx) => {
      const row = await tx.monthClose.findUnique({ where: { month } });
      if (!row) throw Errors.notFound('Closed month');
      await tx.monthClose.delete({ where: { month } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'MONTH_REOPEN', entityType: 'MonthClose', entityId: month, before: { closedAt: row.closedAt.toISOString(), closedById: row.closedById }, after: { reason: why } },
      });
      return { month };
    });
  },
};
