import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

export type KPITrend = 'up' | 'down' | 'neutral';

interface KPICardProps {
  label: string;
  value: ReactNode | string;
  icon?: ReactNode;
  trend?: KPITrend;
  trendValue?: string;
  trendLabel?: string;
  helper?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'info';
  loading?: boolean;
  onClick?: () => void;
  href?: string;
  ariaLabel?: string;
}

const toneClasses: Record<NonNullable<KPICardProps['tone']>, string> = {
  neutral: 'bg-surface-100 text-surface-600',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  brand: 'bg-brand-50 text-brand-700',
  info: 'bg-info-50 text-info-700',
};

function TrendIndicator({
  trend,
  className = '',
}: {
  trend: KPITrend;
  className?: string;
}) {
  if (trend === 'up') {
    return (
      <Icon.ArrowUp
        size={12}
        className={`text-success-600 ${className}`}
        aria-hidden="true"
      />
    );
  }
  if (trend === 'down') {
    return (
      <Icon.ArrowDown
        size={12}
        className={`text-danger-600 ${className}`}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={`text-xs font-mono text-surface-400 ${className}`}
      aria-hidden="true"
    >
      —
    </span>
  );
}

export function KPICard({
  label,
  value,
  icon,
  trend,
  trendValue,
  trendLabel,
  helper,
  tone = 'neutral',
  loading = false,
  onClick,
  href,
  ariaLabel,
}: KPICardProps) {
  const inner = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-eyebrow">{label}</span>
        {icon && (
          <span
            className={`h-8 w-8 rounded-lg flex items-center justify-center ${toneClasses[tone]}`}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-7 w-3/4 bg-surface-100 rounded animate-pulse mb-1" />
      ) : (
        <div className="text-2xl font-semibold text-surface-900 text-num leading-tight">
          {value}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-1 mt-1 h-3 w-1/2 bg-surface-100 rounded animate-pulse" />
      ) : trend || trendValue ? (
        <div className="flex items-center gap-1 mt-1">
          {trend && <TrendIndicator trend={trend} />}
          {trendValue && (
            <span className="text-xs font-mono text-surface-600">{trendValue}</span>
          )}
          {trendLabel && (
            <span className="text-xs text-surface-500">· {trendLabel}</span>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-1 h-3 w-1/3 bg-surface-100 rounded animate-pulse" />
      ) : helper ? (
        <div className="mt-1 text-xs text-surface-500">{helper}</div>
      ) : null}
    </>
  );

  const cardContent = (
    <div
      className={`surface-card p-4 flex flex-col min-h-[112px] ${loading ? 'animate-pulse' : ''} ${onClick ? 'cursor-pointer' : ''}`}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
    >
      {inner}
    </div>
  );

  if (href) {
    const isExternal = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:');
    if (isExternal) {
      return (
        <a
          href={href}
          className={onClick ? '' : 'block hover:shadow-popover transition-shadow'}
          onClick={onClick ? (e) => {
            e.preventDefault();
            onClick();
          } : undefined}
        >
          {cardContent}
        </a>
      );
    }
    return (
      <Link
        to={href}
        className={onClick ? '' : 'block hover:shadow-popover transition-colors'}
        onClick={onClick}
      >
        {cardContent}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left w-full focus:outline-none"
      >
        {cardContent}
      </button>
    );
  }

  return cardContent;
}
