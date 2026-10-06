import type { ReactNode } from 'react';
import { Icon } from './Icon';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, { wrap: string; icon: string }> = {
  info:    { wrap: 'bg-info-50 border-info-100 text-info-700',    icon: 'text-info-500' },
  success: { wrap: 'bg-success-50 border-success-100 text-success-700', icon: 'text-success-500' },
  warning: { wrap: 'bg-warning-50 border-warning-100 text-warning-700', icon: 'text-warning-500' },
  danger:  { wrap: 'bg-danger-50 border-danger-100 text-danger-700',     icon: 'text-danger-500' },
};

interface AlertProps {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', title, children, className = '' }: AlertProps) {
  const IconCmp = tone === 'danger' || tone === 'warning' ? Icon.Alert : tone === 'success' ? Icon.Check : Icon.Info;
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded border px-3 py-2 ${tones[tone].wrap} ${className}`}>
      <span className={`mt-0.5 ${tones[tone].icon}`} aria-hidden="true"><IconCmp /></span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {children && <div className="text-xs mt-0.5 opacity-90">{children}</div>}
      </div>
    </div>
  );
}