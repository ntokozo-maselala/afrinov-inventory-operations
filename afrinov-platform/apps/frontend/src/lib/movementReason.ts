// The Reason column of a stock movement (ADR-026). Each row says what happened
// at its own time: an issue of an item that tracks use says how much is still
// out; a return says what came back in that counter visit (back on the shelf,
// used up, broken); a used up or broken mark booked with nothing back on the
// shelf, and a withdrawal of a mark, are rows of their own and say how many.
// The screens lay the parts out (components/MovementReason.tsx); the
// downloads use the one-line text.
import type { MovementRow } from '../api/types';

export type ReasonRow = Pick<MovementRow, 'type' | 'quantity' | 'reasonCode'> &
  Partial<Pick<MovementRow, 'reversesId' | 'recipientName' | 'returnedQuantity' | 'usedUpQuantity' | 'brokenQuantity' | 'trackUse' | 'reasonNote'>>;

/** Rows that record a mark rather than move stock: no quantity. */
export const MARK_TYPES = new Set(['USED_UP', 'BROKEN', 'OUTCOME_WITHDRAWN']);

const n = (q: string | null | undefined) => Number(q ?? 0);
/** Quantities are kept to four decimal places; rounding there drops floating-point dust (1.1 − 1 − 0.1). */
export const round4 = (x: number) => Math.round(x * 1e4) / 1e4 || 0; // never -0
/** A figure as the downloads write it, on the server too: plain digits, at most four decimals. */
const figureText = (x: number) => String(round4(x));

/**
 * On an issue of an item that tracks use, how much is still out now; also on
 * an issue marked before its item was switched off, since those marks still
 * count. Null otherwise.
 */
export function stillOutOn(m: ReasonRow): number | null {
  if (m.type !== 'ISSUE' || m.reversesId || m.quantity === null) return null;
  if (!m.trackUse && n(m.usedUpQuantity) + n(m.brokenQuantity) === 0) return null;
  return round4(-n(m.quantity) - n(m.returnedQuantity) - n(m.usedUpQuantity) - n(m.brokenQuantity));
}

/** Still out on an issue line of a report: none once the issue is reversed (Qodo, PR #144). */
export const issueStillOut = (m: ReasonRow & { reversedById?: string | null }): number | null => (m.reversedById ? null : stillOutOn(m));

/** Whether a report's issue lines need used up, broken and still out: an item tracks use, or once did. */
export const tracksUseOn = (lines: ReasonRow[]): boolean =>
  lines.some((l) => l.trackUse || n(l.usedUpQuantity) > 0 || n(l.brokenQuantity) > 0);

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

/**
 * The Used up, Broken and Still out columns of a download: what each row
 * itself recorded, so a column adds up. A counter visit gives its used up and
 * broken, a withdrawal the same as a negative; an issue gives its still out now.
 */
export function figureColumns(m: ReasonRow & { reversedById?: string | null }): Array<number | null> {
  if (m.reversesId) return [null, null, null];
  const v = visitFigures(m);
  if (v) {
    const sign = v.withdrawn ? -1 : 1;
    return [v.usedUp > 0 ? sign * v.usedUp : null, v.broken > 0 ? sign * v.broken : null, null];
  }
  return [null, null, issueStillOut(m)];
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
 * Without it, the text is exactly what the server's download writes
 * (movements-export.ts reasonText); both are tested against
 * backend movement-reason.cases.json.
 */
export function movementReason(m: ReasonRow, { withWho = false }: { withWho?: boolean } = {}): string {
  const parts: string[] = [];
  if (withWho) { const who = counterparty(m); if (who) parts.push(who); }
  const out = stillOutOn(m);
  if (out !== null) parts.push(`still out ${figureText(out)}`);
  const v = visitFigures(m);
  if (v) {
    const figures = [
      m.type === 'RETURN' && `back ${figureText(v.back)}`,
      v.usedUp > 0 && `used up ${figureText(v.usedUp)}`,
      v.broken > 0 && `broken ${figureText(v.broken)}`,
    ].filter((p): p is string => !!p).join(', ');
    parts.push(v.withdrawn ? `withdrawn: ${figures}` : figures);
  }
  const code = reasonLabel(m.reasonCode);
  if (code) parts.push(code);
  return parts.join(' · ');
}
