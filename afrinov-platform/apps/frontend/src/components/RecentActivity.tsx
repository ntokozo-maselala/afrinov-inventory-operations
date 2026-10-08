import { useMemo } from 'react';
import type { ReportMovementRow } from '../mock/mockReport';
import type { PurchaseOrderSummary } from '../hooks/useDashboardData';
import { Icon } from './Icon';
import { Skeleton } from './ui/skeleton';
import { ScrollArea } from './ui/scroll-area';
import { formatDateTime } from '../lib/format';
import { Link } from 'react-router-dom';

interface ActivityEntry {
  id: string;
  type: 'movement' | 'po_created' | 'po_approved' | 'po_received' | 'po_closed' | 'po_cancelled';
  title: string;
  description: string;
  timestamp: string;
  actor?: string;
  href?: string;
  quantity?: string;
  tone: 'success' | 'danger' | 'info' | 'warning' | 'neutral';
  icon: JSX.Element;
}

const MOVEMENT_TYPE_CONFIG: Record<string, { tone: ActivityEntry['tone']; icon: JSX.Element; label: string }> = {
  RECEIPT: { tone: 'success', icon: <Icon.ArrowUp size={10} />, label: 'Stock received' },
  ISSUE: { tone: 'danger', icon: <Icon.ArrowDown size={10} />, label: 'Stock issued' },
  TRANSFER_OUT: { tone: 'info', icon: <Icon.Arrows size={10} />, label: 'Stock transferred out' },
  TRANSFER_IN: { tone: 'info', icon: <Icon.Arrows size={10} />, label: 'Stock transferred in' },
  ADJUSTMENT: { tone: 'warning', icon: <Icon.Alert size={10} />, label: 'Stock adjusted' },
};

export function RecentActivity({
  movements,
  purchaseOrders,
  loading,
}: {
  movements: ReportMovementRow[];
  purchaseOrders: PurchaseOrderSummary[] | null;
  loading: boolean;
}) {
  const entries: ActivityEntry[] = useMemo(() => {
    const all: ActivityEntry[] = [];

    // Movement events
    for (const m of movements ?? []) {
      const cfg = MOVEMENT_TYPE_CONFIG[m.type] ?? {
        tone: 'neutral' as const,
        icon: <Icon.Activity size={10} />,
        label: m.type,
      };
      const isPositive = m.quantity > 0;
      const isNegative = m.quantity < 0;
      const qtyPrefix = isPositive ? '+' : isNegative ? '\u2212' : '';
      all.push({
        id: `mov-${m.id}`,
        type: 'movement',
        title: cfg.label,
        description: `${m.materialSku} \u2022 ${m.materialName} \u2022 ${m.locationName}`,
        timestamp: m.postedAt,
        actor: m.actorName,
        href: `/materials/${m.materialId}`,
        quantity: `${qtyPrefix}${Math.abs(m.quantity)}`,
        tone: cfg.tone,
        icon: cfg.icon,
      });
    }

    // PO events
    for (const po of (purchaseOrders ?? []).slice(0, 10)) {
      const poDate = po.createdAt;
      let type: ActivityEntry['type'] = 'po_created';
      let label = 'Purchase order created';
      let tone: ActivityEntry['tone'] = 'info';
      let icon = <Icon.Doc size={10} />;

      if (po.status === 'APPROVED' && po.approvedAt) {
        type = 'po_approved';
        label = 'Purchase order approved';
        icon = <Icon.Check size={10} />;
      } else if (po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED') {
        type = 'po_received';
        label = po.status === 'RECEIVED' ? 'Purchase order received' : 'Purchase order partly received';
        icon = <Icon.Check size={10} />;
      } else if (po.status === 'CLOSED') {
        type = 'po_closed';
        label = 'Purchase order closed';
        tone = 'neutral';
        icon = <Icon.Check size={10} />;
      } else if (po.status === 'CANCELLED') {
        type = 'po_cancelled';
        label = 'Purchase order cancelled';
        tone = 'neutral';
        icon = <Icon.X size={10} />;
      }

      all.push({
        id: `po-${po.id}`,
        type,
        title: label,
        description: `${po.number} \u2022 ${po.supplier?.name ?? 'Unknown supplier'} \u2022 ${po.status}`,
        timestamp: poDate,
        href: `/purchase-orders/${po.id}`,
        quantity: po.number,
        tone,
        icon,
      });
    }

    return all
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 20);
  }, [movements, purchaseOrders]);

  if (loading && !movements?.length && !purchaseOrders?.length) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Recent Activity</h3>
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <Skeleton className="h-6 w-6 rounded" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2 w-1/2" />
              </div>
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Recent Activity</h3>
        <div className="text-center py-8 text-surface-400">
          <Icon.Activity size={24} className="mx-auto mb-2 text-surface-300" />
          <p>No recent activity in the selected period</p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-h3 text-surface-900">Recent Activity</h3>
        <Link to="/movements" className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline">
          View all activity
        </Link>
      </div>
      <ScrollArea maxHeight="320px">
        <ul className="space-y-2.5">
          {entries.map((entry) => (
            <ActivityItem key={entry.id} entry={entry} />
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const toneClasses = {
    success: 'bg-success-50 text-success-600',
    danger: 'bg-danger-50 text-danger-600',
    warning: 'bg-warning-50 text-warning-600',
    info: 'bg-info-50 text-info-600',
    neutral: 'bg-surface-100 text-surface-600',
  };

  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className={`mt-0.5 h-6 w-6 shrink-0 rounded flex items-center justify-center ${toneClasses[entry.tone]}`}
        aria-hidden="true"
      >
        {entry.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-surface-800 truncate">{entry.title}</p>
          <span className="text-xs text-surface-500 whitespace-nowrap ml-2">
            {formatDateTime(entry.timestamp)}
          </span>
        </div>
        <div className="text-xs text-surface-500 truncate mt-0.5">
          {entry.description}
          {entry.quantity && (
            <span className="font-mono text-surface-400 ml-1">{entry.quantity}</span>
          )}
        </div>
        {entry.actor && (
          <div className="text-xs text-surface-500 mt-0.5">
            by {entry.actor}
          </div>
        )}
      </div>
      {entry.href && (
        <Link to={entry.href} className="ml-2 shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700">
          Open
        </Link>
      )}
    </li>
  );
}
