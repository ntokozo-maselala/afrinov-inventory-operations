import type { ReactNode } from 'react';
import { KPICard, type KPITrend } from './KPICard';
import { KPICardSkeleton } from './KPICardSkeleton';

export interface DashboardKPI {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'info';
  trend?: KPITrend;
  trendValue?: string;
  trendLabel?: string;
  helper?: string;
  loading?: boolean;
  href?: string;
  onClick?: () => void;
}

interface KPIGridProps {
  kpis: DashboardKPI[];
  loading?: boolean;
  error?: { message: string } | null;
  skeletonCount?: number;
}

export function KPIGrid({ kpis, loading, error, skeletonCount }: KPIGridProps) {
  if (error) {
    return (
      <div
        className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3"
        role="status"
        aria-label="Dashboard data error"
      >
        {kpis.map((k, i) => (
          <KPICard
            key={`error-${i}`}
            label={k.label}
            value="—"
            icon={k.icon}
            tone="neutral"
            loading={false}
            href={k.href}
          />
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPICardSkeleton count={skeletonCount ?? kpis.length} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {kpis.map((k, i) => (
        <KPICard
          key={`kpi-${i}`}
          label={k.label}
          value={k.value}
          icon={k.icon}
          tone={k.tone}
          trend={k.trend}
          trendValue={k.trendValue}
          trendLabel={k.trendLabel}
          helper={k.helper}
          loading={k.loading}
          href={k.href}
        />
      ))}
    </div>
  );
}
