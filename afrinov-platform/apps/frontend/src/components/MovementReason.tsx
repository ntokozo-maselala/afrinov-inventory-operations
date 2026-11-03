// The Reason cell of a movement table. Each row says what happened at its own
// time (ADR-026): an issue says who it went to and whether any is still out; a
// return, a used up or broken mark, or a withdrawal says who brought it back
// and lists what that visit recorded, labels left and numbers lined up right,
// with its note. Other movements show their reason code. The text for
// downloads is in lib/movementReason.ts.
import { Badge } from './Badge';
import { formatNumber } from '../lib/format';
import { counterparty, reasonLabel, stillOutOn, visitFigures, type ReasonRow } from '../lib/movementReason';

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-surface-500 whitespace-nowrap">{label}</dt>
      <dd className="m-0 text-right tabular-nums font-medium text-surface-900">{formatNumber(value)}</dd>
    </>
  );
}

export function MovementReason({ movement: m, withWho = false }: { movement: ReasonRow; withWho?: boolean }) {
  const who = withWho ? counterparty(m) : null;
  const out = stillOutOn(m);
  const v = visitFigures(m);
  const code = reasonLabel(m.reasonCode);
  if (!who && out === null && !v && !code) return <span className="text-surface-300">—</span>;

  const status = out !== null && (out > 0
    ? <Badge tone="warning" className="whitespace-nowrap">{formatNumber(out)} still out</Badge>
    : <Badge tone="success" className="whitespace-nowrap">Nothing out</Badge>);
  const figures = v ? [
    m.type === 'RETURN' && <Figure key="back" label="Back" value={v.back} />,
    v.usedUp > 0 && <Figure key="used" label="Used up" value={v.usedUp} />,
    v.broken > 0 && <Figure key="broken" label="Broken" value={v.broken} />,
  ].filter(Boolean) : [];
  // A visit's note, or why a mark was withdrawn.
  const note = v && m.reasonNote;

  return (
    <div className="flex flex-col gap-1">
      {(who || status) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {who && <span className="text-sm text-surface-800 whitespace-nowrap">{who}</span>}
          {status}
        </div>
      )}
      {figures.length > 0 && (
        <dl className={`m-0 grid grid-cols-[auto_auto] justify-start gap-x-4 text-xs leading-5 ${v?.withdrawn ? 'line-through decoration-surface-400' : ''}`}>{figures}</dl>
      )}
      {note && <span className="text-xs text-surface-500">{note}</span>}
      {code && <span className="text-meta">{code}</span>}
    </div>
  );
}
