import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { Badge } from './Badge';
import type { ReportResult } from '../mock/mockReport';
import { formatNumber } from '../lib/format';

export interface AttentionItem {
  id: string;
  type: 'out-of-stock' | 'low-stock' | 'pending-po' | 'overdue-po';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
  timestamp?: string;
}

interface AttentionRequiredProps {
  report: ReportResult | null;
  loading: boolean;
  lowStockItems: Array<{ materialId: string; sku: string; name: string; quantity: string; requiredStock: string }> | null;
  purchaseOrders: Array<{ id: string; number: string; status: string; supplier: { name: string }; createdAt: string; expectedDeliveryDate?: string | null }> | null;
}

const severityConfig = {
  critical: { bg: 'bg-danger-50', border: 'border-danger-100', icon: 'danger', text: 'text-danger-700' },
  warning: { bg: 'bg-warning-50', border: 'border-warning-100', icon: 'warning', text: 'text-warning-700' },
  info: { bg: 'bg-info-50', border: 'border-info-100', icon: 'info', text: 'text-info-700' },
};

function severityIcon(severity: 'critical' | 'warning' | 'info') {
  if (severity === 'critical') return <Icon.Alert size={16} aria-hidden="true" />;
  if (severity === 'warning') return <Icon.Warning size={16} aria-hidden="true" />;
  return <Icon.Info size={16} aria-hidden="true" />;
}

export function AttentionRequired({ report, loading, lowStockItems, purchaseOrders }: AttentionRequiredProps) {
  const items: AttentionItem[] = [];

  const exceptions = report?.exceptions ?? [];
  for (const line of exceptions) {
    if (line.status === 'OUT_OF_STOCK') {
      items.push({
        id: `oos-${line.materialId}-${line.locationId}`,
        type: 'out-of-stock',
        severity: 'critical',
        title: line.name,
        description: `${line.sku} at ${line.locationName} — ${formatNumber(line.quantity)} on hand (reorder: ${formatNumber(line.requiredStock)})`,
        actionLabel: 'View stock',
        actionHref: `/materials/${line.materialId}`,
      });
    }
  }

  const lowStock = lowStockItems ?? [];
  for (const item of lowStock.slice(0, 5)) {
    items.push({
      id: `ls-${item.materialId}`,
      type: 'low-stock',
      severity: 'warning',
      title: item.name,
      description: `${item.sku} — ${formatNumber(Number(item.quantity))} on hand (reorder: ${formatNumber(Number(item.requiredStock))})`,
      actionLabel: 'View details',
      actionHref: `/materials/${item.materialId}`,
    });
  }

  const pos = purchaseOrders ?? [];
  // eslint-disable-next-line react-hooks/purity
  const now = useMemo(() => Date.now(), []);
  for (const po of pos) {
    if (['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED', 'APPROVED', 'SENT'].includes(po.status)) {
      items.push({
        id: `po-${po.id}`,
        type: 'pending-po',
        severity: po.expectedDeliveryDate && new Date(po.expectedDeliveryDate).getTime() < now ? 'critical' : 'info',
        title: po.number,
        description: `${po.supplier.name} — ${po.status}`,
        actionLabel: 'View PO',
        actionHref: `/purchase-orders/${po.id}`,
        timestamp: po.expectedDeliveryDate ?? undefined,
      });
    }
  }

  if (loading && !report && !lowStockItems && !purchaseOrders) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Requires Attention</h3>
        <div className="space-y-2.5 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="surface-card p-6 text-center">
        <div className="flex flex-col items-center gap-2 text-surface-400">
          <Icon.Check size={24} aria-hidden="true" />
          <h4 className="text-sm font-medium text-surface-700">All items in good standing</h4>
          <p className="text-xs">No out-of-stock items, low stock, or pending purchase orders require immediate attention.</p>
        </div>
      </div>
    );
  }

  items.sort((a, b) => {
    const aScore = a.severity === 'critical' ? 0 : a.severity === 'warning' ? 1 : 2;
    const bScore = b.severity === 'critical' ? 0 : b.severity === 'warning' ? 1 : 2;
    return aScore - bScore;
  });

  return (
    <div className="surface-card p-4">
      <h3 className="text-h3 text-surface-900 mb-3">Requires Attention</h3>
      <ul className="space-y-2">
        {items.slice(0, 6).map((item) => {
          const cfg = severityConfig[item.severity];
          return (
            <li key={item.id} className={`rounded border ${cfg.bg} ${cfg.border} p-3`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${cfg.icon.replace('text-', 'bg-').replace('-700', '-50')} ${cfg.text}`} aria-hidden="true">
                  {severityIcon(item.severity)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-surface-800 truncate">{item.title}</p>
                    <Badge tone={item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info'} dot>
                      {item.severity === 'critical' ? 'Critical' : item.severity === 'warning' ? 'Warning' : 'Info'}
                    </Badge>
                  </div>
                  <p className="text-xs text-surface-600 mt-0.5">{item.description}</p>
                </div>
                <Link
                  to={item.actionHref}
                  className="ml-2 shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline whitespace-nowrap"
                >
                  {item.actionLabel}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > 6 && (
        <div className="mt-3 pt-2 border-t border-surface-200 text-center">
          <span className="text-xs text-surface-500">{items.length - 6} more items require attention</span>
        </div>
      )}
    </div>
  );
}
