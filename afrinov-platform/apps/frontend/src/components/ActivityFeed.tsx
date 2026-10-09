import { Icon } from './Icon';
import type { ReportMovementRow } from '../mock/mockReport';

interface ActivityFeedProps {
  movements: ReportMovementRow[];
  loading?: boolean;
  empty?: boolean;
  limit?: number;
}

const typeConfig: Record<string, { tone: 'success' | 'danger' | 'info' | 'warning' | 'neutral'; icon: JSX.Element; label: string }> = {
  RECEIPT: { tone: 'success', icon: <Icon.ArrowUp size={12} />, label: 'Stock received' },
  ISSUE: { tone: 'danger', icon: <Icon.ArrowDown size={12} />, label: 'Stock issued' },
  TRANSFER_OUT: { tone: 'info', icon: <Icon.Arrows size={12} />, label: 'Stock transferred out' },
  TRANSFER_IN: { tone: 'info', icon: <Icon.Arrows size={12} />, label: 'Stock transferred in' },
  ADJUSTMENT: { tone: 'warning', icon: <Icon.Alert size={12} />, label: 'Stock adjusted' },
  RETURN: { tone: 'success', icon: <Icon.ArrowUp size={12} />, label: 'Stock returned' },
};

export function ActivityFeed({ movements, loading = false, empty = false, limit = 10 }: ActivityFeedProps) {
  const items = movements?.slice(0, limit) ?? [];

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: limit }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="h-6 w-6 rounded bg-surface-100" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-3/4 bg-surface-100 rounded" />
              <div className="h-2 w-1/2 bg-surface-100 rounded" />
            </div>
            <div className="h-3 w-10 bg-surface-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (empty || items.length === 0) {
    return (
      <div className="text-center py-8 text-surface-400">
        <Icon.Activity size={24} className="mx-auto mb-2 text-surface-300" />
        <p>No recent activity</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-surface-100">
      {items.map((m) => {
        const cfg = typeConfig[m.type] ?? { tone: 'neutral', icon: null, label: m.type };
        const isPositive = m.quantity > 0;
        const isNegative = m.quantity < 0;
        const qtyPrefix = isPositive ? '+' : isNegative ? '−' : '';
        return (
          <li key={m.id} className="flex items-start gap-3 py-2.5">
            <span
              className={`mt-0.5 h-6 w-6 shrink-0 rounded flex items-center justify-center ${
                cfg.tone === 'success'
                  ? 'bg-success-50 text-success-600'
                  : cfg.tone === 'danger'
                  ? 'bg-danger-50 text-danger-600'
                  : cfg.tone === 'warning'
                  ? 'bg-warning-50 text-warning-600'
                  : 'bg-info-50 text-info-600'
              }`}
              aria-hidden="true"
            >
              {cfg.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-surface-800 truncate">
                  {cfg.label}{' '}
                  <span className="font-mono text-num text-surface-600">
                    {qtyPrefix}{Math.abs(m.quantity)}
                  </span>
                </p>
                <span className="text-xs text-surface-500 whitespace-nowrap ml-2">
                  {new Date(m.postedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-xs text-surface-500 truncate">
                {m.materialSku && <span className="font-mono text-surface-400 mr-1">{m.materialSku}</span>}
                {m.materialName}
                {m.locationName && <span className="mx-1 text-surface-300">·</span>}
                {m.locationName}
                {m.projectNumber && <span className="mx-1 text-surface-300">·</span>}
                {m.projectNumber}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
