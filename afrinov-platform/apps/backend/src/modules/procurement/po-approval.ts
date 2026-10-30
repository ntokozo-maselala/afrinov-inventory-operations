// Approval by order value, as on the AFRI-0000_x template, where the approver
// is chosen by the order total (Ona Moloane under R500 000, Simbongile
// Bantubani from R500 000). Here each user who may approve has a limit: the
// largest order total, in rand including VAT, they may approve. No limit
// means any order. Limits are in rand, so an order in another currency needs
// an approver without a limit. Every line must have a price first, or the
// total the limit is checked against is not known.
//
// Each kind of order has its own approvers (Stores and Procurement Separation
// Roadmap): a project order those who approve purchase orders, a Stores order
// the store, who order Stores stock. Limits work the same for both.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { PermissionCode } from '../../shared/permissions.js';
import { orderTotals } from './po-pricing.js';
import type { OrderKind } from './procurement.service.js';

type Num = Prisma.Decimal | number | string;
type Priceable = { orderedQty: Num; unitPrice?: Num | null };

export interface OrderForApproval {
  currency?: string | null;
  vatRate?: Num | null;
  lines: Priceable[];
}

export interface Approver { id: string; name: string; approvalLimit: string | null }

export type ApprovalBlock =
  | { code: 'UNPRICED'; message: string }
  | { code: 'OVER_LIMIT'; message: string };

const rand = (v: Num) => `R ${new Prisma.Decimal(v).toNumber().toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Whether an order of this total and currency is within the limit. Null limit: any order. */
export function withinLimit(limit: Num | null | undefined, total: Num, currency: string): boolean {
  if (limit === null || limit === undefined) return true;
  if (currency !== 'ZAR') return false;
  return new Prisma.Decimal(total).lte(new Prisma.Decimal(limit));
}

/** Why this order can't be approved by someone with this limit, or null when it can. */
export function approvalBlock(po: OrderForApproval, limit: Num | null | undefined): ApprovalBlock | null {
  const totals = orderTotals(po.lines, po.vatRate ?? 0);
  if (totals.unpricedLines > 0) {
    const n = totals.unpricedLines;
    return { code: 'UNPRICED', message: `${n} line${n === 1 ? ' has' : 's have'} no price. Add prices before approving, so the order total is known.` };
  }
  const currency = po.currency ?? 'ZAR';
  if (withinLimit(limit, totals.net, currency)) return null;
  if (currency !== 'ZAR') {
    return { code: 'OVER_LIMIT', message: `This order is in ${currency}. Approval limits are in rand, so it needs an approver without a limit.` };
  }
  return { code: 'OVER_LIMIT', message: `This order is ${rand(totals.net)} including VAT; your approval limit is ${rand(limit!)}.` };
}

/**
 * Segregation of duties (ADR-021, PRA-06): whoever raised an order cannot also
 * approve it, for either kind and for administrators too, so every order
 * commits company money on two people's say-so. Returns the reason, or null
 * when this user may approve.
 */
export function selfApprovalBlock(po: { createdById: string }, actorId: string): string | null {
  return po.createdById === actorId ? 'You raised this order, so someone else must approve it.' : null;
}

/** The permission that approves an order of this kind. */
export function approvePermissionFor(kind: OrderKind) {
  return kind === 'stores' ? PermissionCode.OrderStoresStock : PermissionCode.ApprovePurchaseOrder;
}

/** Active users who may approve orders of this kind, with their limits, most senior first. */
export async function listApprovers(kind: OrderKind = 'projects'): Promise<Approver[]> {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      roles: { some: { role: { permissions: { some: { permission: { code: approvePermissionFor(kind) } } } } } },
    },
    select: { id: true, name: true, approvalLimit: true },
  });
  return users
    .map((u) => ({ id: u.id, name: u.name, approvalLimit: u.approvalLimit?.toString() ?? null }))
    .sort((a, b) => {
      if (a.approvalLimit === b.approvalLimit) return a.name.localeCompare(b.name);
      if (a.approvalLimit === null) return -1;
      if (b.approvalLimit === null) return 1;
      return Number(b.approvalLimit) - Number(a.approvalLimit);
    });
}

/** The approvers whose limit covers this order, leaving out whoever raised it. */
export function approversFor(po: OrderForApproval & { createdById?: string }, approvers: Approver[]): Approver[] {
  const totals = orderTotals(po.lines, po.vatRate ?? 0);
  if (totals.unpricedLines > 0) return [];
  return approvers.filter((a) => a.id !== po.createdById && withinLimit(a.approvalLimit, totals.net, po.currency ?? 'ZAR'));
}

/** "Ask Simbongile Bantubani to approve it." or a fallback when nobody can. */
export function whoToAsk(names: string[]): string {
  if (names.length === 0) return 'Nobody has a high enough limit: an admin can raise one under Settings → Users.';
  if (names.length === 1) return `Ask ${names[0]} to approve it.`;
  return `Ask ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]} to approve it.`;
}
