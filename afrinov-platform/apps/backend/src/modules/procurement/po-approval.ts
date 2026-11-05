// Who signs a purchase order, as Afrinov approves them. By the order's value,
// in rand excluding VAT:
//   - a project order under the threshold (R200 000): the Procurement Manager;
//   - a project order at or above it: the Procurement Manager, then the Director;
//   - a Stores order, at any value: the Procurement Manager.
// The CEO or Workshop Manager may sign a project order's step in place of either
// signer, and the Workshop Manager a Stores order's. Stand-ins may sign at any
// time; the signature records that one did. Nobody signs an order twice, and
// Admin signs only by holding one of these roles.
//
// Nobody signs an order they raised (segregation of duties): raising,
// approving and receiving the same order is one person spending the
// company's money unchecked. Another holder of the role signs it.
//
// An order in another currency is converted at its locked exchange rate. Every
// line must have a price first, or its value is not known.
import { Prisma, type RoleName } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { SettingsService } from '../settings/settings.service.js';
import { orderTotals } from './po-pricing.js';
import { SUPPLIER_CURRENCIES } from './supplier-fields.js';
import type { OrderKind } from './procurement.service.js';

type Num = Prisma.Decimal | number | string;
type Priceable = { orderedQty: Num; unitPrice?: Num | null; discountPercent?: Num | null };

export type ApprovalStep = 'MANAGER' | 'DIRECTOR';
export const STEP_LABEL: Record<ApprovalStep, string> = { MANAGER: 'Procurement Manager', DIRECTOR: 'Director' };

const SIGNERS: Record<OrderKind, Partial<Record<ApprovalStep, { usual: RoleName; standIns: RoleName[] }>>> = {
  projects: {
    MANAGER: { usual: 'PROCUREMENT_MANAGER', standIns: ['CEO', 'WORKSHOP_MANAGER'] },
    DIRECTOR: { usual: 'DIRECTOR', standIns: ['CEO', 'WORKSHOP_MANAGER'] },
  },
  stores: {
    MANAGER: { usual: 'PROCUREMENT_MANAGER', standIns: ['WORKSHOP_MANAGER'] },
  },
};

export interface OrderForApproval {
  /** Who raised it: they never sign it. */
  createdById?: string | null;
  currency?: string | null;
  vatRate?: Num | null;
  exchangeRate?: Num | null;
  projectNumber: string | null;
  lines: Priceable[];
  signatures?: Array<{ step: ApprovalStep; signedById: string }>;
}

export interface ApprovalSettings {
  /** From this value, in rand excluding VAT, a project order also needs the Director. */
  threshold: number;
  /** Rand per unit of each currency; 0 when not set. */
  rates: Record<string, number>;
}

export interface Approver { id: string; name: string; standIn: boolean }

export type ApprovalBlock =
  | { code: 'UNPRICED'; message: string }
  | { code: 'NO_RATE'; message: string };

export interface ApprovalState {
  block: ApprovalBlock | null;
  /** The order's value in rand excluding VAT; null while it can't be worked out. */
  randValue: string | null;
  /** The signatures it needs, in signing order; empty while it can't be worked out. */
  steps: ApprovalStep[];
  /** The next signature it is waiting on; null when none. */
  next: ApprovalStep | null;
}

const THRESHOLD_KEY = 'purchaseOrders.directorApprovalFrom';
const rateKey = (currency: string) => `purchaseOrders.exchangeRate${currency}`;
const FOREIGN_CURRENCIES = SUPPLIER_CURRENCIES.filter((c) => c !== 'ZAR');

export async function loadApprovalSettings(): Promise<ApprovalSettings> {
  const values = await SettingsService.getValues([THRESHOLD_KEY, ...FOREIGN_CURRENCIES.map(rateKey)]);
  return {
    threshold: Number(values[THRESHOLD_KEY]),
    rates: Object.fromEntries(FOREIGN_CURRENCIES.map((c) => [c, Number(values[rateKey(c)])])),
  };
}

/** The rate to use for this order: the one locked on it, or today's until it has one. */
export function exchangeRateOf(po: Pick<OrderForApproval, 'currency' | 'exchangeRate'>, settings: ApprovalSettings): Prisma.Decimal | null {
  const currency = po.currency ?? 'ZAR';
  if (currency === 'ZAR') return null;
  if (po.exchangeRate !== null && po.exchangeRate !== undefined) return new Prisma.Decimal(po.exchangeRate);
  const today = settings.rates[currency];
  return today ? new Prisma.Decimal(today) : null;
}

export function noRateMessage(currency: string): string {
  return `This order is in ${currency}, and there is no exchange rate for ${currency} yet. An admin can add one under Settings → Purchase orders.`;
}

/** Where an order stands: its value in rand, the signatures it needs, and the next one. */
export function approvalState(po: OrderForApproval, settings: ApprovalSettings): ApprovalState {
  const totals = orderTotals(po.lines, po.vatRate ?? 0);
  if (totals.unpricedLines > 0) {
    const n = totals.unpricedLines;
    return {
      block: { code: 'UNPRICED', message: `${n} line${n === 1 ? ' has' : 's have'} no price. Add prices before approving, so the order total is known.` },
      randValue: null, steps: [], next: null,
    };
  }
  const currency = po.currency ?? 'ZAR';
  const rate = exchangeRateOf(po, settings);
  if (currency !== 'ZAR' && !rate) {
    return { block: { code: 'NO_RATE', message: noRateMessage(currency) }, randValue: null, steps: [], next: null };
  }
  const value = new Prisma.Decimal(totals.subtotal).times(rate ?? 1).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const needsDirector = (po.projectNumber ?? null) !== null && value.gte(settings.threshold);
  const steps: ApprovalStep[] = needsDirector ? ['MANAGER', 'DIRECTOR'] : ['MANAGER'];
  const signed = new Set((po.signatures ?? []).map((s) => s.step));
  return { block: null, randValue: value.toFixed(2), steps, next: steps.find((s) => !signed.has(s)) ?? null };
}

/** Whether someone with these roles signs any step of this kind of order. */
export function signsOrdersOfKind(kind: OrderKind, roles: string[]): boolean {
  return Object.values(SIGNERS[kind]).some((s) => roles.includes(s.usual) || s.standIns.some((r) => roles.includes(r)));
}

function holdsStep(kind: OrderKind, step: ApprovalStep, roles: string[]): boolean {
  const signer = SIGNERS[kind][step];
  return !!signer && (roles.includes(signer.usual) || signer.standIns.some((r) => roles.includes(r)));
}

/** Whether someone with these roles signs this step in place of its usual signer. */
export function isStandIn(kind: OrderKind, step: ApprovalStep, roles: string[]): boolean {
  const usual = SIGNERS[kind][step]?.usual;
  return !usual || !roles.includes(usual);
}

export const OWN_ORDER = 'You raised this order, so someone else must sign it.';

/** Why this person can't sign the order now, or null when they can. */
export function signRefusal(kind: OrderKind, state: ApprovalState, po: OrderForApproval, actor: { id: string; roles: string[] }): string | null {
  if (state.block) return state.block.message;
  // Whoever raised it never signs it, whatever their role.
  if (po.createdById && po.createdById === actor.id) return OWN_ORDER;
  // Signed in full but still pending, as when the threshold was raised part-way: any signer finishes it.
  if (!state.next) return signsOrdersOfKind(kind, actor.roles) ? null : 'This order has every signature it needs.';
  if ((po.signatures ?? []).some((s) => s.signedById === actor.id)) {
    return `You have already signed this order. It is waiting on the ${STEP_LABEL[state.next]}.`;
  }
  if (!holdsStep(kind, state.next, actor.roles)) {
    const yours = state.steps.find((s) => holdsStep(kind, s, actor.roles));
    if (yours && state.steps.indexOf(yours) > state.steps.indexOf(state.next)) {
      return `The ${STEP_LABEL[state.next]} signs this order first.`;
    }
    return `This order is waiting on the ${STEP_LABEL[state.next]}.`;
  }
  return null;
}

/**
 * Active users who may sign this step of this order, its usual signers first:
 * not whoever raised it, nor anyone who has signed it already.
 */
export async function listSigners(kind: OrderKind, step: ApprovalStep, po?: Pick<OrderForApproval, 'createdById' | 'signatures'>): Promise<Approver[]> {
  const signer = SIGNERS[kind][step];
  if (!signer) return [];
  const excluded = [po?.createdById, ...(po?.signatures ?? []).map((s) => s.signedById)].filter((id): id is string => !!id);
  const users = await prisma.user.findMany({
    where: { active: true, id: { notIn: excluded }, roles: { some: { role: { name: { in: [signer.usual, ...signer.standIns] } } } } },
    select: { id: true, name: true, roles: { select: { role: { select: { name: true } } } } },
  });
  return users
    .map((u) => ({ id: u.id, name: u.name, standIn: !u.roles.some((r) => r.role.name === signer.usual) }))
    .sort((a, b) => Number(a.standIn) - Number(b.standIn) || a.name.localeCompare(b.name));
}

/**
 * "Ask Simbongile Bantubani to sign it." or a fallback when nobody can: when
 * the only holder of the role raised the order (own), nobody *else* holds it.
 */
export function whoToAsk(names: string[], own = false): string {
  if (names.length === 0 && own) return 'Nobody else holds that role yet: an admin can assign it to another user under Settings → Users.';
  if (names.length === 0) return 'Nobody holds that role yet: an admin can assign it under Settings → Users.';
  if (names.length === 1) return `Ask ${names[0]} to sign it.`;
  return `Ask ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]} to sign it.`;
}
