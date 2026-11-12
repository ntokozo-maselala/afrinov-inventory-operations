// Each change of an item's unit cost, with who made it and why (system audit
// C3): write-offs are valued at it, so a change is kept, not just the latest.
import { useApi } from '../hooks/useApi';
import { formatDateTime, formatNumber } from '../lib/format';

export interface CostChange { before: string | null; after: string | null; reason: string; by: string; at: string }

const rand = (v: string | null) => (v === null ? 'no price' : `R ${formatNumber(Number(v), { fixed: true })}`);

export function CostHistory({ materialId }: { materialId: string }) {
  const history = useApi<CostChange[]>(`/materials/${encodeURIComponent(materialId)}/cost-history`);
  // Not essential to the page: if it can't load, the section stays out of the way.
  if (!Array.isArray(history.data) || history.data.length === 0) return null;
  return (
    <section className="surface-card p-4 space-y-2" aria-label="Unit cost history">
      <h2 className="text-h3 text-surface-900">Unit cost history</h2>
      <ul className="space-y-2 text-sm">
        {history.data.slice(0, 10).map((c, i) => (
          <li key={`${c.at}-${i}`}>
            <div className="text-surface-900">{rand(c.before)} → {rand(c.after)}</div>
            <div className="text-xs text-surface-500">{c.reason} · {c.by} · {formatDateTime(c.at)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
