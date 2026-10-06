import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: Array<{ label: string; to?: string }>;
  actions?: ReactNode;
  meta?: ReactNode;
}

export function PageHeader({ title, description, breadcrumb, actions, meta }: PageHeaderProps) {
  return (
    <header className="mb-6">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 text-xs text-surface-500">
          <ol className="flex items-center gap-1.5">
            {breadcrumb.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {c.to ? <Link className="hover:text-brand-600" to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                {i < breadcrumb.length - 1 && <span aria-hidden="true" className="text-surface-300">/</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-display text-surface-900">{title}</h1>
          {description && <p className="text-sm text-surface-500 mt-1 max-w-2xl">{description}</p>}
          {meta && <div className="mt-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 lg:ml-4">{actions}</div>}
      </div>
    </header>
  );
}

interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function SectionHeader({ title, description, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div>
        <h2 className="text-h2 text-surface-900">{title}</h2>
        {description && <p className="text-sm text-surface-500 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}