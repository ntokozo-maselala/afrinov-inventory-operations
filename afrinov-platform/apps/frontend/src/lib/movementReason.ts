// The Reason column of a stock movement (ADR-026). Each row says what happened
// at its own time: an issue of an item that tracks use says how much is still
// out; a return says what came back in that counter visit (back on the shelf,
// used up, broken); a used up or broken mark booked with nothing back on the
// shelf, and a withdrawal of a mark, are rows of their own and say how many.
// The screens lay the parts out (components/MovementReason.tsx); the
// downloads use the one-line text.
import { formatNumber } from './format';
import type { MovementRow } from '../api/types';

export type ReasonRow = Pick<MovementRow, 'type' | 'quantity' | 'reasonCode'> &
  Partial<Pick<MovementRow, 'reversesId' | 'recipientName' | 'returnedQuantity' | 'usedUpQuantity' | 'brokenQuantity' | 'trackUse' | 'reasonNote'>>;

/** Rows that record a mark rather than move stock: no quantity. */
export const MARK_TYPES = new Set(['USED_UP', 'BROKEN', 'OUTCOME_WITHDRAWN']);

const n = (q: string | null | undefined) => Number(q ?? 0);

/**
 * On an issue of an item that tracks use, how much is still out now; also on
 * an issue marked before its item was switched off, since those marks still
 * count. Null otherwise.
 */
export function stillOutOn(m: ReasonRow): number | null {
  if (m.type !== 'ISSUE' || m.reversesId || m.quantity === null) return null;
  if (!m.trackUse && n(m.usedUpQuantity) + n(m.brokenQuantity) === 0) return null;
  return -n(m.quantity) - n(m.returnedQuantity) - n(m.usedUpQuantity) - n(m.brokenQuantity);
}

export interface VisitFigures {
  /** Back on the shelf; only on a return. */
  back: number;
  usedUp: number;
  broken: number;
  /** A withdrawal of a mark booked earlier. */
  withdrawn: boolean;
}

/** What a return's visit, a mark or a withdrawal records; null on any other row. */
export function visitFigures(m: ReasonRow): VisitFigures | null {
  if (m.type === 'RETURN' && !m.reversesId) return { back: n(m.quantity), usedUp: n(m.usedUpQuantity), broken: n(m.brokenQuantity), withdrawn: false };
  if (MARK_TYPES.has(m.type)) return { back: 0, usedUp: n(m.usedUpQuantity), broken: n(m.brokenQuantity), withdrawn: m.type === 'OUTCOME_WITHDRAWN' };
  return null;
}

/** An adjustment's reason code as words: COUNT_VARIANCE → "count variance". */
export const reasonLabel = (code: string | null | undefined): string | null => (code ? code.replace(/_/g, ' ').toLowerCase() : null);

/** Who an issue went to, or who brought something back; null for anything else. */
export function counterparty(m: ReasonRow): string | null {
  if (!m.recipientName || m.reversesId) return null;
  if (m.type === 'ISSUE') return `To ${m.recipientName}`;
  if (m.type === 'RETURN' || MARK_TYPES.has(m.type)) return `From ${m.recipientName}`;
  return null;
}

/**
 * The Reason column as one line, for the downloads. withWho adds who an issue
 * went to or who brought something back, for a table with no column for it.
 */
export function movementReason(m: ReasonRow, { withWho = false }: { withWho?: boolean } = {}): string {
  const parts: string[] = [];
  if (withWho) { const who = counterparty(m); if (who) parts.push(who); }
  const out = stillOutOn(m);
  if (out !== null) parts.push(`still out ${formatNumber(out)}`);
  const v = visitFigures(m);
  if (v) {
    const figures = [
      m.type === 'RETURN' && `back ${formatNumber(v.back)}`,
      v.usedUp > 0 && `used up ${formatNumber(v.usedUp)}`,
      v.broken > 0 && `broken ${formatNumber(v.broken)}`,
    ].filter((p): p is string => !!p).join(', ');
    parts.push(v.withdrawn ? `withdrawn: ${figures}` : figures);
  }
  const code = reasonLabel(m.reasonCode);
  if (code) parts.push(code);
  return parts.join(' · ');
}
