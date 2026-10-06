import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface StatProps {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  trend?: { value: number; label?: string };
  className?: string;
}

const toneAccent: Record<NonNullable<StatProps['tone']>, string> = {
  neutral: 'bg-surface-100 text-surface-600',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger:  'bg-danger-50  text-danger-700',
  brand:   'bg-brand-50   text-brand-700',
};

export function Stat({ label, value, helper, tone = 'neutral', icon, onClick, href, trend, className = '' }: StatProps) {
  const inner = (
    <div className={`surface-card p-4 flex flex-col ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-eyebrow">{label}</span>
        <div className="flex items-center gap-2">
          {trend !== undefined && (
            <span className={`text-xs font-medium ${trend.value >= 0 ? 'text-success-700' : 'text-danger-700'}`}>
              {trend.value >= 0 ? '+' : ''}{trend.value.toFixed(1)}%
            </span>
          )}
          {icon && <span className={`h-7 w-7 rounded flex items-center justify-center ${toneAccent[tone]}`} aria-hidden="true">{icon}</span>}
        </div>
      </div>
      <div className="text-2xl font-semibold text-surface-900 text-num leading-tight">{value}</div>
      {helper && <div className="text-meta mt-1">{helper}</div>}
    </div>
  );
  if (href) {
    const isExternal = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:');
    if (isExternal) {
      return <a href={href} className="block hover:shadow-popover transition-shadow">{inner}</a>;
    }
    return <Link to={href} className="block hover:shadow-popover transition-shadow">{inner}</Link>;
  }
  if (onClick) return <button onClick={onClick} className="block text-left w-full hover:shadow-popover transition-shadow">{inner}</button>;
  return inner;
}
