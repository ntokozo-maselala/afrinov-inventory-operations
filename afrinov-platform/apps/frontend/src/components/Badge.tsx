type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const tones: Record<Tone, string> = {
  neutral: 'badge-neutral',
  success: 'badge-success',
  warning: 'badge-warning',
  danger:  'badge-danger',
  info:    'badge-info',
  brand:   'badge-brand',
};

interface BadgeProps {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}

export function Badge({ tone = 'neutral', children, dot, className = '', title }: BadgeProps) {
  const dotClass: Record<Tone, string> = {
    neutral: 'bg-surface-400',
    success: 'bg-success-500',
    warning: 'bg-warning-500',
    danger:  'bg-danger-500',
    info:    'bg-info-500',
    brand:   'bg-brand-500',
  };
  return (
    <span className={`${tones[tone]} ${className}`} title={title}>
      {dot && <span className={`dot ${dotClass[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

interface MovementBadgeProps { type: string }

const movementTone: Record<string, Tone> = {
  RECEIPT: 'success',
  ISSUE: 'danger',
  TRANSFER_OUT: 'info',
  TRANSFER_IN: 'info',
  ADJUSTMENT: 'warning',
  RETURN: 'success',
};

const movementLabel: Record<string, string> = {
  RECEIPT: 'Receipt',
  ISSUE: 'Issue',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  ADJUSTMENT: 'Adjustment',
  RETURN: 'Return',
};

export function MovementBadge({ type }: MovementBadgeProps) {
  return <Badge tone={movementTone[type] ?? 'neutral'} dot>{movementLabel[type] ?? type}</Badge>;
}

const poTone: Record<string, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'info',
  APPROVED: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
};

const poLabel: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  PARTIALLY_RECEIVED: 'Partly received',
  RECEIVED: 'Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export function PurchaseOrderStatusBadge({ status }: { status: string }) {
  return <Badge tone={poTone[status] ?? 'neutral'} dot>{poLabel[status] ?? status}</Badge>;
}

const grTone: Record<string, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  POSTED: 'success',
};

const grLabel: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  POSTED: 'Posted',
};

export function GoodsReceiptStatusBadge({ status }: { status: string }) {
  return <Badge tone={grTone[status] ?? 'neutral'} dot>{grLabel[status] ?? status}</Badge>;
}