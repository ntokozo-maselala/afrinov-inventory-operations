// Project material leaves the store only on the Workshop Manager's approval
// (ADR-043). The storeman asks for it from Issue stock; nothing moves while it
// waits. The Workshop Manager approves, possibly less than was asked, or
// rejects it, and the Director may stand in. Approving posts the issue, booked
// to the storeman who asked, exactly as Issue stock posts a Stores issue, and
// records the approval as the slip's confirmation: the person collecting
// doesn't confirm a project slip with a PIN or signature. The storeman may
// cancel their own request while it waits.
//
// A request takes nothing off the balance, but what waits counts against it: a
// second request can't ask for stock the first is already waiting for. The
// approval checks the balance again, as stock may have moved since.
import { Prisma, IssueRequestStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { getCurrentBalance, lockInventoryBalances } from '../../shared/inventory/balances.js';
import { checkWholeUnits } from '../../shared/units.js';
import { pageCursor, parseCursor, saDayOf } from '../../shared/dates.js';
import {
  InventoryService, checkLocationActive, checkMaterialActive, checkProjectTakesIssues, checkRecipientActive,
} from './inventory.service.js';
import { loadSlip, slipFingerprint } from './receipt-confirmation.service.js';

type Decimal = Prisma.Decimal;

/** Who approves a project issue, and who stands in (owner's answer, 16 Nov 2026). */
export const ISSUE_APPROVER_ROLE = 'WORKSHOP_MANAGER';
export const ISSUE_STAND_IN_ROLE = 'DIRECTOR';

/** Whole South African days from one moment to another: 0 on the same day. */
const daysBetweenDays = (from: Date, to: Date) => Math.max(0, Math.round((Date.parse(`${saDayOf(to)}T00:00:00Z`) - Date.parse(`${saDayOf(from)}T00:00:00Z`)) / 86_400_000));

export interface IssueRequestInput {
  projectNumber: string;
  recipientId: string;
  note?: string;
  lines: Array<{ materialId: string; locationId: string; quantity: number | string | Decimal }>;
  actorId: string;
}

export interface ApprovalInput {
  /** Each line's approved quantity, at most what was asked; 0 leaves it out. A line not given is approved in full. */
  lines?: Array<{ lineId: string; quantity: number | string | Decimal }>;
  note?: string;
}

const listed = {
  project: { select: { projectNumber: true, name: true } },
  recipient: { select: { id: true, name: true, type: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      material: { select: { id: true, sku: true, name: true, unitOfMeasure: true } },
      location: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.IssueRequestInclude;

type ListedRequest = Prisma.IssueRequestGetPayload<{ include: typeof listed }>;

const STATUS_WORD: Record<IssueRequestStatus, string> = { PENDING: 'waiting', APPROVED: 'approved', REJECTED: 'rejected', CANCELLED: 'cancelled' };

async function lockRequest(id: string, tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT id FROM issue_requests WHERE id = ${id} FOR UPDATE`;
  const request = await tx.issueRequest.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
  if (!request) throw Errors.notFound('IssueRequest');
  if (request.status !== IssueRequestStatus.PENDING) {
    throw Errors.invalidState(`This request was already ${STATUS_WORD[request.status]}.`, { status: request.status });
  }
  return request;
}

/** The roles that decide whether this person may approve, and whether they stood in. */
async function approverRoles(actorId: string, db: Prisma.TransactionClient): Promise<string[]> {
  const user = await db.user.findUnique({ where: { id: actorId }, select: { roles: { select: { role: { select: { name: true } } } } } });
  return (user?.roles ?? []).map((r) => r.role.name);
}

/** Refuses anyone but the Workshop Manager or the Director; returns whether they stood in. */
function checkApprover(roles: string[]): { standIn: boolean } {
  if (roles.includes(ISSUE_APPROVER_ROLE)) return { standIn: false };
  if (roles.includes(ISSUE_STAND_IN_ROLE)) return { standIn: true };
  throw Errors.forbidden('Project issues are approved by the Workshop Manager, or the Director standing in.');
}

/**
 * How much of each stock other waiting requests ask for, by material and
 * location, for one project. Counted against the balance so two requests
 * can't both be waiting for the same stock.
 */
async function waitingFor(projectNumber: string, keys: Array<{ materialId: string; locationId: string }>, db: Prisma.TransactionClient | typeof prisma, exceptId?: string): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>();
  if (keys.length === 0) return out;
  const rows = await db.issueRequestLine.groupBy({
    by: ['materialId', 'locationId'],
    where: {
      request: { projectNumber, status: IssueRequestStatus.PENDING, ...(exceptId ? { id: { not: exceptId } } : {}) },
      OR: keys.map((k) => ({ materialId: k.materialId, locationId: k.locationId })),
    },
    _sum: { quantity: true },
  });
  for (const r of rows) out.set(`${r.materialId}|${r.locationId}`, r._sum.quantity ?? toDecimal(0));
  return out;
}

function shape(r: ListedRequest, now: Date, onHand?: Map<string, Decimal>) {
  return {
    id: r.id,
    projectNumber: r.projectNumber,
    projectName: r.project.name,
    recipient: r.recipient,
    note: r.note,
    status: r.status,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    standIn: r.standIn,
    issueId: r.issueId,
    cursor: pageCursor(r.requestedAt, r.id),
    daysWaiting: daysBetweenDays(r.requestedAt, r.decidedAt ?? now),
    lines: r.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      material: l.material,
      location: l.location,
      quantity: l.quantity.toString(),
      approvedQuantity: l.approvedQuantity?.toString() ?? null,
      // Held for the project there now, for whoever decides a waiting one.
      onHand: onHand?.get(`${l.materialId}|${l.locationId}`)?.toString() ?? null,
    })),
  };
}

export type IssueRequestView = ReturnType<typeof shape>;

export const IssueRequestService = {
  /**
   * Records the storeman's issue of project material for approval. Checked as
   * the issue itself will be, so one that could never be posted (an inactive
   * item, too little held for the project) is refused at once.
   */
  async request(input: IssueRequestInput, within?: Prisma.TransactionClient): Promise<{ status: 'PENDING_APPROVAL'; requestId: string }> {
    if (!input.recipientId) throw Errors.validation('Choose who the stock is issued to');
    if (input.lines.length === 0) throw Errors.validation('Add at least one item to issue');
    const projectNumber = input.projectNumber;
    const lines = input.lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, qty: toDecimal(l.quantity) }));
    if (lines.some((l) => !gtZero(l.qty))) throw Errors.validation('Issue quantity must be positive');

    const totals = new Map<string, { materialId: string; locationId: string; qty: Decimal }>();
    for (const l of lines) {
      const key = `${l.materialId}|${l.locationId}`;
      const t = totals.get(key);
      if (t) t.qty = t.qty.plus(l.qty);
      else totals.set(key, { ...l });
    }

    return inTx(within, async (tx) => {
      // The balance lock an issue takes, so a request and an issue (or two
      // requests) of the same stock can't both see it free.
      await lockInventoryBalances([...totals.values()].map((t) => ({ ...t, heldForProject: projectNumber })), tx);
      await checkRecipientActive(input.recipientId, tx);
      await checkProjectTakesIssues(projectNumber, tx);
      const skus = new Map<string, string>();
      for (const t of totals.values()) {
        if (skus.has(t.materialId)) continue;
        const material = await checkMaterialActive(t.materialId, tx);
        if (material.category === 'TOOLS') throw Errors.validation(`${material.sku} is a tool: check it out on the Tools page instead of issuing it`);
        skus.set(t.materialId, material.sku);
      }
      await checkWholeUnits(lines.map((l) => ({ materialId: l.materialId, quantity: l.qty })), tx);
      const waiting = await waitingFor(projectNumber, [...totals.values()], tx);
      for (const t of totals.values()) {
        await checkLocationActive(t.locationId, tx);
        const held = await getCurrentBalance({ ...t, heldForProject: projectNumber }, tx);
        const asked = waiting.get(`${t.materialId}|${t.locationId}`) ?? toDecimal(0);
        const free = held.minus(asked);
        if (free.lt(t.qty)) {
          const sku = skus.get(t.materialId)!;
          throw Errors.insufficientBalance(
            asked.gt(0)
              ? `Cannot ask for ${t.qty.toString()} × ${sku}: ${held.toString()} is held for project ${projectNumber} here and ${asked.toString()} of it is already waiting for approval.`
              : `Cannot ask for ${t.qty.toString()} × ${sku}: only ${held.toString()} is held for project ${projectNumber} here.`,
            { materialId: t.materialId, locationId: t.locationId, requested: t.qty.toString(), available: (free.isNegative() ? toDecimal(0) : free).toString() },
          );
        }
      }

      const created = await tx.issueRequest.create({
        data: {
          projectNumber,
          recipientId: input.recipientId,
          note: input.note?.trim() || null,
          requestedById: input.actorId,
          lines: { create: lines.map((l, i) => ({ lineNo: i + 1, materialId: l.materialId, locationId: l.locationId, quantity: l.qty })) },
        },
        select: { id: true },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId, action: 'ISSUE_REQUEST', entityType: 'IssueRequest', entityId: created.id,
          after: { status: 'PENDING', projectNumber, recipientId: input.recipientId, lines: lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, quantity: l.qty.toString() })) },
        },
      });
      return { status: 'PENDING_APPROVAL', requestId: created.id };
    });
  },

  /**
   * Requests, newest first, a page at a time (`before`, a cursor from the last
   * row): those waiting by default. `requestedById` keeps one person's own.
   * A waiting request shows what is held for the project at each line now.
   */
  async list(filter: { status?: IssueRequestStatus; requestedById?: string; projectNumber?: string; before?: string; limit?: number } = {}, now = new Date()): Promise<IssueRequestView[]> {
    const where: Prisma.IssueRequestWhereInput = { status: filter.status ?? IssueRequestStatus.PENDING };
    if (filter.requestedById) where.requestedById = filter.requestedById;
    if (filter.projectNumber) where.projectNumber = filter.projectNumber;
    if (filter.before) {
      const { at, id } = parseCursor(filter.before);
      where.OR = [{ requestedAt: { lt: at } }, { requestedAt: at, id: { lt: id } }];
    }
    const rows = await prisma.issueRequest.findMany({
      where,
      include: listed,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
    const pending = rows.filter((r) => r.status === IssueRequestStatus.PENDING);
    const balances = pending.length === 0 ? [] : await prisma.inventoryBalance.findMany({
      where: { OR: pending.flatMap((r) => r.lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, heldForProject: r.projectNumber }))) },
      select: { materialId: true, locationId: true, heldForProject: true, quantity: true },
    });
    return rows.map((r) => {
      if (r.status !== IssueRequestStatus.PENDING) return shape(r, now);
      const onHand = new Map<string, Decimal>();
      for (const l of r.lines) onHand.set(`${l.materialId}|${l.locationId}`, toDecimal(0));
      for (const b of balances) if (b.heldForProject === r.projectNumber && onHand.has(`${b.materialId}|${b.locationId}`)) onHand.set(`${b.materialId}|${b.locationId}`, b.quantity);
      return shape(r, now, onHand);
    });
  },

  /** How many wait for approval, and since when the oldest has, for the Dashboard. */
  async summary(now = new Date()): Promise<{ waiting: number; oldestRequestedAt: string | null; oldestDays: number | null }> {
    const [waiting, oldest] = await Promise.all([
      prisma.issueRequest.count({ where: { status: IssueRequestStatus.PENDING } }),
      prisma.issueRequest.findFirst({ where: { status: IssueRequestStatus.PENDING }, orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }], select: { requestedAt: true } }),
    ]);
    return { waiting, oldestRequestedAt: oldest?.requestedAt.toISOString() ?? null, oldestDays: oldest ? daysBetweenDays(oldest.requestedAt, now) : null };
  },

  /**
   * Approves it, possibly for less than was asked, and posts the issue for
   * what was approved. Only the Workshop Manager, or the Director standing in,
   * and never whoever asked for it. The issue's own checks run again: stock may
   * have moved, the item been retired or the project closed since.
   */
  async approve(id: string, input: ApprovalInput, actorId: string, within?: Prisma.TransactionClient): Promise<{ id: string; issueId: string; transactionIds: string[] }> {
    return inTx(within, async (tx) => {
      const { standIn } = checkApprover(await approverRoles(actorId, tx));
      const request = await lockRequest(id, tx);
      if (request.requestedById === actorId) throw Errors.forbidden('You asked for this issue, so someone else must approve it.');

      const given = new Map<string, Decimal>();
      for (const l of input.lines ?? []) {
        if (given.has(l.lineId)) throw Errors.validation('A line is given twice.');
        given.set(l.lineId, toDecimal(l.quantity));
      }
      const known = new Set(request.lines.map((l) => l.id));
      if ([...given.keys()].some((lineId) => !known.has(lineId))) throw Errors.validation('A line given is not on this request.');
      const approved = request.lines.map((l) => ({ line: l, qty: given.get(l.id) ?? l.quantity }));
      for (const a of approved) {
        if (a.qty.isNegative()) throw Errors.validation('An approved quantity can\'t be below 0.');
        if (a.qty.gt(a.line.quantity)) throw Errors.validation(`Line ${a.line.lineNo}: approve at most the ${a.line.quantity.toString()} asked for.`);
      }
      const issued = approved.filter((a) => a.qty.gt(0));
      if (issued.length === 0) throw Errors.validation('Approve at least one line, or reject the request.');

      const { issueId, transactionIds } = await InventoryService.issue({
        recipientId: request.recipientId,
        projectNumber: request.projectNumber,
        lines: issued.map((a) => ({ materialId: a.line.materialId, locationId: a.line.locationId, quantity: a.qty, heldForProject: request.projectNumber })),
        // The storeman hands it over, so the movement is theirs, as an approved write-off is its asker's.
        actorId: request.requestedById,
        approvedRequestId: id,
      }, tx);

      // The approval is the slip's confirmation (ADR-043): no PIN or signature is asked for.
      const slip = await loadSlip(issueId, tx);
      await tx.receiptConfirmation.create({
        data: { slipId: issueId, slipKind: 'ISSUE', method: 'APPROVAL', linesFingerprint: slipFingerprint(slip.lines), capturedById: actorId },
      });

      const now = new Date();
      for (const a of approved) {
        await tx.issueRequestLine.update({ where: { id: a.line.id }, data: { approvedQuantity: a.qty } });
      }
      const reduced = approved.some((a) => !a.qty.equals(a.line.quantity));
      await tx.issueRequest.update({
        where: { id },
        data: { status: IssueRequestStatus.APPROVED, decidedById: actorId, decidedAt: now, decisionNote: input.note?.trim() || null, standIn, issueId },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId, action: 'ISSUE_REQUEST_APPROVE', entityType: 'IssueRequest', entityId: id,
          before: { status: 'PENDING' },
          after: {
            status: 'APPROVED', issueId, standIn, requestedById: request.requestedById,
            ...(reduced ? { lines: approved.map((a) => ({ lineNo: a.line.lineNo, asked: a.line.quantity.toString(), approved: a.qty.toString() })) } : {}),
          },
        },
      });
      return { id, issueId, transactionIds };
    });
  },

  /** Turns it down, posting nothing: the Workshop Manager, or the Director standing in. */
  async reject(id: string, reason: string, actorId: string, within?: Prisma.TransactionClient): Promise<{ id: string }> {
    const note = reason.trim();
    if (!note) throw Errors.validation('Say why it is rejected.');
    return inTx(within, async (tx) => {
      const { standIn } = checkApprover(await approverRoles(actorId, tx));
      const request = await lockRequest(id, tx);
      if (request.requestedById === actorId) throw Errors.forbidden('You asked for this issue: cancel it instead.');
      await tx.issueRequest.update({
        where: { id },
        data: { status: IssueRequestStatus.REJECTED, decidedById: actorId, decidedAt: new Date(), decisionNote: note, standIn },
      });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'ISSUE_REQUEST_REJECT', entityType: 'IssueRequest', entityId: id, before: { status: 'PENDING' }, after: { status: 'REJECTED', reason: note, standIn } },
      });
      return { id };
    });
  },

  /** Withdraws it, posting nothing: only whoever asked for it. */
  async cancel(id: string, reason: string, actorId: string, within?: Prisma.TransactionClient): Promise<{ id: string }> {
    const note = reason.trim();
    if (!note) throw Errors.validation('Say why it is cancelled.');
    return inTx(within, async (tx) => {
      const request = await lockRequest(id, tx);
      if (request.requestedById !== actorId) throw Errors.forbidden('Only whoever asked for this issue can cancel it.');
      await tx.issueRequest.update({
        where: { id },
        data: { status: IssueRequestStatus.CANCELLED, decidedById: actorId, decidedAt: new Date(), decisionNote: note },
      });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'ISSUE_REQUEST_CANCEL', entityType: 'IssueRequest', entityId: id, before: { status: 'PENDING' }, after: { status: 'CANCELLED', reason: note } },
      });
      return { id };
    });
  },
};
